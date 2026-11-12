import { and, eq, isNull, sql } from 'drizzle-orm';
import { sign } from 'hono/jwt';
import {
  normalizePhone,
  ROLE_NAMES,
  type MeResponse,
  type PermissionCode,
  type RoleCode,
} from '@ecm/shared';
import type { Bindings } from '../env';
import type { DB } from '../db/client';
import { roles, sessions, users } from '../db/schema';
import { Errors } from '../lib/errors';
import { DUMMY_PASSWORD_HASH, hashPassword, randomToken, sha256Hex, verifyPassword } from '../lib/crypto';
import { addDaysIso, addSeconds, nowIso } from '../lib/time';
import { auditInsert, type AuditMeta } from './audit.service';

export const MAX_FAILED_LOGINS = 10;
export const LOCK_MINUTES = 15;
/** Khoảng thời gian chấp nhận 2 request làm mới đồng thời (VD nhiều tab) mà không coi là đánh cắp token. */
export const REFRESH_RACE_GRACE_SECONDS = 30;

export type Client = 'WEB' | 'MOBILE';

export interface IssuedTokens {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  refreshExpiresAt: string;
  sessionId: number;
}

const iterations = (env: Bindings) => Number(env.PBKDF2_ITERATIONS) || 30_000;
const accessTtl = (env: Bindings) => Number(env.ACCESS_TOKEN_TTL_SECONDS) || 900;
const refreshDays = (env: Bindings, client: Client) =>
  client === 'MOBILE' ? Number(env.REFRESH_TTL_MOBILE_DAYS) || 30 : Number(env.REFRESH_TTL_WEB_DAYS) || 7;

export async function signAccessToken(
  env: Bindings,
  p: { userId: number; sessionId: number; role: RoleCode },
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return sign(
    { sub: String(p.userId), sid: p.sessionId, role: p.role, typ: 'access', iat: now, exp: now + accessTtl(env) },
    env.JWT_SECRET,
    'HS256',
  );
}

async function issueSession(
  db: DB,
  env: Bindings,
  p: { userId: number; role: RoleCode; client: Client; userAgent: string | null; ip: string | null; familyId?: string },
): Promise<IssuedTokens> {
  const refreshToken = randomToken(32);
  const refreshExpiresAt = addDaysIso(refreshDays(env, p.client));
  const [row] = await db
    .insert(sessions)
    .values({
      userId: p.userId,
      refreshTokenHash: await sha256Hex(refreshToken),
      client: p.client,
      userAgent: p.userAgent,
      ip: p.ip,
      expiresAt: refreshExpiresAt,
      familyId: p.familyId ?? randomToken(12),
    })
    .returning({ id: sessions.id });
  const sessionId = row!.id;
  return {
    accessToken: await signAccessToken(env, { userId: p.userId, sessionId, role: p.role }),
    accessTokenExpiresIn: accessTtl(env),
    refreshToken,
    refreshExpiresAt,
    sessionId,
  };
}

async function findUserByIdentifier(db: DB, identifier: string) {
  const id = identifier.trim();
  const cond = id.includes('@') ? eq(users.email, id.toLowerCase()) : eq(users.phone, normalizePhone(id) ?? id);
  const rows = await db
    .select({
      id: users.id,
      passwordHash: users.passwordHash,
      status: users.status,
      lockedUntil: users.lockedUntil,
      failedLoginCount: users.failedLoginCount,
      role: roles.code,
    })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(and(cond, isNull(users.deletedAt)))
    .limit(1);
  return rows[0];
}

