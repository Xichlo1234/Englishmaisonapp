import { createMiddleware } from 'hono/factory';
import { getCookie } from 'hono/cookie';
import type { AppEnv } from '../env';
import { Errors } from '../lib/errors';
import { timingSafeEqualStr } from '../lib/crypto';
import { COOKIE_ACCESS, COOKIE_CSRF, COOKIE_REFRESH, CSRF_HEADER } from '../lib/cookies';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Origin hợp lệ: cùng origin với request hoặc APP_ORIGIN đã cấu hình. */
export function isAllowedOrigin(origin: string, requestUrl: string, appOrigin: string): boolean {
  if (origin === new URL(requestUrl).origin) return true;
  return appOrigin
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(origin);
}

/**
 * Chống CSRF cho request dùng cookie xác thực:
 *  1) Kiểm tra header Origin (nếu trình duyệt gửi) phải thuộc danh sách cho phép.
 *  2) Double-submit: header X-CSRF-Token phải trùng cookie ecm_csrf.
 * Request dùng Bearer token (mobile) không mang cookie nên không cần kiểm tra.
 */
export const csrfProtection = createMiddleware<AppEnv>(async (c, next) => {
  if (SAFE_METHODS.has(c.req.method)) return next();
  if (c.req.header('Authorization')?.startsWith('Bearer ')) return next();

  const usesCookies = !!(getCookie(c, COOKIE_ACCESS) || getCookie(c, COOKIE_REFRESH));
  const origin = c.req.header('Origin');
  if (origin && !isAllowedOrigin(origin, c.req.url, c.env.APP_ORIGIN)) throw Errors.csrf();

  if (usesCookies) {
    const cookie = getCookie(c, COOKIE_CSRF);
    const header = c.req.header(CSRF_HEADER);
    if (!cookie || !header || !timingSafeEqualStr(cookie, header)) throw Errors.csrf();
  }
  await next();
});

/** Header bảo mật cho mọi phản hồi API. */
export const securityHeaders = createMiddleware<AppEnv>(async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('X-Frame-Options', 'DENY');
  c.header('Cache-Control', c.res.headers.get('Cache-Control') ?? 'no-store');
  if (c.env.APP_ENV !== 'development' && c.env.APP_ENV !== 'test') {
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
});

export const requestId = createMiddleware<AppEnv>(async (c, next) => {
  const id = c.req.header('CF-Ray') ?? crypto.randomUUID();
  c.set('requestId', id);
  await next();
  c.header('X-Request-Id', id);
});
