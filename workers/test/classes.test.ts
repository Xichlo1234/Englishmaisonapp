import { createExecutionContext, createScheduledController, env, waitOnExecutionContext } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { addDays, isoWeekday, vnDate } from '@ecm/shared';
import worker from '../src/index';
import { api, bearer, createUser, json, loginMobile } from './helpers';

type Err = { error: { code: string; message: string } };
let admin: string;
let seq = 0;
const uid = () => `${Date.now().toString(36)}${++seq}`;
const today = vnDate();

const post = (path: string, body: unknown, token = admin) => api(path, json(body, { headers: bearer(token) }));
const patch = (path: string, body: unknown, token = admin) => api(path, { ...json(body, { headers: bearer(token) }), method: 'PATCH' });
const get = async <T = any>(path: string, token = admin) => (await (await api(path, { headers: bearer(token) })).json()) as T;

async function newTeacher(name = 'Giáo viên') {
  const r = await post('/teachers', { fullName: `${name} ${uid()}`, email: `gv${uid()}@test.vn` });
  expect(r.status).toBe(201);
  return (await r.json()) as { id: number; teacherCode: string; tempPassword: string };
}

async function newShift(start: string, end: string) {
  const r = await post('/shifts', { name: `Ca ${uid()}`, startTime: start, endTime: end });
  expect(r.status).toBe(201);
  return ((await r.json()) as { id: number }).id;
}

async function newRoom() {
  const r = await post('/rooms', { name: `P${uid()}`, capacity: 20 });
  return ((await r.json()) as { id: number }).id;
}

async function newClass(body: Record<string, unknown>) {
  const r = await post('/classes', { classCode: `L${uid()}`, name: 'Lớp kiểm thử', maxStudents: 3, startDate: '2026-11-02', ...body });
  return { r, body: (await r.json()) as { id: number } & Err };
}

async function newStudent(name = 'Học Sinh') {
  const r = await post('/students', {
    fullName: `${name} ${uid()}`.replace(/\d/g, 'x'),
    startDate: '2026-09-01',
    guardians: [{ guardian: { fullName: 'Phụ Huynh', phone: `09${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}` } }],
  });
  expect(r.status).toBe(201);
  return ((await r.json()) as { id: number }).id;
}

const classVersion = async (id: number) => (await get<{ version: number }>(`/classes/${id}`)).version;
const open = async (id: number) => post(`/classes/${id}/open`, { version: await classVersion(id) });

function countWeekdays(from: string, to: string, weekdays: number[]) {
  let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) if (weekdays.includes(isoWeekday(d))) n++;
  return n;
}

beforeAll(async () => {
  admin = (await loginMobile(await createUser({ role: 'ADMIN' }))).accessToken;
});

describe('Giáo viên', () => {
  it('tạo giáo viên kèm tài khoản, mật khẩu tạm đăng nhập được và bắt buộc đổi', async () => {
    const t = await newTeacher();
    expect(t.teacherCode).toMatch(/^GV\d{3}$/);
    expect(t.tempPassword).toMatch(/^[A-Za-z][A-Za-z0-9]{8}\d$/);
    const list = await get<{ data: { id: number; email: string }[] }>('/teachers');
    const email = list.data.find((x) => x.id === t.id)!.email;
    const login = await loginMobile({ email, password: t.tempPassword });
    expect(login.res.status).toBe(200);
    expect((login as any).user.mustChangePassword).toBe(true);
  });

  it('trùng email → 409; thiếu cả email và SĐT → 422', async () => {
    const email = `dup${uid()}@test.vn`;
    expect((await post('/teachers', { fullName: 'Nguyễn A', email })).status).toBe(201);
    expect((await post('/teachers', { fullName: 'Nguyễn B', email })).status).toBe(409);
    expect((await post('/teachers', { fullName: 'Nguyễn C' })).status).toBe(422);
  });

  it('ngừng làm việc: khóa đăng nhập; bị chặn nếu còn lịch dạy', async () => {
    const t = await newTeacher();
    const shift = await newShift('07:00', '08:00');
    const { body } = await newClass({ mainTeacherId: t.id, schedules: [{ shiftId: shift, weekday: 1 }] });
    const blocked = await post(`/teachers/${t.id}/deactivate`, {});
    expect(blocked.status).toBe(422);
    expect(((await blocked.json()) as Err).error.code).toBe('TEACHER_HAS_SCHEDULES');
    const t2 = await newTeacher();
    expect((await post(`/teachers/${t2.id}/deactivate`, {})).status).toBe(200);
    const list = await get<{ data: { id: number; email: string }[] }>('/teachers?all=1');
    const email = list.data.find((x) => x.id === t2.id)!.email;
    expect((await loginMobile({ email, password: t2.tempPassword })).res.status).toBe(403);
    expect(body.id).toBeGreaterThan(0);
  });
});

