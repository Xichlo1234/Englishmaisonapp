import { and, eq, sql, type SQL } from 'drizzle-orm';
import {
  normalizePersonName,
  normalizePhone,
  normalizeSearch,
  STUDENT_TRANSITIONS,
  vnDate,
  addDays,
  type GuardianLinkInput,
  type StudentCreateInput,
  type StudentListQuery,
  type StudentStatus,
  type StudentUpdateInput,
} from '@ecm/shared';
import type { AuthUser } from '../env';
import type { DB } from '../db/client';
import { guardians, students, studentGuardians } from '../db/schema';
import { Errors } from '../lib/errors';
import { nowIso } from '../lib/time';
import { runBatch, rowsOf, type BatchStatement } from '../lib/batch';
import { auditIfChanged, auditInsert, type AuditMeta } from './audit.service';
import { assertStudentAccess, hasFullScope, studentScopeSql } from './scope';

const STUDENT_SEQ = sql`(SELECT seq FROM sqlite_sequence WHERE name = 'students')`;
const GUARDIAN_SEQ = sql`(SELECT seq FROM sqlite_sequence WHERE name = 'guardians')`;

export interface StudentListRow {
  id: number;
  studentCode: string;
  fullName: string;
  dateOfBirth: string | null;
  gender: string | null;
  englishLevel: string | null;
  status: StudentStatus;
  startDate: string;
  needsAttention: boolean;
  schoolName: string | null;
  currentClasses: { id: number; code: string; name: string }[];
  primaryGuardian: { name: string; phone: string } | null;
  photoFileId: number | null;
}

function listWhere(user: AuthUser, q: StudentListQuery): SQL {
  const conds: SQL[] = [sql`s.deleted_at IS NULL`];
  if (!q.status) conds.push(sql`s.status <> 'ARCHIVED'`);
  else if (q.status !== 'ALL') conds.push(sql`s.status = ${q.status}`);
  if (q.level) conds.push(sql`s.english_level = ${q.level}`);
  if (q.needsAttention) conds.push(sql`s.needs_attention = ${Number(q.needsAttention)}`);
  if (q.classId)
    conds.push(sql`EXISTS (SELECT 1 FROM class_enrollments ce WHERE ce.student_id = s.id AND ce.status = 'ACTIVE' AND ce.class_id = ${q.classId})`);
  if (q.q) {
    const text = `%${normalizeSearch(q.q).replace(/[%_]/g, '')}%`;
    const digits = q.q.replace(/\D/g, '');
    const parts: SQL[] = [sql`s.full_name_search LIKE ${text}`, sql`lower(s.student_code) LIKE ${text}`];
    if (digits.length >= 3) {
      const phone = `%${normalizePhone(q.q) ?? digits}%`;
      parts.push(
        sql`EXISTS (SELECT 1 FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id WHERE sg.student_id = s.id AND g.phone LIKE ${phone})`,
      );
    }
    conds.push(sql`(${sql.join(parts, sql` OR `)})`);
  }
  const scope = studentScopeSql(user, sql`s.id`);
  if (scope) conds.push(scope);
  return sql.join(conds, sql` AND `);
}

const ORDER: Record<StudentListQuery['sort'], SQL> = {
  name: sql`s.full_name_search ASC, s.id ASC`,
  code: sql`s.student_code ASC`,
  startDate: sql`s.start_date DESC, s.id DESC`,
  recent: sql`s.created_at DESC, s.id DESC`,
};

type RawListRow = {
  id: number;
  student_code: string;
  full_name: string;
  date_of_birth: string | null;
  gender: string | null;
  english_level: string | null;
  status: StudentStatus;
  start_date: string;
  needs_attention: number;
  school_name: string | null;
  photo_file_id: number | null;
  classes_json: string | null;
  guardian_name: string | null;
  guardian_phone: string | null;
};

