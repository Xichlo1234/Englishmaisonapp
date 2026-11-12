/**
 * Điểm danh — mỗi buổi học (lesson) là một phiên điểm danh.
 * Trạng thái phiên: NOT_STARTED → DRAFT (lưu nháp) → SUBMITTED (đã xác nhận) → LOCKED (00:00 hôm sau, cron).
 * - Không trùng bản ghi: UNIQUE(lesson_id, student_id) + UPSERT.
 * - Khóa lạc quan theo lessons.version; gửi lại cùng dữ liệu (mạng chập chờn) được coi là thành công.
 * - Mọi thay đổi ghi audit_logs (entity 'lesson') kèm giá trị cũ → mới.
 */
import { sql } from 'drizzle-orm';
import {
  addDays,
  computeAttendanceStats,
  vnDate,
  vnToUtc,
  type AttendanceRecordInput,
  type AttendanceStatus,
} from '@ecm/shared';
import type { AuthUser } from '../env';
import type { DB } from '../db/client';
import { runBatch, type BatchStatement } from '../lib/batch';
import { Errors } from '../lib/errors';
import { nowIso } from '../lib/time';
import { auditInsert, type AuditMeta } from './audit.service';
import { rosterAtDateSql } from './classes.service';
import { assertStudentAccess, hasFullScope, teacherClassIdsSql } from './scope';

/** Giáo viên được mở phiên điểm danh trước giờ học tối đa (phút). */
export const OPEN_MINUTES_BEFORE = 30;

interface LessonRow {
  id: number;
  class_id: number;
  class_code: string;
  class_name: string;
  lesson_date: string;
  start_time: string;
  end_time: string;
  teacher_id: number;
  teacher_name: string;
  room_name: string | null;
  status: string;
  attendance_status: string;
  attendance_submitted_at: string | null;
  attendance_submitted_by_name: string | null;
  attendance_locked_at: string | null;
  topic: string | null;
  version: number;
}

function lessonScopeSql(user: AuthUser) {
  if (hasFullScope(user)) return sql``;
  if (user.role === 'TEACHER' && user.teacherId)
    return sql`AND (l.teacher_id = ${user.teacherId} OR l.class_id IN ${teacherClassIdsSql(user.teacherId)})`;
  return sql`AND 0`;
}

async function loadLesson(db: DB, user: AuthUser, lessonId: number): Promise<LessonRow> {
  const [l] = await db.all<LessonRow>(sql`
    SELECT l.id, l.class_id, c.class_code, c.name AS class_name, l.lesson_date, l.start_time, l.end_time, l.teacher_id,
           t.full_name AS teacher_name, r.name AS room_name, l.status, l.attendance_status, l.attendance_submitted_at,
           su.full_name AS attendance_submitted_by_name, l.attendance_locked_at, l.topic, l.version
      FROM lessons l JOIN classes c ON c.id = l.class_id JOIN teachers t ON t.id = l.teacher_id
      LEFT JOIN rooms r ON r.id = l.room_id LEFT JOIN users su ON su.id = l.attendance_submitted_by
     WHERE l.id = ${lessonId} ${lessonScopeSql(user)}`);
  if (!l) throw Errors.notFound('Buổi học');
  return l;
}

/** Lý do không được sửa điểm danh (null = được sửa). */
export function editBlockReason(user: AuthUser, l: Pick<LessonRow, 'status' | 'attendance_status' | 'lesson_date' | 'start_time'>, now = new Date()): string | null {
  if (!user.permissions.has('attendance.write')) return 'Bạn không có quyền điểm danh';
  if (l.status === 'CANCELLED') return 'Buổi học đã bị hủy';
  if (l.attendance_status === 'LOCKED') return 'Phiên điểm danh đã khóa. Liên hệ quản trị viên để mở khóa.';
  const opensAt = vnToUtc(l.lesson_date, l.start_time).getTime() - OPEN_MINUTES_BEFORE * 60_000;
  if (now.getTime() < opensAt && user.role !== 'ADMIN') return `Chỉ điểm danh được từ ${OPEN_MINUTES_BEFORE} phút trước giờ học`;
  return null;
}

