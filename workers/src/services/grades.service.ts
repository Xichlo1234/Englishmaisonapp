/**
 * Chấm điểm & đánh giá.
 * - Mỗi đợt đánh giá (assessment) chụp lại cấu hình tiêu chí/trọng số/thang điểm/thang xếp loại (config_snapshot)
 *   → đổi cấu hình sau này KHÔNG làm thay đổi điểm trung bình/xếp loại của đợt cũ.
 * - Điểm trung bình theo trọng số, quy về thang 10, chỉ tính tiêu chí có điểm (Q8), làm tròn 2 chữ số (Q9).
 * - Mọi lần sửa điểm ghi audit_logs (cũ → mới).
 */
import { sql } from 'drizzle-orm';
import {
  classify,
  computeWeightedAverage,
  DEFAULT_GRADE_BANDS,
  validateGradeBands,
  vnDate,
  type AssessmentSnapshot,
  type GradeBand,
} from '@ecm/shared';
import type { AuthUser } from '../env';
import type { DB } from '../db/client';
import { runBatch, type BatchStatement } from '../lib/batch';
import { Errors } from '../lib/errors';
import { nowIso } from '../lib/time';
import { auditInsert, type AuditMeta } from './audit.service';
import { rosterAtDateSql } from './classes.service';
import { assertStudentAccess, hasFullScope, teacherClassIdsSql } from './scope';

// ───────────── Cấu hình ─────────────

export async function getBands(db: DB): Promise<GradeBand[]> {
  const [r] = await db.all<{ value: string }>(sql`SELECT value FROM system_settings WHERE key = 'grade_bands'`);
  return r ? (JSON.parse(r.value) as GradeBand[]) : DEFAULT_GRADE_BANDS;
}

export async function getGradingConfig(db: DB) {
  const criteria = await db.all<{ id: number; code: string; name: string; weight: number; maxScore: number; isActive: number; sortOrder: number }>(
    sql`SELECT id, code, name, weight, max_score AS maxScore, is_active AS isActive, sort_order AS sortOrder FROM grading_criteria ORDER BY sort_order, id`,
  );
  const types = await db.all<{ id: number; code: string; name: string; criteriaIds: string; isActive: number }>(
    sql`SELECT id, code, name, criteria_ids AS criteriaIds, is_active AS isActive FROM assessment_types ORDER BY id`,
  );
  return {
    criteria: criteria.map((c) => ({ ...c, isActive: !!c.isActive })),
    types: types.map((t) => ({ ...t, criteriaIds: JSON.parse(t.criteriaIds) as number[], isActive: !!t.isActive })),
    bands: (await getBands(db)).sort((a, b) => b.min - a.min),
  };
}

export async function saveCriteria(
  db: DB,
  meta: AuditMeta,
  input: { criteria: { id?: number; code?: string; name: string; weight: number; maxScore: number; isActive: boolean; sortOrder: number }[] },
) {
  if (!input.criteria.some((c) => c.isActive)) throw Errors.business('NO_ACTIVE_CRITERIA', 'Cần ít nhất một tiêu chí đang dùng');
  const existing = await db.all<{ id: number; code: string }>(sql`SELECT id, code FROM grading_criteria`);
  const ids = new Set(existing.map((e) => e.id));
  const codes = new Set(existing.map((e) => e.code));
  const stmts: BatchStatement[] = [];
  for (const c of input.criteria) {
    if (c.id) {
      if (!ids.has(c.id)) throw Errors.notFound('Tiêu chí');
      stmts.push(sql`UPDATE grading_criteria SET name = ${c.name}, weight = ${c.weight}, max_score = ${c.maxScore}, is_active = ${c.isActive ? 1 : 0},
                     sort_order = ${c.sortOrder}, updated_at = ${nowIso()} WHERE id = ${c.id}`);
    } else {
      if (!c.code) throw Errors.validation([{ path: 'code', message: 'Tiêu chí mới cần mã' }]);
      if (codes.has(c.code)) throw Errors.conflict('DUPLICATE_CODE', `Mã tiêu chí ${c.code} đã tồn tại`);
      codes.add(c.code);
      stmts.push(sql`INSERT INTO grading_criteria (code, name, weight, max_score, is_active, sort_order)
                     VALUES (${c.code}, ${c.name}, ${c.weight}, ${c.maxScore}, ${c.isActive ? 1 : 0}, ${c.sortOrder})`);
    }
  }
  stmts.push(auditInsert(db, meta, { action: 'grading.criteria_update', entityType: 'settings', after: input.criteria }));
  await runBatch(db, stmts);
}