function mapListRow(r: RawListRow): StudentListRow {
  return {
    id: r.id,
    studentCode: r.student_code,
    fullName: r.full_name,
    dateOfBirth: r.date_of_birth,
    gender: r.gender,
    englishLevel: r.english_level,
    status: r.status,
    startDate: r.start_date,
    needsAttention: !!r.needs_attention,
    schoolName: r.school_name,
    photoFileId: r.photo_file_id,
    currentClasses: r.classes_json ? (JSON.parse(r.classes_json) as StudentListRow['currentClasses']) : [],
    primaryGuardian: r.guardian_name ? { name: r.guardian_name, phone: r.guardian_phone ?? '' } : null,
  };
}

const LIST_SELECT = sql`
  SELECT s.id, s.student_code, s.full_name, s.date_of_birth, s.gender, s.english_level, s.status, s.start_date,
         s.needs_attention, s.school_name, s.photo_file_id,
         (SELECT json_group_array(json_object('id', c.id, 'code', c.class_code, 'name', c.name))
            FROM class_enrollments ce JOIN classes c ON c.id = ce.class_id
           WHERE ce.student_id = s.id AND ce.status = 'ACTIVE') AS classes_json,
         g.full_name AS guardian_name, g.phone AS guardian_phone
    FROM students s
    LEFT JOIN guardians g ON g.id = (
      SELECT sg.guardian_id FROM student_guardians sg WHERE sg.student_id = s.id
       ORDER BY sg.is_primary DESC, sg.created_at ASC LIMIT 1)`;

export async function listStudents(db: DB, user: AuthUser, q: StudentListQuery) {
  const where = listWhere(user, q);
  const offset = (q.page - 1) * q.pageSize;
  const [rowsRes, countRes] = await runBatch(db, [
    sql`${LIST_SELECT} WHERE ${where} ORDER BY ${ORDER[q.sort]} LIMIT ${q.pageSize} OFFSET ${offset}`,
    sql`SELECT count(*) AS n FROM students s WHERE ${where}`,
  ]);
  const rows = rowsOf<RawListRow>(rowsRes);
  const count = rowsOf<{ n: number }>(countRes);
  return {
    data: rows.map((r) => {
      const m = mapListRow(r);
      // json_group_array trả "[]" chứa object null khi không có lớp
      m.currentClasses = m.currentClasses.filter((c) => c && c.id !== null);
      return m;
    }),
    page: q.page,
    pageSize: q.pageSize,
    total: count[0]?.n ?? 0,
  };
}

/** Dữ liệu xuất Excel: tối đa 2000 dòng theo bộ lọc. */
export async function exportStudents(db: DB, user: AuthUser, q: StudentListQuery) {
  const where = listWhere(user, q);
  const rows = await db.all<RawListRow & { address: string | null; school_grade: string | null }>(
    sql`SELECT * FROM (${LIST_SELECT}) x JOIN (SELECT id AS sid, address, school_grade FROM students) y ON y.sid = x.id
        WHERE x.id IN (SELECT s.id FROM students s WHERE ${where}) ORDER BY x.full_name ASC LIMIT 2000`,
  );
  return rows.map((r) => ({
    ...mapListRow(r),
    address: r.address,
    schoolGrade: r.school_grade,
  }));
}

