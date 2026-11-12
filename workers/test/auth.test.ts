import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ROLE_PERMISSIONS, ROLE_CODES } from '@ecm/shared';
import { hashPassword, verifyPassword } from '../src/lib/crypto';
import { api, BASE, bearer, createUser, json, loginMobile, loginWeb } from './helpers';

type ErrBody = { error: { code: string; message: string } };

describe('Hệ thống', () => {
  it('health trả ok', async () => {
    const res = await api('/health');
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });
  it('API không tồn tại → 404 JSON', async () => {
    const res = await api('/khong-ton-tai');
    expect(res.status).toBe(404);
    expect(((await res.json()) as ErrBody).error.code).toBe('NOT_FOUND');
  });
  it('quyền mặc định trong D1 khớp với hằng số dùng chung', async () => {
    for (const role of ROLE_CODES) {
      const { results } = await env.DB.prepare(
        `SELECT p.code FROM role_permissions rp JOIN roles r ON r.id = rp.role_id JOIN permissions p ON p.id = rp.permission_id WHERE r.code = ?`,
      )
        .bind(role)
        .all<{ code: string }>();
      expect(results.map((r) => r.code).sort()).toEqual([...DEFAULT_ROLE_PERMISSIONS[role]].sort());
    }
  });
});

describe('Đăng nhập mobile (Bearer)', () => {
  it('đăng nhập thành công, /me trả quyền theo vai trò', async () => {
    const u = await createUser({ role: 'TEACHER' });
    const { res, accessToken, refreshToken } = await loginMobile(u);
    expect(res.status).toBe(200);
    expect(accessToken).toBeTruthy();
    expect(refreshToken).toBeTruthy();
    expect(res.headers.getSetCookie()).toHaveLength(0);

    const me = await api('/me', { headers: bearer(accessToken) });
    expect(me.status).toBe(200);
    const body = (await me.json()) as { role: string; permissions: string[] };
    expect(body.role).toBe('TEACHER');
    expect(body.permissions).toContain('attendance.write');
    expect(body.permissions).not.toContain('fees.read');
  });

  it('đăng nhập bằng số điện thoại (chuẩn hóa +84)', async () => {
    const u = await createUser({ phone: '0912000111' });
    const res = await api('/auth/login', json({ identifier: '+84 912 000 111', password: u.password, client: 'MOBILE' }));
    expect(res.status).toBe(200);
  });

  it('sai mật khẩu và tài khoản không tồn tại trả cùng một lỗi', async () => {
    const u = await createUser();
    const r1 = await api('/auth/login', json({ identifier: u.email, password: 'SaiMatKhau1' }));
    const r2 = await api('/auth/login', json({ identifier: 'khongco@test.vn', password: 'SaiMatKhau1' }));
    expect(r1.status).toBe(401);
    expect(r2.status).toBe(401);
    const b1 = (await r1.json()) as ErrBody;
    const b2 = (await r2.json()) as ErrBody;
    expect(b1.error).toEqual(b2.error);
  });

  it('dữ liệu đầu vào sai → 422', async () => {
    const res = await api('/auth/login', json({ identifier: 'a' }));
    expect(res.status).toBe(422);
    expect(((await res.json()) as ErrBody).error.code).toBe('VALIDATION_ERROR');
  });

  it('token bị sửa → 401', async () => {
    const u = await createUser();
    const { accessToken } = await loginMobile(u);
    const tampered = accessToken.slice(0, -3) + (accessToken.endsWith('a') ? 'bbb' : 'aaa');
    expect((await api('/me', { headers: bearer(tampered) })).status).toBe(401);
    expect((await api('/me')).status).toBe(401);
  });

  it('tài khoản bị vô hiệu hóa không đăng nhập được', async () => {
    const u = await createUser({ status: 'DISABLED' });
    const res = await api('/auth/login', json({ identifier: u.email, password: u.password }));
    expect(res.status).toBe(403);
    expect(((await res.json()) as ErrBody).error.code).toBe('ACCOUNT_DISABLED');
  });

  it('vô hiệu hóa tài khoản đang đăng nhập → token hiện tại mất hiệu lực ngay', async () => {
    const u = await createUser();
    const { accessToken } = await loginMobile(u);
    await env.DB.prepare(`UPDATE users SET status = 'DISABLED' WHERE id = ?`).bind(u.id).run();
    expect((await api('/me', { headers: bearer(accessToken) })).status).toBe(401);
  });
});

