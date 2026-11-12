import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { normalizePersonName, normalizeSearch, type RoleCode, type StaffCreateInput, type UserUpdateInput } from '@ecm/shared';
import type { AuthUser, Bindings } from '../env';
import type { DB } from '../db/client';
import { users } from '../db/schema';
import { runBatch } from '../lib/batch';
import { hashPassword } from '../lib/crypto';
import { Errors } from '../lib/errors';
import { nowIso } from '../lib/time';
import { auditInsert, type AuditMeta } from './audit.service';
import { revokeAllSessionsStmt } from './auth.service';
import { assertIdentityFree, generateTempPassword } from './teachers.service';

const FAMILY_AND_TEACHER: readonly RoleCode[] = ['TEACHER', 'GUARDIAN', 'STUDENT'];

interface Target {
  id: number;
  role: RoleCode;
  status: string;
  fullName: string;
}

async function loadTarget(db: DB, id: number): Promise<Target> {
  const [u] = await db.all<{ id: number; role: RoleCode; status: string; full_name: string }>(
    sql`SELECT u.id, r.code AS role, u.status, u.full_name FROM users u JOIN roles r ON r.id = u.role_id
         WHERE u.id = ${id} AND u.deleted_at IS NULL`,
  );
  if (!u) throw Errors.notFound('Tài khoản');
  return { id: u.id, role: u.role, status: u.status, fullName: u.full_name };
}

/** OWNER only manages teacher/family accounts; ADMIN manages everyone. */
function assertCanManage(actor: AuthUser, target: Target) {
  if (actor.role === 'ADMIN') return;
  if (actor.role === 'OWNER' && FAMILY_AND_TEACHER.includes(target.role)) return;
  throw Errors.forbidden('Bạn không có quyền quản lý tài khoản này');
}

export async function listUsers(db: DB, q: { role?: RoleCode; status?: 'ACTIVE' | 'LOCKED' | 'DISABLED'; q?: string }) {
  const now = nowIso();
  const conds: SQL[] = [sql`u.deleted_at IS NULL`];
  if (q.role) conds.push(sql`r.code = ${q.role}`);
  if (q.status === 'LOCKED') conds.push(sql`u.locked_until > ${now}`);
  else if (q.status === 'ACTIVE') conds.push(sql`u.status = 'ACTIVE' AND (u.locked_until IS NULL OR u.locked_until <= ${now})`);
  else if (q.status === 'DISABLED') conds.push(sql`u.status <> 'ACTIVE'`);
  const rows = await db.all<{
    id: number;
    full_name: string;
    email: string | null;
    phone: string | null;
    role: RoleCode;
    status: string;
    locked_until: string | null;
    must_change_password: number;
    last_login_at: string | null;
    created_at: string;
    teacher_id: number | null;
    guardian_id: number | null;
    student_id: number | null;
  }>(sql`SELECT u.id, u.full_name, u.email, u.phone, r.code AS role, u.status, u.locked_until, u.must_change_password,
                u.last_login_at, u.created_at,
                (SELECT t.id FROM teachers t WHERE t.user_id = u.id AND t.deleted_at IS NULL) AS teacher_id,
                (SELECT g.id FROM guardians g WHERE g.user_id = u.id AND g.deleted_at IS NULL) AS guardian_id,
                (SELECT s.id FROM students s WHERE s.user_id = u.id AND s.deleted_at IS NULL) AS student_id
           FROM users u JOIN roles r ON r.id = u.role_id
          WHERE ${sql.join(conds, sql` AND `)}
          ORDER BY CASE r.code WHEN 'ADMIN' THEN 0 WHEN 'OWNER' THEN 1 WHEN 'TEACHER' THEN 2 WHEN 'GUARDIAN' THEN 3 ELSE 4 END,
                   u.full_name COLLATE NOCASE
          LIMIT 2000`);
  const needle = q.q ? normalizeSearch(q.q) : '';
  return rows
    .filter((u) => !needle || normalizeSearch(`${u.full_name} ${u.email ?? ''} ${u.phone ?? ''}`).includes(needle))
    .map((u) => ({
      id: u.id,
      fullName: u.full_name,
      email: u.email,
      phone: u.phone,
      role: u.role,
      status: u.status,
      lockedUntil: u.locked_until && u.locked_until > now ? u.locked_until : null,
      mustChangePassword: !!u.must_change_password,
      lastLoginAt: u.last_login_at,
      createdAt: u.created_at,
      teacherId: u.teacher_id,
      guardianId: u.guardian_id,
      studentId: u.student_id,
    }));
}