export async function login(
  db: DB,
  env: Bindings,
  meta: AuditMeta,
  input: { identifier: string; password: string; client: Client },
): Promise<IssuedTokens & { userId: number }> {
  const user = await findUserByIdentifier(db, input.identifier);
  const now = nowIso();

  if (!user) {
    await verifyPassword(input.password, DUMMY_PASSWORD_HASH, iterations(env));
    await auditInsert(db, meta, {
      action: 'auth.login_failed',
      entityType: 'user',
      after: { identifier: input.identifier.slice(0, 100), reason: 'NOT_FOUND' },
    });
    throw Errors.invalidCredentials();
  }

  if (user.lockedUntil && user.lockedUntil > now) throw Errors.accountLocked(user.lockedUntil);

  const result = await verifyPassword(input.password, user.passwordHash, iterations(env));
  if (!result.ok) {
    const failed = user.failedLoginCount + 1;
    const lock = failed >= MAX_FAILED_LOGINS;
    const lockedUntil = lock ? addSeconds(LOCK_MINUTES * 60) : null;
    await db.batch([
      db
        .update(users)
        .set({ failedLoginCount: lock ? 0 : failed, lockedUntil: lockedUntil ?? user.lockedUntil })
        .where(eq(users.id, user.id)),
      auditInsert(db, meta, {
        action: lock ? 'auth.account_locked' : 'auth.login_failed',
        entityType: 'user',
        entityId: user.id,
        actorUserId: user.id,
        after: { failedCount: failed, lockedUntil },
      }),
    ]);
    if (lock) throw Errors.accountLocked(lockedUntil!);
    throw Errors.invalidCredentials();
  }

  if (user.status !== 'ACTIVE') throw Errors.accountDisabled();

  const tokens = await issueSession(db, env, {
    userId: user.id,
    role: user.role as RoleCode,
    client: input.client,
    userAgent: meta.userAgent,
    ip: meta.ip,
  });

  await db.batch([
    db
      .update(users)
      .set({
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: now,
        ...(result.needsRehash ? { passwordHash: await hashPassword(input.password, iterations(env)) } : {}),
      })
      .where(eq(users.id, user.id)),
    auditInsert(db, meta, {
      action: 'auth.login',
      entityType: 'user',
      entityId: user.id,
      actorUserId: user.id,
      after: { client: input.client, sessionId: tokens.sessionId },
    }),
  ]);

  return { ...tokens, userId: user.id };
}

