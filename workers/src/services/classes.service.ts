/**
 * Lớp học, lịch của lớp, ghi danh (xếp lớp / chuyển lớp / chuyển ca) và buổi học.
 * Nguyên tắc: không xóa lịch sử — chuyển lớp đóng ghi danh cũ và mở ghi danh mới trong CÙNG một batch nguyên tử.
 */
import { and, eq, sql, type SQL } from 'drizzle-orm';
import {
  addDays,
  normalizeSearch,
  vnDate,
  WEEKDAY_LABELS,
  type ClassCreateInput,
  type ClassUpdateInput,
  type ScheduleInput,
} from '@ecm/shared';
import type { AuthUser } from '../env';
import type { DB } from '../db/client';
import { classes, lessons, schedules, shifts } from '../db/schema';
import { runBatch, rowsOf, type BatchStatement } from '../lib/batch';
import { Errors } from '../lib/errors';
import { nowIso } from '../lib/time';
import { auditIfChanged, auditInsert, type AuditMeta } from './audit.service';
import {
  assertNoConflicts,
  assertRoomExists,
  deleteOrphanFutureLessonsSql,
  findScheduleConflicts,
  generateLessonsSql,
  lessonWindow,
  type Conflict,
} from './schedule.service';
import { hasFullScope, teacherClassIdsSql } from './scope';
import { assertActiveTeacher } from './teachers.service';

// ───────────── Phạm vi ─────────────

function classScopeSql(user: AuthUser, col: SQL = sql`c.id`): SQL | null {
  if (hasFullScope(user)) return null;
  if (user.role === 'TEACHER' && user.teacherId) return sql`${col} IN ${teacherClassIdsSql(user.teacherId)}`;
  return sql`0`;
}

export async function assertClassAccess(db: DB, user: AuthUser, classId: number) {
  const scope = classScopeSql(user);
  const rows = await db.all<{ id: number }>(
    sql`SELECT c.id FROM classes c WHERE c.id = ${classId} AND c.deleted_at IS NULL ${scope ? sql`AND ${scope}` : sql``}`,
  );
  if (!rows.length) throw Errors.notFound('Lớp học');
}

async function loadClass(db: DB, id: number) {
  const [c] = await db.select().from(classes).where(eq(classes.id, id));
  if (!c || c.deletedAt) throw Errors.notFound('Lớp học');
  return c;
}

// ───────────── Danh sách & chi tiết ─────────────

export async function listClasses(db: DB, user: AuthUser, q: { q?: string; status?: string; teacherId?: number; level?: string }) {
  const conds: SQL[] = [sql`c.deleted_at IS NULL`];
  if (!q.status) conds.push(sql`c.status <> 'CLOSED'`);
  else if (q.status !== 'ALL') conds.push(sql`c.status = ${q.status}`);
  if (q.teacherId) conds.push(sql`(c.main_teacher_id = ${q.teacherId} OR EXISTS (SELECT 1 FROM schedules s WHERE s.class_id = c.id AND s.teacher_id = ${q.teacherId} AND s.deleted_at IS NULL))`);
  if (q.level) conds.push(sql`c.english_level = ${q.level}`);
  if (q.q) {
    const t = `%${normalizeSearch(q.q).replace(/[%_]/g, '')}%`;
    conds.push(sql`(lower(c.class_code) LIKE ${t} OR lower(c.name) LIKE ${`%${q.q.toLowerCase()}%`})`);
  }
  const scope = classScopeSql(user);
  if (scope) conds.push(scope);
  const today = vnDate();
  const rows = await db.all<{
    id: number;
    classCode: string;
    name: string;
    englishLevel: string | null;
    status: string;
    startDate: string;
    endDate: string | null;
    maxStudents: number;
    mainTeacherId: number | null;
    mainTeacherName: string | null;
    activeStudents: number;
    schedulesJson: string | null;
  }>(sql`SELECT c.id, c.class_code AS classCode, c.name, c.english_level AS englishLevel, c.status, c.start_date AS startDate,
                c.end_date AS endDate, c.max_students AS maxStudents, c.main_teacher_id AS mainTeacherId, t.full_name AS mainTeacherName,
                (SELECT count(*) FROM class_enrollments ce WHERE ce.class_id = c.id AND ce.status = 'ACTIVE') AS activeStudents,
                (SELECT json_group_array(json_object('weekday', s.weekday, 'shiftName', sh.name, 'startTime', sh.start_time, 'endTime', sh.end_time))
                   FROM schedules s JOIN shifts sh ON sh.id = s.shift_id
                  WHERE s.class_id = c.id AND s.deleted_at IS NULL AND coalesce(s.effective_to, '9999-12-31') >= ${today}) AS schedulesJson
           FROM classes c LEFT JOIN teachers t ON t.id = c.main_teacher_id
          WHERE ${sql.join(conds, sql` AND `)}
          ORDER BY CASE c.status WHEN 'OPEN' THEN 0 WHEN 'PLANNED' THEN 1 ELSE 2 END, c.class_code`);
  return rows.map(({ schedulesJson, ...r }) => ({
    ...r,
    schedules: (schedulesJson ? (JSON.parse(schedulesJson) as { weekday: number | null }[]) : [])
      .filter((s) => s.weekday !== null)
      .sort((a, b) => a.weekday! - b.weekday!),
  }));
}

