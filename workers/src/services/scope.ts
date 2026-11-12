import { sql, type SQL } from 'drizzle-orm';
import { FULL_SCOPE_ROLES } from '@ecm/shared';
import type { AuthUser } from '../env';
import type { DB } from '../db/client';
import { Errors } from '../lib/errors';

/** Quản trị viên / chủ lớp thấy toàn bộ dữ liệu. */
export const hasFullScope = (u: AuthUser) => FULL_SCOPE_ROLES.includes(u.role);

/** Lớp mà giáo viên được giao: là giáo viên chính hoặc có lịch dạy (chưa xóa). */
export const teacherClassIdsSql = (teacherId: number) => sql`(
  SELECT c.id FROM classes c
   WHERE c.deleted_at IS NULL AND (
     c.main_teacher_id = ${teacherId}
     OR EXISTS (SELECT 1 FROM schedules s WHERE s.class_id = c.id AND s.teacher_id = ${teacherId} AND s.deleted_at IS NULL)
     OR EXISTS (SELECT 1 FROM lessons l WHERE l.class_id = c.id AND l.teacher_id = ${teacherId} AND l.lesson_date >= date('now','+7 hours','-30 days'))
   ))`;

/**
 * Điều kiện SQL giới hạn tập học sinh người dùng được xem (dùng với cột `students.id`).
 * - Giáo viên: học sinh đang học trong lớp mình phụ trách.
 * - Phụ huynh: con được liên kết. Học sinh: chính mình.
 * Trả về null nếu không giới hạn.
 */
export function studentScopeSql(u: AuthUser, idCol: SQL = sql`students.id`): SQL | null {
  if (hasFullScope(u)) return null;
  if (u.role === 'TEACHER' && u.teacherId)
    return sql`${idCol} IN (SELECT ce.student_id FROM class_enrollments ce WHERE ce.status = 'ACTIVE' AND ce.class_id IN ${teacherClassIdsSql(u.teacherId)})`;
  if (u.role === 'GUARDIAN' && u.guardianId)
    return sql`${idCol} IN (SELECT sg.student_id FROM student_guardians sg WHERE sg.guardian_id = ${u.guardianId})`;
  if (u.role === 'STUDENT' && u.studentId) return sql`${idCol} = ${u.studentId}`;
  return sql`0`;
}

/** Ném 404 (không phải 403, tránh dò dữ liệu) nếu người dùng không được xem học sinh này. */
export async function assertStudentAccess(db: DB, u: AuthUser, studentId: number) {
  const scope = studentScopeSql(u);
  const rows = await db.all<{ id: number }>(
    sql`SELECT students.id FROM students WHERE students.id = ${studentId} AND students.deleted_at IS NULL ${scope ? sql`AND ${scope}` : sql``}`,
  );
  if (!rows.length) throw Errors.notFound('Học sinh');
}
