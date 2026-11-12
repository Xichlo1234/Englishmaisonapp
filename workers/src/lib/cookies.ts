import type { Context } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import type { AppEnv } from '../env';
import { randomToken } from './crypto';

export const COOKIE_ACCESS = 'ecm_at';
export const COOKIE_REFRESH = 'ecm_rt';
export const COOKIE_CSRF = 'ecm_csrf';
export const CSRF_HEADER = 'X-CSRF-Token';

const REFRESH_PATH = '/api/v1/auth';

/** Cookie xác thực web: HttpOnly + Secure + SameSite=Strict. */
export function setAuthCookies(
  c: Context<AppEnv>,
  t: { accessToken: string; accessTokenExpiresIn: number; refreshToken: string; refreshExpiresAt: string },
) {
  setCookie(c, COOKIE_ACCESS, t.accessToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    path: '/api',
    maxAge: t.accessTokenExpiresIn,
  });
  setCookie(c, COOKIE_REFRESH, t.refreshToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    path: REFRESH_PATH,
    expires: new Date(t.refreshExpiresAt),
  });
  return issueCsrfCookie(c);
}

/** Cookie CSRF (double-submit): JS đọc được để gửi lại qua header X-CSRF-Token. */
export function issueCsrfCookie(c: Context<AppEnv>): string {
  const token = randomToken(24);
  setCookie(c, COOKIE_CSRF, token, { httpOnly: false, secure: true, sameSite: 'Strict', path: '/' });
  return token;
}

export function clearAuthCookies(c: Context<AppEnv>) {
  deleteCookie(c, COOKIE_ACCESS, { path: '/api', secure: true });
  deleteCookie(c, COOKIE_REFRESH, { path: REFRESH_PATH, secure: true });
  deleteCookie(c, COOKIE_CSRF, { path: '/', secure: true });
}
