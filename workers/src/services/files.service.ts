import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { AuthUser, Bindings } from '../env';
import type { DB } from '../db/client';
import { files, students } from '../db/schema';
import { Errors } from '../lib/errors';
import { nowIso } from '../lib/time';
import { runBatch, rowsOf } from '../lib/batch';
import { auditInsert, type AuditMeta } from './audit.service';
import { assertStudentAccess, classContentVisibleSql, hasFullScope, studentScopeSql, teacherClassIdsSql } from './scope';

const IMAGE_TYPES: { mime: string; ext: string; magic: (b: Uint8Array) => boolean }[] = [
  { mime: 'image/jpeg', ext: 'jpg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', ext: 'png', magic: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  {
    mime: 'image/webp',
    ext: 'webp',
    magic: (b) =>
      b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  },
];

/** Xác định loại ảnh bằng magic bytes (không tin Content-Type do client gửi). */
export function detectImage(bytes: Uint8Array) {
  return IMAGE_TYPES.find((t) => t.magic(bytes)) ?? null;
}

export async function uploadStudentPhoto(
  db: DB,
  env: Bindings,
  meta: AuditMeta,
  user: AuthUser,
  studentId: number,
  file: File,
) {
  const [s] = await db
    .select({ id: students.id, photoFileId: students.photoFileId })
    .from(students)
    .where(and(eq(students.id, studentId), isNull(students.deletedAt)));
  if (!s) throw Errors.notFound('Học sinh');

  const maxBytes = (Number(env.MAX_UPLOAD_MB) || 5) * 1024 * 1024;
  if (file.size === 0) throw Errors.validation([{ path: 'file', message: 'Tệp rỗng' }]);
  if (file.size > maxBytes)
    throw Errors.validation([{ path: 'file', message: `Ảnh tối đa ${env.MAX_UPLOAD_MB || 5}MB` }]);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = detectImage(bytes);
  if (!type) throw Errors.validation([{ path: 'file', message: 'Chỉ nhận ảnh JPEG, PNG hoặc WebP' }]);

  // Khóa R2 ngẫu nhiên, không chứa tên/SĐT học sinh.
  const key = `students/${studentId}/${crypto.randomUUID()}.${type.ext}`;
  await env.FILES.put(key, bytes, { httpMetadata: { contentType: type.mime } });

  try {
    const now = nowIso();
    const results = await runBatch(db, [
      db.insert(files).values({
        r2Key: key,
        originalName: file.name.slice(0, 200) || `photo.${type.ext}`,
        mimeType: type.mime,
        sizeBytes: bytes.byteLength,
        category: 'STUDENT_PHOTO',
        ownerType: 'student',
        ownerId: studentId,
        visibility: 'OWNER_LINKED',
        uploadedBy: user.id,
      }),
      sql`UPDATE files SET deleted_at = ${now} WHERE id = ${s.photoFileId ?? -1}`,
      sql`UPDATE students SET photo_file_id = (SELECT seq FROM sqlite_sequence WHERE name = 'files'), updated_at = ${now}
                  WHERE id = ${studentId}`,
      auditInsert(db, meta, { action: 'student.photo_upload', entityType: 'student', entityId: studentId, after: { key } }),
      sql`SELECT photo_file_id AS id FROM students WHERE id = ${studentId}`,
    ]);
    return { fileId: rowsOf<{ id: number }>(results[4])[0]!.id };
  } catch (e) {
    await env.FILES.delete(key);
    throw e;
  }
}

/** Kiểm tra quyền đọc tệp theo đối tượng sở hữu; trả về bản ghi tệp. */
export async function authorizeFileRead(db: DB, user: AuthUser, fileId: number) {
  const [f] = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), isNull(files.deletedAt)));
  if (!f) throw Errors.notFound('Tệp');
  if (hasFullScope(user)) return f;
  if (f.ownerType === 'student') {
    await assertStudentAccess(db, user, f.ownerId);
    return f;
  }
  if (f.ownerType === 'user' && f.ownerId === user.id) return f;
  let visible: SQL | null = null;
  if (f.ownerType === 'user' && f.category === 'AVATAR') {
    // Guardian avatars: visible to whoever may see one of that guardian's children (teachers recognise parents).
    const scope = studentScopeSql(user, sql`sg.student_id`) ?? sql`1`;
    visible = sql`EXISTS (SELECT 1 FROM guardians g JOIN student_guardians sg ON sg.guardian_id = g.id
                           WHERE g.user_id = ${f.ownerId} AND g.deleted_at IS NULL AND ${scope})`;
  } else if (f.ownerType === 'class_post') {
    visible = sql`EXISTS (SELECT 1 FROM class_posts p WHERE p.id = ${f.ownerId} AND p.deleted_at IS NULL
                           AND ${classContentVisibleSql(user, sql`p.class_id`, sql`p.post_date`)})`;
  } else if (f.ownerType === 'homework') {
    visible = sql`EXISTS (SELECT 1 FROM homework h WHERE h.id = ${f.ownerId} AND h.deleted_at IS NULL
                           AND ${classContentVisibleSql(user, sql`h.class_id`, sql`h.assigned_date`)})`;
  } else if (f.ownerType === 'homework_submission') {
    const cond =
      user.role === 'TEACHER'
        ? user.teacherId
          ? sql`h.class_id IN ${teacherClassIdsSql(user.teacherId)}`
          : sql`0`
        : (studentScopeSql(user, sql`hs.student_id`) ?? sql`1`);
    visible = sql`EXISTS (SELECT 1 FROM homework_submissions hs JOIN homework h ON h.id = hs.homework_id
                           WHERE hs.id = ${f.ownerId} AND ${cond})`;
  }
  if (visible) {
    const [ok] = await db.all<{ v: number }>(sql`SELECT ${visible} AS v`);
    if (ok?.v) return f;
  }
  throw Errors.notFound('Tệp');
}

