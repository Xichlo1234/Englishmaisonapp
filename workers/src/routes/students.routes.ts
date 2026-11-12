import { Hono } from 'hono';
import { z } from 'zod';
import {
  duplicateCheckQuery,
  guardianInputSchema,
  guardianLinkSchema,
  idParam,
  RELATIONSHIPS,
  studentArchiveSchema,
  studentCreateSchema,
  studentDropSchema,
  studentListQuery,
  studentPauseSchema,
  studentReactivateSchema,
  studentRestoreSchema,
  studentUpdateSchema,
} from '@ecm/shared';
import type { AppEnv } from '../env';
import { getDb } from '../db/client';
import { Errors } from '../lib/errors';
import { requireAuth, requireAnyPermission, requirePermission } from '../middleware/auth';
import { auditMetaFrom } from '../services/audit.service';
import { uploadStudentPhoto } from '../services/files.service';
import * as svc from '../services/students.service';
import { createGuardianAccount } from '../services/users.service';
import { parseJson, parseParams, parseQuery, parseWith } from '../validators/validate';

export const studentRoutes = new Hono<AppEnv>();
studentRoutes.use('*', requireAuth);

const canRead = requireAnyPermission('students.read', 'self.read');
const canWrite = requirePermission('students.write');

/** Ghi dữ liệu học sinh chỉ dành cho phạm vi toàn hệ thống (quản trị/chủ lớp). */
const fullScopeOnly = requirePermission('students.write');

studentRoutes.get('/', requirePermission('students.read'), async (c) => {
  const q = parseQuery(c, studentListQuery);
  return c.json(await svc.listStudents(getDb(c.env.DB), c.get('user'), q));
});

studentRoutes.get('/export', requirePermission('students.read'), async (c) => {
  const q = parseQuery(c, studentListQuery);
  return c.json({ data: await svc.exportStudents(getDb(c.env.DB), c.get('user'), q) });
});

studentRoutes.get('/check-duplicates', canWrite, async (c) => {
  const q = parseQuery(c, duplicateCheckQuery);
  return c.json({ data: await svc.findDuplicates(getDb(c.env.DB), q) });
});

studentRoutes.post('/', canWrite, async (c) => {
  const input = await parseJson(c, studentCreateSchema);
  const res = await svc.createStudent(getDb(c.env.DB), auditMetaFrom(c), c.get('user'), input);
  return c.json(res, 201);
});

studentRoutes.get('/:id', canRead, async (c) => {
  const { id } = parseParams(c, idParam);
  return c.json(await svc.getStudentDetail(getDb(c.env.DB), c.get('user'), id));
});

studentRoutes.patch('/:id', canWrite, async (c) => {
  const { id } = parseParams(c, idParam);
  const input = await parseJson(c, studentUpdateSchema);
  return c.json(await svc.updateStudent(getDb(c.env.DB), auditMetaFrom(c), id, input));
});

const statusSchemas = {
  pause: studentPauseSchema,
  drop: studentDropSchema,
  reactivate: studentReactivateSchema,
  archive: studentArchiveSchema,
  restore: studentRestoreSchema,
} as const;

for (const action of Object.keys(statusSchemas) as (keyof typeof statusSchemas)[]) {
  studentRoutes.post(`/:id/${action}`, canWrite, async (c) => {
    const { id } = parseParams(c, idParam);
    const input = (await parseJson(c, statusSchemas[action])) as Parameters<typeof svc.changeStudentStatus>[4];
    return c.json(await svc.changeStudentStatus(getDb(c.env.DB), auditMetaFrom(c), id, action, input));
  });
}

studentRoutes.delete('/:id', requirePermission('students.delete'), async (c) => {
  const { id } = parseParams(c, idParam);
  await svc.hardDeleteStudent(getDb(c.env.DB), auditMetaFrom(c), id);
  return c.json({ ok: true });
});

studentRoutes.get('/:id/timeline', fullScopeOnly, async (c) => {
  const { id } = parseParams(c, idParam);
  return c.json({ data: await svc.studentTimeline(getDb(c.env.DB), id) });
});

studentRoutes.post('/:id/photo', canWrite, async (c) => {
  const { id } = parseParams(c, idParam);
  const form = await c.req.formData().catch(() => null);
  const file = form?.get('file');
  if (!file || typeof file === 'string') throw Errors.validation([{ path: 'file', message: 'Chọn ảnh để tải lên' }]);
  const db = getDb(c.env.DB);
  return c.json(await uploadStudentPhoto(db, c.env, auditMetaFrom(c), c.get('user'), id, file as File), 201);
});

// ───── Phụ huynh của học sinh ─────

studentRoutes.post('/:id/guardians', canWrite, async (c) => {
  const { id } = parseParams(c, idParam);
  const input = await parseJson(c, guardianLinkSchema);
  await svc.linkGuardian(getDb(c.env.DB), auditMetaFrom(c), id, input);
  return c.json({ ok: true }, 201);
});

const linkUpdateSchema = z.object({
  relationship: z.enum(RELATIONSHIPS).optional(),
  isPrimary: z.boolean().optional(),
  receiveNotifications: z.boolean().optional(),
  guardian: guardianInputSchema.optional(),
});

const guardianParams = z.object({ id: z.coerce.number().int().positive(), guardianId: z.coerce.number().int().positive() });

studentRoutes.patch('/:id/guardians/:guardianId', canWrite, async (c) => {
  const { id, guardianId } = parseParams(c, guardianParams);
  const input = await parseJson(c, linkUpdateSchema);
  await svc.updateGuardianLink(getDb(c.env.DB), auditMetaFrom(c), id, guardianId, input);
  return c.json({ ok: true });
});

studentRoutes.delete('/:id/guardians/:guardianId', canWrite, async (c) => {
  const { id, guardianId } = parseParams(c, guardianParams);
  await svc.unlinkGuardian(getDb(c.env.DB), auditMetaFrom(c), id, guardianId);
  return c.json({ ok: true });
});

export const guardianRoutes = new Hono<AppEnv>();
guardianRoutes.use('*', requireAuth, requirePermission('students.write'));
guardianRoutes.get('/', async (c) => {
  const { phone } = parseWith(z.object({ phone: z.string().trim().min(3).max(20) }), c.req.query());
  return c.json({ data: await svc.findGuardiansByPhone(getDb(c.env.DB), phone) });
});
guardianRoutes.post('/:id/account', async (c) => {
  const { id } = parseParams(c, idParam);
  return c.json(await createGuardianAccount(getDb(c.env.DB), c.env, auditMetaFrom(c), id), 201);
});