type RosterRow = { enrollmentId: number; studentId: number; studentCode: string; fullName: string; photoFileId: number | null };
type RecordRow = {
  student_id: number;
  status: AttendanceStatus;
  late_minutes: number | null;
  note: string | null;
  marked_at: string;
  marked_by_name: string | null;
  updated_at: string;
  updated_by_name: string | null;
};

async function loadRosterAndRecords(db: DB, l: LessonRow) {
  const roster = await db.all<RosterRow>(rosterAtDateSql(l.class_id, l.lesson_date));
  const records = await db.all<RecordRow>(sql`
    SELECT a.student_id, a.status, a.late_minutes, a.note, a.marked_at, mu.full_name AS marked_by_name, a.updated_at, uu.full_name AS updated_by_name
      FROM attendance_records a LEFT JOIN users mu ON mu.id = a.marked_by LEFT JOIN users uu ON uu.id = a.updated_by
     WHERE a.lesson_id = ${l.id}`);
  return { roster, records: new Map(records.map((r) => [r.student_id, r])) };
}

export async function getAttendanceSheet(db: DB, user: AuthUser, lessonId: number) {
  const l = await loadLesson(db, user, lessonId);
  const { roster, records } = await loadRosterAndRecords(db, l);
  const rows = roster.map((s) => {
    const r = records.get(s.studentId);
    return {
      ...s,
      status: r?.status ?? null,
      lateMinutes: r?.late_minutes ?? null,
      note: r?.note ?? null,
      markedAt: r?.marked_at ?? null,
      markedBy: r?.marked_by_name ?? null,
      updatedBy: r?.updated_by_name ?? null,
    };
  });
  // Học sinh có bản ghi nhưng không còn trong danh sách ngày đó (dữ liệu cũ) — vẫn hiển thị để không mất thông tin
  const inRoster = new Set(roster.map((s) => s.studentId));
  const orphans = [...records.values()].filter((r) => !inRoster.has(r.student_id)).map((r) => r.student_id);
  const blockReason = editBlockReason(user, l);
  return {
    lesson: {
      id: l.id,
      classId: l.class_id,
      classCode: l.class_code,
      className: l.class_name,
      lessonDate: l.lesson_date,
      startTime: l.start_time,
      endTime: l.end_time,
      teacherName: l.teacher_name,
      roomName: l.room_name,
      status: l.status,
      attendanceStatus: l.attendance_status,
      submittedAt: l.attendance_submitted_at,
      submittedBy: l.attendance_submitted_by_name,
      lockedAt: l.attendance_locked_at,
      topic: l.topic,
      version: l.version,
    },
    students: rows,
    orphanStudentIds: orphans,
    summary: computeAttendanceStats(rows.filter((r) => r.status).map((r) => r.status!)),
    unmarked: rows.filter((r) => !r.status).length,
    canEdit: blockReason === null,
    blockReason,
    canUnlock: l.attendance_status === 'LOCKED' && user.permissions.has('attendance.unlock'),
  };
}

const same = (a: { status: string; late_minutes: number | null; note: string | null } | undefined, b: AttendanceRecordInput) =>
  !!a && a.status === b.status && (a.late_minutes ?? null) === (b.lateMinutes ?? null) && (a.note ?? null) === (b.note ?? null);

