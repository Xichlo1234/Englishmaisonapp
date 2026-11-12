/**
 * Nhật ký lớp (ảnh + nội dung buổi học) và bài tập (giao, phụ huynh nộp ảnh bài làm, giáo viên chấm Đã làm/Chưa làm).
 * Tệp nằm trong bảng files (owner_type 'class_post' | 'homework' | 'homework_submission'); quyền đọc ở files.service.
 */
import { sql, type SQL } from 'drizzle-orm';
import { vnDate, type HomeworkReviewInput } from '@ecm/shared';
import type { AuthUser, Bindings } from '../env';
import type { DB } from '../db/client';
import { runBatch, rowsOf, type BatchStatement } from '../lib/batch';
import { Errors } from '../lib/errors';
import { nowIso } from '../lib/time';
import { auditInsert, type AuditMeta } from './audit.service';
import { discardUploads, fileRowsSql, storeUploads } from './files.service';
import { assertStudentAccess, classContentVisibleSql, hasFullScope, teacherClassIdsSql } from './scope';

const seq = (table: string) => sql`(SELECT seq FROM sqlite_sequence WHERE name = ${table})`;

async function loadClass(db: DB, classId: number) {
  const [c] = await db.all<{ id: number; name: string; class_code: string }>(
    sql`SELECT id, name, class_code FROM classes WHERE id = ${classId} AND deleted_at IS NULL`,
  );
  if (!c) throw Errors.notFound('Lớp');
  return c;
}

async function assertClassWrite(db: DB, user: AuthUser, classId: number) {
  const c = await loadClass(db, classId);
  if (hasFullScope(user)) return c;
  if (user.role === 'TEACHER' && user.teacherId) {
    const [ok] = await db.all<{ v: number }>(sql`SELECT ${classId} IN ${teacherClassIdsSql(user.teacherId)} AS v`);
    if (ok?.v) return c;
  }
  throw Errors.forbidden('Chỉ giáo viên của lớp hoặc quản lý được đăng bài cho lớp này');
}

async function notificationsOn(db: DB) {
  const [r] = await db.all<{ value: string }>(sql`SELECT value FROM system_settings WHERE key = 'notifications_enabled'`);
  return r ? (JSON.parse(r.value) as { classroom?: boolean }).classroom !== false : true;
}

/** One notification per guardian account of students actively enrolled in the class. */
function notifyClassGuardians(classId: number, title: string, body: string, data: Record<string, unknown>, dedupePrefix: SQL) {
  return sql`INSERT OR IGNORE INTO notifications (user_id, type, title, body, data, student_id, dedupe_key, push_status)
             SELECT g.user_id, 'SYSTEM', ${title}, ${body}, ${JSON.stringify(data)}, min(ce.student_id), ${dedupePrefix} || ':' || g.user_id, 'PENDING'
               FROM class_enrollments ce JOIN student_guardians sg ON sg.student_id = ce.student_id JOIN guardians g ON g.id = sg.guardian_id
              WHERE ce.class_id = ${classId} AND ce.status = 'ACTIVE' AND sg.receive_notifications = 1 AND g.user_id IS NOT NULL
              GROUP BY g.user_id`;
}

const filesOf = async (db: DB, ownerType: string, ids: number[]) => {
  if (!ids.length) return new Map<number, { id: number; mimeType: string; name: string }[]>();
  const rows = await db.all<{ id: number; owner_id: number; mime_type: string; original_name: string }>(sql`
    SELECT id, owner_id, mime_type, original_name FROM files
     WHERE owner_type = ${ownerType} AND deleted_at IS NULL AND owner_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})
     ORDER BY id`);
  const map = new Map<number, { id: number; mimeType: string; name: string }[]>();
  for (const r of rows) map.set(r.owner_id, [...(map.get(r.owner_id) ?? []), { id: r.id, mimeType: r.mime_type, name: r.original_name }]);
  return map;
};

// ───────────── Nhật ký lớp ─────────────