describe('Ca học', () => {
  it('giờ kết thúc phải sau giờ bắt đầu; tên ca không trùng', async () => {
    expect((await post('/shifts', { name: `X${uid()}`, startTime: '15:00', endTime: '14:00' })).status).toBe(422);
    const name = `Ca ${uid()}`;
    expect((await post('/shifts', { name, startTime: '08:00', endTime: '09:00' })).status).toBe(201);
    expect((await post('/shifts', { name, startTime: '10:00', endTime: '11:00' })).status).toBe(409);
  });

  it('ca mẫu theo yêu cầu đã có sẵn', async () => {
    const { data } = await get<{ data: { name: string; startTime: string; endTime: string }[] }>('/shifts');
    expect(data.slice(0, 3).map((s) => `${s.name} ${s.startTime}-${s.endTime}`)).toEqual([
      'Ca 1 14:00-15:30',
      'Ca 2 16:00-17:30',
      'Ca 3 18:00-20:00',
    ]);
  });
});

describe('Trùng lịch giáo viên & phòng', () => {
  it('chặn trùng giáo viên cùng thứ, giờ giao nhau; cho phép khác ngày hiệu lực', async () => {
    const t = await newTeacher();
    const a = await newShift('09:00', '10:30');
    const b = await newShift('10:00', '11:00');
    const c1 = await newClass({ mainTeacherId: t.id, schedules: [{ shiftId: a, weekday: 2 }] });
    expect(c1.r.status).toBe(201);
    const c2 = await newClass({ mainTeacherId: t.id, schedules: [{ shiftId: b, weekday: 2 }] });
    expect(c2.r.status).toBe(409);
    expect(c2.body.error.code).toBe('SCHEDULE_CONFLICT');
    expect(c2.body.error.message).toContain('Giáo viên');
    // khác thứ → được
    expect((await newClass({ mainTeacherId: t.id, schedules: [{ shiftId: b, weekday: 3 }] })).r.status).toBe(201);
    // lớp đầu kết thúc trước → không trùng
    const t2 = await newTeacher();
    const early = await newClass({ mainTeacherId: t2.id, endDate: '2026-12-31', schedules: [{ shiftId: a, weekday: 4 }] });
    expect(early.r.status).toBe(201);
    expect((await newClass({ mainTeacherId: t2.id, startDate: '2027-01-01', schedules: [{ shiftId: b, weekday: 4 }] })).r.status).toBe(201);
  });

  it('chặn trùng phòng; kiểm tra trùng trước khi lưu', async () => {
    const room = await newRoom();
    const s = await newShift('06:00', '07:00');
    const t1 = await newTeacher();
    const t2 = await newTeacher();
    expect((await newClass({ mainTeacherId: t1.id, schedules: [{ shiftId: s, weekday: 6, roomId: room }] })).r.status).toBe(201);
    const check = await post('/schedules/check-conflicts', {
      teacherId: t2.id,
      effectiveFrom: '2026-11-02',
      schedules: [{ shiftId: s, weekday: 6, roomId: room }],
    });
    const { conflicts } = (await check.json()) as { conflicts: { kind: string }[] };
    expect(conflicts.map((c) => c.kind)).toEqual(['ROOM']);
    expect((await newClass({ mainTeacherId: t2.id, schedules: [{ shiftId: s, weekday: 6, roomId: room }] })).r.status).toBe(409);
  });
});

