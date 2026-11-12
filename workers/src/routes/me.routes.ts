import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { changePasswordSchema, normalizePersonName, phoneSchema, registerDeviceSchema } from '@ecm/shared';
import type { AppEnv } from '../env';
import { getDb } from '../db/client';
import { deviceTokens, guardians, teachers, users } from '../db/schema';
import { Errors } from '../lib/errors';
import { nowIso } from '../lib/time';
import { requireAuth } from '../middleware/auth';
import { auditInsert, auditMetaFrom } from '../services/audit.service';
import * as auth from '../services/auth.service';
import { parseJson } from '../validators/validate';

export const meRoutes = new Hono<AppEnv>();
meRoutes.use('*', requireAuth);

meRoutes.get('/', async (c) => {
  const u = c.get('user');
  const loaded = await auth.loadSessionUser(c.env.DB, u.id, u.sessionId);
  if (!loaded) throw Errors.unauthorized();
  return c.json(auth.toMeResponse(loaded.row, loaded.perms));
});

const updateMeSchema = z.object({
  fullName: z.string().trim().min(2, 'Họ tên tối thiểu 2 ký tự').max(100).optional(),
  phone: phoneSchema.optional(),
});

meRoutes.patch('/', async (c) => {
  const u = c.get('user');
  const input = await parseJson(c, updateMeSchema);
  const db = getDb(c.env.DB);
  const patch: Partial<typeof users.$inferInsert> = { updatedAt: nowIso() };
  if (input.fullName) patch.fullName = normalizePersonName(input.fullName);
  if (input.phone) {
    const [dup] = await db.select({ id: users.id }).from(users).where(eq(users.phone, input.phone));
    if (dup && dup.id !== u.id) throw Errors.conflict('PHONE_TAKEN', 'Số điện thoại đã được sử dụng');
    patch.phone = input.phone;
  }
  await db.batch([
    db.update(users).set(patch).where(eq(users.id, u.id)),
    // Teacher/guardian profiles carry their own name column; keep them in step with the login account.
    ...(patch.fullName
      ? [
          db.update(teachers).set({ fullName: patch.fullName, updatedAt: nowIso() }).where(eq(teachers.userId, u.id)),
          db.update(guardians).set({ fullName: patch.fullName, updatedAt: nowIso() }).where(eq(guardians.userId, u.id)),
        ]
      : []),
    auditInsert(db, auditMetaFrom(c), { action: 'user.update_self', entityType: 'user', entityId: u.id, after: input }),
  ]);
  return c.json({ ok: true });
});

meRoutes.post('/change-password', async (c) => {
  const u = c.get('user');
  const input = await parseJson(c, changePasswordSchema);
  await auth.changePassword(getDb(c.env.DB), c.env, auditMetaFrom(c), {
    userId: u.id,
    sessionId: u.sessionId,
    ...input,
  });
  return c.json({ ok: true });
});

meRoutes.post('/devices', async (c) => {
  const u = c.get('user');
  const input = await parseJson(c, registerDeviceSchema);
  const db = getDb(c.env.DB);
  // Token FCM có thể chuyển chủ (đăng nhập tài khoản khác trên cùng máy) → upsert theo token.
  await db
    .insert(deviceTokens)
    .values({ userId: u.id, fcmToken: input.fcmToken, platform: input.platform })
    .onConflictDoUpdate({
      target: deviceTokens.fcmToken,
      set: { userId: u.id, platform: input.platform, lastSeenAt: nowIso() },
    });
  return c.json({ ok: true });
});

meRoutes.delete('/devices/:token', async (c) => {
  const u = c.get('user');
  const db = getDb(c.env.DB);
  const token = decodeURIComponent(c.req.param('token'));
  const [row] = await db.select().from(deviceTokens).where(eq(deviceTokens.fcmToken, token));
  if (row && row.userId === u.id) await db.delete(deviceTokens).where(eq(deviceTokens.id, row.id));
  return c.json({ ok: true });
});