export async function getStudentDetail(db: DB, user: AuthUser, id: number) {
  await assertStudentAccess(db, user, id);
  const studentRows = await db.select().from(students).where(eq(students.id, id));
  const guardianRows = await db.all<{
      id: number;
      full_name: string;
      phone: string;
      email: string | null;
      relationship: string;
      is_primary: number;
      receive_notifications: number;
      has_account: number;
      avatar_file_id: number | null;
    }>(sql`SELECT g.id, g.full_name, g.phone, g.email, sg.relationship, sg.is_primary, sg.receive_notifications,
                  (g.user_id IS NOT NULL) AS has_account,
                  (SELECT f.id FROM users u JOIN files f ON f.id = u.avatar_file_id AND f.deleted_at IS NULL WHERE u.id = g.user_id) AS avatar_file_id
             FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
            WHERE sg.student_id = ${id} ORDER BY sg.is_primary DESC, sg.created_at ASC`);
  const enrollmentRows = await db.all<{
      id: number;
      class_id: number;
      class_code: string;
      class_name: string;
      start_date: string;
      end_date: string | null;
      status: string;
      end_reason: string | null;
      note: string | null;
      transferred_from_id: number | null;
    }>(sql`SELECT ce.id, ce.class_id, c.class_code, c.name AS class_name, ce.start_date, ce.end_date, ce.status,
                  ce.end_reason, ce.note, ce.transferred_from_id
             FROM class_enrollments ce JOIN classes c ON c.id = ce.class_id
            WHERE ce.student_id = ${id} ORDER BY ce.start_date DESC, ce.id DESC`);
  const row = studentRows[0];
  if (!row) throw Errors.notFound('Học sinh');
  const isFamily = user.role === 'GUARDIAN' || user.role === 'STUDENT';
  // Ghi chú nội bộ của nhân sự không hiển thị cho phụ huynh/học sinh.
  const s = isFamily ? { ...row, notes: null, attentionNote: null, needsAttention: false, createdBy: null } : row;
  return {
    ...s,
    guardians: guardianRows.map((g) => ({
      id: g.id,
      fullName: g.full_name,
      phone: g.phone,
      email: g.email,
      relationship: g.relationship,
      isPrimary: !!g.is_primary,
      receiveNotifications: !!g.receive_notifications,
      hasAccount: !!g.has_account,
      avatarFileId: g.avatar_file_id,
    })),
    enrollments: enrollmentRows.map((e) => ({
      id: e.id,
      classId: e.class_id,
      classCode: e.class_code,
      className: e.class_name,
      startDate: e.start_date,
      endDate: e.end_date,
      status: e.status,
      endReason: e.end_reason,
      note: e.note,
      transferredFromId: e.transferred_from_id,
    })),
    canEdit: hasFullScope(user) && user.permissions.has('students.write'),
  };
}

export async function findDuplicates(
  db: DB,
  p: { fullName?: string; dateOfBirth?: string; phone?: string; excludeId?: number },
) {
  const conds: SQL[] = [];
  if (p.fullName && p.dateOfBirth)
    conds.push(sql`(s.full_name_search = ${normalizeSearch(p.fullName)} AND s.date_of_birth = ${p.dateOfBirth})`);
  const phone = p.phone ? normalizePhone(p.phone) : null;
  if (phone)
    conds.push(
      sql`EXISTS (SELECT 1 FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id WHERE sg.student_id = s.id AND g.phone = ${phone})`,
    );
  if (!conds.length) return [];
  const rows = await db.all<{ id: number; student_code: string; full_name: string; date_of_birth: string | null; status: string }>(
    sql`SELECT s.id, s.student_code, s.full_name, s.date_of_birth, s.status FROM students s
         WHERE s.deleted_at IS NULL AND (${sql.join(conds, sql` OR `)}) ${p.excludeId ? sql`AND s.id <> ${p.excludeId}` : sql``}
         LIMIT 10`,
  );
  return rows.map((r) => ({ id: r.id, studentCode: r.student_code, fullName: r.full_name, dateOfBirth: r.date_of_birth, status: r.status }));
}

/** Tìm phụ huynh có sẵn theo SĐT (để liên kết khi thêm học sinh là anh/chị/em). */
export async function findGuardiansByPhone(db: DB, phone: string) {
  const p = normalizePhone(phone);
  if (!p) return [];
  const rows = await db.all<{ id: number; full_name: string; phone: string; email: string | null; children: string | null }>(
    sql`SELECT g.id, g.full_name, g.phone, g.email,
               (SELECT group_concat(s.full_name, ', ') FROM student_guardians sg JOIN students s ON s.id = sg.student_id WHERE sg.guardian_id = g.id) AS children
          FROM guardians g WHERE g.phone = ${p} AND g.deleted_at IS NULL LIMIT 5`,
  );
  return rows.map((r) => ({ id: r.id, fullName: r.full_name, phone: r.phone, email: r.email, children: r.children }));
}