export async function getClassDetail(db: DB, user: AuthUser, id: number) {
  await assertClassAccess(db, user, id);
  const c = await loadClass(db, id);
  const [teacher] = c.mainTeacherId
    ? await db.all<{ id: number; fullName: string }>(sql`SELECT id, full_name AS fullName FROM teachers WHERE id = ${c.mainTeacherId}`)
    : [];
  const scheduleRows = await db.all<{
    id: number;
    shiftId: number;
    shiftName: string;
    startTime: string;
    endTime: string;
    weekday: number;
    teacherId: number;
    teacherName: string;
    roomId: number | null;
    roomName: string | null;
    effectiveFrom: string;
    effectiveTo: string | null;
  }>(sql`SELECT s.id, s.shift_id AS shiftId, sh.name AS shiftName, sh.start_time AS startTime, sh.end_time AS endTime, s.weekday,
                s.teacher_id AS teacherId, t.full_name AS teacherName, s.room_id AS roomId, r.name AS roomName,
                s.effective_from AS effectiveFrom, s.effective_to AS effectiveTo
           FROM schedules s JOIN shifts sh ON sh.id = s.shift_id JOIN teachers t ON t.id = s.teacher_id LEFT JOIN rooms r ON r.id = s.room_id
          WHERE s.class_id = ${id} AND s.deleted_at IS NULL ORDER BY s.effective_to IS NOT NULL, s.weekday, sh.start_time`);
  const students = await db.all<{
    enrollmentId: number;
    studentId: number;
    studentCode: string;
    fullName: string;
    dateOfBirth: string | null;
    status: string;
    startDate: string;
    guardianPhone: string | null;
  }>(sql`SELECT ce.id AS enrollmentId, s.id AS studentId, s.student_code AS studentCode, s.full_name AS fullName,
                s.date_of_birth AS dateOfBirth, s.status, ce.start_date AS startDate,
                (SELECT g.phone FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
                  WHERE sg.student_id = s.id ORDER BY sg.is_primary DESC LIMIT 1) AS guardianPhone
           FROM class_enrollments ce JOIN students s ON s.id = ce.student_id
          WHERE ce.class_id = ${id} AND ce.status = 'ACTIVE'
          ORDER BY s.full_name_search`);
  const [lessonStats] = await db.all<{ total: number; done: number; upcoming: number; cancelled: number }>(sql`
    SELECT count(*) AS total,
           sum(lesson_date < ${vnDate()} AND status <> 'CANCELLED') AS done,
           sum(lesson_date >= ${vnDate()} AND status <> 'CANCELLED') AS upcoming,
           sum(status = 'CANCELLED') AS cancelled
      FROM lessons WHERE class_id = ${id}`);
  const canManage = hasFullScope(user) && user.permissions.has('classes.write');
  return {
    ...c,
    mainTeacher: teacher ?? null,
    schedules: scheduleRows.map((s) => ({ ...s, active: !s.effectiveTo || s.effectiveTo >= vnDate() })),
    students,
    lessonStats: {
      total: lessonStats?.total ?? 0,
      done: lessonStats?.done ?? 0,
      upcoming: lessonStats?.upcoming ?? 0,
      cancelled: lessonStats?.cancelled ?? 0,
    },
    canManage,
    canEnroll: hasFullScope(user) && user.permissions.has('enrollments.write'),
  };
}

// ───────────── Tạo / sửa lớp ─────────────

async function resolveSchedule(db: DB, s: ScheduleInput, defaultTeacherId: number) {
  const [sh] = await db.select().from(shifts).where(eq(shifts.id, s.shiftId));
  if (!sh || !sh.isActive) throw Errors.business('SHIFT_NOT_FOUND', 'Ca học không tồn tại hoặc đã ngừng sử dụng');
  const teacherId = s.teacherId ?? defaultTeacherId;
  await assertActiveTeacher(db, teacherId);
  await assertRoomExists(db, s.roomId);
  return { shift: sh, teacherId, roomId: s.roomId ?? null, weekday: s.weekday, shiftId: s.shiftId };
}

/** Kiểm tra trùng trong chính danh sách lịch gửi lên và với lịch hiện có. */
async function checkScheduleSet(
  db: DB,
  items: Awaited<ReturnType<typeof resolveSchedule>>[],
  range: { from: string; to: string | null },
  classId: number | null,
  excludeScheduleIds: number[] = [],
) {
  const conflicts: Conflict[] = [];
  for (let i = 0; i < items.length; i++) {
    const a = items[i]!;
    for (let j = i + 1; j < items.length; j++) {
      const b = items[j]!;
      if (a.weekday === b.weekday && a.shift.startTime < b.shift.endTime && b.shift.startTime < a.shift.endTime)
        throw Errors.business('DUPLICATE_SCHEDULE', `Lịch bị lặp: ${WEEKDAY_LABELS[a.weekday]} có hai ca giao nhau`);
    }
    conflicts.push(
      ...(await findScheduleConflicts(db, {
        classId,
        weekday: a.weekday,
        startTime: a.shift.startTime,
        endTime: a.shift.endTime,
        teacherId: a.teacherId,
        roomId: a.roomId,
        effectiveFrom: range.from,
        effectiveTo: range.to,
        excludeScheduleIds,
      })),
    );
  }
  assertNoConflicts(conflicts);
}

export async function createClass(db: DB, meta: AuditMeta, input: ClassCreateInput) {
  const [dup] = await db.select({ id: classes.id }).from(classes).where(eq(classes.classCode, input.classCode));
  if (dup) throw Errors.conflict('DUPLICATE_CODE', 'Mã lớp đã tồn tại');
  await assertActiveTeacher(db, input.mainTeacherId);
  const items = [];
  for (const s of input.schedules) items.push(await resolveSchedule(db, s, input.mainTeacherId));
  await checkScheduleSet(db, items, { from: input.startDate, to: input.endDate ?? null }, null);

  const CLASS_SEQ = sql`(SELECT seq FROM sqlite_sequence WHERE name = 'classes')`;
  const stmts: BatchStatement[] = [
    db.insert(classes).values({
      classCode: input.classCode,
      name: input.name,
      englishLevel: input.englishLevel ?? null,
      mainTeacherId: input.mainTeacherId,
      maxStudents: input.maxStudents,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      notes: input.notes ?? null,
      status: 'PLANNED',
    }),
    ...items.map(
      (s) => sql`INSERT INTO schedules (class_id, shift_id, weekday, teacher_id, room_id, effective_from, effective_to)
                 VALUES (${CLASS_SEQ}, ${s.shiftId}, ${s.weekday}, ${s.teacherId}, ${s.roomId}, ${input.startDate}, ${input.endDate ?? null})`,
    ),
    sql`INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, after_data, ip, user_agent, request_id)
        VALUES (${meta.actorUserId}, 'class.create', 'class', ${CLASS_SEQ}, ${JSON.stringify(input)}, ${meta.ip}, ${meta.userAgent}, ${meta.requestId})`,
    sql`SELECT ${CLASS_SEQ} AS id`,
  ];
  const res = await runBatch(db, stmts);
  return { id: rowsOf<{ id: number }>(res[res.length - 1])[0]!.id };
}