export async function saveBands(db: DB, meta: AuditMeta, bands: GradeBand[]) {
  const err = validateGradeBands(bands);
  if (err) throw Errors.validation([{ path: 'bands', message: err }]);
  const sorted = [...bands].sort((a, b) => b.min - a.min);
  const before = await getBands(db);
  await runBatch(db, [
    sql`INSERT INTO system_settings (key, value, updated_by, updated_at) VALUES ('grade_bands', ${JSON.stringify(sorted)}, ${meta.actorUserId}, ${nowIso()})
        ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    auditInsert(db, meta, { action: 'grading.bands_update', entityType: 'settings', before, after: sorted }),
  ]);
}

export async function updateAssessmentType(db: DB, meta: AuditMeta, id: number, input: { name?: string; criteriaIds?: number[]; isActive?: boolean }) {
  const [t] = await db.all<{ id: number }>(sql`SELECT id FROM assessment_types WHERE id = ${id}`);
  if (!t) throw Errors.notFound('Loại đánh giá');
  if (input.criteriaIds) {
    const found = await db.all<{ id: number }>(
      sql`SELECT id FROM grading_criteria WHERE id IN (${sql.join(input.criteriaIds.map((i) => sql`${i}`), sql`, `)})`,
    );
    if (found.length !== new Set(input.criteriaIds).size) throw Errors.notFound('Tiêu chí');
  }
  await runBatch(db, [
    sql`UPDATE assessment_types SET
          name = coalesce(${input.name ?? null}, name),
          criteria_ids = coalesce(${input.criteriaIds ? JSON.stringify(input.criteriaIds) : null}, criteria_ids),
          is_active = coalesce(${input.isActive === undefined ? null : input.isActive ? 1 : 0}, is_active),
          updated_at = ${nowIso()}
        WHERE id = ${id}`,
    auditInsert(db, meta, { action: 'grading.type_update', entityType: 'settings', entityId: id, after: input }),
  ]);
}

// ───────────── Đợt đánh giá ─────────────

interface AssessmentRow {
  id: number;
  class_id: number;
  class_code: string;
  class_name: string;
  assessment_type_id: number;
  type_name: string;
  lesson_id: number | null;
  title: string;
  assessed_on: string;
  config_snapshot: string;
  status: 'DRAFT' | 'PUBLISHED';
  published_at: string | null;
  created_by_name: string | null;
  created_at: string;
}

function classScope(user: AuthUser, col = sql`a.class_id`) {
  if (hasFullScope(user)) return sql``;
  if (user.role === 'TEACHER' && user.teacherId) return sql`AND ${col} IN ${teacherClassIdsSql(user.teacherId)}`;
  return sql`AND 0`;
}

async function loadAssessment(db: DB, user: AuthUser, id: number): Promise<AssessmentRow & { snapshot: AssessmentSnapshot }> {
  const [a] = await db.all<AssessmentRow>(sql`
    SELECT a.id, a.class_id, c.class_code, c.name AS class_name, a.assessment_type_id, t.name AS type_name, a.lesson_id, a.title,
           a.assessed_on, a.config_snapshot, a.status, a.published_at, u.full_name AS created_by_name, a.created_at
      FROM assessments a JOIN classes c ON c.id = a.class_id JOIN assessment_types t ON t.id = a.assessment_type_id
      LEFT JOIN users u ON u.id = a.created_by
     WHERE a.id = ${id} AND a.deleted_at IS NULL ${classScope(user)}`);
  if (!a) throw Errors.notFound('Đợt đánh giá');
  return { ...a, snapshot: JSON.parse(a.config_snapshot) as AssessmentSnapshot };
}

async function assertCanGradeClass(db: DB, user: AuthUser, classId: number) {
  if (!user.permissions.has('grades.write')) throw Errors.forbidden();
  if (hasFullScope(user)) return;
  const [ok] = await db.all<{ n: number }>(
    sql`SELECT count(*) AS n FROM classes c WHERE c.id = ${classId} AND c.id IN ${teacherClassIdsSql(user.teacherId ?? -1)}`,
  );
  if (!ok?.n) throw Errors.notFound('Lớp học');
}

export async function listAssessments(db: DB, user: AuthUser, q: { classId?: number; typeId?: number }) {
  return db.all<{
    id: number;
    classId: number;
    classCode: string;
    title: string;
    typeName: string;
    assessedOn: string;
    status: string;
    gradedStudents: number;
    classAverage: number | null;
  }>(sql`
    SELECT a.id, a.class_id AS classId, c.class_code AS classCode, a.title, t.name AS typeName, a.assessed_on AS assessedOn, a.status,
           (SELECT count(*) FROM assessment_results r WHERE r.assessment_id = a.id AND r.weighted_average IS NOT NULL) AS gradedStudents,
           (SELECT round(avg(r.weighted_average), 2) FROM assessment_results r WHERE r.assessment_id = a.id AND r.weighted_average IS NOT NULL) AS classAverage
      FROM assessments a JOIN classes c ON c.id = a.class_id JOIN assessment_types t ON t.id = a.assessment_type_id
     WHERE a.deleted_at IS NULL
       ${q.classId ? sql`AND a.class_id = ${q.classId}` : sql``}
       ${q.typeId ? sql`AND a.assessment_type_id = ${q.typeId}` : sql``}
       ${classScope(user)}
     ORDER BY a.assessed_on DESC, a.id DESC LIMIT 300`);
}

export async function createAssessment(
  db: DB,
  meta: AuditMeta,
  user: AuthUser,
  input: { classId: number; assessmentTypeId: number; title: string; assessedOn: string; lessonId?: number | null },
) {
  await assertCanGradeClass(db, user, input.classId);
  const [cls] = await db.all<{ start_date: string; status: string }>(sql`SELECT start_date, status FROM classes WHERE id = ${input.classId} AND deleted_at IS NULL`);
  if (!cls) throw Errors.notFound('Lớp học');
  if (input.assessedOn < cls.start_date) throw Errors.validation([{ path: 'assessedOn', message: 'Ngày đánh giá trước ngày bắt đầu lớp' }]);
  if (input.assessedOn > vnDate()) throw Errors.validation([{ path: 'assessedOn', message: 'Không tạo đợt đánh giá cho ngày trong tương lai' }]);
  const [type] = await db.all<{ criteria_ids: string; is_active: number }>(sql`SELECT criteria_ids, is_active FROM assessment_types WHERE id = ${input.assessmentTypeId}`);
  if (!type || !type.is_active) throw Errors.business('TYPE_NOT_FOUND', 'Loại đánh giá không tồn tại hoặc đã ngừng dùng');
  const ids = JSON.parse(type.criteria_ids) as number[];
  const criteria = ids.length
    ? await db.all<{ id: number; code: string; name: string; weight: number; maxScore: number }>(sql`
        SELECT id, code, name, weight, max_score AS maxScore FROM grading_criteria
         WHERE is_active = 1 AND id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)}) ORDER BY sort_order, id`)
    : [];
  if (!criteria.length) throw Errors.business('NO_CRITERIA', 'Loại đánh giá chưa có tiêu chí đang dùng');
  if (input.lessonId) {
    const [l] = await db.all<{ class_id: number }>(sql`SELECT class_id FROM lessons WHERE id = ${input.lessonId}`);
    if (!l || l.class_id !== input.classId) throw Errors.business('LESSON_MISMATCH', 'Buổi học không thuộc lớp này');
  }
  const snapshot: AssessmentSnapshot = { criteria, bands: (await getBands(db)).sort((a, b) => b.min - a.min) };
  const [row] = await db.all<{ id: number }>(sql`
    INSERT INTO assessments (class_id, assessment_type_id, lesson_id, title, assessed_on, config_snapshot, status, created_by)
    VALUES (${input.classId}, ${input.assessmentTypeId}, ${input.lessonId ?? null}, ${input.title}, ${input.assessedOn}, ${JSON.stringify(snapshot)}, 'DRAFT', ${user.id})
    RETURNING id`);
  await auditInsert(db, meta, { action: 'assessment.create', entityType: 'assessment', entityId: row!.id, after: { ...input, snapshot } });
  return { id: row!.id };
}

function editBlock(user: AuthUser, a: { status: string }): string | null {
  if (!user.permissions.has('grades.write')) return 'Bạn không có quyền chấm điểm';
  if (a.status === 'PUBLISHED' && !hasFullScope(user)) return 'Kết quả đã công bố. Liên hệ quản trị viên nếu cần sửa điểm.';
  return null;
}

export async function getAssessmentSheet(db: DB, user: AuthUser, id: number) {
  const a = await loadAssessment(db, user, id);
  const roster = await db.all<{ studentId: number; studentCode: string; fullName: string }>(rosterAtDateSql(a.class_id, a.assessed_on));
  const grades = await db.all<{ student_id: number; criterion_id: number; score: number }>(
    sql`SELECT student_id, criterion_id, score FROM grades WHERE assessment_id = ${id}`,
  );
  const results = await db.all<{ student_id: number; weighted_average: number | null; classification: string | null; teacher_comment: string | null }>(
    sql`SELECT student_id, weighted_average, classification, teacher_comment FROM assessment_results WHERE assessment_id = ${id}`,
  );
  const res = new Map(results.map((r) => [r.student_id, r]));
  const block = editBlock(user, a);
  return {
    assessment: {
      id: a.id,
      classId: a.class_id,
      classCode: a.class_code,
      className: a.class_name,
      typeName: a.type_name,
      title: a.title,
      assessedOn: a.assessed_on,
      status: a.status,
      publishedAt: a.published_at,
      createdBy: a.created_by_name,
      lessonId: a.lesson_id,
    },
    snapshot: a.snapshot,
    students: roster.map((s) => {
      const scores: Record<number, number> = {};
      for (const g of grades) if (g.student_id === s.studentId) scores[g.criterion_id] = g.score;
      const r = res.get(s.studentId);
      return { ...s, scores, average: r?.weighted_average ?? null, classification: r?.classification ?? null, comment: r?.teacher_comment ?? null };
    }),
    canEdit: block === null,
    blockReason: block,
    canPublish: a.status === 'DRAFT' && block === null,
  };
}

/** Lưu điểm + nhận xét; tính lại điểm TB & xếp loại theo cấu hình đã chụp của đợt. */
export async function saveGrades(
  db: DB,
  meta: AuditMeta,
  user: AuthUser,
  id: number,
  input: { grades: { studentId: number; criterionId: number; score: number | null }[]; comments: { studentId: number; comment: string | null }[] },
) {
  const a = await loadAssessment(db, user, id);
  const block = editBlock(user, a);
  if (block) throw Errors.business('GRADES_NOT_EDITABLE', block);
  await assertCanGradeClass(db, user, a.class_id);
  const roster = new Set((await db.all<{ studentId: number }>(rosterAtDateSql(a.class_id, a.assessed_on))).map((s) => s.studentId));
  const crit = new Map(a.snapshot.criteria.map((c) => [c.id, c]));
  const issues: { path: string; message: string }[] = [];
  for (const [i, g] of input.grades.entries()) {
    const c = crit.get(g.criterionId);
    if (!roster.has(g.studentId)) issues.push({ path: `grades.${i}.studentId`, message: 'Học sinh không thuộc lớp vào ngày đánh giá' });
    else if (!c) issues.push({ path: `grades.${i}.criterionId`, message: 'Tiêu chí không thuộc đợt đánh giá này' });
    else if (g.score !== null && g.score > c.maxScore) issues.push({ path: `grades.${i}.score`, message: `Điểm ${c.name} tối đa ${c.maxScore}` });
    else if (g.score !== null && Math.round(g.score * 100) !== g.score * 100) issues.push({ path: `grades.${i}.score`, message: 'Điểm tối đa 2 chữ số thập phân' });
  }
  for (const [i, cm] of input.comments.entries()) if (!roster.has(cm.studentId)) issues.push({ path: `comments.${i}.studentId`, message: 'Học sinh không thuộc lớp' });
  if (issues.length) throw Errors.validation(issues, issues[0]!.message);

  const before = await db.all<{ student_id: number; criterion_id: number; score: number }>(sql`SELECT student_id, criterion_id, score FROM grades WHERE assessment_id = ${id}`);
  const old = new Map(before.map((g) => [`${g.student_id}:${g.criterion_id}`, g.score]));
  const changed = input.grades.filter((g) => (old.get(`${g.studentId}:${g.criterionId}`) ?? null) !== g.score);
  const oldComments = new Map(
    (await db.all<{ student_id: number; teacher_comment: string | null }>(sql`SELECT student_id, teacher_comment FROM assessment_results WHERE assessment_id = ${id}`)).map((r) => [
      r.student_id,
      r.teacher_comment,
    ]),
  );
  const changedComments = input.comments.filter((c) => (oldComments.get(c.studentId) ?? null) !== c.comment);
  if (!changed.length && !changedComments.length) return { saved: 0 };

  const now = nowIso();
  const stmts: BatchStatement[] = changed.map((g) =>
    g.score === null
      ? sql`DELETE FROM grades WHERE assessment_id = ${id} AND student_id = ${g.studentId} AND criterion_id = ${g.criterionId}`
      : sql`INSERT INTO grades (assessment_id, student_id, criterion_id, score, graded_by, graded_at)
            VALUES (${id}, ${g.studentId}, ${g.criterionId}, ${g.score}, ${user.id}, ${now})
            ON CONFLICT (assessment_id, student_id, criterion_id) DO UPDATE SET
              score = excluded.score, graded_by = excluded.graded_by, graded_at = excluded.graded_at, updated_at = ${now}`,
  );
  for (const c of changedComments)
    stmts.push(sql`INSERT INTO assessment_results (assessment_id, student_id, teacher_comment, updated_by)
                   VALUES (${id}, ${c.studentId}, ${c.comment}, ${user.id})
                   ON CONFLICT (assessment_id, student_id) DO UPDATE SET teacher_comment = excluded.teacher_comment, updated_by = excluded.updated_by, updated_at = ${now}`);
  if (changed.length)
    stmts.push(
      auditInsert(db, meta, {
        action: a.status === 'PUBLISHED' ? 'grade.update_after_publish' : old.size ? 'grade.update' : 'grade.create',
        entityType: 'assessment',
        entityId: id,
        before: changed.map((g) => ({ studentId: g.studentId, criterionId: g.criterionId, score: old.get(`${g.studentId}:${g.criterionId}`) ?? null })),
        after: changed,
      }),
    );
  if (changedComments.length)
    stmts.push(auditInsert(db, meta, { action: 'assessment.comment', entityType: 'assessment', entityId: id, after: changedComments }));
  await runBatch(db, stmts);

  // Tính lại kết quả (đọc lại từ DB để phản ánh cả thay đổi đồng thời của người khác)
  const affected = [...new Set(changed.map((g) => g.studentId))];
  if (affected.length) await recomputeResults(db, user.id, id, a.snapshot, affected);
  return { saved: changed.length + changedComments.length };
}

async function recomputeResults(db: DB, userId: number, id: number, snap: AssessmentSnapshot, studentIds: number[]) {
  const rows = await db.all<{ student_id: number; criterion_id: number; score: number }>(sql`
    SELECT student_id, criterion_id, score FROM grades WHERE assessment_id = ${id}
       AND student_id IN (${sql.join(studentIds.map((s) => sql`${s}`), sql`, `)})`);
  const now = nowIso();
  const stmts: BatchStatement[] = studentIds.map((sid) => {
    const scores: Record<number, number> = {};
    for (const r of rows) if (r.student_id === sid) scores[r.criterion_id] = r.score;
    const avg = computeWeightedAverage(snap.criteria, scores);
    const cls = classify(avg, snap.bands);
    return sql`INSERT INTO assessment_results (assessment_id, student_id, weighted_average, classification, computed_at, updated_by)
               VALUES (${id}, ${sid}, ${avg}, ${cls}, ${now}, ${userId})
               ON CONFLICT (assessment_id, student_id) DO UPDATE SET weighted_average = excluded.weighted_average,
                 classification = excluded.classification, computed_at = excluded.computed_at, updated_at = ${now}`;
  });
  await runBatch(db, stmts);
}

export async function publishAssessment(db: DB, meta: AuditMeta, user: AuthUser, id: number) {
  const a = await loadAssessment(db, user, id);
  const block = editBlock(user, a);
  if (block) throw Errors.business('GRADES_NOT_EDITABLE', block);
  if (a.status === 'PUBLISHED') return { notified: 0 };
  const [n] = await db.all<{ n: number }>(sql`SELECT count(*) AS n FROM assessment_results WHERE assessment_id = ${id} AND weighted_average IS NOT NULL`);
  if (!n?.n) throw Errors.business('NO_GRADES', 'Chưa có điểm nào để công bố');
  const [setting] = await db.all<{ value: string }>(sql`SELECT value FROM system_settings WHERE key = 'notifications_enabled'`);
  const notify = setting ? (JSON.parse(setting.value) as { result?: boolean }).result !== false : true;
  const now = nowIso();
  const res = await runBatch(db, [
    sql`UPDATE assessments SET status = 'PUBLISHED', published_at = ${now}, updated_at = ${now} WHERE id = ${id} AND status = 'DRAFT'`,
    auditInsert(db, meta, { action: 'assessment.publish', entityType: 'assessment', entityId: id }),
    ...(notify
      ? [
          sql`INSERT OR IGNORE INTO notifications (user_id, type, title, body, data, student_id, dedupe_key, push_status)
              SELECT g.user_id, 'RESULT', s.full_name || ': ' || ${a.title},
                     'Điểm trung bình ' || printf('%.2f', r.weighted_average) || ' – ' || coalesce(r.classification, ''),
                     json_object('assessmentId', ${id}, 'studentId', s.id), s.id, 'result:' || ${id} || ':' || s.id, 'PENDING'
                FROM assessment_results r JOIN students s ON s.id = r.student_id
                JOIN student_guardians sg ON sg.student_id = s.id JOIN guardians g ON g.id = sg.guardian_id
               WHERE r.assessment_id = ${id} AND r.weighted_average IS NOT NULL AND sg.receive_notifications = 1 AND g.user_id IS NOT NULL`,
        ]
      : []),
  ]);
  return { notified: notify ? (res[2]?.meta.changes ?? 0) : 0 };
}

export async function deleteAssessment(db: DB, meta: AuditMeta, user: AuthUser, id: number) {
  const a = await loadAssessment(db, user, id);
  await assertCanGradeClass(db, user, a.class_id);
  if (a.status === 'PUBLISHED') throw Errors.business('PUBLISHED', 'Không xóa được đợt đã công bố');
  const [g] = await db.all<{ n: number }>(sql`SELECT count(*) AS n FROM grades WHERE assessment_id = ${id}`);
  if (g!.n) throw Errors.business('HAS_GRADES', 'Đợt đánh giá đã có điểm, không thể xóa');
  await runBatch(db, [
    sql`DELETE FROM assessment_results WHERE assessment_id = ${id}`,
    sql`UPDATE assessments SET deleted_at = ${nowIso()} WHERE id = ${id}`,
    auditInsert(db, meta, { action: 'assessment.delete', entityType: 'assessment', entityId: id }),
  ]);
}

export async function assessmentHistory(db: DB, user: AuthUser, id: number) {
  const a = await loadAssessment(db, user, id);
  const names = new Map(a.snapshot.criteria.map((c) => [c.id, c.name]));
  const students = new Map(
    (await db.all<{ id: number; full_name: string }>(sql`SELECT s.id, s.full_name FROM students s JOIN class_enrollments ce ON ce.student_id = s.id WHERE ce.class_id = ${a.class_id}`)).map(
      (s) => [s.id, s.full_name],
    ),
  );
  const rows = await db.all<{ id: number; action: string; before_data: string | null; after_data: string | null; created_at: string; actor_name: string | null }>(sql`
    SELECT l.id, l.action, l.before_data, l.after_data, l.created_at, u.full_name AS actor_name
      FROM audit_logs l LEFT JOIN users u ON u.id = l.actor_user_id
     WHERE l.entity_type = 'assessment' AND l.entity_id = ${id} ORDER BY l.id DESC LIMIT 300`);
  return rows.map((r) => {
    const after = r.after_data ? JSON.parse(r.after_data) : null;
    const before = r.before_data ? JSON.parse(r.before_data) : null;
    const changes =
      r.action.startsWith('grade.') && Array.isArray(after)
        ? (after as { studentId: number; criterionId: number; score: number | null }[]).map((g, i) => ({
            student: students.get(g.studentId) ?? `#${g.studentId}`,
            criterion: names.get(g.criterionId) ?? `#${g.criterionId}`,
            from: (before as { score: number | null }[] | null)?.[i]?.score ?? null,
            to: g.score,
          }))
        : [];
    return { id: r.id, action: r.action, actorName: r.actor_name, createdAt: r.created_at, changes };
  });
}

