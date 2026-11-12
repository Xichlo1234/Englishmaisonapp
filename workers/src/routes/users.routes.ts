import { Hono } from 'hono';
import { idParam, staffCreateSchema, userListQuery, userUpdateSchema } from '@ecm/shared';
import type { AppEnv } from '../env';
import { getDb } from '../db/client';
import { requireAnyPermission, requireAuth, requirePermission } from '../middleware/auth';
import { auditMetaFrom } from '../services/audit.service';
import * as usr from '../services/users.service';
import { parseJson, parseParams, parseQuery } from '../validators/validate';

const manage = requirePermission('users.manage');

export const userRoutes = new Hono<AppEnv>();
userRoutes.use('*', requireAuth);

userRoutes.get('/', manage, async (c) => c.json({ data: await usr.listUsers(getDb(c.env.DB), parseQuery(c, userListQuery)) }));

userRoutes.post('/', manage, async (c) => {
  const input = await parseJson(c, staffCreateSchema);
  return c.json(await usr.createStaff(getDb(c.env.DB), c.env, auditMetaFrom(c), c.get('user'), input), 201);
});

userRoutes.patch('/:id', manage, async (c) => {
  const { id } = parseParams(c, idParam);
  const input = await parseJson(c, userUpdateSchema);
  return c.json(await usr.updateUser(getDb(c.env.DB), auditMetaFrom(c), c.get('user'), id, input));
});

userRoutes.post('/:id/unlock', manage, async (c) => {
  const { id } = parseParams(c, idParam);
  return c.json(await usr.unlockUser(getDb(c.env.DB), auditMetaFrom(c), c.get('user'), id));
});

userRoutes.post('/:id/revoke-sessions', manage, async (c) => {
  const { id } = parseParams(c, idParam);
  return c.json(await usr.revokeUserSessions(getDb(c.env.DB), auditMetaFrom(c), c.get('user'), id));
});

userRoutes.post('/:id/reset-password', requireAnyPermission('users.manage', 'teachers.write'), async (c) => {
  const { id } = parseParams(c, idParam);
  return c.json(await usr.resetUserPassword(getDb(c.env.DB), c.env, auditMetaFrom(c), c.get('user'), id));
});