export async function updateClass(db: DB, meta: AuditMeta, id: number, input: ClassUpdateInput) {
  const before = await loadClass(db, id);
  if (before.version !== input.version) throw Errors.versionConflict();
  if (before.status === 'CLOSED') throw Errors.business('CLASS_CLOSED', 'Lớp đã đóng, hãy mở lại lớp trước khi sửa');
  const { version, ...fields } = input;
  if (fields.mainTeacherId) await assertActiveTeacher(db, fields.mainTeacherId);
  const startDate = fields.startDate ?? before.startDate;
  const endDate = fields.endDate !== undefined ? fields.endDate : before.endDate;
  if (endDate && endDate < startDate) throw Errors.validation([{ path: 'endDate', message: 'Ngày kết thúc phải sau ngày bắt đầu' }]);
  if (fields.startDate && fields.startDate !== before.startDate) {
    const [n] = await db.all<{ n: number }>(sql`SELECT count(*) AS n FROM lessons WHERE class_id = ${id} AND attendance_status <> 'NOT_STARTED'`);
    if (n!.n) throw Errors.business('CLASS_HAS_ATTENDANCE', 'Lớp đã có buổi điểm danh, không thể đổi ngày bắt đầu');
  }
  if (fields.maxStudents) {
    const [n] = await db.all<{ n: number }>(sql`SELECT count(*) AS n FROM class_enrollments WHERE class_id = ${id} AND status = 'ACTIVE'`);
    if (fields.maxStudents < n!.n)
      throw Errors.business('CAPACITY_BELOW_CURRENT', `Lớp đang có ${n!.n} học sinh, sĩ số tối đa không được nhỏ hơn`);
  }

  const stmts: BatchStatement[] = [
    db
      .update(classes)
      .set({ ...fields, version: version + 1, updatedAt: nowIso() })
      .where(and(eq(classes.id, id), eq(classes.version, version))),
    auditIfChanged(db, meta, { action: 'class.update', entityType: 'class', entityId: id, before, after: fields }),
  ];
  // Lịch đi theo ngày kết thúc lớp; buổi học ngoài khoảng mới (chưa điểm danh) bị xóa, buổi còn thiếu được sinh thêm.
  if (fields.endDate !== undefined || fields.startDate) {
    stmts.push(sql`UPDATE schedules SET effective_to = ${endDate}, updated_at = ${nowIso()}
                    WHERE class_id = ${id} AND deleted_at IS NULL AND (effective_to IS NULL OR effective_to = ${before.endDate})`);
    if (fields.startDate) stmts.push(sql`UPDATE schedules SET effective_from = ${startDate} WHERE class_id = ${id} AND effective_from = ${before.startDate}`);
    stmts.push(sql`DELETE FROM lessons WHERE class_id = ${id} AND attendance_status = 'NOT_STARTED'
                    AND (lesson_date < ${startDate} OR lesson_date > ${endDate ?? '9999-12-31'})
                    AND NOT EXISTS (SELECT 1 FROM attendance_records a WHERE a.lesson_id = lessons.id)`);
    if (before.status === 'OPEN') {
      const w = lessonWindow();
      stmts.push(generateLessonsSql(id, w.from, w.to));
    }
  }
  const [res] = await runBatch(db, stmts);
  if (!res?.meta.changes) throw Errors.versionConflict();
  return { version: version + 1 };
}

export async function openClass(db: DB, meta: AuditMeta, id: number, version: number) {
  const c = await loadClass(db, id);
  if (c.version !== version) throw Errors.versionConflict();
  if (c.status === 'OPEN') throw Errors.business('ALREADY_OPEN', 'Lớp đang mở');
  const [sch] = await db.all<{ n: number }>(sql`SELECT count(*) AS n FROM schedules WHERE class_id = ${id} AND deleted_at IS NULL`);
  if (!sch!.n) throw Errors.business('NO_SCHEDULE', 'Lớp chưa có lịch học. Hãy thêm lịch trước khi mở lớp.');
  if (c.status === 'CLOSED') {
    // Mở lại: kiểm tra lịch còn hiệu lực không trùng với lớp khác
    const today = vnDate();
    const items = await db.all<{ id: number; weekday: number; start_time: string; end_time: string; teacher_id: number; room_id: number | null; effective_to: string | null }>(
      sql`SELECT s.id, s.weekday, sh.start_time, sh.end_time, s.teacher_id, s.room_id, s.effective_to FROM schedules s JOIN shifts sh ON sh.id = s.shift_id
           WHERE s.class_id = ${id} AND s.deleted_at IS NULL`,
    );
    const conflicts: Conflict[] = [];
    for (const s of items)
      conflicts.push(
        ...(await findScheduleConflicts(db, {
          classId: id,
          weekday: s.weekday,
          startTime: s.start_time,
          endTime: s.end_time,
          teacherId: s.teacher_id,
          roomId: s.room_id,
          effectiveFrom: today,
          effectiveTo: c.endDate,
          excludeScheduleIds: items.map((x) => x.id),
        })),
      );
    assertNoConflicts(conflicts);
  }
  const w = lessonWindow();
  const stmts: BatchStatement[] = [
    db
      .update(classes)
      .set({ status: 'OPEN', closedAt: null, version: version + 1, updatedAt: nowIso() })
      .where(and(eq(classes.id, id), eq(classes.version, version))),
    auditIfChanged(db, meta, { action: c.status === 'CLOSED' ? 'class.reopen' : 'class.open', entityType: 'class', entityId: id }),
  ];
  if (c.status === 'CLOSED') {
    // Lịch bị cắt khi đóng lớp → kéo dài lại đến ngày kết thúc lớp
    stmts.push(sql`UPDATE schedules SET effective_to = ${c.endDate}, updated_at = ${nowIso()}
                    WHERE class_id = ${id} AND deleted_at IS NULL AND effective_to = ${c.closedAt ? c.closedAt.slice(0, 10) : ''}`);
  }
  stmts.push(generateLessonsSql(id, c.status === 'CLOSED' ? w.from : c.startDate < w.from ? c.startDate : w.from, w.to));
  const [res] = await runBatch(db, stmts);
  if (!res?.meta.changes) throw Errors.versionConflict();
  const [n] = await db.all<{ n: number }>(sql`SELECT count(*) AS n FROM lessons WHERE class_id = ${id} AND lesson_date >= ${w.from}`);
  return { version: version + 1, upcomingLessons: n!.n };
}

