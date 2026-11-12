import { and, eq, isNull, sql } from 'drizzle-orm';
import type { AuthUser, Bindings } from '../env';
import type { DB } from '../db/client';
import { files, students } from '../db/schema';
import { Errors } from '../lib/errors';
import { nowIso } from '../lib/time';
import { runBatch, rowsOf } from '../lib/batch';
import { auditInsert, type AuditMeta } from './audit.service';
import { assertStudentAccess, hasFullScope } from './scope';

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
  throw Errors.notFound('Tệp');
}