export async function createClassPost(
  db: DB,
  env: Bindings,
  meta: AuditMeta,
  user: AuthUser,
  classId: number,
  input: { content: string; postDate?: string },
  photos: File[],
) {
  const c = await assertClassWrite(db, user, classId);
  const postDate = input.postDate ?? vnDate();
  if (postDate > vnDate()) throw Errors.validation([{ path: 'postDate', message: 'Không đăng nhật ký cho ngày tương lai' }]);
  const stored = await storeUploads(env, `classes/${classId}/posts`, photos, { max: 10 });
  try {
    const stmts: BatchStatement[] = [
      sql`INSERT INTO class_posts (class_id, post_date, content, created_by) VALUES (${classId}, ${postDate}, ${input.content}, ${user.id})`,
      ...fileRowsSql(stored, { category: 'ATTACHMENT', ownerType: 'class_post', ownerId: seq('class_posts'), visibility: 'CLASS', uploadedBy: user.id }),
      auditInsert(db, meta, { action: 'class_post.create', entityType: 'class', entityId: classId, after: { postDate, photos: stored.length } }),
    ];
    if (await notificationsOn(db))
      stmts.push(
        notifyClassGuardians(
          classId,
          `Nhật ký lớp ${c.name}`,
          `${stored.length ? `${stored.length} ảnh · ` : ''}${input.content.slice(0, 120)}`,
          { kind: 'CLASS_POST', classId },
          sql`'post:' || ${seq('class_posts')}`,
        ),
      );
    stmts.push(sql`SELECT ${seq('class_posts')} AS id`);
    const res = await runBatch(db, stmts);
    return { id: rowsOf<{ id: number }>(res[res.length - 1])[0]!.id };
  } catch (e) {
    await discardUploads(env, stored);
    throw e;
  }
}

async function postsWhere(db: DB, user: AuthUser, where: SQL, q: { before?: number; limit: number }) {
  const rows = await db.all<{ id: number; class_id: number; class_name: string; post_date: string; content: string; created_by: number; author: string; created_at: string }>(sql`
    SELECT p.id, p.class_id, c.name AS class_name, p.post_date, p.content, p.created_by, u.full_name AS author, p.created_at
      FROM class_posts p JOIN classes c ON c.id = p.class_id JOIN users u ON u.id = p.created_by
     WHERE p.deleted_at IS NULL AND ${where} AND ${classContentVisibleSql(user, sql`p.class_id`, sql`p.post_date`)}
       ${q.before ? sql`AND p.id < ${q.before}` : sql.empty()}
     ORDER BY p.id DESC LIMIT ${q.limit}`);
  const photos = await filesOf(db, 'class_post', rows.map((r) => r.id));
  return rows.map((r) => ({
    id: r.id,
    classId: r.class_id,
    className: r.class_name,
    postDate: r.post_date,
    content: r.content,
    author: r.author,
    createdAt: r.created_at,
    photos: photos.get(r.id) ?? [],
    canDelete: hasFullScope(user) || r.created_by === user.id,
  }));
}

export async function listClassPosts(db: DB, user: AuthUser, classId: number, q: { before?: number; limit: number }) {
  await loadClass(db, classId);
  return postsWhere(db, user, sql`p.class_id = ${classId}`, q);
}

/** Feed for one child: posts of every class they attended on the post date. */
export async function studentClassPosts(db: DB, user: AuthUser, studentId: number, q: { before?: number; limit: number }) {
  await assertStudentAccess(db, user, studentId);
  return postsWhere(
    db,
    user,
    sql`EXISTS (SELECT 1 FROM class_enrollments e WHERE e.class_id = p.class_id AND e.student_id = ${studentId}
                  AND e.start_date <= p.post_date AND coalesce(e.end_date, '9999-12-31') >= p.post_date)`,
    q,
  );
}

