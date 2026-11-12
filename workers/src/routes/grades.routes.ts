import { Hono } from 'hono';
import {
  assessmentCreateSchema,
  assessmentListQuery,
  assessmentTypeUpdateSchema,
  criterionSaveSchema,
  gradeBandsSchema,
  gradesSaveSchema,
  idParam,
} from '@ecm/shared';
import type { AppEnv } from '../env';
import { getDb } from '../db/client';
import { requireAnyPermission, requireAuth, requirePermission } from '../middleware/auth';
import { auditMetaFrom } from '../services/audit.service';
import * as gr from '../services/grades.service';
import { parseJson, parseParams, parseQuery } from '../validators/validate';

export const gradingRoutes = new Hono<AppEnv>();
gradingRoutes.use('*', requireAuth);
gradingRoutes.get('/config', requireAnyPermission('grades.read', 'self.read'), async (c) => c.json(await gr.getGradingConfig(getDb(c.env.DB))));
gradingRoutes.put('/criteria', requirePermission('grading.config'), async (c) => {
  await gr.saveCriteria(getDb(c.env.DB), auditMetaFrom(c), await parseJson(c, criterionSaveSchema));
  return c.json({ ok: true });
});
gradingRoutes.put('/bands', requirePermission('grading.config'), async (c) => {
  const { bands } = await parseJson(c, gradeBandsSchema);
  await gr.saveBands(getDb(c.env.DB), auditMetaFrom(c), bands);
  return c.json({ ok: true });
});
gradingRoutes.patch('/types/:id', requirePermission('grading.config'), async (c) => {
  const { id } = parseParams(c, idParam);
  await gr.updateAssessmentType(getDb(c.env.DB), auditMetaFrom(c), id, await parseJson(c, assessmentTypeUpdateSchema));
  return c.json({ ok: true });
});

export const assessmentRoutes = new Hono<AppEnv>();
assessmentRoutes.use('*', requireAuth);
assessmentRoutes.get('/', requirePermission('grades.read'), async (c) =>
  c.json({ data: await gr.listAssessments(getDb(c.env.DB), c.get('user'), parseQuery(c, assessmentListQuery)) }),
);
assessmentRoutes.post('/', requirePermission('grades.write'), async (c) =>
  c.json(await gr.createAssessment(getDb(c.env.DB), auditMetaFrom(c), c.get('user'), await parseJson(c, assessmentCreateSchema)), 201),
);
assessmentRoutes.get('/:id', requirePermission('grades.read'), async (c) => {
  const { id } = parseParams(c, idParam);
  return c.json(await gr.getAssessmentSheet(getDb(c.env.DB), c.get('user'), id));
});
assessmentRoutes.put('/:id/grades', requirePermission('grades.write'), async (c) => {
  const { id } = parseParams(c, idParam);
  return c.json(await gr.saveGrades(getDb(c.env.DB), auditMetaFrom(c), c.get('user'), id, await parseJson(c, gradesSaveSchema)));
});
assessmentRoutes.post('/:id/publish', requirePermission('grades.write'), async (c) => {
  const { id } = parseParams(c, idParam);
  return c.json(await gr.publishAssessment(getDb(c.env.DB), auditMetaFrom(c), c.get('user'), id));
});
assessmentRoutes.delete('/:id', requirePermission('grades.write'), async (c) => {
  const { id } = parseParams(c, idParam);
  await gr.deleteAssessment(getDb(c.env.DB), auditMetaFrom(c), c.get('user'), id);
  return c.json({ ok: true });
});
assessmentRoutes.get('/:id/history', requirePermission('grades.read'), async (c) => {
  const { id } = parseParams(c, idParam);
  return c.json({ data: await gr.assessmentHistory(getDb(c.env.DB), c.get('user'), id) });
});

export const studentResultRoutes = new Hono<AppEnv>();
studentResultRoutes.get('/:id/results', requireAuth, requireAnyPermission('grades.read', 'self.read'), async (c) => {
  const { id } = parseParams(c, idParam);
  return c.json({ data: await gr.studentResults(getDb(c.env.DB), c.get('user'), id) });
});