/**
 * Đóng lớp từ ngày `closeDate`: chặn nếu còn buổi đã qua chưa xác nhận điểm danh;
 * kết thúc ghi danh đang mở, kết thúc lịch, xóa buổi tương lai chưa điểm danh.
 */
export async function closeClass(db: DB, meta: AuditMeta, id: number, input: { closeDate: string; reason: string; version: number }) {
  const c = await loadClass(db, id);
  if (c.version !== input.version) throw Errors.versionConflict();
  if (c.status === 'CLOSED') throw Errors.business('ALREADY_CLOSED', 'Lớp đã đóng');
  if (input.closeDate < c.startDate) throw Errors.validation([{ path: 'closeDate', message: 'Ngày đóng lớp phải sau ngày bắt đầu' }]);
  const pending = await db.all<{ lesson_date: string }>(sql`
    SELECT lesson_date FROM lessons WHERE class_id = ${id} AND status <> 'CANCELLED' AND lesson_date <= ${input.closeDate}
       AND lesson_date < ${vnDate()} AND attendance_status IN ('NOT_STARTED', 'DRAFT') ORDER BY lesson_date LIMIT 5`);
  if (pending.length)
    throw Errors.business(
      'PENDING_ATTENDANCE',
      `Còn buổi học chưa xác nhận điểm danh (${pending.map((p) => p.lesson_date.split('-').reverse().join('/')).join(', ')}). Hãy hoàn tất điểm danh hoặc hủy buổi trước khi đóng lớp.`,
      { dates: pending.map((p) => p.lesson_date) },
    );
  const [later] = await db.all<{ n: number }>(sql`SELECT count(*) AS n FROM lessons WHERE class_id = ${id} AND lesson_date > ${input.closeDate} AND attendance_status <> 'NOT_STARTED'`);
  if (later!.n) throw Errors.business('ATTENDANCE_AFTER_CLOSE', 'Đã có điểm danh sau ngày đóng lớp, hãy chọn ngày muộn hơn');

  const now = nowIso();
  const [res] = await runBatch(db, [
    db
      .update(classes)
      .set({ status: 'CLOSED', closedAt: `${input.closeDate}T00:00:00.000Z`, version: input.version + 1, updatedAt: now })
      .where(and(eq(classes.id, id), eq(classes.version, input.version))),
    auditIfChanged(db, meta, { action: 'class.close', entityType: 'class', entityId: id, after: { closeDate: input.closeDate }, reason: input.reason }),
    sql`UPDATE class_enrollments SET status = 'ENDED', end_date = max(start_date, ${input.closeDate}), end_reason = 'CLASS_CLOSED', updated_at = ${now}
         WHERE class_id = ${id} AND status = 'ACTIVE' AND (SELECT status FROM classes WHERE id = ${id}) = 'CLOSED'`,
    sql`UPDATE schedules SET effective_to = max(effective_from, ${input.closeDate}), updated_at = ${now}
         WHERE class_id = ${id} AND deleted_at IS NULL AND coalesce(effective_to, '9999-12-31') > ${input.closeDate}
           AND (SELECT status FROM classes WHERE id = ${id}) = 'CLOSED'`,
    sql`DELETE FROM lessons WHERE class_id = ${id} AND lesson_date > ${input.closeDate} AND attendance_status = 'NOT_STARTED'
         AND NOT EXISTS (SELECT 1 FROM attendance_records a WHERE a.lesson_id = lessons.id)
         AND NOT EXISTS (SELECT 1 FROM assessments x WHERE x.lesson_id = lessons.id)
         AND (SELECT status FROM classes WHERE id = ${id}) = 'CLOSED'`,
  ]);
  if (!res?.meta.changes) throw Errors.versionConflict();
  return { version: input.version + 1 };
}

// ───────────── Lịch của lớp ─────────────

export async function addSchedule(db: DB, meta: AuditMeta, classId: number, input: ScheduleInput & { effectiveFrom?: string }) {
  const c = await loadClass(db, classId);
  if (c.status === 'CLOSED') throw Errors.business('CLASS_CLOSED', 'Lớp đã đóng');
  const from = input.effectiveFrom ?? (c.startDate > vnDate() ? c.startDate : vnDate());
  if (from < c.startDate) throw Errors.validation([{ path: 'effectiveFrom', message: 'Ngày hiệu lực phải từ ngày bắt đầu lớp' }]);
  if (c.endDate && from > c.endDate) throw Errors.validation([{ path: 'effectiveFrom', message: 'Ngày hiệu lực sau ngày kết thúc lớp' }]);
  const item = await resolveSchedule(db, input, c.mainTeacherId!);
  // trùng với lịch khác của chính lớp này cũng được phát hiện (cùng giáo viên) — nhưng kiểm tra riêng để báo rõ
  const own = await db.all<{ n: number }>(sql`
    SELECT count(*) AS n FROM schedules s JOIN shifts sh ON sh.id = s.shift_id
     WHERE s.class_id = ${classId} AND s.deleted_at IS NULL AND s.weekday = ${item.weekday}
       AND sh.start_time < ${item.shift.endTime} AND ${item.shift.startTime} < sh.end_time
       AND coalesce(s.effective_to, '9999-12-31') >= ${from}`);
  if (own[0]!.n) throw Errors.business('DUPLICATE_SCHEDULE', `Lớp đã có lịch ${WEEKDAY_LABELS[item.weekday]} trong khung giờ này`);
  await checkScheduleSet(db, [item], { from, to: c.endDate }, classId);
  const stmts: BatchStatement[] = [
    db.insert(schedules).values({
      classId,
      shiftId: item.shiftId,
      weekday: item.weekday,
      teacherId: item.teacherId,
      roomId: item.roomId,
      effectiveFrom: from,
      effectiveTo: c.endDate,
    }),
    auditInsert(db, meta, { action: 'schedule.add', entityType: 'class', entityId: classId, after: { ...input, effectiveFrom: from } }),
  ];
  if (c.status === 'OPEN') {
    const w = lessonWindow();
    stmts.push(generateLessonsSql(classId, w.from, w.to));
  }
  await runBatch(db, stmts);
}

