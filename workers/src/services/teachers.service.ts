import { eq, sql } from 'drizzle-orm';
import { normalizePersonName } from '@ecm/shared';
import type { Bindings } from '../env';
import type { DB } from '../db/client';
import { teachers, users } from '../db/schema';
import { runBatch } from '../lib/batch';
import { hashPassword } from '../lib/crypto';
import { Errors } from '../lib/errors';
import { nowIso } from '../lib/time';
import { auditInsert, type AuditMeta } from './audit.service';
import { revokeAllSessionsStmt } from './auth.service';

/** Mật khẩu tạm 10 ký tự, luôn có chữ và số, tránh ký tự dễ nhầm (0/O, 1/l). */
export function generateTempPassword(): string {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const all = letters + digits;
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  const chars = [...bytes].map((b) => all[b % all.length]!);
  chars[0] = letters[bytes[0]! % letters.length]!;
  chars[9] = digits[bytes[9]! % digits.length]!;
  return chars.join('');
}

export async function assertIdentityFree(db: DB, email: string | null | undefined, phone: string | null | undefined, exceptUserId?: number) {
  if (email) {
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (u && u.id !== exceptUserId) throw Errors.conflict('EMAIL_TAKEN', 'Email đã được dùng cho tài khoản khác');
  }
  if (phone) {
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.phone, phone));
    if (u && u.id !== exceptUserId) throw Errors.conflict('PHONE_TAKEN', 'Số điện thoại đã được dùng cho tài khoản khác');
  }
}

export async function listTeachers(db: DB, includeInactive: boolean) {
  return db.all<{
    id: number;
    teacherCode: string;
    fullName: string;
    phone: string | null;
    email: string | null;
    specialty: string | null;
    status: string;
    hiredDate: string | null;
    userId: number;
    accountStatus: string;
    lastLoginAt: string | null;
    classCount: number;
    weeklySessions: number;
  }>(sql`SELECT t.id, t.teacher_code AS teacherCode, t.full_name AS fullName, t.phone, t.email, t.specialty, t.status,
                t.hired_date AS hiredDate, t.user_id AS userId, u.status AS accountStatus, u.last_login_at AS lastLoginAt,
                (SELECT count(*) FROM classes c WHERE c.main_teacher_id = t.id AND c.status <> 'CLOSED' AND c.deleted_at IS NULL) AS classCount,
                (SELECT count(*) FROM schedules s JOIN classes c ON c.id = s.class_id
                  WHERE s.teacher_id = t.id AND s.deleted_at IS NULL AND c.status = 'OPEN'
                    AND coalesce(s.effective_to, '9999-12-31') >= date('now', '+7 hours')) AS weeklySessions
           FROM teachers t JOIN users u ON u.id = t.user_id
          WHERE t.deleted_at IS NULL ${includeInactive ? sql`` : sql`AND t.status = 'ACTIVE'`}
          ORDER BY t.status, t.full_name`);
}

export async function createTeacher(
  db: DB,
  env: Bindings,
  meta: AuditMeta,
  input: {
    fullName: string;
    phone?: string | null;
    email?: string | null;
    specialty?: string | null;
    hiredDate?: string | null;
    notes?: string | null;
  },
) {
  await assertIdentityFree(db, input.email, input.phone);
  const tempPassword = generateTempPassword();
  const hash = await hashPassword(tempPassword, Number(env.PBKDF2_ITERATIONS) || 30000);
  const fullName = normalizePersonName(input.fullName);
  const userSeq = sql`(SELECT seq FROM sqlite_sequence WHERE name = 'users')`;
  const res = await runBatch(db, [
    sql`INSERT INTO users (role_id, full_name, email, phone, password_hash, must_change_password)
        VALUES ((SELECT id FROM roles WHERE code = 'TEACHER'), ${fullName}, ${input.email ?? null}, ${input.phone ?? null}, ${hash}, 1)`,
    sql`INSERT INTO teachers (user_id, full_name, phone, email, specialty, hired_date, notes)
        VALUES (${userSeq}, ${fullName}, ${input.phone ?? null}, ${input.email ?? null}, ${input.specialty ?? null}, ${input.hiredDate ?? null}, ${input.notes ?? null})`,
    sql`INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, after_data, ip, user_agent, request_id)
        VALUES (${meta.actorUserId}, 'teacher.create', 'teacher', (SELECT seq FROM sqlite_sequence WHERE name = 'teachers'),
                ${JSON.stringify({ ...input, fullName })}, ${meta.ip}, ${meta.userAgent}, ${meta.requestId})`,
    sql`SELECT id, teacher_code FROM teachers WHERE id = (SELECT seq FROM sqlite_sequence WHERE name = 'teachers')`,
  ]);
  const row = (res[3]!.results as { id: number; teacher_code: string }[])[0]!;
  return { id: row.id, teacherCode: row.teacher_code, tempPassword };
}

