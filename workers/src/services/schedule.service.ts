/**
 * Ca học, phòng học, lịch lặp, kiểm tra trùng lịch, sinh buổi học và lịch tổng hợp.
 */
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { addDays, vnDate, WEEKDAY_LABELS } from '@ecm/shared';
import type { AuthUser } from '../env';
import type { DB } from '../db/client';
import { rooms, shifts } from '../db/schema';
import { runBatch, type BatchStatement } from '../lib/batch';
import { Errors } from '../lib/errors';
import { nowIso } from '../lib/time';
import { auditInsert, type AuditMeta } from './audit.service';
import { hasFullScope, teacherClassIdsSql } from './scope';

/** Số ngày sinh buổi học trước (8 tuần). */
export const LESSON_HORIZON_DAYS = 56;

export interface Conflict {
  kind: 'TEACHER' | 'ROOM' | 'STUDENT';
  scheduleId?: number;
  classId: number;
  classCode: string;
  weekday: number;
  startTime: string;
  endTime: string;
  detail: string;
}

export interface ScheduleCandidate {
  classId: number | null;
  weekday: number;
  startTime: string;
  endTime: string;
  teacherId: number;
  roomId: number | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  excludeScheduleIds?: number[];
}

/** Tìm lịch khác (lớp chưa đóng) trùng giáo viên hoặc phòng trong cùng thứ, giờ giao nhau, hiệu lực giao nhau. */
export async function findScheduleConflicts(db: DB, c: ScheduleCandidate): Promise<Conflict[]> {
  const exclude = c.excludeScheduleIds?.length ? sql`AND s.id NOT IN (${sql.join(c.excludeScheduleIds.map((i) => sql`${i}`), sql`, `)})` : sql``;
  const rows = await db.all<{
    id: number;
    class_id: number;
    class_code: string;
    weekday: number;
    start_time: string;
    end_time: string;
    teacher_id: number;
    room_id: number | null;
    teacher_name: string;
    room_name: string | null;
  }>(sql`
    SELECT s.id, s.class_id, c.class_code, s.weekday, sh.start_time, sh.end_time, s.teacher_id, s.room_id,
           t.full_name AS teacher_name, r.name AS room_name
      FROM schedules s
      JOIN shifts sh ON sh.id = s.shift_id
      JOIN classes c ON c.id = s.class_id
      JOIN teachers t ON t.id = s.teacher_id
      LEFT JOIN rooms r ON r.id = s.room_id
     WHERE s.deleted_at IS NULL AND c.deleted_at IS NULL AND c.status <> 'CLOSED'
       AND s.weekday = ${c.weekday}
       AND sh.start_time < ${c.endTime} AND ${c.startTime} < sh.end_time
       AND s.effective_from <= ${c.effectiveTo ?? '9999-12-31'}
       AND ${c.effectiveFrom} <= coalesce(s.effective_to, '9999-12-31')
       AND (s.teacher_id = ${c.teacherId} ${c.roomId ? sql`OR s.room_id = ${c.roomId}` : sql``})
       ${exclude}`);
  return rows.map((r) => {
    const kind = r.teacher_id === c.teacherId ? 'TEACHER' : 'ROOM';
    return {
      kind,
      scheduleId: r.id,
      classId: r.class_id,
      classCode: r.class_code,
      weekday: r.weekday,
      startTime: r.start_time,
      endTime: r.end_time,
      detail:
        kind === 'TEACHER'
          ? `Giáo viên ${r.teacher_name} đã dạy lớp ${r.class_code} ${WEEKDAY_LABELS[r.weekday]} ${r.start_time}–${r.end_time}`
          : `Phòng ${r.room_name} đã có lớp ${r.class_code} ${WEEKDAY_LABELS[r.weekday]} ${r.start_time}–${r.end_time}`,
    };
  });
}

export async function getShift(db: DB, id: number) {
  const [s] = await db.select().from(shifts).where(eq(shifts.id, id));
  if (!s) throw Errors.notFound('Ca học');
  return s;
}

export function assertNoConflicts(conflicts: Conflict[]) {
  if (conflicts.length)
    throw Errors.conflict('SCHEDULE_CONFLICT', `Trùng lịch: ${conflicts.map((c) => c.detail).join('; ')}`, conflicts);
}