/** Kết quả học tập của một học sinh (phụ huynh/học sinh chỉ thấy đợt đã công bố). */
export async function studentResults(db: DB, user: AuthUser, studentId: number) {
  await assertStudentAccess(db, user, studentId);
  const family = user.role === 'GUARDIAN' || user.role === 'STUDENT';
  const rows = await db.all<{
    id: number;
    title: string;
    typeName: string;
    assessedOn: string;
    classCode: string;
    status: string;
    snapshot: string;
    average: number | null;
    classification: string | null;
    comment: string | null;
  }>(sql`
    SELECT a.id, a.title, t.name AS typeName, a.assessed_on AS assessedOn, c.class_code AS classCode, a.status, a.config_snapshot AS snapshot,
           r.weighted_average AS average, r.classification, r.teacher_comment AS comment
      FROM assessment_results r JOIN assessments a ON a.id = r.assessment_id
      JOIN assessment_types t ON t.id = a.assessment_type_id JOIN classes c ON c.id = a.class_id
     WHERE r.student_id = ${studentId} AND a.deleted_at IS NULL ${family ? sql`AND a.status = 'PUBLISHED'` : sql``}
       ${user.role === 'TEACHER' ? classScope(user) : sql``}
     ORDER BY a.assessed_on, a.id`);
  const grades = rows.length
    ? await db.all<{ assessment_id: number; criterion_id: number; score: number }>(sql`
        SELECT assessment_id, criterion_id, score FROM grades WHERE student_id = ${studentId}
           AND assessment_id IN (${sql.join(rows.map((r) => sql`${r.id}`), sql`, `)})`)
    : [];
  return rows.map(({ snapshot, ...r }) => {
    const snap = JSON.parse(snapshot) as AssessmentSnapshot;
    return {
      ...r,
      scores: snap.criteria.map((c) => ({
        criterionId: c.id,
        name: c.name,
        maxScore: c.maxScore,
        score: grades.find((g) => g.assessment_id === r.id && g.criterion_id === c.id)?.score ?? null,
      })),
    };
  });
}