/** Lưu (nháp hoặc sửa sau xác nhận). Chỉ ghi các bản ghi thay đổi. */
export async function saveAttendance(
  db: DB,
  meta: AuditMeta,
  user: AuthUser,
  lessonId: number,
  input: { records: AttendanceRecordInput[]; version: number },
) {
  const l = await loadLesson(db, user, lessonId);
  const block = editBlockReason(user, l);
  if (block) throw Errors.business('ATTENDANCE_NOT_EDITABLE', block);
  const { roster, records } = await loadRosterAndRecords(db, l);
  const rosterIds = new Set(roster.map((s) => s.studentId));
  const seen = new Set<number>();
  for (const r of input.records) {
    if (!rosterIds.has(r.studentId)) throw Errors.business('STUDENT_NOT_IN_CLASS', 'Có học sinh không thuộc lớp vào ngày học này');
    if (seen.has(r.studentId)) throw Errors.validation([{ path: 'records', message: 'Một học sinh xuất hiện hai lần' }]);
    seen.add(r.studentId);
  }
  const changed = input.records.filter((r) => !same(records.get(r.studentId), r));
  if (l.version !== input.version) {
    // Gửi lại đúng dữ liệu đã lưu (VD mất phản hồi do mạng) → coi như thành công
    if (!changed.length) return { version: l.version, saved: 0, attendanceStatus: l.attendance_status };
    throw Errors.versionConflict();
  }
  if (!changed.length) return { version: l.version, saved: 0, attendanceStatus: l.attendance_status };

  const now = nowIso();
  const newVersion = l.version + 1;
  const guard = sql`(SELECT version FROM lessons WHERE id = ${lessonId}) = ${newVersion}`;
  const enrollmentOf = new Map(roster.map((s) => [s.studentId, s.enrollmentId]));
  const stmts: BatchStatement[] = [
    sql`UPDATE lessons SET version = ${newVersion}, updated_at = ${now},
               attendance_status = CASE WHEN attendance_status = 'NOT_STARTED' THEN 'DRAFT' ELSE attendance_status END
         WHERE id = ${lessonId} AND version = ${input.version} AND attendance_status <> 'LOCKED'`,
    ...changed.map(
      (r) => sql`INSERT INTO attendance_records (lesson_id, student_id, enrollment_id, status, late_minutes, note, marked_by, marked_at, updated_by, updated_at)
                 SELECT ${lessonId}, ${r.studentId}, ${enrollmentOf.get(r.studentId) ?? null}, ${r.status}, ${r.lateMinutes ?? null}, ${r.note ?? null}, ${user.id}, ${now}, ${user.id}, ${now}
                  WHERE ${guard}
                 ON CONFLICT (lesson_id, student_id) DO UPDATE SET
                   status = excluded.status, late_minutes = excluded.late_minutes, note = excluded.note,
                   updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    ),
  ];
  const edits = changed.filter((r) => records.has(r.studentId));
  stmts.push(
    sql`INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, before_data, after_data, ip, user_agent, request_id)
        SELECT ${user.id}, ${l.attendance_status === 'SUBMITTED' ? 'attendance.edit_after_submit' : edits.length ? 'attendance.edit' : 'attendance.mark'},
               'lesson', ${lessonId},
               ${JSON.stringify(edits.map((r) => ({ studentId: r.studentId, status: records.get(r.studentId)!.status, lateMinutes: records.get(r.studentId)!.late_minutes, note: records.get(r.studentId)!.note })))},
               ${JSON.stringify(changed)}, ${meta.ip}, ${meta.userAgent}, ${meta.requestId}
         WHERE ${guard}`,
  );
  const [upd] = await runBatch(db, stmts);
  if (!upd?.meta.changes) throw Errors.versionConflict();
  return { version: newVersion, saved: changed.length, attendanceStatus: l.attendance_status === 'NOT_STARTED' ? 'DRAFT' : l.attendance_status };
}

/** Xác nhận điểm danh: yêu cầu đủ học sinh; tạo thông báo cho phụ huynh học sinh vắng. */
export async function submitAttendance(db: DB, meta: AuditMeta, user: AuthUser, lessonId: number, version: number) {
  const l = await loadLesson(db, user, lessonId);
  const block = editBlockReason(user, l);
  if (block) throw Errors.business('ATTENDANCE_NOT_EDITABLE', block);
  if (l.version !== version) {
    if (l.attendance_status === 'SUBMITTED') return { version: l.version, absentNotified: 0 }; // gửi lại
    throw Errors.versionConflict();
  }
  const { roster, records } = await loadRosterAndRecords(db, l);
  const missing = roster.filter((s) => !records.has(s.studentId));
  if (missing.length)
    throw Errors.business('ATTENDANCE_INCOMPLETE', `Còn ${missing.length} học sinh chưa điểm danh: ${missing.slice(0, 5).map((s) => s.fullName).join(', ')}${missing.length > 5 ? '…' : ''}`, {
      studentIds: missing.map((s) => s.studentId),
    });

  const [setting] = await db.all<{ value: string }>(sql`SELECT value FROM system_settings WHERE key = 'notifications_enabled'`);
  const notifyAbsence = setting ? (JSON.parse(setting.value) as { absence?: boolean }).absence !== false : true;
  const absent = roster.filter((s) => {
    const st = records.get(s.studentId)?.status;
    return st === 'EXCUSED' || st === 'UNEXCUSED';
  });

  const now = nowIso();
  const newVersion = version + 1;
  const guard = sql`(SELECT version FROM lessons WHERE id = ${lessonId}) = ${newVersion} AND (SELECT attendance_status FROM lessons WHERE id = ${lessonId}) = 'SUBMITTED'`;
  const dateVn = l.lesson_date.split('-').reverse().join('/');
  const stmts: BatchStatement[] = [
    sql`UPDATE lessons SET attendance_status = 'SUBMITTED', attendance_submitted_by = ${user.id}, attendance_submitted_at = ${now},
               status = 'COMPLETED', version = ${newVersion}, updated_at = ${now}
         WHERE id = ${lessonId} AND version = ${version} AND attendance_status IN ('NOT_STARTED', 'DRAFT', 'SUBMITTED')`,
    auditInsert(db, meta, {
      action: 'attendance.submit',
      entityType: 'lesson',
      entityId: lessonId,
      after: computeAttendanceStats(roster.map((s) => records.get(s.studentId)!.status)),
    }),
  ];
  if (notifyAbsence)
    for (const s of absent) {
      const st = records.get(s.studentId)!.status;
      stmts.push(sql`INSERT OR IGNORE INTO notifications (user_id, type, title, body, data, student_id, dedupe_key, push_status)
                     SELECT g.user_id, 'ABSENCE', ${`${s.fullName} vắng học ${dateVn}`},
                            ${`Con vắng ${st === 'EXCUSED' ? 'có phép' : 'không phép'} buổi ${l.start_time}–${l.end_time} lớp ${l.class_code}.`},
                            ${JSON.stringify({ lessonId, studentId: s.studentId, status: st })}, ${s.studentId}, ${`absence:${lessonId}:${s.studentId}`}, 'PENDING'
                       FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
                      WHERE sg.student_id = ${s.studentId} AND sg.receive_notifications = 1 AND g.user_id IS NOT NULL AND ${guard}`);
    }
  const [upd] = await runBatch(db, stmts);
  if (!upd?.meta.changes) throw Errors.versionConflict();
  return { version: newVersion, absentNotified: notifyAbsence ? absent.length : 0 };
}

export async function unlockAttendance(db: DB, meta: AuditMeta, user: AuthUser, lessonId: number, reason: string) {
  const l = await loadLesson(db, user, lessonId);
  if (l.attendance_status !== 'LOCKED') throw Errors.business('NOT_LOCKED', 'Phiên điểm danh chưa khóa');
  const now = nowIso();
  const [upd] = await runBatch(db, [
    sql`UPDATE lessons SET attendance_locked_at = NULL, version = version + 1, updated_at = ${now},
               attendance_status = CASE WHEN attendance_submitted_at IS NOT NULL THEN 'SUBMITTED'
                                        WHEN EXISTS (SELECT 1 FROM attendance_records a WHERE a.lesson_id = lessons.id) THEN 'DRAFT'
                                        ELSE 'NOT_STARTED' END
         WHERE id = ${lessonId} AND attendance_status = 'LOCKED'`,
    auditInsert(db, meta, { action: 'attendance.unlock', entityType: 'lesson', entityId: lessonId, reason }),
  ]);
  if (!upd?.meta.changes) throw Errors.versionConflict();
}

/** Cron 00:00 giờ VN: khóa mọi phiên điểm danh của các ngày đã qua (kể cả buổi chưa điểm danh). */
export async function lockPastAttendance(db: DB, today = vnDate()) {
  const res = await db.run(sql`UPDATE lessons SET attendance_status = 'LOCKED', attendance_locked_at = ${nowIso()}, version = version + 1
                                WHERE lesson_date < ${today} AND status <> 'CANCELLED' AND attendance_status <> 'LOCKED'`);
  return res.meta.changes ?? 0;
}

export async function attendanceHistory(db: DB, user: AuthUser, lessonId: number) {
  await loadLesson(db, user, lessonId);
  const rows = await db.all<{
    id: number;
    action: string;
    before_data: string | null;
    after_data: string | null;
    reason: string | null;
    created_at: string;
    actor_name: string | null;
  }>(sql`SELECT a.id, a.action, a.before_data, a.after_data, a.reason, a.created_at, u.full_name AS actor_name
           FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id
          WHERE a.entity_type = 'lesson' AND a.entity_id = ${lessonId} AND a.action LIKE 'attendance.%'
          ORDER BY a.id DESC`);
  const names = new Map(
    (await db.all<{ id: number; full_name: string }>(sql`SELECT s.id, s.full_name FROM students s
       WHERE s.id IN (SELECT student_id FROM attendance_records WHERE lesson_id = ${lessonId})`)).map((r) => [r.id, r.full_name]),
  );
  return rows.map((r) => {
    const before = r.before_data ? (JSON.parse(r.before_data) as { studentId: number; status: string }[] | Record<string, unknown>) : null;
    const after = r.after_data ? (JSON.parse(r.after_data) as { studentId: number; status: string }[] | Record<string, unknown>) : null;
    const changes = Array.isArray(after)
      ? after.map((a) => ({
          studentId: a.studentId,
          studentName: names.get(a.studentId) ?? `#${a.studentId}`,
          from: Array.isArray(before) ? (before.find((b) => b.studentId === a.studentId)?.status ?? null) : null,
          to: a.status,
        }))
      : [];
    return { id: r.id, action: r.action, actorName: r.actor_name, createdAt: r.created_at, reason: r.reason, changes, summary: Array.isArray(after) ? null : after };
  });
}