export async function deleteClassPost(db: DB, meta: AuditMeta, user: AuthUser, id: number) {
  const [p] = await db.all<{ created_by: number; class_id: number }>(sql`SELECT created_by, class_id FROM class_posts WHERE id = ${id} AND deleted_at IS NULL`);
  if (!p) throw Errors.notFound('Bài nhật ký');
  if (!hasFullScope(user) && p.created_by !== user.id) throw Errors.forbidden('Chỉ người đăng hoặc quản lý được xóa');
  const now = nowIso();
  await runBatch(db, [
    sql`UPDATE class_posts SET deleted_at = ${now}, updated_at = ${now} WHERE id = ${id}`,
    sql`UPDATE files SET deleted_at = ${now} WHERE owner_type = 'class_post' AND owner_id = ${id} AND deleted_at IS NULL`,
    auditInsert(db, meta, { action: 'class_post.delete', entityType: 'class', entityId: p.class_id, after: { postId: id } }),
  ]);
}

// ───────────── Bài tập ─────────────

export async function createHomework(
  db: DB,
  env: Bindings,
  meta: AuditMeta,
  user: AuthUser,
  classId: number,
  input: { title: string; description: string | null; dueDate: string },
  attachments: File[],
) {
  const c = await assertClassWrite(db, user, classId);
  const today = vnDate();
  if (input.dueDate < today) throw Errors.validation([{ path: 'dueDate', message: 'Hạn nộp phải từ hôm nay trở đi' }]);
  const stored = await storeUploads(env, `classes/${classId}/homework`, attachments, { max: 5, allowPdf: true });
  try {
    const stmts: BatchStatement[] = [
      sql`INSERT INTO homework (class_id, title, description, assigned_date, due_date, created_by)
          VALUES (${classId}, ${input.title}, ${input.description}, ${today}, ${input.dueDate}, ${user.id})`,
      ...fileRowsSql(stored, { category: 'ATTACHMENT', ownerType: 'homework', ownerId: seq('homework'), visibility: 'CLASS', uploadedBy: user.id }),
      auditInsert(db, meta, { action: 'homework.create', entityType: 'class', entityId: classId, after: { title: input.title, dueDate: input.dueDate } }),
    ];
    if (await notificationsOn(db))
      stmts.push(
        notifyClassGuardians(
          classId,
          `Bài tập mới lớp ${c.name}`,
          `${input.title} — hạn nộp ${input.dueDate.split('-').reverse().join('/')}`,
          { kind: 'HOMEWORK', classId },
          sql`'homework:' || ${seq('homework')}`,
        ),
      );
    stmts.push(sql`SELECT ${seq('homework')} AS id`);
    const res = await runBatch(db, stmts);
    return { id: rowsOf<{ id: number }>(res[res.length - 1])[0]!.id };
  } catch (e) {
    await discardUploads(env, stored);
    throw e;
  }
}

/** Students the homework applies to: enrolled in the class on the day it was assigned. */
const rosterSql = (h: { class_id: number; assigned_date: string }) => sql`
  SELECT s.id, s.full_name, s.student_code FROM class_enrollments ce JOIN students s ON s.id = ce.student_id
   WHERE ce.class_id = ${h.class_id} AND ce.start_date <= ${h.assigned_date} AND coalesce(ce.end_date, '9999-12-31') >= ${h.assigned_date}
     AND s.deleted_at IS NULL`;

interface HomeworkRow {
  id: number;
  class_id: number;
  class_name: string;
  title: string;
  description: string | null;
  assigned_date: string;
  due_date: string;
  created_by: number;
  author: string;
}

async function loadHomework(db: DB, user: AuthUser, id: number) {
  const [h] = await db.all<HomeworkRow>(sql`
    SELECT h.id, h.class_id, c.name AS class_name, h.title, h.description, h.assigned_date, h.due_date, h.created_by, u.full_name AS author
      FROM homework h JOIN classes c ON c.id = h.class_id JOIN users u ON u.id = h.created_by
     WHERE h.id = ${id} AND h.deleted_at IS NULL AND ${classContentVisibleSql(user, sql`h.class_id`, sql`h.assigned_date`)}`);
  if (!h) throw Errors.notFound('Bài tập');
  return h;
}

