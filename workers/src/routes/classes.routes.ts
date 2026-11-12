import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  addDays,
  calendarQuery,
  classCloseSchema,
  classCreateSchema,
  classListQuery,
  classOpenSchema,
  classUpdateSchema,
  enrollmentEndSchema,
  enrollSchema,
  idParam,
  isoDate,
  lessonCreateSchema,
  lessonUpdateSchema,
  roomSchema,
  scheduleAddSchema,
  scheduleEndSchema,
  scheduleInputSchema,
  shiftCreateSchema,
  shiftUpdateSchema,
  teacherCreateSchema,
  teacherUpdateSchema,
  transferSchema,
  vnDate,
} from '@ecm/shared';
import type { AppEnv } from '../env';
import { getDb } from '../db/client';
import { requireAnyPermission, requireAuth, requirePermission } from '../middleware/auth';
import { auditMetaFrom } from '../services/audit.service';
import * as cls from '../services/classes.service';
import * as sch from '../services/schedule.service';
import * as tch from '../services/teachers.service';
import { parseJson, parseParams, parseQuery, parseWith } from '../validators/validate';
import { Errors } from '../lib/errors';

const manage = requirePermission('classes.write');
const read = requirePermission('classes.read');

// ───────────── Ca học & phòng ─────────────
export const shiftRoutes = new Hono<AppEnv>();
shiftRoutes.use('*', requireAuth);
shiftRoutes.get('/', requireAnyPermission('classes.read', 'self.read'), async (c) => c.json({ data: await sch.listShifts(getDb(c.env.DB)) }));
shiftRoutes.post('/', manage, async (c) => {
  const input = await parseJson(c, shiftCreateSchema);
  return c.json(await sch.createShift(getDb(c.env.DB), auditMetaFrom(c), input), 201);
});
shiftRoutes.patch('/:id', manage, async (c) => {
  const { id } = parseParams(c, idParam);
  await sch.updateShift(getDb(c.env.DB), auditMetaFrom(c), id, await parseJson(c, shiftUpdateSchema));
  return c.json({ ok: true });
});

export const roomRoutes = new Hono<AppEnv>();
roomRoutes.use('*', requireAuth);
roomRoutes.get('/', read, async (c) => c.json({ data: await sch.listRooms(getDb(c.env.DB)) }));
roomRoutes.post('/', manage, async (c) => c.json(await sch.saveRoom(getDb(c.env.DB), auditMetaFrom(c), null, await parseJson(c, roomSchema)), 201));
roomRoutes.patch('/:id', manage, async (c) => {
  const { id } = parseParams(c, idParam);
  return c.json(await sch.saveRoom(getDb(c.env.DB), auditMetaFrom(c), id, await parseJson(c, roomSchema)));
});

// ───────────── Lịch tổng hợp ─────────────
export const calendarRoutes = new Hono<AppEnv>();
calendarRoutes.use('*', requireAuth, requireAnyPermission('classes.read', 'self.read'));
calendarRoutes.get('/', async (c) => {
  const q = parseQuery(c, calendarQuery);
  return c.json({ data: await sch.calendar(getDb(c.env.DB), c.get('user'), q) });
});