/** Buổi học trong ngày (giáo viên: buổi của mình; quản lý: tất cả) kèm tiến độ điểm danh. */
export async function lessonsOfDay(db: DB, user: AuthUser, date: string) {
  return db.all<{
    id: number;
    classId: number;
    classCode: string;
    className: string;
    lessonDate: string;
    startTime: string;
    endTime: string;
    teacherName: string;
    roomName: string | null;
    status: string;
    attendanceStatus: string;
    total: number;
    marked: number;
    absent: number;
    late: number;
  }>(sql`
    SELECT l.id, l.class_id AS classId, c.class_code AS classCode, c.name AS className, l.lesson_date AS lessonDate,
           l.start_time AS startTime, l.end_time AS endTime, t.full_name AS teacherName, r.name AS roomName,
           l.status, l.attendance_status AS attendanceStatus,
           (SELECT count(*) FROM class_enrollments ce WHERE ce.class_id = l.class_id AND ce.start_date <= l.lesson_date
              AND (ce.end_date IS NULL OR ce.end_date >= l.lesson_date)) AS total,
           (SELECT count(*) FROM attendance_records a WHERE a.lesson_id = l.id) AS marked,
           (SELECT count(*) FROM attendance_records a WHERE a.lesson_id = l.id AND a.status IN ('EXCUSED', 'UNEXCUSED')) AS absent,
           (SELECT count(*) FROM attendance_records a WHERE a.lesson_id = l.id AND a.status = 'LATE') AS late
      FROM lessons l JOIN classes c ON c.id = l.class_id JOIN teachers t ON t.id = l.teacher_id LEFT JOIN rooms r ON r.id = l.room_id
     WHERE l.lesson_date = ${date} ${lessonScopeSql(user)}
     ORDER BY l.start_time, c.class_code`);
}

