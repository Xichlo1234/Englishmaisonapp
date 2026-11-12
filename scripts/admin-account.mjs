#!/usr/bin/env node
/**
 * Tạo tài khoản quản trị đầu tiên hoặc đặt lại mật khẩu quản trị (quy trình "break-glass").
 * Chạy từ thư mục gốc repo. Cần quyền truy cập D1 (wrangler đã đăng nhập khi dùng --remote).
 *
 *   node scripts/admin-account.mjs create --email admin@ten-mien.vn --name "Nguyễn Văn A" [--phone 09xxxxxxxx] [--remote] [--env production]
 *   node scripts/admin-account.mjs reset  --email admin@ten-mien.vn [--remote] [--env production]
 *
 * Mật khẩu tạm được sinh ngẫu nhiên, chỉ in ra MỘT lần; người dùng bắt buộc đổi ở lần đăng nhập đầu.
 * Mật khẩu được băm cục bộ (PBKDF2-SHA256), không bao giờ gửi dạng thuần lên Cloudflare.
 */
import { execFileSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomBytes, webcrypto } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ITERATIONS = Number(process.env.PBKDF2_ITERATIONS ?? 30000);
const args = process.argv.slice(2);
const cmd = args[0];
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const flag = (name) => args.includes(`--${name}`);

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const q = (s) => (s == null ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`);

async function hashPassword(password) {
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const key = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await webcrypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, key, 256);
  return `pbkdf2-sha256$${ITERATIONS}$${b64url(salt)}$${b64url(bits)}`;
}

function tempPassword() {
  // 12 ký tự, luôn có chữ và số, tránh ký tự dễ nhầm.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let s = '';
  const bytes = randomBytes(12);
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return s.slice(0, 10) + 'a' + String(bytes[0] % 10);
}

function normalizePhone(p) {
  if (!p) return null;
  let d = p.replace(/[^\d+]/g, '');
  if (d.startsWith('+84')) d = '0' + d.slice(3);
  if (!/^0\d{9}$/.test(d)) throw new Error('Số điện thoại không hợp lệ');
  return d;
}

const WORKERS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../workers');

/** Chạy `npx ...` trên mọi hệ điều hành (Windows cần shell để gọi npx.cmd; tự đặt ngoặc kép cho tham số). */
function npx(args, opts) {
  if (process.platform !== 'win32') return execFileSync('npx', args, opts);
  const q = (a) => (/^[\w@./:=-]+$/.test(a) ? a : `"${String(a).replace(/"/g, '\\"')}"`);
  return execSync(['npx', ...args].map(q).join(' '), opts);
}

function wranglerBase() {
  const a = ['wrangler', 'd1', 'execute', 'DB', flag('remote') ? '--remote' : '--local', '--yes'];
  if (opt('env')) a.push('--env', opt('env'));
  return a;
}

function queryJson(sql) {
  const out = npx([...wranglerBase(), '--json', '--command', sql], {
    cwd: WORKERS_DIR,
    encoding: 'utf8',
  });
  return JSON.parse(out)[0].results;
}

function runSql(sql) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ecm-')), 'admin.sql');
  fs.writeFileSync(file, sql, { mode: 0o600 });
  const wranglerArgs = [...wranglerBase(), '--file', file];
  try {
    npx(wranglerArgs, { cwd: WORKERS_DIR, stdio: 'inherit' });
  } finally {
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  }
}

async function main() {
  const email = opt('email')?.trim().toLowerCase();
  if (!['create', 'reset'].includes(cmd) || !email) {
    console.error('Cách dùng: node scripts/admin-account.mjs create|reset --email <email> [--name <họ tên>] [--phone <sđt>] [--remote] [--env <env>]');
    process.exit(1);
  }
  const existing = queryJson(
    `SELECT u.id, r.code AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.email = ${q(email)}`,
  );
  if (cmd === 'create' && existing.length) throw new Error('Email đã tồn tại');
  if (cmd === 'reset' && (!existing.length || existing[0].role !== 'ADMIN'))
    throw new Error('Không tìm thấy tài khoản quản trị với email này');
  const password = tempPassword();
  const hash = await hashPassword(password);
  let sql;
  if (cmd === 'create') {
    const name = opt('name');
    if (!name) throw new Error('Thiếu --name');
    sql = `INSERT INTO users (role_id, full_name, email, phone, password_hash, must_change_password, status)
VALUES ((SELECT id FROM roles WHERE code = 'ADMIN'), ${q(name)}, ${q(email)}, ${q(normalizePhone(opt('phone')))}, ${q(hash)}, 1, 'ACTIVE');
INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, after_data)
VALUES (NULL, 'user.create_admin_cli', 'user', (SELECT id FROM users WHERE email = ${q(email)}), ${q(JSON.stringify({ email }))});`;
  } else {
    sql = `UPDATE users SET password_hash = ${q(hash)}, must_change_password = 1, status = 'ACTIVE', failed_login_count = 0, locked_until = NULL,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE email = ${q(email)} AND role_id = (SELECT id FROM roles WHERE code = 'ADMIN');
UPDATE sessions SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), revoke_reason = 'BREAK_GLASS'
WHERE user_id = (SELECT id FROM users WHERE email = ${q(email)}) AND revoked_at IS NULL;
INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, after_data)
VALUES (NULL, 'auth.break_glass', 'user', (SELECT id FROM users WHERE email = ${q(email)}), ${q(JSON.stringify({ email }))});`;
  }
  runSql(sql);
  console.log('\n────────────────────────────────────────────');
  console.log(cmd === 'create' ? 'Đã tạo tài khoản quản trị.' : 'Đã đặt lại mật khẩu quản trị (mọi phiên cũ bị thu hồi).');
  console.log(`Email:          ${email}`);
  console.log(`Mật khẩu tạm:   ${password}`);
  console.log('Hãy đăng nhập và đổi mật khẩu ngay. Mật khẩu này không được lưu ở đâu khác.');
  console.log('────────────────────────────────────────────');
}

main().catch((e) => {
  console.error('Lỗi:', e.message);
  process.exit(1);
});
