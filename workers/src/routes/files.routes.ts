import { Hono } from 'hono';
import { idParam } from '@ecm/shared';
import type { AppEnv } from '../env';
import { getDb } from '../db/client';
import { Errors } from '../lib/errors';
import { requireAuth } from '../middleware/auth';
import { authorizeFileRead } from '../services/files.service';
import { parseParams } from '../validators/validate';

export const fileRoutes = new Hono<AppEnv>();
fileRoutes.use('*', requireAuth);

/** Tệp R2 chỉ đọc qua Worker sau khi kiểm tra quyền — bucket không công khai. */
fileRoutes.get('/:id/content', async (c) => {
  const { id } = parseParams(c, idParam);
  const f = await authorizeFileRead(getDb(c.env.DB), c.get('user'), id);
  const obj = await c.env.FILES.get(f.r2Key);
  if (!obj) throw Errors.notFound('Tệp');
  return new Response(obj.body, {
    headers: {
      'Content-Type': f.mimeType,
      'Content-Length': String(f.sizeBytes),
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `inline; filename="file-${f.id}"`,
    },
  });
});