export interface StoredUpload {
  key: string;
  mime: string;
  size: number;
  name: string;
}

const PDF = { mime: 'application/pdf', ext: 'pdf', magic: (b: Uint8Array) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 };

/**
 * Validates every file (size + magic bytes) before writing any of them, then puts them in R2.
 * Callers insert the `files` rows in their batch and must call `discardUploads` if that batch fails.
 */
export async function storeUploads(env: Bindings, prefix: string, list: File[], opts: { max: number; allowPdf?: boolean }) {
  if (list.length > opts.max) throw Errors.validation([{ path: 'files', message: `Tối đa ${opts.max} tệp mỗi lần` }]);
  const maxBytes = (Number(env.MAX_UPLOAD_MB) || 5) * 1024 * 1024;
  const checked = await Promise.all(
    list.map(async (file) => {
      if (file.size === 0) throw Errors.validation([{ path: 'files', message: 'Tệp rỗng' }]);
      if (file.size > maxBytes) throw Errors.validation([{ path: 'files', message: `Mỗi tệp tối đa ${env.MAX_UPLOAD_MB || 5}MB` }]);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const type = detectImage(bytes) ?? (opts.allowPdf && PDF.magic(bytes) ? PDF : null);
      if (!type)
        throw Errors.validation([{ path: 'files', message: opts.allowPdf ? 'Chỉ nhận ảnh JPEG, PNG, WebP hoặc PDF' : 'Chỉ nhận ảnh JPEG, PNG hoặc WebP' }]);
      return { file, bytes, type };
    }),
  );
  const stored: StoredUpload[] = [];
  for (const { file, bytes, type } of checked) {
    const key = `${prefix}/${crypto.randomUUID()}.${type.ext}`;
    await env.FILES.put(key, bytes, { httpMetadata: { contentType: type.mime } });
    stored.push({ key, mime: type.mime, size: bytes.byteLength, name: file.name.slice(0, 200) || `file.${type.ext}` });
  }
  return stored;
}

export async function discardUploads(env: Bindings, stored: StoredUpload[]) {
  if (stored.length) await env.FILES.delete(stored.map((s) => s.key));
}

/** INSERT statements for stored uploads; ownerId may be a SQL expression (e.g. the id just inserted in the same batch). */
export function fileRowsSql(stored: StoredUpload[], o: { category: string; ownerType: string; ownerId: number | SQL; visibility: string; uploadedBy: number }) {
  return stored.map(
    (s) => sql`INSERT INTO files (r2_key, original_name, mime_type, size_bytes, category, owner_type, owner_id, visibility, uploaded_by)
               VALUES (${s.key}, ${s.name}, ${s.mime}, ${s.size}, ${o.category}, ${o.ownerType}, ${o.ownerId}, ${o.visibility}, ${o.uploadedBy})`,
  );
}

export async function uploadMyAvatar(db: DB, env: Bindings, meta: AuditMeta, user: AuthUser, file: File) {
  const stored = await storeUploads(env, `users/${user.id}`, [file], { max: 1 });
  try {
    const now = nowIso();
    const res = await runBatch(db, [
      sql`UPDATE files SET deleted_at = ${now} WHERE id = (SELECT avatar_file_id FROM users WHERE id = ${user.id})`,
      ...fileRowsSql(stored, { category: 'AVATAR', ownerType: 'user', ownerId: user.id, visibility: 'OWNER_LINKED', uploadedBy: user.id }),
      sql`UPDATE users SET avatar_file_id = (SELECT seq FROM sqlite_sequence WHERE name = 'files'), updated_at = ${now} WHERE id = ${user.id}`,
      auditInsert(db, meta, { action: 'user.avatar_upload', entityType: 'user', entityId: user.id }),
      sql`SELECT avatar_file_id AS id FROM users WHERE id = ${user.id}`,
    ]);
    return { fileId: rowsOf<{ id: number }>(res[4])[0]!.id };
  } catch (e) {
    await discardUploads(env, stored);
    throw e;
  }
}