export async function listClassHomework(db: DB, user: AuthUser, classId: number) {
  await loadClass(db, classId);
  const rows = await db.all<HomeworkRow & { roster: number; submitted: number; done: number }>(sql`
    SELECT h.id, h.class_id, c.name AS class_name, h.title, h.description, h.assigned_date, h.due_date, h.created_by, u.full_name AS author,
           (SELECT count(*) FROM class_enrollments ce WHERE ce.class_id = h.class_id AND ce.start_date <= h.assigned_date
              AND coalesce(ce.end_date, '9999-12-31') >= h.assigned_date) AS roster,
           (SELECT count(*) FROM homework_submissions hs WHERE hs.homework_id = h.id AND hs.submitted_at IS NOT NULL) AS submitted,
           (SELECT count(*) FROM homework_submissions hs WHERE hs.homework_id = h.id AND hs.result = 'DONE') AS done
      FROM homework h JOIN classes c ON c.id = h.class_id JOIN users u ON u.id = h.created_by
     WHERE h.class_id = ${classId} AND h.deleted_at IS NULL AND ${classContentVisibleSql(user, sql`h.class_id`, sql`h.assigned_date`)}
     ORDER BY h.due_date DESC, h.id DESC LIMIT 100`);
  return rows.map((h) => ({
    id: h.id,
    title: h.title,
    assignedDate: h.assigned_date,
    dueDate: h.due_date,
    author: h.author,
    roster: h.roster,
    submitted: h.submitted,
    done: h.done,
  }));
}

export async function getHomework(db: DB, user: AuthUser, id: number) {
  const h = await loadHomework(db, user, id);
  const family = user.role === 'GUARDIAN' || user.role === 'STUDENT';
  const roster = await db.all<{ id: number; full_name: string; student_code: string }>(rosterSql(h));
  const own = family
    ? new Set(
        (
          await db.all<{ id: number }>(
            sql`SELECT student_id AS id FROM student_guardians WHERE guardian_id = ${user.guardianId ?? -1}
                UNION SELECT ${user.studentId ?? -1}`,
          )
        ).map((r) => r.id),
      )
    : null;
  const students = own ? roster.filter((s) => own.has(s.id)) : roster;
  const subs = await db.all<{
    id: number;
    student_id: number;
    note: string | null;
    submitted_at: string | null;
    submitted_by_name: string | null;
    result: 'DONE' | 'NOT_DONE' | null;
    teacher_comment: string | null;
    reviewed_at: string | null;
  }>(sql`
    SELECT hs.id, hs.student_id, hs.note, hs.submitted_at, su.full_name AS submitted_by_name, hs.result, hs.teacher_comment, hs.reviewed_at
      FROM homework_submissions hs LEFT JOIN users su ON su.id = hs.submitted_by WHERE hs.homework_id = ${id}`);
  const subPhotos = await filesOf(db, 'homework_submission', subs.map((s) => s.id));
  const byStudent = new Map(subs.map((s) => [s.student_id, s]));
  const attachments = (await filesOf(db, 'homework', [id])).get(id) ?? [];
  return {
    id: h.id,
    classId: h.class_id,
    className: h.class_name,
    title: h.title,
    description: h.description,
    assignedDate: h.assigned_date,
    dueDate: h.due_date,
    author: h.author,
    attachments,
    canManage: !family,
    canDelete: hasFullScope(user) || h.created_by === user.id,
    students: students.map((s) => {
      const sub = byStudent.get(s.id);
      return {
        studentId: s.id,
        fullName: s.full_name,
        studentCode: s.student_code,
        submittedAt: sub?.submitted_at ?? null,
        submittedBy: sub?.submitted_by_name ?? null,
        note: sub?.note ?? null,
        photos: sub ? (subPhotos.get(sub.id) ?? []) : [],
        result: sub?.result ?? null,
        teacherComment: sub?.teacher_comment ?? null,
        reviewedAt: sub?.reviewed_at ?? null,
      };
    }),
  };
}