describe('Làm mới phiên (refresh token xoay vòng)', () => {
  const doRefresh = (token: string) => api('/auth/refresh', json({ refreshToken: token }));

  it('xoay vòng token và token cũ không dùng lại được', async () => {
    const u = await createUser();
    const first = await loginMobile(u);
    const r = await doRefresh(first.refreshToken);
    expect(r.status).toBe(200);
    const next = (await r.json()) as { accessToken: string; refreshToken: string };
    expect(next.refreshToken).not.toBe(first.refreshToken);
    expect((await api('/me', { headers: bearer(next.accessToken) })).status).toBe(200);

    // Dùng lại ngay (trong thời gian ân hạn – VD 2 tab) → 401 nhưng không thu hồi chuỗi phiên.
    expect((await doRefresh(first.refreshToken)).status).toBe(401);
    expect((await api('/me', { headers: bearer(next.accessToken) })).status).toBe(200);
  });

  it('phát hiện dùng lại token cũ (sau ân hạn) → thu hồi toàn bộ chuỗi phiên', async () => {
    const u = await createUser();
    const first = await loginMobile(u);
    const next = (await (await doRefresh(first.refreshToken)).json()) as { accessToken: string; refreshToken: string };
    await env.DB.prepare(
      `UPDATE sessions SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now','-5 minutes') WHERE user_id = ? AND revoke_reason = 'ROTATED'`,
    )
      .bind(u.id)
      .run();
    expect((await doRefresh(first.refreshToken)).status).toBe(401);
    expect((await doRefresh(next.refreshToken)).status).toBe(401);
    expect((await api('/me', { headers: bearer(next.accessToken) })).status).toBe(401);
    const log = await env.DB.prepare(`SELECT count(*) n FROM audit_logs WHERE action = 'auth.refresh_reuse_detected' AND actor_user_id = ?`)
      .bind(u.id)
      .first<{ n: number }>();
    expect(log!.n).toBe(1);
  });

  it('đăng xuất thu hồi phiên', async () => {
    const u = await createUser();
    const s = await loginMobile(u);
    await api('/auth/logout', json({ refreshToken: s.refreshToken }));
    expect((await api('/me', { headers: bearer(s.accessToken) })).status).toBe(401);
    expect((await doRefresh(s.refreshToken)).status).toBe(401);
  });
});

describe('Đăng nhập web (cookie + CSRF)', () => {
  it('cookie HttpOnly, Secure, SameSite=Strict; không trả token trong body', async () => {
    const u = await createUser();
    const { res, jar } = await loginWeb(u);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.accessToken).toBeUndefined();
    expect(body.refreshToken).toBeUndefined();
    const at = jar.raw.find((c) => c.startsWith('ecm_at='))!;
    const rt = jar.raw.find((c) => c.startsWith('ecm_rt='))!;
    for (const c of [at, rt]) {
      expect(c).toMatch(/HttpOnly/);
      expect(c).toMatch(/Secure/);
      expect(c).toMatch(/SameSite=Strict/);
    }
    const csrf = jar.raw.find((c) => c.startsWith('ecm_csrf='))!;
    expect(csrf).not.toMatch(/HttpOnly/);
  });

  it('request thay đổi dữ liệu bằng cookie bắt buộc CSRF token', async () => {
    const u = await createUser();
    const { jar } = await loginWeb(u);
    const cookie = jar.header();
    expect((await api('/me', { headers: { Cookie: cookie } })).status).toBe(200);

    const patch = (headers: Record<string, string>) =>
      api('/me', { method: 'PATCH', headers: { Cookie: cookie, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ fullName: 'Nguyễn văn an' }) });

    const noToken = await patch({});
    expect(noToken.status).toBe(403);
    expect(((await noToken.json()) as ErrBody).error.code).toBe('CSRF_FAILED');
    expect((await patch({ 'X-CSRF-Token': 'gia-mao' })).status).toBe(403);
    expect((await patch({ 'X-CSRF-Token': jar.get('ecm_csrf')!, Origin: 'https://evil.example' })).status).toBe(403);
    expect((await patch({ 'X-CSRF-Token': jar.get('ecm_csrf')!, Origin: BASE })).status).toBe(200);

    const me = (await (await api('/me', { headers: { Cookie: cookie } })).json()) as { fullName: string };
    expect(me.fullName).toBe('Nguyễn Văn An');
  });

  it('refresh bằng cookie xoay vòng cookie', async () => {
    const u = await createUser();
    const { jar } = await loginWeb(u);
    const oldRt = jar.get('ecm_rt');
    const res = await api('/auth/refresh', {
      method: 'POST',
      headers: { Cookie: jar.header(), 'X-CSRF-Token': jar.get('ecm_csrf')!, Origin: BASE },
    });
    expect(res.status).toBe(200);
    jar.absorb(res);
    expect(jar.get('ecm_rt')).not.toBe(oldRt);
    expect((await api('/me', { headers: { Cookie: jar.header() } })).status).toBe(200);
  });
});