// ───────────── Ca học ─────────────

export async function listShifts(db: DB) {
  return db.all<{
    id: number;
    name: string;
    startTime: string;
    endTime: string;
    isActive: number;
    sortOrder: number;
    classCount: number;
  }>(sql`SELECT sh.id, sh.name, sh.start_time AS startTime, sh.end_time AS endTime, sh.is_active AS isActive, sh.sort_order AS sortOrder,
                (SELECT count(DISTINCT s.class_id) FROM schedules s JOIN classes c ON c.id = s.class_id
                  WHERE s.shift_id = sh.id AND s.deleted_at IS NULL AND c.status <> 'CLOSED'
                    AND coalesce(s.effective_to, '9999-12-31') >= ${vnDate()}) AS classCount
           FROM shifts sh ORDER BY sh.sort_order, sh.start_time`);
}

export async function createShift(db: DB, meta: AuditMeta, input: { name: string; startTime: string; endTime: string; sortOrder?: number }) {
  const [dup] = await db.select({ id: shifts.id }).from(shifts).where(eq(shifts.name, input.name));
  if (dup) throw Errors.conflict('DUPLICATE_NAME', 'Tên ca đã tồn tại');
  // Ca mới mặc định xếp cuối danh sách
  const [max] = await db.all<{ m: number | null }>(sql`SELECT max(sort_order) AS m FROM shifts`);
  const [row] = await db
    .insert(shifts)
    .values({ ...input, sortOrder: input.sortOrder ?? (max?.m ?? 0) + 1 })
    .returning();
  await auditInsert(db, meta, { action: 'shift.create', entityType: 'shift', entityId: row!.id, after: input });
  return row!;
}

/**
 * Sửa ca học. Đổi giờ: kiểm tra trùng lịch với giờ mới, chỉ áp dụng cho buổi học CHƯA diễn ra và chưa điểm danh
 * (buổi đã diễn ra giữ nguyên giờ cũ).
 */
export async function updateShift(
  db: DB,
  meta: AuditMeta,
  id: number,
  input: { name?: string; startTime?: string; endTime?: string; sortOrder?: number; isActive?: boolean },
) {
  const before = await getShift(db, id);
  const startTime = input.startTime ?? before.startTime;
  const endTime = input.endTime ?? before.endTime;
  if (startTime >= endTime) throw Errors.validation([{ path: 'endTime', message: 'Giờ kết thúc phải sau giờ bắt đầu' }]);
  if (input.name && input.name !== before.name) {
    const [dup] = await db.select({ id: shifts.id }).from(shifts).where(eq(shifts.name, input.name));
    if (dup) throw Errors.conflict('DUPLICATE_NAME', 'Tên ca đã tồn tại');
  }
  const today = vnDate();
  const users = await db.all<{
    id: number;
    class_id: number;
    weekday: number;
    teacher_id: number;
    room_id: number | null;
    effective_from: string;
    effective_to: string | null;
  }>(sql`SELECT s.id, s.class_id, s.weekday, s.teacher_id, s.room_id, s.effective_from, s.effective_to
           FROM schedules s JOIN classes c ON c.id = s.class_id
          WHERE s.shift_id = ${id} AND s.deleted_at IS NULL AND c.status <> 'CLOSED'
            AND coalesce(s.effective_to, '9999-12-31') >= ${today}`);

  if (input.isActive === false && users.length)
    throw Errors.business('SHIFT_IN_USE', `Ca đang được ${users.length} lịch học sử dụng, không thể ngừng sử dụng`);

  const timeChanged = startTime !== before.startTime || endTime !== before.endTime;
  if (timeChanged) {
    const all: Conflict[] = [];
    for (const s of users) {
      all.push(
        ...(await findScheduleConflicts(db, {
          classId: s.class_id,
          weekday: s.weekday,
          startTime,
          endTime,
          teacherId: s.teacher_id,
          roomId: s.room_id,
          effectiveFrom: s.effective_from < today ? today : s.effective_from,
          effectiveTo: s.effective_to,
          excludeScheduleIds: users.map((u) => u.id),
        })),
      );
    }
    assertNoConflicts(all);
  }

  const stmts: BatchStatement[] = [
    db
      .update(shifts)
      .set({ ...input, updatedAt: nowIso() })
      .where(eq(shifts.id, id)),
  ];
  if (timeChanged)
    stmts.push(sql`UPDATE lessons SET start_time = ${startTime}, end_time = ${endTime}, updated_at = ${nowIso()}
                    WHERE schedule_id IN (SELECT id FROM schedules WHERE shift_id = ${id})
                      AND lesson_date >= ${today} AND attendance_status = 'NOT_STARTED' AND status = 'SCHEDULED'`);
  stmts.push(auditInsert(db, meta, { action: 'shift.update', entityType: 'shift', entityId: id, before, after: input }));
  await runBatch(db, stmts);
}