// ───────────── Lịch lặp ─────────────
export const scheduleRoutes = new Hono<AppEnv>();
scheduleRoutes.use('*', requireAuth, manage);
scheduleRoutes.post('/check-conflicts', async (c) => {
  const body = await parseJson(
    c,
    z.object({
      classId: z.number().int().positive().optional(),
      teacherId: z.number().int().positive(),
      effectiveFrom: isoDate,
      effectiveTo: isoDate.optional().nullable(),
      schedules: z.array(scheduleInputSchema).max(14),
    }),
  );
  const db = getDb(c.env.DB);
  const exclude = body.classId
    ? (await db.all<{ id: number }>(sql`SELECT id FROM schedules WHERE class_id = ${body.classId} AND deleted_at IS NULL`)).map((r) => r.id)
    : [];
  const conflicts: sch.Conflict[] = [];
  for (const s of body.schedules) {
    const shift = await sch.getShift(db, s.shiftId);
    conflicts.push(
      ...(await sch.findScheduleConflicts(db, {
        classId: body.classId ?? null,
        weekday: s.weekday,
        startTime: shift.startTime,
        endTime: shift.endTime,
        teacherId: s.teacherId ?? body.teacherId,
        roomId: s.roomId ?? null,
        effectiveFrom: body.effectiveFrom,
        effectiveTo: body.effectiveTo ?? null,
        excludeScheduleIds: exclude,
      })),
    );
  }
  return c.json({ conflicts });
});
scheduleRoutes.post('/:id/end', async (c) => {
  const { id } = parseParams(c, idParam);
  await cls.endSchedule(getDb(c.env.DB), auditMetaFrom(c), id, await parseJson(c, scheduleEndSchema));
  return c.json({ ok: true });
});

// ───────────── Lớp học ─────────────
export const classRoutes = new Hono<AppEnv>();
classRoutes.use('*', requireAuth);

classRoutes.get('/', read, async (c) => c.json({ data: await cls.listClasses(getDb(c.env.DB), c.get('user'), parseQuery(c, classListQuery)) }));
classRoutes.post('/', manage, async (c) => c.json(await cls.createClass(getDb(c.env.DB), auditMetaFrom(c), await parseJson(c, classCreateSchema)), 201));
classRoutes.get('/:id', read, async (c) => {
  const { id } = parseParams(c, idParam);
  return c.json(await cls.getClassDetail(getDb(c.env.DB), c.get('user'), id));
});
classRoutes.patch('/:id', manage, async (c) => {
  const { id } = parseParams(c, idParam);
  return c.json(await cls.updateClass(getDb(c.env.DB), auditMetaFrom(c), id, await parseJson(c, classUpdateSchema)));
});
classRoutes.post('/:id/open', manage, async (c) => {
  const { id } = parseParams(c, idParam);
  const { version } = await parseJson(c, classOpenSchema);
  return c.json(await cls.openClass(getDb(c.env.DB), auditMetaFrom(c), id, version));
});
classRoutes.post('/:id/close', manage, async (c) => {
  const { id } = parseParams(c, idParam);
  return c.json(await cls.closeClass(getDb(c.env.DB), auditMetaFrom(c), id, await parseJson(c, classCloseSchema)));
});
classRoutes.post('/:id/schedules', manage, async (c) => {
  const { id } = parseParams(c, idParam);
  await cls.addSchedule(getDb(c.env.DB), auditMetaFrom(c), id, await parseJson(c, scheduleAddSchema));
  return c.json({ ok: true }, 201);
});
classRoutes.post('/:id/enrollments', requirePermission('enrollments.write'), async (c) => {
  const { id } = parseParams(c, idParam);
  return c.json(await cls.enrollStudents(getDb(c.env.DB), auditMetaFrom(c), c.get('user'), id, await parseJson(c, enrollSchema)), 201);
});
classRoutes.get('/:id/enrollment-history', read, async (c) => {
  const { id } = parseParams(c, idParam);
  return c.json({ data: await cls.enrollmentHistory(getDb(c.env.DB), c.get('user'), id) });
});
classRoutes.get('/:id/lessons', read, async (c) => {
  const { id } = parseParams(c, idParam);
  const today = vnDate();
  const q = parseWith(z.object({ from: isoDate.default(addDays(today, -30)), to: isoDate.default(addDays(today, 56)) }), c.req.query());
  return c.json({ data: await cls.listLessons(getDb(c.env.DB), c.get('user'), id, q.from, q.to) });
});
classRoutes.post('/:id/lessons', manage, async (c) => {
  const { id } = parseParams(c, idParam);
  return c.json(await cls.createLesson(getDb(c.env.DB), auditMetaFrom(c), id, await parseJson(c, lessonCreateSchema)), 201);
});