describe('Mở lớp & sinh buổi học', () => {
  it('không mở được lớp chưa có lịch; mở lớp sinh đúng buổi theo thứ trong tuần', async () => {
    const t = await newTeacher();
    const empty = await newClass({ mainTeacherId: t.id });
    const r = await open(empty.body.id);
    expect(r.status).toBe(422);
    expect(((await r.json()) as Err).error.code).toBe('NO_SCHEDULE');

    const s = await newShift('05:00', '06:00');
    const { body } = await newClass({ mainTeacherId: t.id, schedules: [{ shiftId: s, weekday: 1 }, { shiftId: s, weekday: 3 }] });
    expect((await open(body.id)).status).toBe(200);
    const lessons = await get<{ data: { lessonDate: string; startTime: string }[] }>(`/classes/${body.id}/lessons?from=2026-11-01&to=${addDays(today, 70)}`);
    const expected = countWeekdays('2026-11-02', addDays(today, 56), [1, 3]);
    expect(lessons.data).toHaveLength(expected);
    expect(lessons.data.every((l) => [1, 3].includes(isoWeekday(l.lessonDate)) && l.startTime === '05:00')).toBe(true);
    expect(lessons.data[0]!.lessonDate).toBe('2026-11-02');

    // Mở lại / sinh lại không tạo trùng (cron)
    const ctrl = createScheduledController({ cron: '0 17 * * *', scheduledTime: Date.now() });
    const ctx = createExecutionContext();
    await worker.scheduled(ctrl, env, ctx);
    await waitOnExecutionContext(ctx);
    const after = await get<{ data: unknown[] }>(`/classes/${body.id}/lessons?from=2026-11-01&to=${addDays(today, 70)}`);
    expect(after.data).toHaveLength(expected);
  });

  it('đổi giờ ca: chỉ áp dụng cho buổi chưa diễn ra', async () => {
    const t = await newTeacher();
    const s = await newShift('04:00', '05:00');
    const { body } = await newClass({ mainTeacherId: t.id, schedules: [{ shiftId: s, weekday: isoWeekday(today) }] });
    await open(body.id);
    const r = await patch(`/shifts/${s}`, { startTime: '04:15', endTime: '05:15' });
    expect(r.status).toBe(200);
    const { data } = await get<{ data: { lessonDate: string; startTime: string }[] }>(`/classes/${body.id}/lessons?from=2026-11-01&to=${addDays(today, 70)}`);
    expect(data.filter((l) => l.lessonDate < today).every((l) => l.startTime === '04:00')).toBe(true);
    expect(data.filter((l) => l.lessonDate >= today).every((l) => l.startTime === '04:15')).toBe(true);
  });

  it('kết thúc lịch: xóa buổi tương lai chưa điểm danh', async () => {
    const t = await newTeacher();
    const s = await newShift('03:00', '04:00');
    const { body } = await newClass({ mainTeacherId: t.id, schedules: [{ shiftId: s, weekday: 5 }] });
    await open(body.id);
    const detail = await get<{ schedules: { id: number }[] }>(`/classes/${body.id}`);
    const end = addDays(today, 7);
    expect((await post(`/schedules/${detail.schedules[0]!.id}/end`, { effectiveTo: end })).status).toBe(200);
    const { data } = await get<{ data: { lessonDate: string }[] }>(`/classes/${body.id}/lessons?from=2026-11-01&to=${addDays(today, 70)}`);
    expect(data.every((l) => l.lessonDate <= end)).toBe(true);
  });
});