export async function createStaff(db: DB, env: Bindings, meta: AuditMeta, actor: AuthUser, input: StaffCreateInput) {
  if (actor.role !== 'ADMIN') throw Errors.forbidden('Chỉ quản trị viên được tạo tài khoản quản trị/chủ lớp');
  await assertIdentityFree(db, input.email, input.phone);
  const tempPassword = generateTempPassword();
  const hash = await hashPassword(tempPassword, Number(env.PBKDF2_ITERATIONS) || 30000);
  const fullName = normalizePersonName(input.fullName);
  const userSeq = sql`(SELECT seq FROM sqlite_sequence WHERE name = 'users')`;
  const res = await runBatch(db, [
    sql`INSERT INTO users (role_id, full_name, email, phone, password_hash, must_change_password)
        VALUES ((SELECT id FROM roles WHERE code = ${input.role}), ${fullName}, ${input.email ?? null}, ${input.phone ?? null}, ${hash}, 1)`,
    sql`INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, after_data, ip, user_agent, request_id)
        VALUES (${meta.actorUserId}, 'user.create', 'user', ${userSeq},
                ${JSON.stringify({ fullName, email: input.email ?? null, phone: input.phone ?? null, role: input.role })},
                ${meta.ip}, ${meta.userAgent}, ${meta.requestId})`,
    sql`SELECT ${userSeq} AS id`,
  ]);
  const id = (res[2]!.results as { id: number }[])[0]!.id;
  return { id, tempPassword };
}

export async function updateUser(db: DB, meta: AuditMeta, actor: AuthUser, id: number, input: UserUpdateInput) {
  const target = await loadTarget(db, id);
  // Blocking self-change guarantees an active ADMIN (the actor) always remains.
  if (target.id === actor.id) throw Errors.business('SELF_CHANGE', 'Không thể tự khóa hoặc đổi vai trò tài khoản của chính mình');
  assertCanManage(actor, target);

  const newStatus = input.status && input.status !== target.status ? input.status : undefined;
  const newRole = input.role && input.role !== target.role ? input.role : undefined;
  if (!newStatus && !newRole) return { ok: true };

  if (newStatus && target.role === 'TEACHER')
    throw Errors.business('USE_TEACHER_PAGE', 'Tài khoản giáo viên được khóa/mở ở trang Giáo viên (để kiểm tra lịch dạy)');
  if (newRole) {
    if (actor.role !== 'ADMIN') throw Errors.forbidden('Chỉ quản trị viên được đổi vai trò');
    if (target.role !== 'ADMIN' && target.role !== 'OWNER')
      throw Errors.business('ROLE_NOT_CHANGEABLE', 'Chỉ đổi được giữa vai trò Quản trị viên và Chủ lớp');
  }

  const now = nowIso();
  await runBatch(db, [
    sql`UPDATE users SET
          status = ${newStatus ?? target.status},
          role_id = (SELECT id FROM roles WHERE code = ${newRole ?? target.role}),
          ${newStatus === 'ACTIVE' ? sql`failed_login_count = 0, locked_until = NULL,` : sql.empty()}
          updated_at = ${now}
        WHERE id = ${id}`,
    // Permissions are loaded per request, but revoking makes a demotion or disable take effect on every device now.
    revokeAllSessionsStmt(db, id, newStatus === 'DISABLED' ? 'ACCOUNT_DISABLED' : 'ROLE_CHANGED'),
    auditInsert(db, meta, {
      action: newRole ? 'user.change_role' : newStatus === 'DISABLED' ? 'user.disable' : 'user.enable',
      entityType: 'user',
      entityId: id,
      before: { status: target.status, role: target.role },
      after: { status: newStatus ?? target.status, role: newRole ?? target.role },
      reason: input.reason ?? null,
    }),
  ]);
  return { ok: true };
}

