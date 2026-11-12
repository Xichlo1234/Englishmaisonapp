import { env, SELF } from 'cloudflare:test';
import type { RoleCode } from '@ecm/shared';
import { hashPassword } from '../src/lib/crypto';

export const BASE = 'https://ecm.test';
let seq = 0;

export interface TestUser {
  id: number;
  email: string;
  password: string;
}

export async function createUser(
  opts: { role?: RoleCode; password?: string; mustChange?: boolean; status?: string; phone?: string } = {},
): Promise<TestUser> {
  const n = ++seq + Math.floor(Math.random() * 1e6);
  const email = `user${n}@test.vn`;
  const password = opts.password ?? 'Matkhau123';
  const hash = await hashPassword(password, Number(env.PBKDF2_ITERATIONS));
  const res = await env.DB.prepare(
    `INSERT INTO users (role_id, full_name, email, phone, password_hash, must_change_password, status)
     VALUES ((SELECT id FROM roles WHERE code = ?1), ?2, ?3, ?4, ?5, ?6, ?7) RETURNING id`,
  )
    .bind(opts.role ?? 'ADMIN', `Người dùng ${n}`, email, opts.phone ?? null, hash, opts.mustChange ? 1 : 0, opts.status ?? 'ACTIVE')
    .first<{ id: number }>();
  return { id: res!.id, email, password };
}

export function api(path: string, init: RequestInit = {}) {
  return SELF.fetch(`${BASE}/api/v1${path}`, init);
}

export function json(body: unknown, init: RequestInit = {}): RequestInit {
  return {
    method: 'POST',
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers as Record<string, string>) },
    body: JSON.stringify(body),
  };
}

export async function loginMobile(u: { email: string; password: string }) {
  const res = await api('/auth/login', json({ identifier: u.email, password: u.password, client: 'MOBILE' }));
  const body = (await res.json()) as { accessToken: string; refreshToken: string; user: { permissions: string[] } };
  return { res, ...body };
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Bộ cookie tối giản cho test web. */
export class CookieJar {
  cookies = new Map<string, string>();
  raw: string[] = [];
  absorb(res: Response) {
    for (const sc of res.headers.getSetCookie()) {
      this.raw.push(sc);
      const [pair] = sc.split(';');
      const idx = pair!.indexOf('=');
      const name = pair!.slice(0, idx);
      const value = pair!.slice(idx + 1);
      if (value === '' || /Max-Age=0/i.test(sc)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  get(name: string) {
    return this.cookies.get(name);
  }
}

export async function loginWeb(u: { email: string; password: string }) {
  const jar = new CookieJar();
  const res = await api(
    '/auth/login',
    json({ identifier: u.email, password: u.password }, { headers: { Origin: BASE } }),
  );
  jar.absorb(res);
  return { res, jar };
}
