import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { addDays, vnDate } from '@ecm/shared';
import { api, bearer, createUser, json, loginMobile } from './helpers';

type Err = { error: { code: string } };
let admin: string;
let n = 0;
const uid = () => `${Date.now().toString(36)}${++n}`;
const today = vnDate();
const post = (p: string, b: unknown, t = admin) => api(p, json(b, { headers: bearer(t) }));
const patch = (p: string, b: unknown, t = admin) => api(p, { ...json(b, { headers: bearer(t) }), method: 'PATCH' });
const get = async <T = any>(p: string, t = admin) => (await (await api(p, { headers: bearer(t) })).json()) as T;
const status = async (p: string, t: string) => (await api(p, { headers: bearer(t) })).status;

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const PDF = new TextEncoder().encode('%PDF-1.4\n%test');
const jpg = (name = 'anh.jpg') => new File([JPEG], name, { type: 'image/jpeg' });
function form(fields: Record<string, string>, files: File[] = []) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  for (const file of files) f.append('files', file);
  return f;
}
const send = (p: string, body: FormData, t: string) => api(p, { method: 'POST', headers: bearer(t), body });

async function tokenFor(login: string, password: string) {
  await env.DB.prepare(`UPDATE users SET must_change_password = 0 WHERE email = ?1 OR phone = ?1`).bind(login).run();
  const r = await api('/auth/login', json({ identifier: login, password, client: 'MOBILE' }));
  return ((await r.json()) as { accessToken: string }).accessToken;
}
async function newTeacher() {
  const email = `gv${uid()}@t.vn`;
  const r = (await (await post('/teachers', { fullName: 'Giáo Viên Lớp', email })).json()) as { id: number; tempPassword: string };
  return { id: r.id, token: await tokenFor(email, r.tempPassword) };
}
async function newClass(teacherId: number) {
  const sh = ((await (await post('/shifts', { name: `C${uid()}`, startTime: '04:00', endTime: '05:00' })).json()) as { id: number }).id;
  const r = await post('/classes', { classCode: `N${uid()}`, name: `Lớp ${uid()}`, mainTeacherId: teacherId, maxStudents: 9, startDate: '2026-09-01', schedules: [{ shiftId: sh, weekday: 7 }] });
  return ((await r.json()) as { id: number }).id;
}
/** Student enrolled in the class from `start`, with a guardian account; returns tokens/ids. */
async function family(classId: number, start = '2026-09-01') {
  const phone = `09${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  const sid = ((await (await post('/students', { fullName: 'Học Sinh Lớp', startDate: '2026-01-01', guardians: [{ guardian: { fullName: 'Phụ Huynh', phone } }] })).json()) as { id: number }).id;
  await env.DB.prepare(`INSERT INTO class_enrollments (class_id, student_id, start_date, status) VALUES (?, ?, ?, 'ACTIVE')`).bind(classId, sid, start).run();
  const gid = (await get<{ guardians: { id: number }[] }>(`/students/${sid}`)).guardians[0]!.id;
  const acc = (await (await post(`/guardians/${gid}/account`, {})).json()) as { login: string; tempPassword: string };
  return { sid, gid, phone, token: await tokenFor(acc.login, acc.tempPassword) };
}

let teacher: { id: number; token: string };
let classId: number;
let a: Awaited<ReturnType<typeof family>>;
let b: Awaited<ReturnType<typeof family>>;
let other: Awaited<ReturnType<typeof family>>;

beforeAll(async () => {
  admin = (await loginMobile(await createUser({ role: 'ADMIN' }))).accessToken;
  teacher = await newTeacher();
  classId = await newClass(teacher.id);
  a = await family(classId);
  b = await family(classId);
  const t2 = await newTeacher();
  other = await family(await newClass(t2.id));
});

describe('Nhật ký lớp', () => {
  it('giáo viên đăng ảnh; phụ huynh trong lớp xem được, phụ huynh lớp khác thì không', async () => {
    const r = await send(`/classes/${classId}/posts`, form({ content: 'Hôm nay học chủ đề Animals' }, [jpg(), jpg('b.jpg')]), teacher.token);
    expect(r.status).toBe(201);
    const postId = ((await r.json()) as { id: number }).id;

    const feed = (await get<{ data: { id: number; content: string; photos: { id: number }[] }[] }>(`/students/${a.sid}/class-posts`, a.token)).data;
    expect(feed.map((p) => p.id)).toContain(postId);
    const photo = feed.find((p) => p.id === postId)!.photos[0]!.id;
    expect(feed.find((p) => p.id === postId)!.photos).toHaveLength(2);
    expect(await status(`/files/${photo}/content`, a.token)).toBe(200);
    expect(await status(`/files/${photo}/content`, other.token)).toBe(404);
    expect((await get<{ data: unknown[] }>(`/classes/${classId}/posts`, other.token)).data).toEqual([]);
    expect(await status(`/students/${a.sid}/class-posts`, other.token)).toBe(404);

    const notif = await env.DB.prepare(`SELECT data FROM notifications WHERE user_id = (SELECT id FROM users WHERE phone = ?) AND type = 'SYSTEM'`).bind(a.phone).first<{ data: string }>();
    expect(JSON.parse(notif!.data)).toMatchObject({ kind: 'CLASS_POST', classId });
  });

  it('học sinh vào lớp sau không thấy ảnh đăng trước ngày vào lớp', async () => {
    const late = await family(classId, addDays(today, 1));
    await send(`/classes/${classId}/posts`, form({ content: 'Buổi trước khi bạn mới vào' }, [jpg()]), teacher.token);
    expect((await get<{ data: unknown[] }>(`/students/${late.sid}/class-posts`, late.token)).data).toEqual([]);
  });

  it('chỉ giáo viên của lớp được đăng; tệp không phải ảnh bị từ chối; ngày tương lai bị từ chối', async () => {
    const outsider = await newTeacher();
    expect((await send(`/classes/${classId}/posts`, form({ content: 'x' }), outsider.token)).status).toBe(403);
    expect((await send(`/classes/${classId}/posts`, form({ content: 'x' }), a.token)).status).toBe(403);
    const bad = await send(`/classes/${classId}/posts`, form({ content: 'x' }, [new File(['<html>'], 'a.jpg', { type: 'image/jpeg' })]), teacher.token);
    expect(bad.status).toBe(422);
    const future = await send(`/classes/${classId}/posts`, form({ content: 'x', postDate: addDays(today, 2) }), teacher.token);
    expect(future.status).toBe(422);
  });

  it('cờ "Không đăng ảnh" hiện cho giáo viên khi đăng bài', async () => {
    const v = (await get<{ version: number }>(`/students/${b.sid}`)).version;
    expect((await patch(`/students/${b.sid}`, { photoConsent: false, version: v })).status).toBe(200);
    const list = (await get<{ data: { id: number }[] }>(`/classes/${classId}/no-photo-students`, teacher.token)).data;
    expect(list.map((s) => s.id)).toEqual([b.sid]);
  });

  it('người đăng xóa được bài; ảnh không còn đọc được', async () => {
    const id = ((await (await send(`/classes/${classId}/posts`, form({ content: 'Xóa thử' }, [jpg()]), teacher.token)).json()) as { id: number }).id;
    const p = (await get<{ data: { id: number; photos: { id: number }[] }[] }>(`/classes/${classId}/posts`, teacher.token)).data.find((x) => x.id === id)!;
    expect((await api(`/class-posts/${id}`, { method: 'DELETE', headers: bearer(teacher.token) })).status).toBe(200);
    expect(await status(`/files/${p.photos[0]!.id}/content`, a.token)).toBe(404);
  });
});

describe('Bài tập', () => {
  let hw: number;
  it('giao bài kèm PDF → phụ huynh thấy trong danh sách bài của con', async () => {
    const r = await send(`/classes/${classId}/homework`, form({ title: 'Workbook trang 12', description: 'Làm bài 1, 2', dueDate: addDays(today, 3) }, [new File([PDF], 'de.pdf', { type: 'application/pdf' })]), teacher.token);
    expect(r.status).toBe(201);
    hw = ((await r.json()) as { id: number }).id;
    const list = (await get<{ data: { id: number; submittedAt: string | null }[] }>(`/students/${a.sid}/homework`, a.token)).data;
    expect(list.find((h) => h.id === hw)).toMatchObject({ submittedAt: null });
    const d = await get<{ attachments: { id: number; mimeType: string }[]; students: unknown[] }>(`/homework/${hw}`, a.token);
    expect(d.attachments[0]!.mimeType).toBe('application/pdf');
    expect(d.students).toHaveLength(1); // phụ huynh chỉ thấy con mình
    expect(await status(`/homework/${hw}`, other.token)).toBe(404);
  });

  it('phụ huynh nộp ảnh bài làm cho con mình; không nộp thay con người khác', async () => {
    expect((await send(`/homework/${hw}/submissions`, form({ studentId: String(a.sid), note: 'Con làm xong rồi ạ' }, [jpg()]), a.token)).status).toBe(201);
    expect((await send(`/homework/${hw}/submissions`, form({ studentId: String(b.sid) }, [jpg()]), a.token)).status).toBe(404);
    expect(((await (await send(`/homework/${hw}/submissions`, form({ studentId: String(a.sid) }), a.token)).json()) as Err).error.code).toBe('VALIDATION_ERROR');
    expect((await send(`/homework/${hw}/submissions`, form({ studentId: String(a.sid) }, [jpg()]), teacher.token)).status).toBe(403);
  });

  it('giáo viên xem bài nộp + ảnh, chấm Đã làm / Chưa làm (kể cả em không nộp online); đã chấm thì không nộp lại', async () => {
    const d = await get<{ students: { studentId: number; submittedAt: string | null; note: string | null; photos: { id: number }[] }[] }>(`/homework/${hw}`, teacher.token);
    const rowA = d.students.find((s) => s.studentId === a.sid)!;
    expect(rowA).toMatchObject({ note: 'Con làm xong rồi ạ' });
    expect(rowA.photos).toHaveLength(1);
    expect(await status(`/files/${rowA.photos[0]!.id}/content`, teacher.token)).toBe(200);
    expect(await status(`/files/${rowA.photos[0]!.id}/content`, b.token)).toBe(404);

    expect((await post(`/homework/${hw}/review`, { studentId: a.sid, result: 'DONE', comment: 'Làm tốt' }, teacher.token)).status).toBe(200);
    expect((await post(`/homework/${hw}/review`, { studentId: b.sid, result: 'NOT_DONE' }, teacher.token)).status).toBe(200);
    expect((await post(`/homework/${hw}/review`, { studentId: other.sid, result: 'DONE' }, teacher.token)).status).toBe(422);
    expect(((await (await send(`/homework/${hw}/submissions`, form({ studentId: String(a.sid) }, [jpg()]), a.token)).json()) as Err).error.code).toBe('ALREADY_REVIEWED');

    const mine = (await get<{ data: { id: number; result: string; teacherComment: string }[] }>(`/students/${a.sid}/homework`, a.token)).data.find((h) => h.id === hw);
    expect(mine).toMatchObject({ result: 'DONE', teacherComment: 'Làm tốt' });
    const list = (await get<{ data: { id: number; submitted: number; done: number }[] }>(`/classes/${classId}/homework`, teacher.token)).data.find((h) => h.id === hw);
    expect(list).toMatchObject({ submitted: 1, done: 1 });
  });
});

describe('Ảnh đại diện phụ huynh', () => {
  it('phụ huynh tự tải ảnh; quản lý/giáo viên của con thấy, phụ huynh khác không', async () => {
    const r = await send('/me/avatar', form({}, [jpg()]), a.token);
    expect(r.status).toBe(201);
    const fileId = ((await r.json()) as { fileId: number }).fileId;
    expect((await get<{ avatarFileId: number | null }>('/me', a.token)).avatarFileId).toBe(fileId);
    const detail = await get<{ guardians: { id: number; avatarFileId: number | null }[] }>(`/students/${a.sid}`);
    expect(detail.guardians[0]!.avatarFileId).toBe(fileId);
    expect(await status(`/files/${fileId}/content`, teacher.token)).toBe(200);
    expect(await status(`/files/${fileId}/content`, admin)).toBe(200);
    expect(await status(`/files/${fileId}/content`, other.token)).toBe(404);
    // ảnh mới thay ảnh cũ
    const r2 = await send('/me/avatar', form({}, [jpg()]), a.token);
    const newId = ((await r2.json()) as { fileId: number }).fileId;
    expect(await status(`/files/${fileId}/content`, admin)).toBe(404);
    expect((await get<{ guardians: { avatarFileId: number }[] }>(`/students/${a.sid}`)).guardians[0]!.avatarFileId).toBe(newId);
  });
});
