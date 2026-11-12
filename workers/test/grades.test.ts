import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { addDays, isoWeekday, vnDate } from '@ecm/shared';
import { api, bearer, createUser, json, loginMobile } from './helpers';

type Err = { error: { code: string; message: string } };
let admin: string;
let n = 0;
const uid = () => `${Date.now().toString(36)}${++n}`;
const today = vnDate();
const post = (p: string, b: unknown, t = admin) => api(p, json(b, { headers: bearer(t) }));
const put = (p: string, b: unknown, t = admin) => api(p, { ...json(b, { headers: bearer(t) }), method: 'PUT' });
const get = async <T = any>(p: string, t = admin) => (await (await api(p, { headers: bearer(t) })).json()) as T;

async function setup() {
  const t = (await (await post('/teachers', { fullName: `GV ${uid()}`, email: `gv${uid()}@t.vn` })).json()) as { id: number; tempPassword: string };
  const email = (await get<{ data: { id: number; email: string }[] }>('/teachers')).data.find((x) => x.id === t.id)!.email;
  const login = await loginMobile({ email, password: t.tempPassword });
  await post('/me/change-password', { currentPassword: t.tempPassword, newPassword: 'GiaoVien2026' }, login.accessToken);
  const shift = ((await (await post('/shifts', { name: `C${uid()}`, startTime: '10:00', endTime: '11:00' })).json()) as { id: number }).id;
  const start = addDays(today, -30);
  const cls = (await (await post('/classes', { classCode: `G${uid()}`, name: 'Lớp chấm điểm', mainTeacherId: t.id, maxStudents: 10, startDate: start, schedules: [{ shiftId: shift, weekday: isoWeekday(today) }] })).json()) as { id: number };
  const students: number[] = [];
  for (let i = 0; i < 2; i++) {
    const r = await post('/students', { fullName: `Học Sinh ${'ab'[i]}`, startDate: '2026-01-01', guardians: [{ guardian: { fullName: 'Phụ Huynh', phone: `09${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}` } }] });
    students.push(((await r.json()) as { id: number }).id);
  }
  await post(`/classes/${cls.id}/enrollments`, { studentIds: students, startDate: start });
  return { classId: cls.id, teacher: login.accessToken, students };
}

const typeId = async (code: string) => (await get<{ types: { id: number; code: string }[] }>('/grading/config')).types.find((t) => t.code === code)!.id;
const criteria = async () => (await get<{ criteria: { id: number; code: string; weight: number; maxScore: number }[] }>('/grading/config')).criteria;

async function newAssessment(ctx: { classId: number; teacher: string }, title = 'Kiểm tra tháng') {
  const r = await post('/assessments', { classId: ctx.classId, assessmentTypeId: await typeId('MONTHLY'), title, assessedOn: today }, ctx.teacher);
  expect(r.status).toBe(201);
  return ((await r.json()) as { id: number }).id;
}

beforeAll(async () => {
  admin = (await loginMobile(await createUser({ role: 'ADMIN' }))).accessToken;
});

describe('Cấu hình chấm điểm', () => {
  it('mặc định 6 tiêu chí, 4 loại đánh giá, 5 mức xếp loại', async () => {
    const cfg = await get<any>('/grading/config');
    expect(cfg.criteria.map((c: any) => c.code)).toEqual(['LISTENING', 'SPEAKING', 'READING', 'WRITING', 'HOMEWORK', 'ATTITUDE']);
    expect(cfg.types.map((t: any) => t.code)).toEqual(['LESSON', 'PERIODIC', 'MONTHLY', 'FINAL']);
    expect(cfg.bands.map((b: any) => `${b.min}:${b.label}`)).toEqual(['9:Xuất sắc', '8:Giỏi', '6.5:Khá', '5:Trung bình', '0:Cần cải thiện']);
  });
  it('thang xếp loại không hợp lệ bị từ chối; giáo viên không sửa cấu hình được', async () => {
    expect((await put('/grading/bands', { bands: [{ min: 5, label: 'Đạt' }, { min: 8, label: 'Tốt' }] })).status).toBe(422);
    const ctx = await setup();
    expect((await put('/grading/bands', { bands: [{ min: 0, label: 'A' }, { min: 5, label: 'B' }] }, ctx.teacher)).status).toBe(403);
  });
});