/** Kết thúc một lịch từ ngày `effectiveTo` (giữ lịch sử). Buổi sau ngày đó chưa điểm danh bị xóa. */
export async function endSchedule(db: DB, meta: AuditMeta, scheduleId: number, input: { effectiveTo: string; reason?: string }) {
  const [s] = await db.select().from(schedules).where(eq(schedules.id, scheduleId));
  if (!s || s.deletedAt) throw Errors.notFound('Lịch học');
  if (input.effectiveTo < s.effectiveFrom) {
    // Lịch chưa bắt đầu → xóa mềm
    const [used] = await db.all<{ n: number }>(sql`SELECT count(*) AS n FROM lessons WHERE schedule_id = ${scheduleId} AND attendance_status <> 'NOT_STARTED'`);
    if (used!.n) throw Errors.business('SCHEDULE_USED', 'Lịch đã có buổi điểm danh, hãy chọn ngày kết thúc sau buổi đó');
  }
  const [att] = await db.all<{ d: string | null }>(
    sql`SELECT max(lesson_date) AS d FROM lessons WHERE schedule_id = ${scheduleId} AND attendance_status <> 'NOT_STARTED'`,
  );
  if (att?.d && att.d > input.effectiveTo)
    throw Errors.business('SCHEDULE_USED', `Lịch đã có buổi điểm danh ngày ${att.d.split('-').reverse().join('/')}, hãy chọn ngày kết thúc sau ngày này`);
  const softDelete = input.effectiveTo < s.effectiveFrom;
  await runBatch(db, [
    softDelete
      ? db.update(schedules).set({ deletedAt: nowIso(), updatedAt: nowIso() }).where(eq(schedules.id, scheduleId))
      : db.update(schedules).set({ effectiveTo: input.effectiveTo, updatedAt: nowIso() }).where(eq(schedules.id, scheduleId)),
    deleteOrphanFutureLessonsSql(s.classId, softDelete ? addDays(s.effectiveFrom, -1) : input.effectiveTo),
    auditInsert(db, meta, { action: 'schedule.end', entityType: 'class', entityId: s.classId, before: s, after: input, reason: input.reason }),
  ]);
}

// ───────────── Ghi danh ─────────────

/** Học sinh bị trùng giờ với lớp khác đang học (lịch giao nhau về thứ, giờ, khoảng hiệu lực). */
async function studentTimeConflicts(db: DB, studentId: number, targetClassId: number, from: string, excludeClassId?: number) {
  return db.all<{ class_code: string; weekday: number; start_time: string; end_time: string }>(sql`
    SELECT oc.class_code, os.weekday, osh.start_time, osh.end_time
      FROM class_enrollments ce
      JOIN classes oc ON oc.id = ce.class_id
      JOIN schedules os ON os.class_id = oc.id AND os.deleted_at IS NULL
      JOIN shifts osh ON osh.id = os.shift_id
      JOIN schedules ts ON ts.class_id = ${targetClassId} AND ts.deleted_at IS NULL
      JOIN shifts tsh ON tsh.id = ts.shift_id
     WHERE ce.student_id = ${studentId} AND ce.status = 'ACTIVE' AND ce.class_id <> ${targetClassId}
       ${excludeClassId ? sql`AND ce.class_id <> ${excludeClassId}` : sql``}
       AND os.weekday = ts.weekday
       AND osh.start_time < tsh.end_time AND tsh.start_time < osh.end_time
       AND coalesce(os.effective_to, '9999-12-31') >= ${from} AND coalesce(ts.effective_to, '9999-12-31') >= ${from}
       AND os.effective_from <= coalesce(ts.effective_to, '9999-12-31') AND ts.effective_from <= coalesce(os.effective_to, '9999-12-31')
     LIMIT 1`);
}

async function assertCapacity(db: DB, c: { id: number; maxStudents: number }, adding: number, overrideReason: string | undefined, user: AuthUser) {
  const [n] = await db.all<{ n: number }>(sql`SELECT count(*) AS n FROM class_enrollments WHERE class_id = ${c.id} AND status = 'ACTIVE'`);
  if (n!.n + adding > c.maxStudents) {
    if (overrideReason && user.role === 'ADMIN') return { overridden: true, current: n!.n };
    throw Errors.business(
      'CLASS_FULL',
      `Lớp đã có ${n!.n}/${c.maxStudents} học sinh, không đủ chỗ cho ${adding} học sinh.${user.role === 'ADMIN' ? ' Quản trị viên có thể vượt sĩ số khi nhập lý do.' : ''}`,
      { current: n!.n, max: c.maxStudents },
    );
  }
  return { overridden: false, current: n!.n };
}