async function assertInRoster(db: DB, h: { class_id: number; assigned_date: string }, studentId: number) {
  const roster = await db.all<{ id: number }>(rosterSql(h));
  if (!roster.some((r) => r.id === studentId)) throw Errors.business('NOT_IN_CLASS', 'Học sinh không thuộc lớp được giao bài này');
}

/** Guardian (or student) submits photos of the finished work. Resubmitting replaces the photos until the teacher has reviewed. */
export async function submitHomework(
  db: DB,
  env: Bindings,
  meta: AuditMeta,
  user: AuthUser,
  homeworkId: number,
  input: { studentId: number; note: string | null },
  photos: File[],
) {
  if (user.role !== 'GUARDIAN' && user.role !== 'STUDENT') throw Errors.forbidden('Phụ huynh hoặc học sinh nộp bài qua ứng dụng');
  await assertStudentAccess(db, user, input.studentId);
  const h = await loadHomework(db, user, homeworkId);
  await assertInRoster(db, h, input.studentId);
  if (!photos.length) throw Errors.validation([{ path: 'files', message: 'Chụp ít nhất một ảnh bài làm' }]);
  const [existing] = await db.all<{ id: number; result: string | null }>(
    sql`SELECT id, result FROM homework_submissions WHERE homework_id = ${homeworkId} AND student_id = ${input.studentId}`,
  );
  if (existing?.result) throw Errors.business('ALREADY_REVIEWED', 'Giáo viên đã chấm bài này, không nộp lại được');
  const stored = await storeUploads(env, `homework/${homeworkId}/${input.studentId}`, photos, { max: 10 });
  try {
    const now = nowIso();
    const subId = sql`(SELECT id FROM homework_submissions WHERE homework_id = ${homeworkId} AND student_id = ${input.studentId})`;
    await runBatch(db, [
      sql`INSERT INTO homework_submissions (homework_id, student_id, note, submitted_by, submitted_at)
          VALUES (${homeworkId}, ${input.studentId}, ${input.note}, ${user.id}, ${now})
          ON CONFLICT (homework_id, student_id) DO UPDATE SET note = excluded.note, submitted_by = excluded.submitted_by,
                      submitted_at = excluded.submitted_at, updated_at = ${now}`,
      sql`UPDATE files SET deleted_at = ${now} WHERE owner_type = 'homework_submission' AND owner_id = ${subId} AND deleted_at IS NULL`,
      ...fileRowsSql(stored, { category: 'ATTACHMENT', ownerType: 'homework_submission', ownerId: subId, visibility: 'OWNER_LINKED', uploadedBy: user.id }),
      auditInsert(db, meta, { action: 'homework.submit', entityType: 'student', entityId: input.studentId, after: { homeworkId, photos: stored.length } }),
    ]);
    return { ok: true, late: now.slice(0, 10) > h.due_date };
  } catch (e) {
    await discardUploads(env, stored);
    throw e;
  }
}