describe('Đợt đánh giá & điểm', () => {
  it('tính điểm TB theo trọng số và xếp loại (8,17 → Giỏi); thiếu tiêu chí chỉ tính tiêu chí có điểm', async () => {
    const ctx = await setup();
    const id = await newAssessment(ctx);
    const cr = await criteria();
    const scores = [8, 7, 9, 6, 10, 9];
    const grades = cr.slice(0, 6).map((c, i) => ({ studentId: ctx.students[0], criterionId: c.id, score: scores[i] }));
    grades.push({ studentId: ctx.students[1], criterionId: cr[0]!.id, score: 8 }, { studentId: ctx.students[1], criterionId: cr[2]!.id, score: 6 });
    const r = await put(`/assessments/${id}/grades`, { grades, comments: [{ studentId: ctx.students[0], comment: 'Tiến bộ tốt' }] }, ctx.teacher);
    expect(r.status).toBe(200);
    const sheet = await get<any>(`/assessments/${id}`, ctx.teacher);
    const a = sheet.students.find((s: any) => s.studentId === ctx.students[0]);
    const b = sheet.students.find((s: any) => s.studentId === ctx.students[1]);
    expect(a).toMatchObject({ average: 8.17, classification: 'Giỏi', comment: 'Tiến bộ tốt' });
    expect(b).toMatchObject({ average: 7, classification: 'Khá' });

    // xóa một điểm → tính lại
    await put(`/assessments/${id}/grades`, { grades: [{ studentId: ctx.students[1], criterionId: cr[2]!.id, score: null }] }, ctx.teacher);
    const b2 = (await get<any>(`/assessments/${id}`, ctx.teacher)).students.find((s: any) => s.studentId === ctx.students[1]);
    expect(b2).toMatchObject({ average: 8, classification: 'Giỏi' });
  });

  it('từ chối điểm vượt thang, học sinh ngoài lớp, ngày tương lai', async () => {
    const ctx = await setup();
    const id = await newAssessment(ctx);
    const cr = await criteria();
    const over = await put(`/assessments/${id}/grades`, { grades: [{ studentId: ctx.students[0], criterionId: cr[0]!.id, score: 11 }] }, ctx.teacher);
    expect(over.status).toBe(422);
    const outsider = await put(`/assessments/${id}/grades`, { grades: [{ studentId: 9_999_999, criterionId: cr[0]!.id, score: 5 }] }, ctx.teacher);
    expect(outsider.status).toBe(422);
    const fut = await post('/assessments', { classId: ctx.classId, assessmentTypeId: await typeId('LESSON'), title: 'Tương lai', assessedOn: addDays(today, 3) }, ctx.teacher);
    expect(fut.status).toBe(422);
  });

  it('đổi trọng số/thang xếp loại KHÔNG làm thay đổi kết quả đợt cũ; đợt mới dùng cấu hình mới', async () => {
    const ctx = await setup();
    const cr = await criteria();
    const oldId = await newAssessment(ctx, 'Đợt cũ');
    const g = (aid: number) => put(`/assessments/${aid}/grades`, { grades: [{ studentId: ctx.students[0], criterionId: cr[0]!.id, score: 9 }, { studentId: ctx.students[0], criterionId: cr[1]!.id, score: 6 }] }, ctx.teacher);
    await g(oldId);
    expect((await get<any>(`/assessments/${oldId}`)).students[0].average ?? null).not.toBeUndefined();
    const before = (await get<any>(`/assessments/${oldId}`)).students.find((s: any) => s.studentId === ctx.students[0]);
    expect(before).toMatchObject({ average: 7.5, classification: 'Khá' });

    const all = await criteria();
    await put('/grading/criteria', { criteria: all.map((c: any, i: number) => ({ id: c.id, name: c.name ?? c.code, weight: i === 0 ? 3 : c.weight, maxScore: c.maxScore, isActive: true, sortOrder: i + 1 })) });
    const bandsBefore = (await get<any>('/grading/config')).bands;
    await put('/grading/bands', { bands: [{ min: 0, label: 'Chưa đạt' }, { min: 7, label: 'Đạt' }] });
    try {
      // sửa lại một điểm của đợt cũ → vẫn tính theo snapshot cũ
      await put(`/assessments/${oldId}/grades`, { grades: [{ studentId: ctx.students[0], criterionId: cr[1]!.id, score: 6 }, { studentId: ctx.students[0], criterionId: cr[0]!.id, score: 9 }] }, ctx.teacher);
      const after = (await get<any>(`/assessments/${oldId}`)).students.find((s: any) => s.studentId === ctx.students[0]);
      expect(after).toMatchObject({ average: 7.5, classification: 'Khá' });
      const newId = await newAssessment(ctx, 'Đợt mới');
      await g(newId);
      const neu = (await get<any>(`/assessments/${newId}`)).students.find((s: any) => s.studentId === ctx.students[0]);
      expect(neu).toMatchObject({ average: 8.25, classification: 'Đạt' }); // (9*3 + 6*1) / 4
    } finally {
      await put('/grading/criteria', { criteria: all.map((c: any, i: number) => ({ id: c.id, name: c.name ?? c.code, weight: 1, maxScore: c.maxScore, isActive: true, sortOrder: i + 1 })) });
      await put('/grading/bands', { bands: bandsBefore });
    }
  });

  it('lịch sử sửa điểm cũ → mới; công bố → phụ huynh thấy & nhận thông báo; giáo viên không sửa sau công bố', async () => {
    const ctx = await setup();
    const cr = await criteria();
    const id = await newAssessment(ctx);
    await put(`/assessments/${id}/grades`, { grades: [{ studentId: ctx.students[0], criterionId: cr[0]!.id, score: 6 }] }, ctx.teacher);
    await put(`/assessments/${id}/grades`, { grades: [{ studentId: ctx.students[0], criterionId: cr[0]!.id, score: 7.5 }] }, ctx.teacher);
    const h = await get<{ data: { action: string; changes: { from: number | null; to: number | null }[] }[] }>(`/assessments/${id}/history`, ctx.teacher);
    expect(h.data[0]!.changes[0]).toMatchObject({ from: 6, to: 7.5 });

    const gUser = await createUser({ role: 'GUARDIAN' });
    const gid = (await get<any>(`/students/${ctx.students[0]}`)).guardians[0].id;
    await env.DB.prepare('UPDATE guardians SET user_id = ? WHERE id = ?').bind(gUser.id, gid).run();
    const gToken = (await loginMobile(gUser)).accessToken;
    expect((await get<{ data: unknown[] }>(`/students/${ctx.students[0]}/results`, gToken)).data).toHaveLength(0);

    const pub = await post(`/assessments/${id}/publish`, {}, ctx.teacher);
    expect(pub.status).toBe(200);
    expect(((await pub.json()) as { notified: number }).notified).toBe(1);
    const res = await get<{ data: { average: number; scores: { score: number | null }[] }[] }>(`/students/${ctx.students[0]}/results`, gToken);
    expect(res.data).toHaveLength(1);
    expect(res.data[0]!.average).toBe(7.5);
    const notes = await env.DB.prepare(`SELECT count(*) n FROM notifications WHERE type = 'RESULT' AND user_id = ?`).bind(gUser.id).first<{ n: number }>();
    expect(notes!.n).toBe(1);

    const t = await put(`/assessments/${id}/grades`, { grades: [{ studentId: ctx.students[0], criterionId: cr[0]!.id, score: 9 }] }, ctx.teacher);
    expect(t.status).toBe(422);
    expect((await put(`/assessments/${id}/grades`, { grades: [{ studentId: ctx.students[0], criterionId: cr[0]!.id, score: 9 }] })).status).toBe(200);
    const h2 = await get<{ data: { action: string }[] }>(`/assessments/${id}/history`);
    expect(h2.data[0]!.action).toBe('grade.update_after_publish');
  });

  it('giáo viên lớp khác không thấy đợt đánh giá; không xóa đợt đã có điểm', async () => {
    const a = await setup();
    const b = await setup();
    const id = await newAssessment(a);
    expect((await api(`/assessments/${id}`, { headers: bearer(b.teacher) })).status).toBe(404);
    expect((await post('/assessments', { classId: a.classId, assessmentTypeId: await typeId('LESSON'), title: 'Lớp người khác', assessedOn: today }, b.teacher)).status).toBe(404);
    const cr = await criteria();
    await put(`/assessments/${id}/grades`, { grades: [{ studentId: a.students[0], criterionId: cr[0]!.id, score: 5 }] }, a.teacher);
    const del = await api(`/assessments/${id}`, { method: 'DELETE', headers: bearer(a.teacher) });
    expect(del.status).toBe(422);
    expect(((await del.json()) as Err).error.code).toBe('HAS_GRADES');
  });
});
