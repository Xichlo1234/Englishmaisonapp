import { Hono } from 'hono';
import {
  attendanceMatrixQuery,
  attendanceRangeQuery,
  attendanceSaveSchema,
  attendanceSubmitSchema,
  attendanceUnlockSchema,
  idParam,
  myLessonsQuery,
  vnDate,
} from '@ecm/shared';
import type { AppEnv } from '../env';
import { getDb } from '../db/client';
import { requireAnyPermission, requireAuth, requirePermission } from '../middleware/auth';
import { auditMetaFrom } from '../services/audit.service';
import * as att from '../services/attendance.service';
import { parseJson, parseParams, parseQuery } from '../validators/validate';

/** /api/v1/attendance/... */
export const attendanceRoutes = new Hono<AppEnv>();
attendanceRoutes.use('*', requireAuth);
attendanceRoutes.get('/lessons', requirePermission('attendance.read'), async (c) => {
  const { date } = parseQuery(c, myLessonsQuery);
  return c.json({ data: await att.lessonsOfDay(getDb(c.env.DB), c.get('user'), date ?? vnDate()) });
});
attendanceRoutes.get('/classes/:id/matrix', requirePermission('attendance.read'), async (c) => {
  const { id } = parseParams(c, idParam);
  const { month } = parseQuery(c, attendanceMatrixQuery);
  return c.json(await att.classAttendanceMatrix(getDb(c.env.DB), c.get('user'), id, month));
});
attendanceRoutes.get('/students/:id', requireAnyPermission('attendance.read', 'self.read'), async (c) => {
  const { id } = parseParams(c, idParam);
  const q = parseQuery(c, attendanceRangeQuery);
  return c.json(await att.studentAttendance(getDb(c.env.DB), c.get('user'), id, q.from, q.to));
});

/** /api/v1/lessons/:id/attendance... */
export const lessonAttendanceRoutes = new Hono<AppEnv>();
lessonAttendanceRoutes.use('/:id/attendance', requireAuth);
lessonAttendanceRoutes.use('/:id/attendance/*', requireAuth);
lessonAttendanceRoutes.get('/:id/attendance', requirePermission('attendance.read'), async (c) => {
  const { id } = parseParams(c, idParam);
  return c.json(await att.getAttendanceSheet(getDb(c.env.DB), c.get('user'), id));
});
lessonAttendanceRoutes.put('/:id/attendance', requirePermission('attendance.write'), async (c) => {
  const { id } = parseParams(c, idParam);
  return c.json(await att.saveAttendance(getDb(c.env.DB), auditMetaFrom(c), c.get('user'), id, await parseJson(c, attendanceSaveSchema)));
});
lessonAttendanceRoutes.post('/:id/attendance/submit', requirePermission('attendance.write'), async (c) => {
  const { id } = parseParams(c, idParam);
  const { version } = await parseJson(c, attendanceSubmitSchema);
  return c.json(await att.submitAttendance(getDb(c.env.DB), auditMetaFrom(c), c.get('user'), id, version));
});
lessonAttendanceRoutes.post('/:id/attendance/unlock', requirePermission('attendance.unlock'), async (c) => {
  const { id } = parseParams(c, idParam);
  const { reason } = await parseJson(c, attendanceUnlockSchema);
  await att.unlockAttendance(getDb(c.env.DB), auditMetaFrom(c), c.get('user'), id, reason);
  return c.json({ ok: true });
});
lessonAttendanceRoutes.get('/:id/attendance/history', requirePermission('attendance.read'), async (c) => {
  const { id } = parseParams(c, idParam);
  return c.json({ data: await att.attendanceHistory(getDb(c.env.DB), c.get('user'), id) });
});