async function assertGuardiansExist(db: DB, links: GuardianLinkInput[]) {
  const ids = links.map((l) => l.guardianId).filter((x): x is number => !!x);
  if (!ids.length) return;
  const rows = await db.all<{ id: number }>(
    sql`SELECT id FROM guardians WHERE deleted_at IS NULL AND id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`,
  );
  if (rows.length !== new Set(ids).size) throw Errors.business('GUARDIAN_NOT_FOUND', 'Phụ huynh được chọn không tồn tại');
}

export async function createStudent(db: DB, meta: AuditMeta, user: AuthUser, input: StudentCreateInput) {
  await assertGuardiansExist(db, input.guardians);
  const fullName = normalizePersonName(input.fullName);
  const links = input.guardians.map((g, i) => ({ ...g, isPrimary: g.isPrimary || false, idx: i }));
  if (!links.some((l) => l.isPrimary)) links[0]!.isPrimary = true;
  // chỉ một phụ huynh chính
  let seenPrimary = false;
  for (const l of links) {
    if (l.isPrimary && seenPrimary) l.isPrimary = false;
    if (l.isPrimary) seenPrimary = true;
  }

  const stmts: BatchStatement[] = [
    db.insert(students).values({
      fullName,
      fullNameSearch: normalizeSearch(fullName),
      dateOfBirth: input.dateOfBirth ?? null,
      gender: input.gender ?? null,
      address: input.address,
      schoolName: input.schoolName,
      schoolGrade: input.schoolGrade,
      startDate: input.startDate,
      englishLevel: input.englishLevel,
      needsAttention: input.needsAttention ?? false,
      photoConsent: input.photoConsent ?? true,
      attentionNote: input.attentionNote,
      notes: input.notes,
      status: 'ACTIVE',
      createdBy: user.id,
    }),
  ];
  for (const l of links) {
    if (l.guardian) {
      stmts.push(
        db.insert(guardians).values({
          fullName: normalizePersonName(l.guardian.fullName),
          phone: l.guardian.phone,
          email: l.guardian.email ?? null,
        }),
      );
    }
    stmts.push(
      sql`INSERT INTO student_guardians (student_id, guardian_id, relationship, is_primary, receive_notifications)
                 VALUES (${STUDENT_SEQ}, ${l.guardian ? GUARDIAN_SEQ : l.guardianId!}, ${l.relationship}, ${l.isPrimary ? 1 : 0}, ${l.receiveNotifications ? 1 : 0})`,
    );
  }
  stmts.push(
    sql`INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, after_data, ip, user_agent, request_id)
               VALUES (${meta.actorUserId}, 'student.create', 'student', ${STUDENT_SEQ}, ${JSON.stringify({ ...input, fullName })}, ${meta.ip}, ${meta.userAgent}, ${meta.requestId})`,
  );
  stmts.push(sql`SELECT id, student_code FROM students WHERE id = ${STUDENT_SEQ}`);

  const results = await runBatch(db, stmts);
  const created = rowsOf<{ id: number; student_code: string }>(results[results.length - 1])[0]!;
  return { id: created.id, studentCode: created.student_code };
}

async function loadForWrite(db: DB, id: number) {
  const [s] = await db.select().from(students).where(and(eq(students.id, id), sql`${students.deletedAt} IS NULL`));
  if (!s) throw Errors.notFound('Học sinh');
  return s;
}

function versionMismatch(current: { version: number }, expected: number) {
  if (current.version !== expected) throw Errors.versionConflict();
}