describe('Xếp lớp, sĩ số, chuyển lớp/ca', () => {
  it('chặn vượt sĩ số; quản trị viên vượt được khi có lý do', async () => {
    const t = await newTeacher();
    const s = await newShift('20:00', '21:00');
    const { body } = await newClass({ mainTeacherId: t.id, maxStudents: 2, schedules: [{ shiftId: s, weekday: 7 }] });
    const ids = [await newStudent(), await newStudent(), await newStudent()];
    expect((await post(`/classes/${body.id}/enrollments`, { studentIds: ids.slice(0, 2), startDate: '2026-11-02' })).status).toBe(201);
    const full = await post(`/classes/${body.id}/enrollments`, { studentIds: [ids[2]], startDate: '2026-11-02' });
    expect(full.status).toBe(422);
    expect(((await full.json()) as Err).error.code).toBe('CLASS_FULL');
    expect((await post(`/classes/${body.id}/enrollments`, { studentIds: [ids[2]], startDate: '2026-11-02', overrideCapacityReason: 'Học sinh cũ quay lại' })).status).toBe(201);
    expect((await get<{ students: unknown[] }>(`/classes/${body.id}`)).students).toHaveLength(3);
  });

  it('chặn học sinh trùng giờ giữa hai lớp; học sinh tạm nghỉ không xếp lớp được', async () => {
    const s = await newShift('21:00', '22:00');
    const c1 = await newClass({ mainTeacherId: (await newTeacher()).id, schedules: [{ shiftId: s, weekday: 2 }] });
    const c2 = await newClass({ mainTeacherId: (await newTeacher()).id, schedules: [{ shiftId: s, weekday: 2 }] });
    const sid = await newStudent();
    expect((await post(`/classes/${c1.body.id}/enrollments`, { studentIds: [sid], startDate: '2026-11-02' })).status).toBe(201);
    const r = await post(`/classes/${c2.body.id}/enrollments`, { studentIds: [sid], startDate: '2026-11-02' });
    expect(r.status).toBe(422);
    expect(((await r.json()) as Err).error.message).toContain('trùng giờ');

    const paused = await newStudent();
    await post(`/students/${paused}/pause`, { effectiveDate: today, reason: 'Nghỉ ốm', version: 0 });
    expect((await post(`/classes/${c2.body.id}/enrollments`, { studentIds: [paused], startDate: '2026-11-02' })).status).toBe(422);
  });

  it('chuyển ca: lịch sử được giữ, điểm danh cũ không đổi, danh sách theo ngày đúng lớp', async () => {
    const tA = await newTeacher();
    const tB = await newTeacher();
    const s1 = await newShift('12:00', '13:00');
    const s2 = await newShift('13:00', '14:00');
    const from = await newClass({ mainTeacherId: tA.id, schedules: [{ shiftId: s1, weekday: 1 }] });
    const to = await newClass({ mainTeacherId: tB.id, schedules: [{ shiftId: s2, weekday: 1 }] });
    await open(from.body.id);
    await open(to.body.id);
    const sid = await newStudent();
    await post(`/classes/${from.body.id}/enrollments`, { studentIds: [sid], startDate: '2026-11-02' });
    const enrollmentId = (await get<{ students: { enrollmentId: number }[] }>(`/classes/${from.body.id}`)).students[0]!.enrollmentId;

    // điểm danh buổi 02/11 ở lớp cũ
    const lesson = await env.DB.prepare(`SELECT id FROM lessons WHERE class_id = ? AND lesson_date = '2026-11-02'`).bind(from.body.id).first<{ id: number }>();
    const marker = await createUser({ role: 'ADMIN' });
    await env.DB.prepare(`INSERT INTO attendance_records (lesson_id, student_id, enrollment_id, status, marked_by, marked_at) VALUES (?, ?, ?, 'PRESENT', ?, '2026-11-02T08:00:00Z')`)
      .bind(lesson!.id, sid, enrollmentId, marker.id)
      .run();

    // ngày chuyển trước buổi đã điểm danh → chặn
    const bad = await post(`/enrollments/${enrollmentId}/transfer`, { toClassId: to.body.id, effectiveDate: '2026-11-02', reason: 'Đổi giờ học' });
    expect(bad.status).toBe(422);
    const ok = await post(`/enrollments/${enrollmentId}/transfer`, { toClassId: to.body.id, effectiveDate: '2026-11-09', reason: 'Đổi giờ học' });
    expect(ok.status).toBe(200);

    const st = await get<{ enrollments: { classId: number; status: string; endDate: string | null; endReason: string | null; transferredFromId: number | null }[] }>(`/students/${sid}`);
    const old = st.enrollments.find((e) => e.classId === from.body.id)!;
    const neu = st.enrollments.find((e) => e.classId === to.body.id)!;
    expect(old).toMatchObject({ status: 'ENDED', endDate: '2026-11-08', endReason: 'TRANSFER' });
    expect(neu).toMatchObject({ status: 'ACTIVE', transferredFromId: enrollmentId });

    const att = await env.DB.prepare('SELECT status, lesson_id FROM attendance_records WHERE student_id = ?').bind(sid).all();
    expect(att.results).toEqual([{ status: 'PRESENT', lesson_id: lesson!.id }]);

    const roster = async (classId: number, date: string) =>
      (await env.DB.prepare(`SELECT count(*) n FROM class_enrollments WHERE class_id = ? AND student_id = ? AND start_date <= ? AND (end_date IS NULL OR end_date >= ?)`)
        .bind(classId, sid, date, date)
        .first<{ n: number }>())!.n;
    expect(await roster(from.body.id, '2026-11-02')).toBe(1);
    expect(await roster(to.body.id, '2026-11-02')).toBe(0);
    expect(await roster(from.body.id, '2026-11-09')).toBe(0);
    expect(await roster(to.body.id, '2026-11-09')).toBe(1);

    const timeline = await get<{ data: { action: string }[] }>(`/students/${sid}/timeline`);
    expect(timeline.data.map((x) => x.action)).toContain('enrollment.transfer');
    const hist = await get<{ data: { toClassCode: string | null }[] }>(`/classes/${from.body.id}/enrollment-history`);
    expect(hist.data[0]!.toClassCode).toBeTruthy();
  });
});

