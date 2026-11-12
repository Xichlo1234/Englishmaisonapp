import { Hono, type Context } from 'hono';
import { classPostCreateSchema, feedQuery, homeworkCreateSchema, homeworkReviewSchema, homeworkSubmitSchema, idParam } from '@ecm/shared';
import type { AppEnv } from '../env';
import { getDb } from '../db/client';
import { Errors } from '../lib/errors';
import { requireAuth } from '../middleware/auth';
import { auditMetaFrom } from '../services/audit.service';
import * as cr from '../services/classroom.service';
import { uploadMyAvatar } from '../services/files.service';
import { parseJson, parseParams, parseQuery, parseWith } from '../validators/validate';

/** Multipart body: text fields + every File under `files`. */
async function multipart(c: Context<AppEnv>) {
  const form = await c.req.formData().catch(() => null);
  if (!form) throw Errors.validation([{ path: 'body', message: 'Cần gửi dạng multipart/form-data' }]);
  const fields: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === 'string') fields[k] = v;
  const files = form.getAll('files').filter((f): f is File => typeof f !== 'string');
  return { fields, files };
}

// Mounted at /classes, /class-posts, /homework, /students, /me — every route requires login.
export const classFeedRoutes = new Hono<AppEnv>();
classFeedRoutes.use('*', requireAuth);
classFeedRoutes.get('/:id/posts', async (c) => {
  const { id } = parseParams(c, idParam);
  return c.json({ data: await cr.listClassPosts(getDb(c.env.DB), c.get('user'), id, parseQuery(c, feedQuery)) });
});
classFeedRoutes.post('/:id/posts', async (c) => {
  const { id } = parseParams(c, idParam);
  const { fields, files } = await multipart(c);
  const input = parseWith(classPostCreateSchema, { content: fields.content, postDate: fields.postDate || undefined });
  return c.json(await cr.createClassPost(getDb(c.env.DB), c.env, auditMetaFrom(c), c.get('user'), id, input, files), 201);
});
classFeedRoutes.get('/:id/no-photo-students', async (c) => {
  const { id } = parseParams(c, idParam);
  return c.json({ data: await cr.noPhotoStudents(getDb(c.env.DB), c.get('user'), id) });
});
classFeedRoutes.get('/:id/homework', async (c) => {
  const { id } = parseParams(c, idParam);
  return c.json({ data: await cr.listClassHomework(getDb(c.env.DB), c.get('user'), id) });
});
classFeedRoutes.post('/:id/homework', async (c) => {
  const { id } = parseParams(c, idParam);
  const { fields, files } = await multipart(c);
  const input = parseWith(homeworkCreateSchema, { title: fields.title, description: fields.description, dueDate: fields.dueDate });
  return c.json(await cr.createHomework(getDb(c.env.DB), c.env, auditMetaFrom(c), c.get('user'), id, input, files), 201);
});

export const classPostRoutes = new Hono<AppEnv>();
classPostRoutes.use('*', requireAuth);
classPostRoutes.delete('/:id', async (c) => {
  const { id } = parseParams(c, idParam);
  await cr.deleteClassPost(getDb(c.env.DB), auditMetaFrom(c), c.get('user'), id);
  return c.json({ ok: true });
});

export const homeworkRoutes = new Hono<AppEnv>();
homeworkRoutes.use('*', requireAuth);
homeworkRoutes.get('/:id', async (c) => {
  const { id } = parseParams(c, idParam);
  return c.json(await cr.getHomework(getDb(c.env.DB), c.get('user'), id));
});
homeworkRoutes.delete('/:id', async (c) => {
  const { id } = parseParams(c, idParam);
  await cr.deleteHomework(getDb(c.env.DB), auditMetaFrom(c), c.get('user'), id);
  return c.json({ ok: true });
});
homeworkRoutes.post('/:id/submissions', async (c) => {
  const { id } = parseParams(c, idParam);
  const { fields, files } = await multipart(c);
  const input = parseWith(homeworkSubmitSchema, { studentId: fields.studentId, note: fields.note });
  return c.json(await cr.submitHomework(getDb(c.env.DB), c.env, auditMetaFrom(c), c.get('user'), id, input, files), 201);
});
homeworkRoutes.post('/:id/review', async (c) => {
  const { id } = parseParams(c, idParam);
  return c.json(await cr.reviewHomework(getDb(c.env.DB), auditMetaFrom(c), c.get('user'), id, await parseJson(c, homeworkReviewSchema)));
});

export const studentClassroomRoutes = new Hono<AppEnv>();
studentClassroomRoutes.use('*', requireAuth);
studentClassroomRoutes.get('/:id/class-posts', async (c) => {
  const { id } = parseParams(c, idParam);
  return c.json({ data: await cr.studentClassPosts(getDb(c.env.DB), c.get('user'), id, parseQuery(c, feedQuery)) });
});
studentClassroomRoutes.get('/:id/homework', async (c) => {
  const { id } = parseParams(c, idParam);
  return c.json({ data: await cr.studentHomework(getDb(c.env.DB), c.get('user'), id) });
});

export const avatarRoutes = new Hono<AppEnv>();
avatarRoutes.use('*', requireAuth);
avatarRoutes.post('/avatar', async (c) => {
  const { files } = await multipart(c);
  if (files.length !== 1) throw Errors.validation([{ path: 'files', message: 'Chọn một ảnh' }]);
  return c.json(await uploadMyAvatar(getDb(c.env.DB), c.env, auditMetaFrom(c), c.get('user'), files[0]!), 201);
});