// ───────────── Phòng học ─────────────

export async function listRooms(db: DB) {
  return db.select().from(rooms).orderBy(rooms.name);
}

export async function saveRoom(
  db: DB,
  meta: AuditMeta,
  id: number | null,
  input: { name: string; capacity?: number | null; isActive?: boolean },
) {
  const [dup] = await db.select({ id: rooms.id }).from(rooms).where(eq(rooms.name, input.name));
  if (dup && dup.id !== id) throw Errors.conflict('DUPLICATE_NAME', 'Tên phòng đã tồn tại');
  if (id) {
    const [r] = await db.select().from(rooms).where(eq(rooms.id, id));
    if (!r) throw Errors.notFound('Phòng');
    await runBatch(db, [
      db
        .update(rooms)
        .set({ ...input, updatedAt: nowIso() })
        .where(eq(rooms.id, id)),
      auditInsert(db, meta, { action: 'room.update', entityType: 'room', entityId: id, before: r, after: input }),
    ]);
    return { id };
  }
  const [row] = await db.insert(rooms).values(input).returning({ id: rooms.id });
  await auditInsert(db, meta, { action: 'room.create', entityType: 'room', entityId: row!.id, after: input });
  return row!;
}

// ───────────── Sinh buổi học ─────────────

/**
 * Sinh buổi học từ lịch lặp của lớp trong khoảng [from, to] (giới hạn theo ngày bắt đầu/kết thúc lớp và hiệu lực lịch).
 * Idempotent: UNIQUE(class_id, lesson_date, start_time) + ON CONFLICT DO NOTHING.
 */
export function generateLessonsSql(classId: number, from: string, to: string): SQL {
  return sql`
    WITH RECURSIVE d(day) AS (
      SELECT ${from}
      UNION ALL SELECT date(day, '+1 day') FROM d WHERE day < ${to}
    )
    INSERT INTO lessons (class_id, schedule_id, lesson_date, start_time, end_time, teacher_id, room_id)
    SELECT s.class_id, s.id, d.day, sh.start_time, sh.end_time, s.teacher_id, s.room_id
      FROM d
      JOIN schedules s ON s.class_id = ${classId} AND s.deleted_at IS NULL
      JOIN shifts sh ON sh.id = s.shift_id
      JOIN classes c ON c.id = s.class_id
     WHERE c.status = 'OPEN' AND c.deleted_at IS NULL
       AND d.day >= c.start_date AND (c.end_date IS NULL OR d.day <= c.end_date)
       AND d.day >= s.effective_from AND (s.effective_to IS NULL OR d.day <= s.effective_to)
       AND ((CAST(strftime('%w', d.day) AS INTEGER) + 6) % 7) + 1 = s.weekday
    ON CONFLICT DO NOTHING`;
}

export function lessonWindow(today = vnDate()) {
  return { from: today, to: addDays(today, LESSON_HORIZON_DAYS) };
}

/** Xóa buổi tương lai chưa điểm danh thuộc lịch đã kết thúc/bị xóa (sau ngày `after`). */
export function deleteOrphanFutureLessonsSql(classId: number, after: string): SQL {
  return sql`DELETE FROM lessons
              WHERE class_id = ${classId} AND lesson_date > ${after} AND attendance_status = 'NOT_STARTED'
                AND NOT EXISTS (SELECT 1 FROM attendance_records a WHERE a.lesson_id = lessons.id)
                AND NOT EXISTS (SELECT 1 FROM assessments x WHERE x.lesson_id = lessons.id)
                AND schedule_id IS NOT NULL
                AND NOT EXISTS (
                  SELECT 1 FROM schedules s WHERE s.id = lessons.schedule_id AND s.deleted_at IS NULL
                     AND lessons.lesson_date >= s.effective_from AND (s.effective_to IS NULL OR lessons.lesson_date <= s.effective_to))`;
}

