import { createExecutionContext, createScheduledController, env, waitOnExecutionContext } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { addDays, isoWeekday, vnDate } from '@ecm/shared';
import worker from '../src/index';
import { api, bearer, createUser, json, loginMobile } from './helpers';

type Err = { error: { code: string; message: string } };
let admin: string;
let n = 0;
const uid = () => `${Date.now().toString(36)}${++n}`;
const today = vnDate();
const post = (p: string, body: unknown, t = admin) => api(p, json(body, { headers: bearer(t) }));
const put = (p: string, body: unknown, t = admin) => api(p, { ...json(body, { headers: bearer(t) }), method: 'PUT' });
const get = async <T = any>(p: string, t = admin) => (await (await api(p, { headers: bearer(t) })).json()) as T;

interface Ctx {
  classId: number;
  teacherToken: string;
  students: number[];
  todayLesson: number;
  pastLesson: number;
  futureLesson: number;
  guardianToken: string;
}

/** Lớp có lịch đúng thứ hôm nay, bắt đầu 3 tuần trước, ca 00:05–00:35 (luôn đã tới giờ mở điểm danh trong ngày). */
async function setup(): Promise<Ctx> {
  const t = (await (await post('/teachers', { fullName: `GV ${uid()}`, email: `gv${uid()}@t.vn` })).json()) as { id: number; tempPassword: string };
  const email = (await get<{ data: { id: number; email: string }[] }>('/teachers')).data.find((x) => x.id === t.id)!.email;
  const login = await loginMobile({ email, password: t.tempPassword });
  await post('/me/change-password', { currentPassword: t.tempPassword, newPassword: 'GiaoVien2026' }, login.accessToken);

  const shift = ((await (await post('/shifts', { name: `C${uid()}`, startTime: '00:05', endTime: '00:35' })).json()) as { id: number }).id;
  const start = addDays(today, -21);
  const cls = (await (await post('/classes', { classCode: `A${uid()}`, name: 'Lớp điểm danh', mainTeacherId: t.id, maxStudents: 10, startDate: start, schedules: [{ shiftId: shift, weekday: isoWeekday(today) }] })).json()) as { id: number };
  const v = (await get<{ version: number }>(`/classes/${cls.id}`)).version;
  await post(`/classes/${cls.id}/open`, { version: v });

  const students: number[] = [];
  for (let i = 0; i < 3; i++) {
    const r = await post('/students', { fullName: `Học Sinh ${'abc'[i]}`, startDate: '2026-01-01', guardians: [{ guardian: { fullName: 'Phụ Huynh', phone: `09${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}` } }] });
    students.push(((await r.json()) as { id: number }).id);
  }
  await post(`/classes/${cls.id}/enrollments`, { studentIds: students, startDate: start });

  // Tài khoản phụ huynh cho học sinh 0
  const gUser = await createUser({ role: 'GUARDIAN' });
  const gid = (await get<{ guardians: { id: number }[] }>(`/students/${students[0]}`)).guardians[0]!.id;
  await env.DB.prepare('UPDATE guardians SET user_id = ? WHERE id = ?').bind(gUser.id, gid).run();

  const lessons = (await get<{ data: { id: number; lessonDate: string }[] }>(`/classes/${cls.id}/lessons?from=${start}&to=${addDays(today, 30)}`)).data;
  return {
    classId: cls.id,
    teacherToken: login.accessToken,
    students,
    todayLesson: lessons.find((l) => l.lessonDate === today)!.id,
    pastLesson: lessons.find((l) => l.lessonDate === addDays(today, -7))!.id,
    futureLesson: lessons.find((l) => l.lessonDate === addDays(today, 7))!.id,
    guardianToken: (await loginMobile(gUser)).accessToken,
  };
}

const sheet = (ctx: Ctx, lessonId: number, token = ctx.teacherToken) => get<any>(`/lessons/${lessonId}/attendance`, token);

beforeAll(async () => {
  admin = (await loginMobile(await createUser({ role: 'ADMIN' }))).accessToken;
});