/** Teacher marks Done / Not done (with or without an online submission) and comments; guardians are notified. */
export async function reviewHomework(db: DB, meta: AuditMeta, user: AuthUser, homeworkId: number, input: HomeworkReviewInput) {
  const h = await loadHomework(db, user, homeworkId);
  await assertClassWrite(db, user, h.class_id);
  await assertInRoster(db, h, input.studentId);
  const now = nowIso();
  const stmts: BatchStatement[] = [
    sql`INSERT INTO homework_submissions (homework_id, student_id, result, teacher_comment, reviewed_by, reviewed_at)
        VALUES (${homeworkId}, ${input.studentId}, ${input.result}, ${input.comment}, ${user.id}, ${now})
        ON CONFLICT (homework_id, student_id) DO UPDATE SET result = excluded.result, teacher_comment = excluded.teacher_comment,
                    reviewed_by = excluded.reviewed_by, reviewed_at = excluded.reviewed_at, updated_at = ${now}`,
    auditInsert(db, meta, { action: 'homework.review', entityType: 'student', entityId: input.studentId, after: { homeworkId, result: input.result } }),
  ];
  if (await notificationsOn(db))
    stmts.push(sql`INSERT OR IGNORE INTO notifications (user_id, type, title, body, data, student_id, dedupe_key, push_status)
                   SELECT g.user_id, 'SYSTEM', ${`Bài tập: ${h.title}`},
                          (SELECT full_name FROM students WHERE id = ${input.studentId}) || ${input.result === 'DONE' ? ': Đã làm' : ': Chưa làm'}
                            || ${input.comment ? ` — ${input.comment}` : ''},
                          ${JSON.stringify({ kind: 'HOMEWORK_REVIEW', homeworkId, studentId: input.studentId })}, ${input.studentId},
                          ${`homework-review:${homeworkId}:${input.studentId}:${now}`}, 'PENDING'
                     FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
                    WHERE sg.student_id = ${input.studentId} AND sg.receive_notifications = 1 AND g.user_id IS NOT NULL`);
  await runBatch(db, stmts);
  return { ok: true };
}

export async function deleteHomework(db: DB, meta: AuditMeta, user: AuthUser, id: number) {
  const h = await loadHomework(db, user, id);
  if (!hasFullScope(user) && h.created_by !== user.id) throw Errors.forbidden('Chỉ người giao bài hoặc quản lý được xóa');
  const now = nowIso();
  await runBatch(db, [
    sql`UPDATE homework SET deleted_at = ${now}, updated_at = ${now} WHERE id = ${id}`,
    sql`UPDATE files SET deleted_at = ${now} WHERE owner_type = 'homework' AND owner_id = ${id} AND deleted_at IS NULL`,
    auditInsert(db, meta, { action: 'homework.delete', entityType: 'class', entityId: h.class_id, after: { homeworkId: id } }),
  ]);
}

/** Homework list for one child (guardian app). */
export async function studentHomework(db: DB, user: AuthUser, studentId: number) {
  await assertStudentAccess(db, user, studentId);
  const rows = await db.all<{
    id: number;
    class_name: string;
    title: string;
    assigned_date: string;
    due_date: string;
    submitted_at: string | null;
    result: 'DONE' | 'NOT_DONE' | null;
    teacher_comment: string | null;
  }>(sql`
    SELECT h.id, c.name AS class_name, h.title, h.assigned_date, h.due_date, hs.submitted_at, hs.result, hs.teacher_comment
      FROM homework h JOIN classes c ON c.id = h.class_id
      LEFT JOIN homework_submissions hs ON hs.homework_id = h.id AND hs.student_id = ${studentId}
     WHERE h.deleted_at IS NULL
       AND EXISTS (SELECT 1 FROM class_enrollments ce WHERE ce.class_id = h.class_id AND ce.student_id = ${studentId}
                     AND ce.start_date <= h.assigned_date AND coalesce(ce.end_date, '9999-12-31') >= h.assigned_date)
     ORDER BY h.due_date DESC, h.id DESC LIMIT 100`);
  return rows.map((r) => ({
    id: r.id,
    className: r.class_name,
    title: r.title,
    assignedDate: r.assigned_date,
    dueDate: r.due_date,
    submittedAt: r.submitted_at,
    result: r.result,
    teacherComment: r.teacher_comment,
  }));
}

/** Active students whose family declined photos — shown to the teacher before posting. */
export async function noPhotoStudents(db: DB, user: AuthUser, classId: number) {
  await assertClassWrite(db, user, classId);
  return db.all<{ id: number; fullName: string }>(sql`
    SELECT s.id, s.full_name AS fullName FROM class_enrollments ce JOIN students s ON s.id = ce.student_id
     WHERE ce.class_id = ${classId} AND ce.status = 'ACTIVE' AND s.photo_consent = 0 AND s.deleted_at IS NULL
     ORDER BY s.full_name`);
}