/** Cron hằng ngày: sinh buổi học cho mọi lớp đang mở đến 8 tuần tới. */
export async function generateLessonsForOpenClasses(db: DB) {
  const open = await db.all<{ id: number }>(sql`SELECT id FROM classes WHERE status = 'OPEN' AND deleted_at IS NULL`);
  const w = lessonWindow();
  if (!open.length) return 0;
  await runBatch(db, open.map((c) => generateLessonsSql(c.id, w.from, w.to)));
  return open.length;
}

// ───────────── Lịch tổng hợp ─────────────

export async function calendar(
  db: DB,
  user: AuthUser,
  q: { from: string; to: string; teacherId?: number; roomId?: number; classId?: number },
) {
  const conds: SQL[] = [sql`l.lesson_date BETWEEN ${q.from} AND ${q.to}`, sql`c.deleted_at IS NULL`];
  if (q.teacherId) conds.push(sql`l.teacher_id = ${q.teacherId}`);
  if (q.roomId) conds.push(sql`l.room_id = ${q.roomId}`);
  if (q.classId) conds.push(sql`l.class_id = ${q.classId}`);
  if (!hasFullScope(user)) {
    if (user.role === 'TEACHER' && user.teacherId)
      conds.push(sql`(l.teacher_id = ${user.teacherId} OR l.class_id IN ${teacherClassIdsSql(user.teacherId)})`);
    else if (user.role === 'GUARDIAN' && user.guardianId)
      conds.push(sql`l.class_id IN (SELECT ce.class_id FROM class_enrollments ce JOIN student_guardians sg ON sg.student_id = ce.student_id
                                     WHERE sg.guardian_id = ${user.guardianId} AND l.lesson_date >= ce.start_date
                                       AND (ce.end_date IS NULL OR l.lesson_date <= ce.end_date))`);
    else if (user.role === 'STUDENT' && user.studentId)
      conds.push(sql`l.class_id IN (SELECT ce.class_id FROM class_enrollments ce WHERE ce.student_id = ${user.studentId}
                                       AND l.lesson_date >= ce.start_date AND (ce.end_date IS NULL OR l.lesson_date <= ce.end_date))`);
    else conds.push(sql`0`);
  }
  return db.all<{
    id: number;
    classId: number;
    classCode: string;
    className: string;
    lessonDate: string;
    startTime: string;
    endTime: string;
    teacherId: number;
    teacherName: string;
    roomId: number | null;
    roomName: string | null;
    status: string;
    attendanceStatus: string;
    isMakeup: number;
  }>(sql`SELECT l.id, l.class_id AS classId, c.class_code AS classCode, c.name AS className, l.lesson_date AS lessonDate,
                l.start_time AS startTime, l.end_time AS endTime, l.teacher_id AS teacherId, t.full_name AS teacherName,
                l.room_id AS roomId, r.name AS roomName, l.status, l.attendance_status AS attendanceStatus,
                (l.schedule_id IS NULL) AS isMakeup
           FROM lessons l
           JOIN classes c ON c.id = l.class_id
           JOIN teachers t ON t.id = l.teacher_id
           LEFT JOIN rooms r ON r.id = l.room_id
          WHERE ${sql.join(conds, sql` AND `)}
          ORDER BY l.lesson_date, l.start_time, c.class_code
          LIMIT 2000`);
}

export async function assertRoomExists(db: DB, roomId: number | null | undefined) {
  if (!roomId) return;
  const [r] = await db.select({ id: rooms.id, active: rooms.isActive }).from(rooms).where(and(eq(rooms.id, roomId)));
  if (!r || !r.active) throw Errors.business('ROOM_NOT_FOUND', 'Phòng học không tồn tại hoặc đã ngừng sử dụng');
}
