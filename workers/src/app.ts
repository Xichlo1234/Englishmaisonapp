import { Hono } from 'hono';
import type { AppEnv } from './env';
import { AppError } from './lib/errors';
import { csrfProtection, requestId, securityHeaders } from './middleware/security';
import { authRoutes } from './routes/auth.routes';
import { meRoutes } from './routes/me.routes';
import { fileRoutes } from './routes/files.routes';
import { settingsRoutes } from './routes/settings.routes';
import { guardianRoutes, studentRoutes } from './routes/students.routes';

export function createApp() {
  const app = new Hono<AppEnv>();
  const api = new Hono<AppEnv>();

  api.use('*', requestId, securityHeaders, csrfProtection);

  api.get('/health', (c) => c.json({ status: 'ok', time: new Date().toISOString() }));
  api.route('/auth', authRoutes);
  api.route('/me', meRoutes);
  api.route('/settings', settingsRoutes);
  api.route('/students', studentRoutes);
  api.route('/guardians', guardianRoutes);
  api.route('/files', fileRoutes);

  api.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: 'Không tìm thấy API' } }, 404));

  app.route('/api/v1', api);

  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json({ error: { code: err.code, message: err.message, details: err.details } }, err.status);
    }
    const msg = err instanceof Error ? err.message : String(err);
    // Vi phạm ràng buộc DB (UNIQUE/CHECK/FK) không được bắt ở service → 409, không lộ chi tiết SQL.
    if (/SQLITE_CONSTRAINT|constraint failed/i.test(msg)) {
      console.warn('constraint', c.get('requestId'), msg);
      return c.json({ error: { code: 'CONSTRAINT_VIOLATION', message: 'Dữ liệu bị trùng hoặc không hợp lệ' } }, 409);
    }
    console.error('unhandled', c.get('requestId'), err);
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Lỗi hệ thống, vui lòng thử lại' } }, 500);
  });

  // Các đường dẫn /api/* khác (ngoài /api/v1)
  app.all('/api/*', (c) => c.json({ error: { code: 'NOT_FOUND', message: 'Không tìm thấy API' } }, 404));
  // Mọi đường dẫn khác: phục vụ webapp (Static Assets, SPA fallback).
  app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

  return app;
}