describe('Khóa tài khoản & đổi mật khẩu', () => {
  it('khóa tạm sau 10 lần sai, kể cả khi sau đó nhập đúng', async () => {
    const u = await createUser();
    let last: Response | undefined;
    for (let i = 0; i < 10; i++) last = await api('/auth/login', json({ identifier: u.email, password: 'SaiMatKhau1' }));
    expect(last!.status).toBe(423);
    const right = await api('/auth/login', json({ identifier: u.email, password: u.password }));
    expect([423, 429]).toContain(right.status);
    const row = await env.DB.prepare('SELECT locked_until FROM users WHERE id = ?').bind(u.id).first<{ locked_until: string }>();
    expect(row!.locked_until > new Date().toISOString()).toBe(true);
  });

  it('bắt buộc đổi mật khẩu lần đầu', async () => {
    const u = await createUser({ mustChange: true });
    const other = await loginMobile(u);
    const s = await loginMobile(u);
    expect((await api('/me', { headers: bearer(s.accessToken) })).status).toBe(200);
    const blocked = await api('/auth/logout-all', { method: 'POST', headers: bearer(s.accessToken) });
    expect(blocked.status).toBe(403);
    expect(((await blocked.json()) as ErrBody).error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const weak = await api('/me/change-password', json({ currentPassword: u.password, newPassword: 'abc' }, { headers: bearer(s.accessToken) }));
    expect(weak.status).toBe(422);
    const wrong = await api('/me/change-password', json({ currentPassword: 'Sai12345', newPassword: 'MatKhauMoi9' }, { headers: bearer(s.accessToken) }));
    expect(wrong.status).toBe(422);
    const ok = await api('/me/change-password', json({ currentPassword: u.password, newPassword: 'MatKhauMoi9' }, { headers: bearer(s.accessToken) }));
    expect(ok.status).toBe(200);

    // Phiên hiện tại vẫn dùng được, phiên khác bị đăng xuất.
    expect((await api('/me', { headers: bearer(s.accessToken) })).status).toBe(200);
    expect((await api('/me', { headers: bearer(other.accessToken) })).status).toBe(401);
    const relog = await api('/auth/login', json({ identifier: u.email, password: 'MatKhauMoi9' }));
    expect(relog.status).toBe(200);
    const me = (await relog.json()) as { user: { mustChangePassword: boolean } };
    expect(me.user.mustChangePassword).toBe(false);
  });
});

describe('Mật mã & toàn vẹn dữ liệu', () => {
  it('không lưu mật khẩu dạng thuần; hash có salt khác nhau', async () => {
    const a = await hashPassword('Matkhau123', 10000);
    const b = await hashPassword('Matkhau123', 10000);
    expect(a).not.toBe(b);
    expect(a).not.toContain('Matkhau123');
    expect((await verifyPassword('Matkhau123', a, 10000)).ok).toBe(true);
    expect((await verifyPassword('Matkhau124', a, 10000)).ok).toBe(false);
  });
  it('đánh dấu cần băm lại khi tăng số vòng', async () => {
    const h = await hashPassword('Matkhau123', 10000);
    expect(await verifyPassword('Matkhau123', h, 30000)).toEqual({ ok: true, needsRehash: true });
  });
  it('nhật ký đăng nhập được ghi và không thể sửa/xóa', async () => {
    const u = await createUser();
    await loginMobile(u);
    const row = await env.DB.prepare(`SELECT id FROM audit_logs WHERE action = 'auth.login' AND actor_user_id = ?`).bind(u.id).first<{ id: number }>();
    expect(row).toBeTruthy();
    await expect(env.DB.prepare('UPDATE audit_logs SET action = ? WHERE id = ?').bind('x', row!.id).run()).rejects.toThrow(/append-only/);
    await expect(env.DB.prepare('DELETE FROM audit_logs WHERE id = ?').bind(row!.id).run()).rejects.toThrow(/append-only/);
  });
});