describe('Phiên điểm danh', () => {
  it('lưu nháp, không trùng bản ghi, gửi lại cùng dữ liệu vẫn thành công, khác dữ liệu → 409', async () => {
    const ctx = await setup();
    const s0 = await sheet(ctx, ctx.todayLesson);
    expect(s0.students).toHaveLength(3);
    expect(s0.canEdit).toBe(true);
    expect(s0.unmarked).toBe(3);
    expect(s0.lesson.attendanceStatus).toBe('NOT_STARTED');

    const body = { version: s0.lesson.version, records: [{ studentId: ctx.students[0], status: 'PRESENT' }, { studentId: ctx.students[1], status: 'LATE', lateMinutes: 10 }] };
    const r1 = await put(`/lessons/${ctx.todayLesson}/attendance`, body, ctx.teacherToken);
    expect(r1.status).toBe(200);
    expect(await r1.json()).toMatchObject({ saved: 2, attendanceStatus: 'DRAFT' });

    // gửi lại y hệt với version cũ (mất phản hồi do mạng)
    const r2 = await put(`/lessons/${ctx.todayLesson}/attendance`, body, ctx.teacherToken);
    expect(r2.status).toBe(200);
    expect(((await r2.json()) as { saved: number }).saved).toBe(0);
    const rows = await env.DB.prepare('SELECT count(*) n FROM attendance_records WHERE lesson_id = ?').bind(ctx.todayLesson).first<{ n: number }>();
    expect(rows!.n).toBe(2);

    // người khác sửa với version cũ → xung đột
    const r3 = await put(`/lessons/${ctx.todayLesson}/attendance`, { ...body, records: [{ studentId: ctx.students[0], status: 'UNEXCUSED' }] }, admin);
    expect(r3.status).toBe(409);

    const s1 = await sheet(ctx, ctx.todayLesson);
    const late = s1.students.find((x: any) => x.studentId === ctx.students[1]);
    expect(late).toMatchObject({ status: 'LATE', lateMinutes: 10 });
    expect(s1.summary).toMatchObject({ present: 1, late: 1 });
  });

  it('phút đi muộn bị bỏ khi không phải "Đi muộn"; học sinh ngoài lớp bị từ chối', async () => {
    const ctx = await setup();
    const v = (await sheet(ctx, ctx.todayLesson)).lesson.version;
    await put(`/lessons/${ctx.todayLesson}/attendance`, { version: v, records: [{ studentId: ctx.students[0], status: 'PRESENT', lateMinutes: 15 }] }, ctx.teacherToken);
    const row = await env.DB.prepare('SELECT late_minutes FROM attendance_records WHERE lesson_id = ? AND student_id = ?').bind(ctx.todayLesson, ctx.students[0]).first<{ late_minutes: number | null }>();
    expect(row!.late_minutes).toBeNull();
    const outsider = await createUser();
    const bad = await put(`/lessons/${ctx.todayLesson}/attendance`, { version: v + 1, records: [{ studentId: 999999 + outsider.id, status: 'PRESENT' }] }, ctx.teacherToken);
    expect(bad.status).toBe(422);
    expect(((await bad.json()) as Err).error.code).toBe('STUDENT_NOT_IN_CLASS');
  });

  it('xác nhận: thiếu học sinh → 422; đủ → SUBMITTED, thông báo phụ huynh học sinh vắng (không trùng)', async () => {
    const ctx = await setup();
    let v = (await sheet(ctx, ctx.todayLesson)).lesson.version;
    await put(`/lessons/${ctx.todayLesson}/attendance`, { version: v, records: [{ studentId: ctx.students[0], status: 'UNEXCUSED' }] }, ctx.teacherToken);
    v++;
    const inc = await post(`/lessons/${ctx.todayLesson}/attendance/submit`, { version: v }, ctx.teacherToken);
    expect(inc.status).toBe(422);
    expect(((await inc.json()) as Err).error.code).toBe('ATTENDANCE_INCOMPLETE');

    await put(`/lessons/${ctx.todayLesson}/attendance`, { version: v, records: [{ studentId: ctx.students[1], status: 'PRESENT' }, { studentId: ctx.students[2], status: 'EXCUSED' }] }, ctx.teacherToken);
    v++;
    const ok = await post(`/lessons/${ctx.todayLesson}/attendance/submit`, { version: v }, ctx.teacherToken);
    expect(ok.status).toBe(200);
    const s = await sheet(ctx, ctx.todayLesson);
    expect(s.lesson).toMatchObject({ attendanceStatus: 'SUBMITTED', status: 'COMPLETED' });
    expect(s.lesson.submittedBy).toBeTruthy();

    // gửi lại xác nhận (version cũ) → không lỗi, không thông báo trùng
    expect((await post(`/lessons/${ctx.todayLesson}/attendance/submit`, { version: v }, ctx.teacherToken)).status).toBe(200);
    const notes = await env.DB.prepare(`SELECT count(*) n FROM notifications WHERE type = 'ABSENCE' AND student_id = ?`).bind(ctx.students[0]).first<{ n: number }>();
    expect(notes!.n).toBe(1);
    // học sinh 2 vắng có phép nhưng phụ huynh chưa có tài khoản → không tạo
    const none = await env.DB.prepare(`SELECT count(*) n FROM notifications WHERE student_id = ?`).bind(ctx.students[2]).first<{ n: number }>();
    expect(none!.n).toBe(0);
  });

  it('sửa sau khi xác nhận được ghi lịch sử (cũ → mới)', async () => {
    const ctx = await setup();
    let v = (await sheet(ctx, ctx.todayLesson)).lesson.version;
    await put(`/lessons/${ctx.todayLesson}/attendance`, { version: v++, records: ctx.students.map((id) => ({ studentId: id, status: 'PRESENT' })) }, ctx.teacherToken);
    await post(`/lessons/${ctx.todayLesson}/attendance/submit`, { version: v++ }, ctx.teacherToken);
    const r = await put(`/lessons/${ctx.todayLesson}/attendance`, { version: v, records: [{ studentId: ctx.students[1], status: 'UNEXCUSED' }] }, ctx.teacherToken);
    expect(r.status).toBe(200);
    const h = await get<{ data: { action: string; changes: { studentId: number; from: string; to: string }[] }[] }>(`/lessons/${ctx.todayLesson}/attendance/history`, ctx.teacherToken);
    expect(h.data.map((x) => x.action)).toEqual(['attendance.edit_after_submit', 'attendance.submit', 'attendance.mark']);
    expect(h.data[0]!.changes).toEqual([expect.objectContaining({ studentId: ctx.students[1], from: 'PRESENT', to: 'UNEXCUSED' })]);
  });
});