export async function enrollStudents(
  db: DB,
  meta: AuditMeta,
  user: AuthUser,
  classId: number,
  input: { studentIds: number[]; startDate: string; overrideCapacityReason?: string },
) {
  const c = await loadClass(db, classId);
  if (c.status === 'CLOSED') throw Errors.business('CLASS_CLOSED', 'Lớp đã đóng');
  if (input.startDate < c.startDate) throw Errors.validation([{ path: 'startDate', message: 'Ngày vào lớp phải từ ngày bắt đầu lớp' }]);
  if (c.endDate && input.startDate > c.endDate) throw Errors.validation([{ path: 'startDate', message: 'Ngày vào lớp sau ngày kết thúc lớp' }]);
  const ids = [...new Set(input.studentIds)];
  const studs = await db.all<{ id: number; full_name: string; status: string; in_class: number }>(sql`
    SELECT s.id, s.full_name, s.status,
           EXISTS (SELECT 1 FROM class_enrollments ce WHERE ce.student_id = s.id AND ce.class_id = ${classId} AND ce.status = 'ACTIVE') AS in_class
      FROM students s WHERE s.deleted_at IS NULL AND s.id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
  if (studs.length !== ids.length) throw Errors.notFound('Học sinh');
  const problems: string[] = [];
  for (const s of studs) {
    if (s.status !== 'ACTIVE') problems.push(`${s.full_name}: không ở trạng thái "Đang học"`);
    else if (s.in_class) problems.push(`${s.full_name}: đã ở trong lớp`);
    else {
      const [tc] = await studentTimeConflicts(db, s.id, classId, input.startDate);
      if (tc) problems.push(`${s.full_name}: trùng giờ với lớp ${tc.class_code} (${WEEKDAY_LABELS[tc.weekday]} ${tc.start_time}–${tc.end_time})`);
    }
  }
  if (problems.length) throw Errors.business('ENROLL_REJECTED', problems.join('; '), problems);
  const cap = await assertCapacity(db, c, ids.length, input.overrideCapacityReason, user);
  await runBatch(db, [
    ...ids.map(
      (sid) => sql`INSERT INTO class_enrollments (student_id, class_id, start_date, status, created_by, note)
                   VALUES (${sid}, ${classId}, ${input.startDate}, 'ACTIVE', ${user.id}, ${cap.overridden ? `Vượt sĩ số: ${input.overrideCapacityReason}` : null})`,
    ),
    ...ids.map((sid) =>
      auditInsert(db, meta, {
        action: 'enrollment.add',
        entityType: 'enrollment',
        entityId: classId,
        after: { studentId: sid, classId, classCode: c.classCode, startDate: input.startDate, overrideCapacity: cap.overridden },
        reason: input.overrideCapacityReason ?? null,
      }),
    ),
  ]);
  return { enrolled: ids.length };
}

/**
 * Chuyển lớp / chuyển ca. Ghi danh cũ kết thúc ngày (hiệu lực − 1), ghi danh mới bắt đầu từ ngày hiệu lực,
 * liên kết qua `transferred_from_id`. Điểm danh và điểm của lớp cũ không bị thay đổi.
 */
export async function transferEnrollment(
  db: DB,
  meta: AuditMeta,
  user: AuthUser,
  enrollmentId: number,
  input: { toClassId: number; effectiveDate: string; reason: string; overrideCapacityReason?: string },
) {
  const [e] = await db.all<{ id: number; student_id: number; class_id: number; start_date: string; status: string; class_code: string; full_name: string }>(sql`
    SELECT ce.id, ce.student_id, ce.class_id, ce.start_date, ce.status, c.class_code, s.full_name
      FROM class_enrollments ce JOIN classes c ON c.id = ce.class_id JOIN students s ON s.id = ce.student_id WHERE ce.id = ${enrollmentId}`);
  if (!e) throw Errors.notFound('Ghi danh');
  if (e.status !== 'ACTIVE') throw Errors.business('ENROLLMENT_ENDED', 'Ghi danh này đã kết thúc');
  if (e.class_id === input.toClassId) throw Errors.business('SAME_CLASS', 'Lớp đích trùng với lớp hiện tại');
  if (input.effectiveDate <= e.start_date)
    throw Errors.validation([{ path: 'effectiveDate', message: 'Ngày chuyển phải sau ngày vào lớp hiện tại' }]);
  const target = await loadClass(db, input.toClassId);
  if (target.status === 'CLOSED') throw Errors.business('CLASS_CLOSED', 'Lớp đích đã đóng');
  if (input.effectiveDate < target.startDate)
    throw Errors.validation([{ path: 'effectiveDate', message: `Lớp đích bắt đầu từ ${target.startDate.split('-').reverse().join('/')}` }]);
  if (target.endDate && input.effectiveDate > target.endDate) throw Errors.validation([{ path: 'effectiveDate', message: 'Lớp đích đã kết thúc trước ngày chuyển' }]);
  const [inTarget] = await db.all<{ n: number }>(sql`SELECT count(*) AS n FROM class_enrollments WHERE student_id = ${e.student_id} AND class_id = ${input.toClassId} AND status = 'ACTIVE'`);
  if (inTarget!.n) throw Errors.business('ALREADY_IN_CLASS', 'Học sinh đã ở trong lớp đích');

  // Không cho đè lên dữ liệu điểm danh đã có ở lớp cũ
  const [att] = await db.all<{ d: string | null }>(sql`
    SELECT max(l.lesson_date) AS d FROM attendance_records a JOIN lessons l ON l.id = a.lesson_id
     WHERE a.student_id = ${e.student_id} AND l.class_id = ${e.class_id}`);
  if (att?.d && att.d >= input.effectiveDate)
    throw Errors.business(
      'EFFECTIVE_DATE_BEFORE_ATTENDANCE',
      `Học sinh đã được điểm danh ở lớp ${e.class_code} đến ngày ${att.d.split('-').reverse().join('/')}. Ngày chuyển phải sau ngày này.`,
      { lastAttendanceDate: att.d },
    );
  const [tc] = await studentTimeConflicts(db, e.student_id, input.toClassId, input.effectiveDate, e.class_id);
  if (tc) throw Errors.business('STUDENT_TIME_CONFLICT', `Trùng giờ với lớp ${tc.class_code} (${WEEKDAY_LABELS[tc.weekday]} ${tc.start_time}–${tc.end_time})`);
  const cap = await assertCapacity(db, target, 1, input.overrideCapacityReason, user);

  const endDate = addDays(input.effectiveDate, -1);
  const now = nowIso();
  const [upd] = await runBatch(db, [
    sql`UPDATE class_enrollments SET status = 'ENDED', end_date = ${endDate}, end_reason = 'TRANSFER', note = ${input.reason}, updated_at = ${now}
         WHERE id = ${enrollmentId} AND status = 'ACTIVE'`,
    sql`INSERT INTO class_enrollments (student_id, class_id, start_date, status, transferred_from_id, created_by, note)
        SELECT ${e.student_id}, ${input.toClassId}, ${input.effectiveDate}, 'ACTIVE', ${enrollmentId}, ${user.id}, ${cap.overridden ? `Vượt sĩ số: ${input.overrideCapacityReason}` : input.reason}
         WHERE changes() > 0`,
    auditIfChanged(db, meta, {
      action: 'enrollment.transfer',
      entityType: 'enrollment',
      entityId: enrollmentId,
      after: {
        studentId: e.student_id,
        fromClassId: e.class_id,
        fromClassCode: e.class_code,
        toClassId: input.toClassId,
        toClassCode: target.classCode,
        effectiveDate: input.effectiveDate,
        overrideCapacity: cap.overridden,
      },
      reason: input.reason,
    }),
  ]);
  if (!upd?.meta.changes) throw Errors.conflict('ENROLLMENT_CHANGED', 'Ghi danh vừa được thay đổi, vui lòng tải lại');
}

export async function endEnrollment(
  db: DB,
  meta: AuditMeta,
  enrollmentId: number,
  input: { endDate: string; reason: string; endReason: 'COMPLETED' | 'DROP' },
) {
  const [e] = await db.all<{ id: number; student_id: number; class_id: number; start_date: string; status: string }>(
    sql`SELECT id, student_id, class_id, start_date, status FROM class_enrollments WHERE id = ${enrollmentId}`,
  );
  if (!e) throw Errors.notFound('Ghi danh');
  if (e.status !== 'ACTIVE') throw Errors.business('ENROLLMENT_ENDED', 'Ghi danh này đã kết thúc');
  if (input.endDate < e.start_date) throw Errors.validation([{ path: 'endDate', message: 'Ngày kết thúc phải sau ngày vào lớp' }]);
  const [att] = await db.all<{ d: string | null }>(sql`
    SELECT max(l.lesson_date) AS d FROM attendance_records a JOIN lessons l ON l.id = a.lesson_id
     WHERE a.student_id = ${e.student_id} AND l.class_id = ${e.class_id}`);
  if (att?.d && att.d > input.endDate)
    throw Errors.business('EFFECTIVE_DATE_BEFORE_ATTENDANCE', `Đã có điểm danh ngày ${att.d.split('-').reverse().join('/')}, hãy chọn ngày kết thúc từ ngày này`);
  await runBatch(db, [
    sql`UPDATE class_enrollments SET status = 'ENDED', end_date = ${input.endDate}, end_reason = ${input.endReason}, note = ${input.reason}, updated_at = ${nowIso()}
         WHERE id = ${enrollmentId} AND status = 'ACTIVE'`,
    auditIfChanged(db, meta, {
      action: 'enrollment.end',
      entityType: 'enrollment',
      entityId: enrollmentId,
      after: { studentId: e.student_id, classId: e.class_id, endDate: input.endDate, endReason: input.endReason },
      reason: input.reason,
    }),
  ]);
}

/** Toàn bộ lịch sử vào/ra lớp (cho lịch sử sĩ số). */
export async function enrollmentHistory(db: DB, user: AuthUser, classId: number) {
  await assertClassAccess(db, user, classId);
  return db.all<{
    id: number;
    studentId: number;
    studentCode: string;
    fullName: string;
    startDate: string;
    endDate: string | null;
    status: string;
    endReason: string | null;
    note: string | null;
    fromClassCode: string | null;
    toClassCode: string | null;
  }>(sql`SELECT ce.id, s.id AS studentId, s.student_code AS studentCode, s.full_name AS fullName, ce.start_date AS startDate,
                ce.end_date AS endDate, ce.status, ce.end_reason AS endReason, ce.note,
                (SELECT c2.class_code FROM class_enrollments p JOIN classes c2 ON c2.id = p.class_id WHERE p.id = ce.transferred_from_id) AS fromClassCode,
                (SELECT c3.class_code FROM class_enrollments n JOIN classes c3 ON c3.id = n.class_id WHERE n.transferred_from_id = ce.id) AS toClassCode
           FROM class_enrollments ce JOIN students s ON s.id = ce.student_id
          WHERE ce.class_id = ${classId}
          ORDER BY ce.start_date DESC, ce.id DESC`);
}

/** Danh sách học sinh của lớp tại một ngày (dùng cho điểm danh). */
export function rosterAtDateSql(classId: number, date: string) {
  return sql`SELECT ce.id AS enrollmentId, s.id AS studentId, s.student_code AS studentCode, s.full_name AS fullName, s.photo_file_id AS photoFileId
               FROM class_enrollments ce JOIN students s ON s.id = ce.student_id
              WHERE ce.class_id = ${classId} AND ce.start_date <= ${date} AND (ce.end_date IS NULL OR ce.end_date >= ${date})
              ORDER BY s.full_name_search`;
}

// ───────────── Buổi học ─────────────

export async function listLessons(db: DB, user: AuthUser, classId: number, from: string, to: string) {
  await assertClassAccess(db, user, classId);
  return db.all<{
    id: number;
    lessonDate: string;
    startTime: string;
    endTime: string;
    teacherId: number;
    teacherName: string;
    roomId: number | null;
    roomName: string | null;
    status: string;
    cancelReason: string | null;
    topic: string | null;
    attendanceStatus: string;
    isMakeup: number;
    version: number;
  }>(sql`SELECT l.id, l.lesson_date AS lessonDate, l.start_time AS startTime, l.end_time AS endTime, l.teacher_id AS teacherId,
                t.full_name AS teacherName, l.room_id AS roomId, r.name AS roomName, l.status, l.cancel_reason AS cancelReason,
                l.topic, l.attendance_status AS attendanceStatus, (l.schedule_id IS NULL) AS isMakeup, l.version
           FROM lessons l JOIN teachers t ON t.id = l.teacher_id LEFT JOIN rooms r ON r.id = l.room_id
          WHERE l.class_id = ${classId} AND l.lesson_date BETWEEN ${from} AND ${to}
          ORDER BY l.lesson_date, l.start_time`);
}

/** Kiểm tra trùng giáo viên/phòng ở cấp buổi học (buổi bù, dạy thay). */
async function lessonConflicts(
  db: DB,
  p: { date: string; start: string; end: string; teacherId: number; roomId: number | null; excludeLessonId?: number },
) {
  const rows = await db.all<{ class_code: string; start_time: string; end_time: string; teacher_id: number }>(sql`
    SELECT c.class_code, l.start_time, l.end_time, l.teacher_id FROM lessons l JOIN classes c ON c.id = l.class_id
     WHERE l.lesson_date = ${p.date} AND l.status <> 'CANCELLED' AND l.start_time < ${p.end} AND ${p.start} < l.end_time
       AND (l.teacher_id = ${p.teacherId} ${p.roomId ? sql`OR l.room_id = ${p.roomId}` : sql``})
       ${p.excludeLessonId ? sql`AND l.id <> ${p.excludeLessonId}` : sql``}`);
  if (rows.length)
    throw Errors.conflict(
      'SCHEDULE_CONFLICT',
      `Trùng lịch: ${rows.map((r) => `${r.teacher_id === p.teacherId ? 'giáo viên' : 'phòng'} đã có lớp ${r.class_code} ${r.start_time}–${r.end_time}`).join('; ')}`,
    );
}

export async function createLesson(
  db: DB,
  meta: AuditMeta,
  classId: number,
  input: { lessonDate: string; startTime: string; endTime: string; teacherId: number; roomId?: number | null; topic?: string | null },
) {
  const c = await loadClass(db, classId);
  if (c.status !== 'OPEN') throw Errors.business('CLASS_NOT_OPEN', 'Chỉ thêm buổi học cho lớp đang mở');
  await assertActiveTeacher(db, input.teacherId);
  await assertRoomExists(db, input.roomId);
  await lessonConflicts(db, { date: input.lessonDate, start: input.startTime, end: input.endTime, teacherId: input.teacherId, roomId: input.roomId ?? null });
  const [dup] = await db.all<{ n: number }>(sql`SELECT count(*) AS n FROM lessons WHERE class_id = ${classId} AND lesson_date = ${input.lessonDate} AND start_time = ${input.startTime}`);
  if (dup!.n) throw Errors.conflict('DUPLICATE_LESSON', 'Lớp đã có buổi học vào giờ này');
  const [row] = await db
    .insert(lessons)
    .values({ classId, lessonDate: input.lessonDate, startTime: input.startTime, endTime: input.endTime, teacherId: input.teacherId, roomId: input.roomId ?? null, topic: input.topic ?? null })
    .returning({ id: lessons.id });
  await auditInsert(db, meta, { action: 'lesson.create', entityType: 'lesson', entityId: row!.id, after: { classId, ...input } });
  return row!;
}

export async function updateLesson(
  db: DB,
  meta: AuditMeta,
  user: AuthUser,
  lessonId: number,
  input: { teacherId?: number; roomId?: number | null; topic?: string | null; cancel?: { reason: string }; restore?: boolean; version: number },
) {
  const [l] = await db.select().from(lessons).where(eq(lessons.id, lessonId));
  if (!l) throw Errors.notFound('Buổi học');
  await assertClassAccess(db, user, l.classId);
  if (l.version !== input.version) throw Errors.versionConflict();
  const manager = hasFullScope(user) && user.permissions.has('classes.write');
  // Giáo viên chỉ được cập nhật chủ đề bài học
  if (!manager && (input.teacherId || input.roomId !== undefined || input.cancel || input.restore)) throw Errors.forbidden();
  const patch: Partial<typeof lessons.$inferInsert> = {};
  if (input.topic !== undefined) patch.topic = input.topic;
  if (input.cancel) {
    if (l.attendanceStatus !== 'NOT_STARTED') throw Errors.business('LESSON_HAS_ATTENDANCE', 'Buổi học đã điểm danh, không thể hủy');
    patch.status = 'CANCELLED';
    patch.cancelReason = input.cancel.reason;
  }
  if (input.restore) {
    if (l.status !== 'CANCELLED') throw Errors.business('NOT_CANCELLED', 'Buổi học không ở trạng thái hủy');
    patch.status = 'SCHEDULED';
    patch.cancelReason = null;
  }
  if (input.teacherId || input.roomId !== undefined || input.restore) {
    const teacherId = input.teacherId ?? l.teacherId;
    const roomId = input.roomId !== undefined ? input.roomId : l.roomId;
    if (input.teacherId) await assertActiveTeacher(db, input.teacherId);
    await assertRoomExists(db, roomId);
    await lessonConflicts(db, { date: l.lessonDate, start: l.startTime, end: l.endTime, teacherId, roomId, excludeLessonId: l.id });
    if (input.teacherId) patch.teacherId = input.teacherId;
    if (input.roomId !== undefined) patch.roomId = input.roomId;
  }
  const [res] = await runBatch(db, [
    db
      .update(lessons)
      .set({ ...patch, version: input.version + 1, updatedAt: nowIso() })
      .where(and(eq(lessons.id, lessonId), eq(lessons.version, input.version))),
    auditIfChanged(db, meta, {
      action: input.cancel ? 'lesson.cancel' : input.restore ? 'lesson.restore' : 'lesson.update',
      entityType: 'lesson',
      entityId: lessonId,
      before: { teacherId: l.teacherId, roomId: l.roomId, topic: l.topic, status: l.status },
      after: patch,
      reason: input.cancel?.reason ?? null,
    }),
  ]);
  if (!res?.meta.changes) throw Errors.versionConflict();
}
