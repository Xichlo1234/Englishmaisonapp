import { createMiddleware } from 'hono/factory';
import { getCookie } from 'hono/cookie';
import { verify } from 'hono/jwt';
import type { PermissionCode, RoleCode } from '@ecm/shared';
import type { AppEnv } from '../env';
import { Errors } from '../lib/errors';
import { loadSessionUser } from '../services/auth.service';
import { COOKIE_ACCESS } from '../lib/cookies';

/** Đường dẫn vẫn dùng được khi người dùng bắt buộc phải đổi mật khẩu. */
const ALLOWED_WHEN_MUST_CHANGE = ['/api/v1/me', '/api/v1/me/change-password', '/api/v1/auth/logout'];

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header('Authorization');
  let token: string | undefined;
  let via: 'cookie' | 'bearer' = 'cookie';
  if (header?.startsWith('Bearer ')) {
    token = header.slice(7).trim();
    via = 'bearer';
  } else {
    token = getCookie(c, COOKIE_ACCESS);
  }
  if (!token) throw Errors.unauthorized();

  let payload: Record<string, unknown>;
  try {
    payload = (await verify(token, c.env.JWT_SECRET, 'HS256')) as Record<string, unknown>;
  } catch {
    throw Errors.unauthorized('Phiên đăng nhập đã hết hạn');
  }
  if (payload.typ !== 'access') throw Errors.unauthorized();
  const userId = Number(payload.sub);
  const sessionId = Number(payload.sid);
  if (!Number.isInteger(userId) || !Number.isInteger(sessionId)) throw Errors.unauthorized();

  const loaded = await loadSessionUser(c.env.DB, userId, sessionId);
  if (!loaded) throw Errors.unauthorized('Phiên đăng nhập đã hết hạn');

  const { row, perms } = loaded;
  c.set('user', {
    id: row.id,
    sessionId,
    role: row.role as RoleCode,
    fullName: row.full_name,
    permissions: perms,
    mustChangePassword: !!row.must_change_password,
    teacherId: row.teacher_id,
    guardianId: row.guardian_id,
    studentId: row.student_id,
    via,
  });

  if (row.must_change_password && !ALLOWED_WHEN_MUST_CHANGE.includes(c.req.path)) {
    throw Errors.passwordChangeRequired();
  }
  await next();
});

/** Yêu cầu có TẤT CẢ các quyền được liệt kê. */
export const requirePermission = (...codes: PermissionCode[]) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const user = c.get('user');
    if (!user) throw Errors.unauthorized();
    for (const code of codes) if (!user.permissions.has(code)) throw Errors.forbidden();
    await next();
  });

/** Yêu cầu có ÍT NHẤT MỘT trong các quyền. */
export const requireAnyPermission = (...codes: PermissionCode[]) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const user = c.get('user');
    if (!user) throw Errors.unauthorized();
    if (!codes.some((code) => user.permissions.has(code))) throw Errors.forbidden();
    await next();
  });