export async function updateStudent(db: DB, meta: AuditMeta, id: number, input: StudentUpdateInput) {
  const before = await loadForWrite(db, id);
  versionMismatch(before, input.version);
  const { version, ...fields } = input;
  const patch: Partial<typeof students.$inferInsert> = {};
  const changed: Record<string, { from: unknown; to: unknown }> = {};
  for (const [k, v] of Object.entries(fields) as [keyof typeof fields, unknown][]) {
    if (v === undefined) continue;
    let value = v;
    if (k === 'fullName') value = normalizePersonName(String(v));
    const old = (before as Record<string, unknown>)[k];
    if (old !== value) {
      (patch as Record<string, unknown>)[k] = value;
      changed[k] = { from: old, to: value };
    }
  }
  if (patch.fullName) patch.fullNameSearch = normalizeSearch(patch.fullName);
  const newDob = patch.dateOfBirth !== undefined ? patch.dateOfBirth : before.dateOfBirth;
  const newStart = patch.startDate ?? before.startDate;
  if (newDob && newDob >= newStart)
    throw Errors.validation([{ path: 'dateOfBirth', message: 'Ngày sinh phải trước ngày bắt đầu học' }]);
  if (!Object.keys(changed).length) return { version: before.version, changed: 0 };

  const [res] = await runBatch(db, [
    db
      .update(students)
      .set({ ...patch, version: sql`${students.version} + 1`, updatedAt: nowIso() })
      .where(and(eq(students.id, id), eq(students.version, version))),
    auditIfChanged(db, meta, { action: 'student.update', entityType: 'student', entityId: id, before: undefined, after: changed }),
  ]);
  if (!res?.meta.changes) throw Errors.versionConflict();
  return { version: version + 1, changed: Object.keys(changed).length };
}

export type StatusAction = keyof typeof STUDENT_TRANSITIONS;

export async function changeStudentStatus(
  db: DB,
  meta: AuditMeta,
  id: number,
  action: StatusAction,
  input: { version: number; effectiveDate?: string; until?: string | null; reason?: string },
) {
  const before = await loadForWrite(db, id);
  versionMismatch(before, input.version);
  const allowed = STUDENT_TRANSITIONS[action] as readonly string[];
  if (!allowed.includes(before.status))
    throw Errors.business('INVALID_STATUS_TRANSITION', `Không thể thực hiện thao tác này với học sinh đang ở trạng thái hiện tại`);

  const today = vnDate();
  const eff = input.effectiveDate ?? today;
  let newStatus: StudentStatus;
  const patch: Partial<typeof students.$inferInsert> = {};
  let closeEnrollments: 'PAUSE' | 'DROP' | null = null;

  switch (action) {
    case 'pause':
      newStatus = 'PAUSED';
      patch.pauseUntil = input.until ?? null;
      closeEnrollments = 'PAUSE';
      break;
    case 'drop':
      newStatus = 'DROPPED';
      patch.pauseUntil = null;
      closeEnrollments = 'DROP';
      break;
    case 'reactivate':
      newStatus = 'ACTIVE';
      patch.pauseUntil = null;
      break;
    case 'archive':
      newStatus = 'ARCHIVED';
      patch.statusBeforeArchive = before.status;
      if (before.status === 'ACTIVE' || before.status === 'PAUSED') closeEnrollments = 'DROP';
      break;
    case 'restore': {
      const prev = before.statusBeforeArchive;
      // Ghi danh đã bị đóng khi lưu trữ → học sinh đang học/tạm nghỉ được khôi phục về "Nghỉ học".
      newStatus = prev === 'GRADUATED' ? 'GRADUATED' : 'DROPPED';
      patch.statusBeforeArchive = null;
      break;
    }
  }

  if (closeEnrollments) {
    // Không cho đặt ngày hiệu lực trước buổi đã điểm danh (tránh sai lệch dữ liệu).
    const att = await db.all<{ d: string | null }>(
      sql`SELECT max(l.lesson_date) AS d FROM attendance_records a JOIN lessons l ON l.id = a.lesson_id WHERE a.student_id = ${id}`,
    );
    const last = att[0]?.d;
    if (last && last >= eff)
      throw Errors.business(
        'EFFECTIVE_DATE_BEFORE_ATTENDANCE',
        `Học sinh đã được điểm danh đến ngày ${last.split('-').reverse().join('/')}. Ngày hiệu lực phải sau ngày này.`,
        { lastAttendanceDate: last },
      );
  }

  const newVersion = input.version + 1;
  const stmts: BatchStatement[] = [
    db
      .update(students)
      .set({ ...patch, status: newStatus!, version: newVersion, updatedAt: nowIso() })
      .where(and(eq(students.id, id), eq(students.version, input.version))),
    auditIfChanged(db, meta, {
      action: `student.${action}`,
      entityType: 'student',
      entityId: id,
      before: { status: before.status },
      after: { status: newStatus!, effectiveDate: eff, until: input.until ?? null },
      reason: input.reason ?? null,
    }),
  ];
  if (closeEnrollments) {
    const endDate = addDays(eff, -1);
    stmts.push(
      sql`UPDATE class_enrollments
                    SET status = 'ENDED', end_date = max(start_date, ${endDate}), end_reason = ${closeEnrollments},
                        note = coalesce(note || ' | ', '') || ${input.reason ?? ''}, updated_at = ${nowIso()}
                  WHERE student_id = ${id} AND status = 'ACTIVE'
                    AND (SELECT version FROM students WHERE id = ${id}) = ${newVersion}`,
    );
  }
  const [res] = await runBatch(db, stmts);
  if (!res?.meta.changes) throw Errors.versionConflict();
  return { status: newStatus!, version: newVersion };
}

