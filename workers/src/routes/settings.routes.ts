import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import type { AppEnv } from '../env';
import { getDb } from '../db/client';
import { requireAuth } from '../middleware/auth';

export const settingsRoutes = new Hono<AppEnv>();
settingsRoutes.use('*', requireAuth);

/** Cài đặt cần cho giao diện (danh mục trình độ, tên trung tâm, thang xếp loại). Không chứa dữ liệu nhạy cảm. */
const PUBLIC_KEYS = ['center_name', 'english_levels', 'grade_bands', 'attendance_lock_policy'];

settingsRoutes.get('/public', async (c) => {
  const db = getDb(c.env.DB);
  const rows = await db.all<{ key: string; value: string }>(
    sql`SELECT key, value FROM system_settings WHERE key IN (${sql.join(PUBLIC_KEYS.map((k) => sql`${k}`), sql`, `)})`,
  );
  return c.json(Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)])));
});