export const enrollmentRoutes = new Hono<AppEnv>();
enrollmentRoutes.use('*', requireAuth, requirePermission('enrollments.write'));
enrollmentRoutes.post('/:id/transfer', async (c) => {
  const { id } = parseParams(c, idParam);
  await cls.transferEnrollment(getDb(c.env.DB), auditMetaFrom(c), c.get('user'), id, await parseJson(c, transferSchema));
  return c.json({ ok: true });
});
enrollmentRoutes.post('/:id/end', async (c) => {
  const { id } = parseParams(c, idParam);
  await cls.endEnrollment(getDb(c.env.DB), auditMetaFrom(c), id, await parseJson(c, enrollmentEndSchema));
  return c.json({ ok: true });
});

export const lessonRoutes = new Hono<AppEnv>();
// requireAuth gắn trực tiếp vào route (router /lessons dùng chung với lessonAttendanceRoutes)
lessonRoutes.patch('/:id', requireAuth, requireAnyPermission('classes.write', 'attendance.write'), async (c) => {
  const { id } = parseParams(c, idParam);
  await cls.updateLesson(getDb(c.env.DB), auditMetaFrom(c), c.get('user'), id, await parseJson(c, lessonUpdateSchema));
  return c.json({ ok: true });
});

// ───────────── Giáo viên ─────────────
export const teacherRoutes = new Hono<AppEnv>();
teacherRoutes.use('*', requireAuth);
teacherRoutes.get('/', requireAnyPermission('teachers.read', 'classes.read'), async (c) => {
  const all = c.req.query('all') === '1' && c.get('user').permissions.has('teachers.write');
  const rows = await tch.listTeachers(getDb(c.env.DB), all);
  // Giáo viên chỉ thấy danh sách tên để chọn (không có thông tin tài khoản)
  if (!c.get('user').permissions.has('teachers.write'))
    return c.json({ data: rows.map((r) => ({ id: r.id, teacherCode: r.teacherCode, fullName: r.fullName, status: r.status })) });
  return c.json({ data: rows });
});
teacherRoutes.post('/', requirePermission('teachers.write'), async (c) => {
  const input = await parseJson(c, teacherCreateSchema);
  return c.json(await tch.createTeacher(getDb(c.env.DB), c.env, auditMetaFrom(c), input), 201);
});
teacherRoutes.patch('/:id', requirePermission('teachers.write'), async (c) => {
  const { id } = parseParams(c, idParam);
  await tch.updateTeacher(getDb(c.env.DB), auditMetaFrom(c), id, await parseJson(c, teacherUpdateSchema));
  return c.json({ ok: true });
});
for (const [path, active] of [
  ['deactivate', false],
  ['activate', true],
] as const) {
  teacherRoutes.post(`/:id/${path}`, requirePermission('teachers.write'), async (c) => {
    const { id } = parseParams(c, idParam);
    const body = (await c.req.json().catch(() => ({}))) as { reason?: string };
    await tch.setTeacherActive(getDb(c.env.DB), auditMetaFrom(c), id, active, body.reason);
    return c.json({ ok: true });
  });
}

export const userRoutes = new Hono<AppEnv>();
userRoutes.use('*', requireAuth);
userRoutes.post('/:id/reset-password', requireAnyPermission('users.manage', 'teachers.write'), async (c) => {
  const { id } = parseParams(c, idParam);
  const me = c.get('user');
  // Chủ lớp (không có users.manage) chỉ cấp lại mật khẩu cho giáo viên/phụ huynh/học sinh
  if (!me.permissions.has('users.manage')) {
    const db = getDb(c.env.DB);
    const [u] = await db.all<{ role: string }>(sql`SELECT r.code AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ${id}`);
    if (!u || ['ADMIN', 'OWNER'].includes(u.role)) throw Errors.forbidden();
  }
  return c.json(await tch.resetUserPassword(getDb(c.env.DB), c.env, auditMetaFrom(c), id));
});