export async function refresh(
  db: DB,
  env: Bindings,
  meta: AuditMeta,
  refreshToken: string,
): Promise<IssuedTokens & { userId: number }> {
  const hash = await sha256Hex(refreshToken);
  const [s] = await db
    .select({
      id: sessions.id,
      userId: sessions.userId,
      client: sessions.client,
      expiresAt: sessions.expiresAt,
      revokedAt: sessions.revokedAt,
      revokeReason: sessions.revokeReason,
      familyId: sessions.familyId,
      userStatus: users.status,
      userDeleted: users.deletedAt,
      role: roles.code,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(eq(sessions.refreshTokenHash, hash))
    .limit(1);

  if (!s) throw Errors.unauthorized('Phiên đăng nhập không hợp lệ');
  const now = nowIso();

  if (s.revokedAt) {
    const withinGrace =
      s.revokeReason === 'ROTATED' &&
      Date.now() - new Date(s.revokedAt).getTime() < REFRESH_RACE_GRACE_SECONDS * 1000;
    if (!withinGrace && s.revokeReason === 'ROTATED') {
      // Token đã xoay vòng bị dùng lại → nghi bị đánh cắp: thu hồi toàn bộ chuỗi phiên.
      await db.batch([
        db
          .update(sessions)
          .set({ revokedAt: now, revokeReason: 'REUSE_DETECTED' })
          .where(and(eq(sessions.familyId, s.familyId), isNull(sessions.revokedAt))),
        auditInsert(db, meta, {
          action: 'auth.refresh_reuse_detected',
          entityType: 'session',
          entityId: s.id,
          actorUserId: s.userId,
        }),
      ]);
    }
    throw Errors.unauthorized('Phiên đăng nhập đã hết hạn');
  }
  if (s.expiresAt <= now) throw Errors.unauthorized('Phiên đăng nhập đã hết hạn');
  if (s.userStatus !== 'ACTIVE' || s.userDeleted) throw Errors.accountDisabled();

  const revoked = await db
    .update(sessions)
    .set({ revokedAt: now, revokeReason: 'ROTATED', lastUsedAt: now })
    .where(and(eq(sessions.id, s.id), isNull(sessions.revokedAt)))
    .run();
  if (!revoked.meta.changes) throw Errors.unauthorized('Phiên đăng nhập đã hết hạn');

  const tokens = await issueSession(db, env, {
    userId: s.userId,
    role: s.role as RoleCode,
    client: s.client as Client,
    userAgent: meta.userAgent,
    ip: meta.ip,
    familyId: s.familyId,
  });
  await db.update(sessions).set({ replacedById: tokens.sessionId }).where(eq(sessions.id, s.id));
  return { ...tokens, userId: s.userId };
}

export async function revokeSession(db: DB, sessionId: number, reason = 'LOGOUT') {
  await db
    .update(sessions)
    .set({ revokedAt: nowIso(), revokeReason: reason })
    .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
}

export async function revokeSessionByRefreshToken(db: DB, refreshToken: string) {
  const hash = await sha256Hex(refreshToken);
  await db
    .update(sessions)
    .set({ revokedAt: nowIso(), revokeReason: 'LOGOUT' })
    .where(and(eq(sessions.refreshTokenHash, hash), isNull(sessions.revokedAt)));
}

export function revokeAllSessionsStmt(db: DB, userId: number, reason: string) {
  return db
    .update(sessions)
    .set({ revokedAt: nowIso(), revokeReason: reason })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}

export async function changePassword(
  db: DB,
  env: Bindings,
  meta: AuditMeta,
  p: { userId: number; sessionId: number; currentPassword: string; newPassword: string },
) {
  const [u] = await db.select({ hash: users.passwordHash }).from(users).where(eq(users.id, p.userId));
  if (!u) throw Errors.unauthorized();
  const v = await verifyPassword(p.currentPassword, u.hash, iterations(env));
  if (!v.ok) throw Errors.business('WRONG_PASSWORD', 'Mật khẩu hiện tại không đúng');
  const now = nowIso();
  await db.batch([
    db
      .update(users)
      .set({
        passwordHash: await hashPassword(p.newPassword, iterations(env)),
        mustChangePassword: false,
        passwordChangedAt: now,
        updatedAt: now,
      })
      .where(eq(users.id, p.userId)),
    // Đăng xuất mọi thiết bị khác, giữ phiên hiện tại.
    db
      .update(sessions)
      .set({ revokedAt: now, revokeReason: 'PASSWORD_CHANGED' })
      .where(and(eq(sessions.userId, p.userId), isNull(sessions.revokedAt), sql`${sessions.id} <> ${p.sessionId}`)),
    auditInsert(db, meta, { action: 'auth.password_changed', entityType: 'user', entityId: p.userId }),
  ]);
}

/** Tải thông tin người dùng + quyền cho phiên đang hoạt động (1 lượt batch D1). */
export async function loadSessionUser(d1: D1Database, userId: number, sessionId: number) {
  const [userRes, permRes] = await d1.batch([
    d1
      .prepare(
        `SELECT u.id, u.full_name, u.email, u.phone, u.status, u.must_change_password, u.deleted_at,
                r.code AS role, s.revoked_at, s.expires_at,
                (SELECT t.id FROM teachers t WHERE t.user_id = u.id AND t.deleted_at IS NULL) AS teacher_id,
                (SELECT g.id FROM guardians g WHERE g.user_id = u.id AND g.deleted_at IS NULL) AS guardian_id,
                (SELECT st.id FROM students st WHERE st.user_id = u.id AND st.deleted_at IS NULL) AS student_id,
                (SELECT f.id FROM files f WHERE f.id = u.avatar_file_id AND f.deleted_at IS NULL) AS avatar_file_id
           FROM sessions s
           JOIN users u ON u.id = s.user_id
           JOIN roles r ON r.id = u.role_id
          WHERE s.id = ?1 AND s.user_id = ?2`,
      )
      .bind(sessionId, userId),
    d1
      .prepare(
        `SELECT p.code FROM users u
           JOIN role_permissions rp ON rp.role_id = u.role_id
           JOIN permissions p ON p.id = rp.permission_id
          WHERE u.id = ?1`,
      )
      .bind(userId),
  ]);
  const row = userRes?.results[0] as
    | {
        id: number;
        full_name: string;
        email: string | null;
        phone: string | null;
        status: string;
        must_change_password: number;
        deleted_at: string | null;
        role: RoleCode;
        revoked_at: string | null;
        expires_at: string;
        teacher_id: number | null;
        guardian_id: number | null;
        student_id: number | null;
        avatar_file_id: number | null;
      }
    | undefined;
  if (!row || row.revoked_at || row.expires_at <= nowIso() || row.deleted_at || row.status !== 'ACTIVE') return null;
  const perms = new Set((permRes?.results ?? []).map((r) => (r as { code: PermissionCode }).code));
  return { row, perms };
}

export function toMeResponse(
  row: NonNullable<Awaited<ReturnType<typeof loadSessionUser>>>['row'],
  perms: Set<PermissionCode>,
): MeResponse {
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    roleName: ROLE_NAMES[row.role],
    permissions: [...perms].sort(),
    mustChangePassword: !!row.must_change_password,
    teacherId: row.teacher_id,
    guardianId: row.guardian_id,
    studentId: row.student_id,
    avatarFileId: row.avatar_file_id,
  };
}
