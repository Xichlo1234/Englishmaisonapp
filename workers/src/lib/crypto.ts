/**
 * Mật mã dùng WebCrypto native của Workers (không dùng thư viện JS thuần để tiết kiệm CPU).
 * Định dạng hash mật khẩu: pbkdf2-sha256$<iterations>$<salt b64url>$<hash b64url>
 */
const enc = new TextEncoder();

export function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** So sánh thời gian hằng định. */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  return timingSafeEqual(enc.encode(a), enc.encode(b));
}

const MAX_ITERATIONS = 100_000; // giới hạn của WebCrypto trên Workers

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string, iterations: number): Promise<string> {
  const it = Math.min(Math.max(10_000, Math.trunc(iterations)), MAX_ITERATIONS);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, it);
  return `pbkdf2-sha256$${it}$${b64url(salt)}$${b64url(hash)}`;
}

export interface VerifyResult {
  ok: boolean;
  /** true nếu hash dùng số vòng thấp hơn cấu hình hiện tại → nên băm lại. */
  needsRehash: boolean;
}

export async function verifyPassword(
  password: string,
  stored: string,
  currentIterations: number,
): Promise<VerifyResult> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256') return { ok: false, needsRehash: false };
  const it = Number(parts[1]);
  if (!Number.isInteger(it) || it < 1 || it > MAX_ITERATIONS) return { ok: false, needsRehash: false };
  const salt = fromB64url(parts[2]!);
  const expected = fromB64url(parts[3]!);
  const actual = await pbkdf2(password, salt, it);
  const ok = timingSafeEqual(actual, expected);
  return { ok, needsRehash: ok && it < Math.min(currentIterations, MAX_ITERATIONS) };
}

/** Hash giả để chạy PBKDF2 khi tài khoản không tồn tại — tránh lộ tài khoản qua thời gian phản hồi. */
export const DUMMY_PASSWORD_HASH =
  'pbkdf2-sha256$30000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