describe('Khóa phiên & quyền', () => {
  it('buổi tương lai: giáo viên không điểm danh được, quản trị viên được', async () => {
    const ctx = await setup();
    const s = await sheet(ctx, ctx.futureLesson);
    expect(s.canEdit).toBe(false);
    const r = await put(`/lessons/${ctx.futureLesson}/attendance`, { version: s.lesson.version, records: [{ studentId: ctx.students[0], status: 'PRESENT' }] }, ctx.teacherToken);
    expect(r.status).toBe(422);
    expect(((await r.json()) as Err).error.code).toBe('ATTENDANCE_NOT_EDITABLE');
    expect((await put(`/lessons/${ctx.futureLesson}/attendance`, { version: s.lesson.version, records: [{ studentId: ctx.students[0], status: 'PRESENT' }] })).status).toBe(200);
  });

  it('cron 00:00 khóa buổi đã qua; giáo viên không sửa/mở khóa được; quản trị viên mở khóa có lý do', async () => {
    const ctx = await setup();
    const ctrl = createScheduledController({ cron: '0 17 * * *', scheduledTime: Date.now() });
    const ec = createExecutionContext();
    await worker.scheduled(ctrl, env, ec);
    await waitOnExecutionContext(ec);

    const s = await sheet(ctx, ctx.pastLesson);
    expect(s.lesson.attendanceStatus).toBe('LOCKED');
    expect(s.canEdit).toBe(false);
    expect((await sheet(ctx, ctx.todayLesson)).lesson.attendanceStatus).not.toBe('LOCKED');
    expect((await put(`/lessons/${ctx.pastLesson}/attendance`, { version: s.lesson.version, records: [{ studentId: ctx.students[0], status: 'PRESENT' }] }, ctx.teacherToken)).status).toBe(422);
    expect((await post(`/lessons/${ctx.pastLesson}/attendance/unlock`, { reason: 'Quên điểm danh' }, ctx.teacherToken)).status).toBe(403);
    expect((await post(`/lessons/${ctx.pastLesson}/attendance/unlock`, { reason: 'Giáo viên quên điểm danh' })).status).toBe(200);
    const after = await sheet(ctx, ctx.pastLesson);
    expect(after.canEdit).toBe(true);
    expect((await put(`/lessons/${ctx.pastLesson}/attendance`, { version: after.lesson.version, records: [{ studentId: ctx.students[0], status: 'PRESENT' }] }, ctx.teacherToken)).status).toBe(200);
    const h = await get<{ data: { action: string; reason: string | null }[] }>(`/lessons/${ctx.pastLesson}/attendance/history`);
    expect(h.data.find((x) => x.action === 'attendance.unlock')!.reason).toBe('Giáo viên quên điểm danh');
  });

  it('giáo viên lớp khác không xem được; phụ huynh xem chuyên cần của con', async () => {
    const a = await setup();
    const b = await setup();
    expect((await api(`/lessons/${a.todayLesson}/attendance`, { headers: bearer(b.teacherToken) })).status).toBe(404);
    const day = await get<{ data: { classId: number }[] }>(`/attendance/lessons?date=${today}`, b.teacherToken);
    expect(day.data.every((l) => l.classId === b.classId)).toBe(true);

    let v = (await sheet(a, a.todayLesson)).lesson.version;
    await put(`/lessons/${a.todayLesson}/attendance`, { version: v++, records: a.students.map((id, i) => ({ studentId: id, status: i === 0 ? 'LATE' : 'PRESENT', lateMinutes: 5 })) }, a.teacherToken);
    const mine = await get<{ stats: { total: number; late: number; rate: number } }>(`/attendance/students/${a.students[0]}`, a.guardianToken);
    expect(mine.stats).toMatchObject({ total: 1, late: 1, rate: 100 });
    expect((await api(`/attendance/students/${a.students[1]}`, { headers: bearer(a.guardianToken) })).status).toBe(404);
    expect((await api(`/lessons/${a.todayLesson}/attendance`, { headers: bearer(a.guardianToken) })).status).toBe(403);

    const matrix = await get<{ lessons: { id: number }[]; students: { id: number; cells: Record<string, string | null> }[] }>(`/attendance/classes/${a.classId}/matrix?month=${today.slice(0, 7)}`);
    expect(matrix.students).toHaveLength(3);
    expect(matrix.students.find((s) => s.id === a.students[0])!.cells[a.todayLesson]).toBe('LATE');
  });
});
