import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import type { AppEnv } from '../env';
import { getDb } from '../db/client';
import { requireAuth, requirePermission } from '../middleware/auth';
import { centerSettingsSchema } from '@ecm/shared';
import { auditInsert, auditMetaFrom } from '../services/audit.service';
import { runBatch } from '../lib/batch';
import { nowIso } from '../lib/time';
import { parseJson } from '../validators/validate';

export const settingsRoutes = new Hono<AppEnv>();
settingsRoutes.use('*', requireAuth);

/** Cài đặt cần cho giao diện (danh mục trình độ, tên trung tâm, thang xếp loại). Không chứa dữ liệu nhạy cảm. */
const PUBLIC_KEYS = ['center_name', 'center_address', 'center_phone', 'english_levels', 'grade_bands', 'attendance_lock_policy'];

settingsRoutes.get('/public', async (c) => {
  const db = getDb(c.env.DB);
  const rows = await db.all<{ key: string; value: string }>(
    sql`SELECT key, value FROM system_settings WHERE key IN (${sql.join(PUBLIC_KEYS.map((k) => sql`${k}`), sql`, `)})`,
  );
  return c.json(Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)])));
});

settingsRoutes.patch('/center', requirePermission('settings.manage'), async (c) => {
  const input = await parseJson(c, centerSettingsSchema);
  const db = getDb(c.env.DB);
  const values = { center_name: input.name, center_address: input.address, center_phone: input.phone };
  await runBatch(db, [
    ...Object.entries(values).map(
      ([k, v]) => sql`INSERT INTO system_settings (key, value, updated_by) VALUES (${k}, ${JSON.stringify(v)}, ${c.get('user').id})
                      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = ${nowIso()}`,
    ),
    auditInsert(db, auditMetaFrom(c), { action: 'settings.center_update', entityType: 'system_settings', after: values }),
  ]);
  return c.json({ ok: true });
});