/** Điểm danh của một học sinh trong khoảng ngày + thống kê chuyên cần. */
export async function studentAttendance(db: DB, user: AuthUser, studentId: number, from?: string, to?: string) {
  await assertStudentAccess(db, user, studentId);
  const end = to ?? vnDate();
  const start = from ?? addDays(end, -90);
  const rows = await db.all<{
    lessonId: number;
    lessonDate: string;
    startTime: string;
    classCode: string;
    status: AttendanceStatus;
    lateMinutes: number | null;
    note: string | null;
  }>(sql`SELECT l.id AS lessonId, l.lesson_date AS lessonDate, l.start_time AS startTime, c.class_code AS classCode,
                a.status, a.late_minutes AS lateMinutes, a.note
           FROM attendance_records a JOIN lessons l ON l.id = a.lesson_id JOIN classes c ON c.id = l.class_id
          WHERE a.student_id = ${studentId} AND l.lesson_date BETWEEN ${start} AND ${end} AND l.status <> 'CANCELLED'
          ORDER BY l.lesson_date DESC, l.start_time DESC`);
  return { from: start, to: end, records: rows, stats: computeAttendanceStats(rows.map((r) => r.status)) };
}

/** Ma trận điểm danh tháng của một lớp: hàng = học sinh, cột = buổi học. */
export async function classAttendanceMatrix(db: DB, user: AuthUser, classId: number, month: string) {
  const from = `${month}-01`;
  const [y, m] = month.split('-').map(Number) as [number, number];
  const to = addDays(m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`, -1);
  const scope = lessonScopeSql(user);
  const lessons = await db.all<{ id: number; lessonDate: string; startTime: string; attendanceStatus: string }>(sql`
    SELECT l.id, l.lesson_date AS lessonDate, l.start_time AS startTime, l.attendance_status AS attendanceStatus
      FROM lessons l WHERE l.class_id = ${classId} AND l.lesson_date BETWEEN ${from} AND ${to} AND l.status <> 'CANCELLED' ${scope}
     ORDER BY l.lesson_date, l.start_time`);
  if (!hasFullScope(user) && !lessons.length) {
    const [ok] = await db.all<{ n: number }>(sql`SELECT count(*) AS n FROM classes c WHERE c.id = ${classId} AND c.id IN ${teacherClassIdsSql(user.teacherId ?? -1)}`);
    if (!ok?.n) throw Errors.notFound('Lớp học');
  }
  const students = await db.all<{ id: number; studentCode: string; fullName: string; startDate: string; endDate: string | null }>(sql`
    SELECT s.id, s.student_code AS studentCode, s.full_name AS fullName, min(ce.start_date) AS startDate,
           CASE WHEN sum(ce.end_date IS NULL) > 0 THEN NULL ELSE max(ce.end_date) END AS endDate
      FROM class_enrollments ce JOIN students s ON s.id = ce.student_id
     WHERE ce.class_id = ${classId} AND ce.start_date <= ${to} AND (ce.end_date IS NULL OR ce.end_date >= ${from})
     GROUP BY s.id ORDER BY s.full_name_search`);
  const recs = lessons.length
    ? await db.all<{ lesson_id: number; student_id: number; status: AttendanceStatus }>(sql`
        SELECT lesson_id, student_id, status FROM attendance_records
         WHERE lesson_id IN (${sql.join(lessons.map((l) => sql`${l.id}`), sql`, `)})`)
    : [];
  const map = new Map(recs.map((r) => [`${r.lesson_id}:${r.student_id}`, r.status]));
  return {
    month,
    lessons,
    students: students.map((s) => {
      const cells: Record<number, AttendanceStatus | null> = {};
      for (const l of lessons) cells[l.id] = map.get(`${l.id}:${s.id}`) ?? null;
      return { ...s, cells, stats: computeAttendanceStats(Object.values(cells).filter((v): v is AttendanceStatus => !!v)) };
    }),
  };
}

