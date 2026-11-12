import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { loginSchema, refreshSchema, type LoginResponse } from '@ecm/shared';
import type { AppEnv } from '../env';
import { getDb } from '../db/client';
import { Errors } from '../lib/errors';
import { clearAuthCookies, COOKIE_REFRESH, issueCsrfCookie, setAuthCookies } from '../lib/cookies';
import { requireAuth } from '../middleware/auth';
import { auditMetaFrom } from '../services/audit.service';
import * as auth from '../services/auth.service';
import { parseJson, parseWith } from '../validators/validate';
import { revokeAllSessionsStmt } from '../services/auth.service';

export const authRoutes = new Hono<AppEnv>();

authRoutes.get('/csrf', (c) => c.json({ csrfToken: issueCsrfCookie(c) }));

authRoutes.post('/login', async (c) => {
  const input = await parseJson(c, loginSchema);
  const meta = auditMetaFrom(c);

  if (c.env.LOGIN_LIMITER) {
    const key = `${meta.ip ?? 'unknown'}:${input.identifier.toLowerCase()}`;
    const { success } = await c.env.LOGIN_LIMITER.limit({ key });
    if (!success) throw Errors.tooManyRequests();
  }

  const db = getDb(c.env.DB);
  const t = await auth.login(db, c.env, meta, input);
  const loaded = await auth.loadSessionUser(c.env.DB, t.userId, t.sessionId);
  if (!loaded) throw Errors.unauthorized();

  const body: LoginResponse & { csrfToken?: string } = {
    user: auth.toMeResponse(loaded.row, loaded.perms),
    accessTokenExpiresIn: t.accessTokenExpiresIn,
  };
  if (input.client === 'MOBILE') {
    body.accessToken = t.accessToken;
    body.refreshToken = t.refreshToken;
  } else {
    body.csrfToken = setAuthCookies(c, t);
  }
  return c.json(body);
});

authRoutes.post('/refresh', async (c) => {
  const cookieToken = getCookie(c, COOKIE_REFRESH);
  let bodyToken: string | undefined;
  if (!cookieToken) {
    const body = await c.req.json().catch(() => null);
    if (body) bodyToken = parseWith(refreshSchema, body).refreshToken;
  }
  const token = cookieToken ?? bodyToken;
  if (!token) throw Errors.unauthorized();

  const db = getDb(c.env.DB);
  const t = await auth.refresh(db, c.env, auditMetaFrom(c), token);
  if (cookieToken) {
    const csrfToken = setAuthCookies(c, t);
    return c.json({ accessTokenExpiresIn: t.accessTokenExpiresIn, csrfToken });
  }
  return c.json({ accessToken: t.accessToken, refreshToken: t.refreshToken, accessTokenExpiresIn: t.accessTokenExpiresIn });
});

authRoutes.post('/logout', async (c) => {
  const db = getDb(c.env.DB);
  const cookieToken = getCookie(c, COOKIE_REFRESH);
  if (cookieToken) await auth.revokeSessionByRefreshToken(db, cookieToken);
  else {
    const body = (await c.req.json().catch(() => ({}))) as { refreshToken?: unknown };
    if (typeof body.refreshToken === 'string') await auth.revokeSessionByRefreshToken(db, body.refreshToken);
  }
  clearAuthCookies(c);
  return c.json({ ok: true });
});

authRoutes.post('/logout-all', requireAuth, async (c) => {
  const db = getDb(c.env.DB);
  const user = c.get('user');
  await revokeAllSessionsStmt(db, user.id, 'LOGOUT_ALL');
  clearAuthCookies(c);
  return c.json({ ok: true });
});