/** Xóa cứng — chỉ khi học sinh chưa có bất kỳ dữ liệu học tập/tài chính nào. */
export async function hardDeleteStudent(db: DB, meta: AuditMeta, id: number) {
  const before = await loadForWrite(db, id);
  const [dep] = await db.all<{ n: number }>(sql`SELECT
      (SELECT count(*) FROM class_enrollments WHERE student_id = ${id}) +
      (SELECT count(*) FROM attendance_records WHERE student_id = ${id}) +
      (SELECT count(*) FROM grades WHERE student_id = ${id}) +
      (SELECT count(*) FROM assessment_results WHERE student_id = ${id}) +
      (SELECT count(*) FROM invoices WHERE student_id = ${id}) +
      (SELECT count(*) FROM payments WHERE student_id = ${id}) +
      (SELECT count(*) FROM student_fee_plans WHERE student_id = ${id}) AS n`);
  if (dep!.n > 0)
    throw Errors.business(
      'STUDENT_HAS_HISTORY',
      'Học sinh đã có lịch sử học tập hoặc tài chính, không thể xóa vĩnh viễn. Hãy dùng "Lưu trữ".',
    );
  await runBatch(db, [
    sql`UPDATE files SET deleted_at = ${nowIso()} WHERE owner_type = 'student' AND owner_id = ${id}`,
    sql`DELETE FROM notifications WHERE student_id = ${id}`,
    db.delete(studentGuardians).where(eq(studentGuardians.studentId, id)),
    sql`UPDATE students SET photo_file_id = NULL WHERE id = ${id}`,
    db.delete(students).where(eq(students.id, id)),
    auditInsert(db, meta, { action: 'student.hard_delete', entityType: 'student', entityId: id, before }),
  ]);
}