async function loadTeacher(db: DB, id: number) {
  const [t] = await db.select().from(teachers).where(eq(teachers.id, id));
  if (!t || t.deletedAt) throw Errors.notFound('Giáo viên');
  return t;
}

export async function updateTeacher(
  db: DB,
  meta: AuditMeta,
  id: number,
  input: { fullName?: string; phone?: string | null; email?: string | null; specialty?: string | null; hiredDate?: string | null; notes?: string | null },
) {
  const t = await loadTeacher(db, id);
  await assertIdentityFree(db, input.email, input.phone, t.userId);
  const patch = { ...input, ...(input.fullName ? { fullName: normalizePersonName(input.fullName) } : {}) };
  const userPatch: Partial<typeof users.$inferInsert> = { updatedAt: nowIso() };
  if (patch.fullName) userPatch.fullName = patch.fullName;
  if (input.phone !== undefined) userPatch.phone = input.phone;
  if (input.email !== undefined) userPatch.email = input.email;
  const [u] = await db.select({ email: users.email, phone: users.phone }).from(users).where(eq(users.id, t.userId));
  const nextEmail = input.email !== undefined ? input.email : u?.email;
  const nextPhone = input.phone !== undefined ? input.phone : u?.phone;
  if (!nextEmail && !nextPhone) throw Errors.validation([{ path: 'phone', message: 'Cần số điện thoại hoặc email để đăng nhập' }]);
  await runBatch(db, [
    db
      .update(teachers)
      .set({ ...patch, updatedAt: nowIso() })
      .where(eq(teachers.id, id)),
    db.update(users).set(userPatch).where(eq(users.id, t.userId)),
    auditInsert(db, meta, { action: 'teacher.update', entityType: 'teacher', entityId: id, before: t, after: patch }),
  ]);
}

/** Ngừng/tiếp tục làm việc: khóa/mở tài khoản đăng nhập và thu hồi phiên. */
export async function setTeacherActive(db: DB, meta: AuditMeta, id: number, active: boolean, reason?: string) {
  const t = await loadTeacher(db, id);
  if (!active) {
    const [busy] = await db.all<{ n: number }>(sql`
      SELECT count(*) AS n FROM schedules s JOIN classes c ON c.id = s.class_id
       WHERE s.teacher_id = ${id} AND s.deleted_at IS NULL AND c.status <> 'CLOSED'
         AND coalesce(s.effective_to, '9999-12-31') >= date('now', '+7 hours')`);
    if (busy!.n > 0)
      throw Errors.business('TEACHER_HAS_SCHEDULES', `Giáo viên còn ${busy!.n} lịch dạy. Hãy chuyển lịch cho giáo viên khác trước.`);
  }
  await runBatch(db, [
    db.update(teachers).set({ status: active ? 'ACTIVE' : 'INACTIVE', updatedAt: nowIso() }).where(eq(teachers.id, id)),
    db.update(users).set({ status: active ? 'ACTIVE' : 'DISABLED', updatedAt: nowIso() }).where(eq(users.id, t.userId)),
    ...(active ? [] : [revokeAllSessionsStmt(db, t.userId, 'ACCOUNT_DISABLED')]),
    auditInsert(db, meta, { action: active ? 'teacher.activate' : 'teacher.deactivate', entityType: 'teacher', entityId: id, reason }),
  ]);
}

export async function assertActiveTeacher(db: DB, teacherId: number) {
  const [t] = await db.select({ status: teachers.status, deletedAt: teachers.deletedAt }).from(teachers).where(eq(teachers.id, teacherId));
  if (!t || t.deletedAt || t.status !== 'ACTIVE') throw Errors.business('TEACHER_NOT_ACTIVE', 'Giáo viên không tồn tại hoặc đã ngừng làm việc');
}