describe('Đóng lớp & buổi học', () => {
  it('đóng lớp bị chặn khi còn buổi đã qua chưa điểm danh; hủy các buổi đó thì đóng được', async () => {
    const t = await newTeacher();
    const s = await newShift('01:00', '02:00');
    const { body } = await newClass({ mainTeacherId: t.id, schedules: [{ shiftId: s, weekday: 1 }] });
    await open(body.id);
    const sid = await newStudent();
    await post(`/classes/${body.id}/enrollments`, { studentIds: [sid], startDate: '2026-11-02' });
    const blocked = await post(`/classes/${body.id}/close`, { closeDate: today, reason: 'Kết thúc khóa', version: await classVersion(body.id) });
    expect(blocked.status).toBe(422);
    expect(((await blocked.json()) as Err).error.code).toBe('PENDING_ATTENDANCE');

    const past = await get<{ data: { id: number; lessonDate: string; version: number }[] }>(`/classes/${body.id}/lessons?from=2026-11-01&to=${addDays(today, -1)}`);
    for (const l of past.data) expect((await patch(`/lessons/${l.id}`, { cancel: { reason: 'Nghỉ lễ' }, version: l.version })).status).toBe(200);
    const closed = await post(`/classes/${body.id}/close`, { closeDate: today, reason: 'Kết thúc khóa', version: await classVersion(body.id) });
    expect(closed.status).toBe(200);
    const d = await get<{ status: string; students: unknown[] }>(`/classes/${body.id}`);
    expect(d.status).toBe('CLOSED');
    expect(d.students).toHaveLength(0);
    const future = await get<{ data: unknown[] }>(`/classes/${body.id}/lessons?from=${addDays(today, 1)}&to=${addDays(today, 70)}`);
    expect(future.data).toHaveLength(0);
    const e = await env.DB.prepare('SELECT end_reason FROM class_enrollments WHERE student_id = ?').bind(sid).first<{ end_reason: string }>();
    expect(e!.end_reason).toBe('CLASS_CLOSED');
  });

  it('buổi bù và dạy thay kiểm tra trùng giáo viên', async () => {
    const tA = await newTeacher();
    const tB = await newTeacher();
    const s = await newShift('22:00', '23:00');
    const a = await newClass({ mainTeacherId: tA.id, schedules: [{ shiftId: s, weekday: 2 }] });
    const b = await newClass({ mainTeacherId: tB.id, schedules: [{ shiftId: s, weekday: 2 }] });
    await open(a.body.id);
    await open(b.body.id);
    const date = addDays(today, 14 - ((isoWeekday(today) + 5) % 7)); // một thứ Ba trong tương lai
    expect(isoWeekday(date)).toBe(2);
    const lessonA = (await get<{ data: { id: number; lessonDate: string; version: number }[] }>(`/classes/${a.body.id}/lessons?from=${date}&to=${date}`)).data[0]!;
    const sub = await patch(`/lessons/${lessonA.id}`, { teacherId: tB.id, version: lessonA.version });
    expect(sub.status).toBe(409);
    const makeup = await post(`/classes/${a.body.id}/lessons`, { lessonDate: date, startTime: '22:30', endTime: '23:30', teacherId: tB.id });
    expect(makeup.status).toBe(409);
    expect((await post(`/classes/${a.body.id}/lessons`, { lessonDate: addDays(date, 1), startTime: '22:30', endTime: '23:30', teacherId: tB.id })).status).toBe(201);
  });
});

