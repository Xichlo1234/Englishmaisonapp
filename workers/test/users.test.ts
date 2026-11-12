import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { api, bearer, createUser, json, loginMobile, type TestUser } from './helpers';

type Err = { error: { code: string } };
type UserRow = { id: number; role: string; status: string; lockedUntil: string | null; guardianId: number | null; email: string | null; phone: string | null };
let admin: TestUser;
let adminToken: string;
let seq = 0;
const uid = () => `${Date.now().toString(36)}${++seq}`;
const phone = () => `09${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

const post = (path: string, body: unknown, token = adminToken) => api(path, json(body, { headers: bearer(token) }));
const patch = (path: string, body: unknown, token = adminToken) => api(path, { ...json(body, { headers: bearer(token) }), method: 'PATCH' });
const list_ = async (query = '', token = adminToken) =>
  ((await (await api(`/users${query}`, { headers: bearer(token) })).json()) as { data: UserRow[] }).data;
const tokenOf = async (u: TestUser) => (await loginMobile(u)).accessToken;

async function newGuardianId() {
  const p = phone();
  const r = await post('/students', {
    fullName: `Hoc Sinh ${uid()}`.replace(/\d/g, 'x'),
    startDate: '2026-09-01',
    guardians: [{ guardian: { fullName: 'Phụ Huynh', phone: p, email: `ph${uid()}@test.vn` } }],
  });
  expect(r.status).toBe(201);
  const sid = ((await r.json()) as { id: number }).id;
  const s = (await (await api(`/students/${sid}`, { headers: bearer(adminToken) })).json()) as { guardians: { id: number }[] };
  return { id: s.guardians[0]!.id, phone: p };
}

beforeAll(async () => {
  admin = await createUser({ role: 'ADMIN' });
  adminToken = await tokenOf(admin);
});

describe('Danh sách tài khoản', () => {
  it('lọc theo vai trò, tìm không dấu, chỉ người có users.manage xem được', async () => {
    const owner = await createUser({ role: 'OWNER' });
    const teacher = await createUser({ role: 'TEACHER' });
    const owners = await list_('?role=OWNER');
    expect(owners.every((u) => u.role === 'OWNER')).toBe(true);
    expect(owners.some((u) => u.id === owner.id)).toBe(true);
    const found = await list_(`?q=${encodeURIComponent(owner.email.toUpperCase())}`);
    expect(found.map((u) => u.id)).toEqual([owner.id]);
    expect((await api('/users', { headers: bearer(await tokenOf(teacher)) })).status).toBe(403);
  });

  it('tài khoản bị khóa do đăng nhập sai hiện ở bộ lọc "LOCKED" và mở khóa được', async () => {
    const u = await createUser({ role: 'OWNER' });
    await env.DB.prepare(`UPDATE users SET locked_until = '2999-01-01T00:00:00.000Z' WHERE id = ?1`).bind(u.id).run();
    expect((await list_('?status=LOCKED')).some((x) => x.id === u.id)).toBe(true);
    expect((await post(`/users/${u.id}/unlock`, {})).status).toBe(200);
    expect((await list_('?status=LOCKED')).some((x) => x.id === u.id)).toBe(false);
    expect((await loginMobile(u)).res.status).toBe(200);
  });
});

describe('Tạo tài khoản quản trị/chủ lớp', () => {
  it('quản trị viên tạo chủ lớp → mật khẩu tạm, bắt buộc đổi mật khẩu', async () => {
    const email = `owner${uid()}@test.vn`;
    const r = await post('/users', { fullName: 'nguyễn văn chủ', email, role: 'OWNER' });
    expect(r.status).toBe(201);
    const { tempPassword } = (await r.json()) as { tempPassword: string };
    const login = await loginMobile({ email, password: tempPassword });
    expect(login.res.status).toBe(200);
    const me = (await (await api('/me', { headers: bearer(login.accessToken) })).json()) as { mustChangePassword: boolean; role: string; fullName: string };
    expect(me).toMatchObject({ mustChangePassword: true, role: 'OWNER', fullName: 'Nguyễn Văn Chủ' });
  });

  it('chủ lớp không tạo được tài khoản quản trị; email trùng bị từ chối', async () => {
    const owner = await createUser({ role: 'OWNER' });
    const r = await post('/users', { fullName: 'Ai Đó', email: `x${uid()}@test.vn`, role: 'ADMIN' }, await tokenOf(owner));
    expect(r.status).toBe(403);
    const dup = await post('/users', { fullName: 'Trùng Email', email: owner.email, role: 'OWNER' });
    expect(dup.status).toBe(409);
    expect(((await dup.json()) as Err).error.code).toBe('EMAIL_TAKEN');
  });
});

describe('Khóa, đổi vai trò, đăng xuất', () => {
  it('khóa tài khoản → phiên đang mở bị thu hồi, không đăng nhập được; mở lại thì được', async () => {
    const u = await createUser({ role: 'OWNER' });
    const t = await tokenOf(u);
    expect((await patch(`/users/${u.id}`, { status: 'DISABLED', reason: 'Nghỉ việc' })).status).toBe(200);
    expect((await api('/me', { headers: bearer(t) })).status).toBe(401);
    expect((await loginMobile(u)).res.status).toBe(403);
    expect((await patch(`/users/${u.id}`, { status: 'ACTIVE' })).status).toBe(200);
    expect((await loginMobile(u)).res.status).toBe(200);
  });

  it('không tự khóa / tự đổi vai trò', async () => {
    const r = await patch(`/users/${admin.id}`, { status: 'DISABLED' });
    expect(((await r.json()) as Err).error.code).toBe('SELF_CHANGE');
  });

  it('quản trị viên hạ quản trị viên khác xuống chủ lớp → mất quyền ngay, không quản lý được quản trị viên nữa', async () => {
    const other = await createUser({ role: 'ADMIN' });
    const ot = await tokenOf(other);
    expect((await patch(`/users/${other.id}`, { role: 'OWNER' })).status).toBe(200);
    expect((await api('/me', { headers: bearer(ot) })).status).toBe(401);
    const asOwner = await tokenOf(other);
    expect((await patch(`/users/${admin.id}`, { status: 'DISABLED' }, asOwner)).status).toBe(403);
    expect((await list_('?role=OWNER')).some((u) => u.id === other.id)).toBe(true);
  });

  it('chủ lớp không đổi vai trò, không khóa giáo viên qua trang tài khoản', async () => {
    const owner = await createUser({ role: 'OWNER' });
    const ot = await tokenOf(owner);
    const other = await createUser({ role: 'OWNER' });
    expect((await patch(`/users/${other.id}`, { role: 'ADMIN' }, ot)).status).toBe(403);
    const teacher = await createUser({ role: 'TEACHER' });
    const r = await patch(`/users/${teacher.id}`, { status: 'DISABLED' }, ot);
    expect(((await r.json()) as Err).error.code).toBe('USE_TEACHER_PAGE');
  });

  it('đăng xuất mọi thiết bị', async () => {
    const u = await createUser({ role: 'GUARDIAN' });
    const t1 = await tokenOf(u);
    const t2 = await tokenOf(u);
    expect((await post(`/users/${u.id}/revoke-sessions`, {})).status).toBe(200);
    for (const t of [t1, t2]) expect((await api('/me', { headers: bearer(t) })).status).toBe(401);
  });
});

describe('Cấp mật khẩu tạm', () => {
  it('chủ lớp KHÔNG đặt lại mật khẩu chủ lớp khác hay quản trị viên; được với giáo viên/phụ huynh', async () => {
    const owner = await createUser({ role: 'OWNER' });
    const ot = await tokenOf(owner);
    const other = await createUser({ role: 'OWNER' });
    expect((await post(`/users/${other.id}/reset-password`, {}, ot)).status).toBe(403);
    expect((await post(`/users/${admin.id}/reset-password`, {}, ot)).status).toBe(403);
    expect((await loginMobile(other)).res.status).toBe(200);
    const g = await createUser({ role: 'GUARDIAN' });
    const r = await post(`/users/${g.id}/reset-password`, {}, ot);
    expect(r.status).toBe(200);
    const { tempPassword } = (await r.json()) as { tempPassword: string };
    expect((await loginMobile({ email: g.email, password: tempPassword })).res.status).toBe(200);
    expect((await loginMobile(g)).res.status).toBe(401);
  });

  it('quản trị viên không đặt lại mật khẩu quản trị viên khác', async () => {
    const other = await createUser({ role: 'ADMIN' });
    expect((await post(`/users/${other.id}/reset-password`, {})).status).toBe(403);
  });
});

describe('Cấp tài khoản phụ huynh', () => {
  it('đăng nhập bằng SĐT với mật khẩu tạm, liên kết đúng phụ huynh, không cấp 2 lần', async () => {
    const g = await newGuardianId();
    const r = await post(`/guardians/${g.id}/account`, {});
    expect(r.status).toBe(201);
    const { login, tempPassword } = (await r.json()) as { login: string; tempPassword: string };
    expect(login).toBe(g.phone);
    const l = await api('/auth/login', json({ identifier: g.phone, password: tempPassword, client: 'MOBILE' }));
    expect(l.status).toBe(200);
    const { accessToken } = (await l.json()) as { accessToken: string };
    const me = (await (await api('/me', { headers: bearer(accessToken) })).json()) as { role: string; guardianId: number };
    expect(me).toMatchObject({ role: 'GUARDIAN', guardianId: g.id });
    const again = await post(`/guardians/${g.id}/account`, {});
    expect(((await again.json()) as Err).error.code).toBe('ALREADY_HAS_ACCOUNT');
  });

  it('giáo viên không cấp được tài khoản phụ huynh', async () => {
    const g = await newGuardianId();
    const teacher = await createUser({ role: 'TEACHER' });
    expect((await post(`/guardians/${g.id}/account`, {}, await tokenOf(teacher))).status).toBe(403);
  });
});

describe('Tên hiển thị', () => {
  it('người dùng tự đổi họ tên; hồ sơ giáo viên đổi theo', async () => {
    const r = await post('/teachers', { fullName: 'Giáo Viên Cũ', email: `gvten${uid()}@test.vn` });
    const { tempPassword } = (await r.json()) as { tempPassword: string };
    const list = await list_('?role=TEACHER');
    const t = list.find((u) => u.email?.startsWith('gvten'))!;
    await env.DB.prepare(`UPDATE users SET must_change_password = 0 WHERE id = ?1`).bind(t.id).run();
    const tok = await tokenOf({ id: t.id, email: t.email!, password: tempPassword });
    expect((await patch('/me', { fullName: 'nguyễn thị mới' }, tok)).status).toBe(200);
    const me = (await (await api('/me', { headers: bearer(tok) })).json()) as { fullName: string };
    expect(me.fullName).toBe('Nguyễn Thị Mới');
    const teachers = (await (await api('/teachers?includeInactive=1', { headers: bearer(adminToken) })).json()) as { data: { userId: number; fullName: string }[] };
    expect(teachers.data.find((x) => x.userId === t.id)?.fullName).toBe('Nguyễn Thị Mới');
  });

  it('quản trị viên đổi tên/địa chỉ/SĐT trung tâm; chủ lớp không được', async () => {
    const owner = await createUser({ role: 'OWNER' });
    const body = { name: 'English Maison', address: '12 Lê Lợi, Huế', phone: '0234 3888 999' };
    expect((await patch('/settings/center', body, await tokenOf(owner))).status).toBe(403);
    expect((await patch('/settings/center', body)).status).toBe(200);
    const pub = (await (await api('/settings/public', { headers: bearer(adminToken) })).json()) as Record<string, string>;
    expect(pub).toMatchObject({ center_name: 'English Maison', center_address: '12 Lê Lợi, Huế', center_phone: '0234 3888 999' });
    expect((await patch('/settings/center', { name: 'X', address: null, phone: null })).status).toBe(422);
  });
});