export async function studentTimeline(db: DB, id: number) {
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
          WHERE (a.entity_type = 'student' AND a.entity_id = ${id})
             OR (a.entity_type = 'enrollment' AND json_extract(a.after_data, '$.studentId') = ${id})
          ORDER BY a.id DESC LIMIT 200`);
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    before: r.before_data ? JSON.parse(r.before_data) : null,
    after: r.after_data ? JSON.parse(r.after_data) : null,
    reason: r.reason,
    createdAt: r.created_at,
    actorName: r.actor_name,
  }));
}

// ───────────── Phụ huynh của học sinh ─────────────

export async function linkGuardian(db: DB, meta: AuditMeta, studentId: number, input: GuardianLinkInput) {
  await loadForWrite(db, studentId);
  await assertGuardiansExist(db, [input]);
  const [cnt] = await db.all<{ n: number }>(sql`SELECT count(*) AS n FROM student_guardians WHERE student_id = ${studentId}`);
  if (cnt!.n >= 3) throw Errors.business('TOO_MANY_GUARDIANS', 'Mỗi học sinh tối đa 3 phụ huynh');
  if (input.guardianId) {
    const [dup] = await db.all<{ n: number }>(
      sql`SELECT count(*) AS n FROM student_guardians WHERE student_id = ${studentId} AND guardian_id = ${input.guardianId}`,
    );
    if (dup!.n) throw Errors.conflict('ALREADY_LINKED', 'Phụ huynh này đã được liên kết');
  }
  const isPrimary = input.isPrimary || cnt!.n === 0;
  const stmts: BatchStatement[] = [];
  if (isPrimary) stmts.push(sql`UPDATE student_guardians SET is_primary = 0 WHERE student_id = ${studentId}`);
  if (input.guardian)
    stmts.push(
      db.insert(guardians).values({
        fullName: normalizePersonName(input.guardian.fullName),
        phone: input.guardian.phone,
        email: input.guardian.email ?? null,
      }),
    );
  stmts.push(
    sql`INSERT INTO student_guardians (student_id, guardian_id, relationship, is_primary, receive_notifications)
               VALUES (${studentId}, ${input.guardian ? GUARDIAN_SEQ : input.guardianId!}, ${input.relationship}, ${isPrimary ? 1 : 0}, ${input.receiveNotifications ? 1 : 0})`,
    auditInsert(db, meta, { action: 'student.guardian_link', entityType: 'student', entityId: studentId, after: input }),
  );
  await runBatch(db, stmts);
}

export async function updateGuardianLink(
  db: DB,
  meta: AuditMeta,
  studentId: number,
  guardianId: number,
  input: { relationship?: string; isPrimary?: boolean; receiveNotifications?: boolean; guardian?: { fullName: string; phone: string; email?: string | null } },
) {
  const [link] = await db
    .select()
    .from(studentGuardians)
    .where(and(eq(studentGuardians.studentId, studentId), eq(studentGuardians.guardianId, guardianId)));
  if (!link) throw Errors.notFound('Liên kết phụ huynh');
  const stmts: BatchStatement[] = [];
  if (input.isPrimary) stmts.push(sql`UPDATE student_guardians SET is_primary = 0 WHERE student_id = ${studentId}`);
  const patch: Partial<typeof studentGuardians.$inferInsert> = {};
  if (input.relationship) patch.relationship = input.relationship;
  if (input.isPrimary !== undefined) patch.isPrimary = input.isPrimary;
  if (input.receiveNotifications !== undefined) patch.receiveNotifications = input.receiveNotifications;
  if (Object.keys(patch).length)
    stmts.push(
      db
        .update(studentGuardians)
        .set(patch)
        .where(and(eq(studentGuardians.studentId, studentId), eq(studentGuardians.guardianId, guardianId))),
    );
  if (input.guardian)
    stmts.push(
      db
        .update(guardians)
        .set({
          fullName: normalizePersonName(input.guardian.fullName),
          phone: input.guardian.phone,
          email: input.guardian.email ?? null,
          updatedAt: nowIso(),
        })
        .where(eq(guardians.id, guardianId)),
    );
  stmts.push(
    auditInsert(db, meta, { action: 'student.guardian_update', entityType: 'student', entityId: studentId, after: { guardianId, ...input } }),
  );
  await runBatch(db, stmts);
}

export async function unlinkGuardian(db: DB, meta: AuditMeta, studentId: number, guardianId: number) {
  const [cnt] = await db.all<{ n: number; linked: number }>(
    sql`SELECT count(*) AS n, sum(guardian_id = ${guardianId}) AS linked FROM student_guardians WHERE student_id = ${studentId}`,
  );
  if (!cnt?.linked) throw Errors.notFound('Liên kết phụ huynh');
  if (cnt.n <= 1) throw Errors.business('LAST_GUARDIAN', 'Học sinh phải có ít nhất một phụ huynh');
  await runBatch(db, [
    db.delete(studentGuardians).where(and(eq(studentGuardians.studentId, studentId), eq(studentGuardians.guardianId, guardianId))),
    // đảm bảo vẫn còn một phụ huynh chính
    sql`UPDATE student_guardians SET is_primary = 1
                WHERE student_id = ${studentId} AND NOT EXISTS (SELECT 1 FROM student_guardians WHERE student_id = ${studentId} AND is_primary = 1)
                  AND guardian_id = (SELECT guardian_id FROM student_guardians WHERE student_id = ${studentId} ORDER BY created_at LIMIT 1)`,
    auditInsert(db, meta, { action: 'student.guardian_unlink', entityType: 'student', entityId: studentId, after: { guardianId } }),
  ]);
}