describe('Phân quyền lớp học', () => {
  it('giáo viên chỉ thấy lớp & lịch của mình, không tạo lớp/xếp lớp', async () => {
    const t = await newTeacher();
    const other = await newTeacher();
    const s = await newShift('23:00', '23:30');
    const mine = await newClass({ mainTeacherId: t.id, schedules: [{ shiftId: s, weekday: 1 }] });
    const theirs = await newClass({ mainTeacherId: other.id, schedules: [{ shiftId: s, weekday: 3 }] });
    await open(mine.body.id);
    await open(theirs.body.id);
    const email = (await get<{ data: { id: number; email: string }[] }>('/teachers')).data.find((x) => x.id === t.id)!.email;
    const s1 = await loginMobile({ email, password: t.tempPassword });
    await post('/me/change-password', { currentPassword: t.tempPassword, newPassword: 'GiaoVien2026' }, s1.accessToken);
    const token = s1.accessToken;

    const list = await get<{ data: { id: number }[] }>('/classes', token);
    expect(list.data.map((c) => c.id)).toEqual([mine.body.id]);
    expect((await api(`/classes/${theirs.body.id}`, { headers: bearer(token) })).status).toBe(404);
    const cal = await get<{ data: { classId: number }[] }>(`/calendar?from=${today}&to=${addDays(today, 13)}`, token);
    expect(cal.data.length).toBeGreaterThan(0);
    expect(cal.data.every((l) => l.classId === mine.body.id)).toBe(true);
    expect((await post('/classes', { classCode: 'X1', name: 'x', mainTeacherId: t.id, maxStudents: 5, startDate: today }, token)).status).toBe(403);
    expect((await post(`/classes/${mine.body.id}/enrollments`, { studentIds: [1], startDate: today }, token)).status).toBe(403);
    // danh sách giáo viên rút gọn, không lộ email/SĐT
    const tl = await get<{ data: Record<string, unknown>[] }>('/teachers', token);
    expect(tl.data[0]).not.toHaveProperty('email');
  });
});