export async function unlockUser(db: DB, meta: AuditMeta, actor: AuthUser, id: number) {
  const target = await loadTarget(db, id);
  assertCanManage(actor, target);
  await runBatch(db, [
    db.update(users).set({ failedLoginCount: 0, lockedUntil: null, updatedAt: nowIso() }).where(eq(users.id, id)),
    auditInsert(db, meta, { action: 'user.unlock', entityType: 'user', entityId: id }),
  ]);
  return { ok: true };
}

export async function revokeUserSessions(db: DB, meta: AuditMeta, actor: AuthUser, id: number) {
  const target = await loadTarget(db, id);
  if (target.id !== actor.id) assertCanManage(actor, target);
  await runBatch(db, [
    revokeAllSessionsStmt(db, id, 'ADMIN_REVOKE'),
    auditInsert(db, meta, { action: 'user.revoke_sessions', entityType: 'user', entityId: id }),
  ]);
  return { ok: true };
}

/** Temp password; another ADMIN's password is reset only via the break-glass script. */
export async function resetUserPassword(db: DB, env: Bindings, meta: AuditMeta, actor: AuthUser, id: number) {
  const target = await loadTarget(db, id);
  if (target.role === 'ADMIN' && target.id !== actor.id)
    throw Errors.forbidden('Không thể đặt lại mật khẩu quản trị viên khác tại đây');
  assertCanManage(actor, target);
  const tempPassword = generateTempPassword();
  const hash = await hashPassword(tempPassword, Number(env.PBKDF2_ITERATIONS) || 30000);
  await runBatch(db, [
    db
      .update(users)
      .set({ passwordHash: hash, mustChangePassword: true, failedLoginCount: 0, lockedUntil: null, updatedAt: nowIso() })
      .where(eq(users.id, id)),
    revokeAllSessionsStmt(db, id, 'PASSWORD_RESET'),
    auditInsert(db, meta, { action: 'user.reset_password', entityType: 'user', entityId: id }),
  ]);
  return { tempPassword };
}

export async function createGuardianAccount(db: DB, env: Bindings, meta: AuditMeta, guardianId: number) {
  const [g] = await db.all<{ id: number; full_name: string; phone: string; email: string | null; user_id: number | null }>(
    sql`SELECT id, full_name, phone, email, user_id FROM guardians WHERE id = ${guardianId} AND deleted_at IS NULL`,
  );
  if (!g) throw Errors.notFound('Phụ huynh');
  if (g.user_id) throw Errors.conflict('ALREADY_HAS_ACCOUNT', 'Phụ huynh này đã có tài khoản');
  await assertIdentityFree(db, null, g.phone);
  // Phone is the login; email is attached only when no other account uses it.
  const [emailOwner] = g.email
    ? await db.select({ id: users.id }).from(users).where(and(eq(users.email, g.email), isNull(users.deletedAt)))
    : [];
  const email = g.email && !emailOwner ? g.email : null;
  const tempPassword = generateTempPassword();
  const hash = await hashPassword(tempPassword, Number(env.PBKDF2_ITERATIONS) || 30000);
  const userSeq = sql`(SELECT seq FROM sqlite_sequence WHERE name = 'users')`;
  await runBatch(db, [
    sql`INSERT INTO users (role_id, full_name, email, phone, password_hash, must_change_password)
        VALUES ((SELECT id FROM roles WHERE code = 'GUARDIAN'), ${g.full_name}, ${email}, ${g.phone}, ${hash}, 1)`,
    sql`UPDATE guardians SET user_id = ${userSeq}, updated_at = ${nowIso()} WHERE id = ${guardianId} AND user_id IS NULL`,
    sql`INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, after_data, ip, user_agent, request_id)
        VALUES (${meta.actorUserId}, 'guardian.create_account', 'guardian', ${guardianId},
                ${JSON.stringify({ phone: g.phone, email })}, ${meta.ip}, ${meta.userAgent}, ${meta.requestId})`,
  ]);
  return { login: g.phone, tempPassword };
}
