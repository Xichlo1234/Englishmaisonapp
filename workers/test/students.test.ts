import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { api, bearer, createUser, json, loginMobile } from './helpers';

type Err = { error: { code: string; message: string } };
let admin: string;

const newStudent = (over: Record<string, unknown> = {}) => ({
  fullName: 'nguyễn   văn an',
  dateOfBirth: '2015-03-10',
  gender: 'MALE',
  startDate: '2026-09-01',
  schoolName: 'TH Kim Đồng',
  address: '12 Lê Lợi',
  englishLevel: 'Movers',
  guardians: [{ guardian: { fullName: 'nguyễn văn bố', phone: '0901 234 567' }, relationship: 'FATHER' }],
  ...over,
});

async function create(token: string, body: Record<string, unknown>) {
  const res = await api('/students', json(body, { headers: bearer(token) }));
  return { res, body: (await res.json()) as { id: number; studentCode: string } & Err };
}

async function detail(token: string, id: number) {
  const res = await api(`/students/${id}`, { headers: bearer(token) });
  return { res, body: (await res.json()) as any };
}

/** Tạo giáo viên + lớp + ghi danh trực tiếp bằng SQL (module lớp học chưa có ở giai đoạn này). */
async function setupTeacherClass(studentIds: number[]) {
  const tUser = await createUser({ role: 'TEACHER' });
  const t = await env.DB.prepare(`INSERT INTO teachers (user_id, full_name) VALUES (?, 'GV') RETURNING id`).bind(tUser.id).first<{ id: number }>();
  const code = `L${Math.random().toString(36).slice(2, 8)}`;
  const cls = await env.DB.prepare(
    `INSERT INTO classes (class_code, name, main_teacher_id, max_students, start_date, status) VALUES (?, 'Lớp test', ?, 20, '2026-09-01', 'OPEN') RETURNING id`,
  )
    .bind(code, t!.id)
    .first<{ id: number }>();
  for (const sid of studentIds)
    await env.DB.prepare(`INSERT INTO class_enrollments (student_id, class_id, start_date) VALUES (?, ?, '2026-09-01')`).bind(sid, cls!.id).run();
  return { teacher: tUser, classId: cls!.id, teacherId: t!.id };
}

beforeAll(async () => {
  admin = (await loginMobile(await createUser({ role: 'ADMIN' }))).accessToken;
});

describe('Thêm học sinh', () => {
  it('tạo học sinh + phụ huynh mới, mã tự động, chuẩn hóa tên & SĐT, ghi nhật ký', async () => {
    const { res, body } = await create(admin, newStudent());
    expect(res.status).toBe(201);
    expect(body.studentCode).toMatch(/^HS\d{5}$/);
    const d = (await detail(admin, body.id)).body;
    expect(d.fullName).toBe('Nguyễn Văn An');
    expect(d.status).toBe('ACTIVE');
    expect(d.guardians).toHaveLength(1);
    expect(d.guardians[0]).toMatchObject({ fullName: 'Nguyễn Văn Bố', phone: '0901234567', isPrimary: true, relationship: 'FATHER' });
    const log = await env.DB.prepare(`SELECT count(*) n FROM audit_logs WHERE action='student.create' AND entity_id = ?`).bind(body.id).first<{ n: number }>();
    expect(log!.n).toBe(1);
  });

  it.each([
    ['không có phụ huynh', { guardians: [] }],
    ['ngày sinh sau ngày bắt đầu', { dateOfBirth: '2027-01-01' }],
    ['SĐT phụ huynh sai', { guardians: [{ guardian: { fullName: 'Bố', phone: '123' } }] }],
    ['ngày không tồn tại', { startDate: '2026-02-30' }],
    ['họ tên quá ngắn', { fullName: 'A' }],
  ])('từ chối: %s', async (_n, over) => {
    const { res, body } = await create(admin, newStudent(over));
    expect(res.status).toBe(422);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('liên kết phụ huynh có sẵn cho anh/chị/em; tìm phụ huynh theo SĐT', async () => {
    const a = await create(admin, newStudent({ guardians: [{ guardian: { fullName: 'Trần Thị Mẹ', phone: '0988000111' }, relationship: 'MOTHER' }] }));
    const found = (await (await api('/guardians?phone=0988000111', { headers: bearer(admin) })).json()) as { data: { id: number }[] };
    expect(found.data).toHaveLength(1);
    const b = await create(admin, newStudent({ fullName: 'Trần Bé Hai', guardians: [{ guardianId: found.data[0]!.id, relationship: 'MOTHER' }] }));
    expect(b.res.status).toBe(201);
    const again = (await (await api('/guardians?phone=0988000111', { headers: bearer(admin) })).json()) as { data: { children: string }[] };
    expect(again.data[0]!.children).toContain('Trần Bé Hai');
    expect(a.body.id).not.toBe(b.body.id);
  });

  it('cảnh báo trùng theo họ tên + ngày sinh và SĐT phụ huynh', async () => {
    await create(admin, newStudent({ fullName: 'Lê Thị Trùng', dateOfBirth: '2014-05-05' }));
    const r = await api(`/students/check-duplicates?fullName=${encodeURIComponent('le thi trung')}&dateOfBirth=2014-05-05`, { headers: bearer(admin) });
    expect(((await r.json()) as { data: unknown[] }).data.length).toBeGreaterThan(0);
  });
});

describe('Danh sách & tìm kiếm', () => {
  it('tìm không dấu, tìm theo SĐT phụ huynh, phân trang, ẩn hồ sơ lưu trữ', async () => {
    const name = `Phạm Đức Tìm${Math.floor(Math.random() * 1e6)}`;
    const { body } = await create(admin, newStudent({ fullName: name, guardians: [{ guardian: { fullName: 'Phạm Bố', phone: '0977123999' } }] }));
    const byName = (await (await api(`/students?q=${encodeURIComponent('pham duc tim')}`, { headers: bearer(admin) })).json()) as any;
    expect(byName.data.some((s: any) => s.id === body.id)).toBe(true);
    const byPhone = (await (await api(`/students?q=0977123999`, { headers: bearer(admin) })).json()) as any;
    expect(byPhone.data.map((s: any) => s.id)).toContain(body.id);
    expect(byPhone.data[0].primaryGuardian.phone).toBe('0977123999');

    const page = (await (await api(`/students?pageSize=1&page=1`, { headers: bearer(admin) })).json()) as any;
    expect(page.data).toHaveLength(1);
    expect(page.total).toBeGreaterThan(1);

    const d = (await detail(admin, body.id)).body;
    await api(`/students/${body.id}/archive`, json({ reason: 'Nhập nhầm', version: d.version }, { headers: bearer(admin) }));
    const after = (await (await api(`/students?q=0977123999`, { headers: bearer(admin) })).json()) as any;
    expect(after.data.map((s: any) => s.id)).not.toContain(body.id);
    const all = (await (await api(`/students?q=0977123999&status=ARCHIVED`, { headers: bearer(admin) })).json()) as any;
    expect(all.data.map((s: any) => s.id)).toContain(body.id);
  });
});

describe('Sửa hồ sơ (khóa lạc quan)', () => {
  it('sửa một trường không làm mất trường khác; version cũ → 409', async () => {
    const { body } = await create(admin, newStudent());
    const r1 = await api(`/students/${body.id}`, { ...json({ schoolName: 'THCS Mới', version: 0 }, { headers: bearer(admin) }), method: 'PATCH' });
    expect(r1.status).toBe(200);
    expect(((await r1.json()) as any).version).toBe(1);
    const d = (await detail(admin, body.id)).body;
    expect(d.schoolName).toBe('THCS Mới');
    expect(d.address).toBe('12 Lê Lợi');
    expect(d.englishLevel).toBe('Movers');

    const stale = await api(`/students/${body.id}`, { ...json({ schoolName: 'Khác', version: 0 }, { headers: bearer(admin) }), method: 'PATCH' });
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as Err).error.code).toBe('VERSION_CONFLICT');

    const clear = await api(`/students/${body.id}`, { ...json({ address: null, version: 1 }, { headers: bearer(admin) }), method: 'PATCH' });
    expect(clear.status).toBe(200);
    expect((await detail(admin, body.id)).body.address).toBeNull();
  });
});

describe('Trạng thái học tập', () => {
  it('tạm nghỉ đóng ghi danh; không tạm nghỉ hai lần; quay lại học', async () => {
    const { body } = await create(admin, newStudent());
    const { classId } = await setupTeacherClass([body.id]);
    const p = await api(`/students/${body.id}/pause`, json({ effectiveDate: '2026-11-15', until: '2026-12-15', reason: 'Ốm dài ngày', version: 0 }, { headers: bearer(admin) }));
    expect(p.status).toBe(200);
    const d = (await detail(admin, body.id)).body;
    expect(d.status).toBe('PAUSED');
    expect(d.pauseUntil).toBe('2026-12-15');
    expect(d.enrollments[0]).toMatchObject({ classId, status: 'ENDED', endDate: '2026-11-14', endReason: 'PAUSE' });

    const twice = await api(`/students/${body.id}/pause`, json({ effectiveDate: '2026-11-16', reason: 'Lần hai', version: d.version }, { headers: bearer(admin) }));
    expect(twice.status).toBe(422);
    expect(((await twice.json()) as Err).error.code).toBe('INVALID_STATUS_TRANSITION');

    const back = await api(`/students/${body.id}/reactivate`, json({ version: d.version }, { headers: bearer(admin) }));
    expect(back.status).toBe(200);
    expect((await detail(admin, body.id)).body.status).toBe('ACTIVE');
  });

  it('không cho ngày hiệu lực trước buổi đã điểm danh', async () => {
    const { body } = await create(admin, newStudent());
    const { classId, teacherId, teacher } = await setupTeacherClass([body.id]);
    const l = await env.DB.prepare(
      `INSERT INTO lessons (class_id, lesson_date, start_time, end_time, teacher_id) VALUES (?, '2026-11-20', '14:00', '15:30', ?) RETURNING id`,
    )
      .bind(classId, teacherId)
      .first<{ id: number }>();
    await env.DB.prepare(`INSERT INTO attendance_records (lesson_id, student_id, status, marked_by, marked_at) VALUES (?, ?, 'PRESENT', ?, '2026-11-20T07:00:00Z')`)
      .bind(l!.id, body.id, teacher.id)
      .run();
    const r = await api(`/students/${body.id}/drop`, json({ effectiveDate: '2026-11-18', reason: 'Chuyển nhà', version: 0 }, { headers: bearer(admin) }));
    expect(r.status).toBe(422);
    expect(((await r.json()) as Err).error.code).toBe('EFFECTIVE_DATE_BEFORE_ATTENDANCE');
    const ok = await api(`/students/${body.id}/drop`, json({ effectiveDate: '2026-11-21', reason: 'Chuyển nhà', version: 0 }, { headers: bearer(admin) }));
    expect(ok.status).toBe(200);
  });

  it('lưu trữ rồi khôi phục → "Nghỉ học"; xóa cứng bị chặn khi có lịch sử', async () => {
    const { body } = await create(admin, newStudent());
    await setupTeacherClass([body.id]);
    await api(`/students/${body.id}/archive`, json({ reason: 'Không học nữa', version: 0 }, { headers: bearer(admin) }));
    const r = await api(`/students/${body.id}/restore`, json({ version: 1 }, { headers: bearer(admin) }));
    expect(r.status).toBe(200);
    expect(((await r.json()) as any).status).toBe('DROPPED');
    const del = await api(`/students/${body.id}`, { method: 'DELETE', headers: bearer(admin) });
    expect(del.status).toBe(422);
    expect(((await del.json()) as Err).error.code).toBe('STUDENT_HAS_HISTORY');
  });

  it('xóa cứng hồ sơ tạo nhầm (chưa có dữ liệu) và ghi nhật ký', async () => {
    const { body } = await create(admin, newStudent());
    const del = await api(`/students/${body.id}`, { method: 'DELETE', headers: bearer(admin) });
    expect(del.status).toBe(200);
    expect((await detail(admin, body.id)).res.status).toBe(404);
    const log = await env.DB.prepare(`SELECT count(*) n FROM audit_logs WHERE action='student.hard_delete' AND entity_id=?`).bind(body.id).first<{ n: number }>();
    expect(log!.n).toBe(1);
  });

  it('nhật ký thay đổi của học sinh', async () => {
    const { body } = await create(admin, newStudent());
    await api(`/students/${body.id}`, { ...json({ schoolName: 'Trường B', version: 0 }, { headers: bearer(admin) }), method: 'PATCH' });
    const t = (await (await api(`/students/${body.id}/timeline`, { headers: bearer(admin) })).json()) as { data: { action: string }[] };
    expect(t.data.map((x) => x.action)).toEqual(['student.update', 'student.create']);
  });
});

describe('Phụ huynh', () => {
  it('không được bỏ phụ huynh cuối cùng; thêm phụ huynh mới thành phụ huynh chính', async () => {
    const { body } = await create(admin, newStudent());
    const d = (await detail(admin, body.id)).body;
    const r = await api(`/students/${body.id}/guardians/${d.guardians[0].id}`, { method: 'DELETE', headers: bearer(admin) });
    expect(r.status).toBe(422);
    const add = await api(`/students/${body.id}/guardians`, json({ guardian: { fullName: 'Mẹ Mới', phone: '0911222333' }, relationship: 'MOTHER', isPrimary: true }, { headers: bearer(admin) }));
    expect(add.status).toBe(201);
    const d2 = (await detail(admin, body.id)).body;
    expect(d2.guardians).toHaveLength(2);
    expect(d2.guardians.filter((g: any) => g.isPrimary)).toHaveLength(1);
    expect(d2.guardians[0].fullName).toBe('Mẹ Mới');
    expect((await api(`/students/${body.id}/guardians/${d.guardians[0].id}`, { method: 'DELETE', headers: bearer(admin) })).status).toBe(200);
  });
});

describe('Phân quyền dữ liệu', () => {
  it('giáo viên chỉ thấy học sinh lớp mình, không thêm/sửa được', async () => {
    const mine = await create(admin, newStudent({ fullName: 'Học Sinh Lớp Mình' }));
    const other = await create(admin, newStudent({ fullName: 'Học Sinh Lớp Khác' }));
    const { teacher } = await setupTeacherClass([mine.body.id]);
    const t = (await loginMobile(teacher)).accessToken;

    const list = (await (await api('/students?pageSize=100', { headers: bearer(t) })).json()) as any;
    expect(list.data.map((s: any) => s.id)).toEqual([mine.body.id]);
    expect((await detail(t, mine.body.id)).res.status).toBe(200);
    expect((await detail(t, other.body.id)).res.status).toBe(404);
    expect((await create(t, newStudent())).res.status).toBe(403);
    const patch = await api(`/students/${mine.body.id}`, { ...json({ schoolName: 'x', version: 0 }, { headers: bearer(t) }), method: 'PATCH' });
    expect(patch.status).toBe(403);
  });

  it('phụ huynh chỉ xem hồ sơ con được liên kết, không thấy ghi chú nội bộ, không xem danh sách', async () => {
    const child = await create(admin, newStudent({ notes: 'Ghi chú nội bộ', needsAttention: true, attentionNote: 'Theo dõi' }));
    const stranger = await create(admin, newStudent());
    const gUser = await createUser({ role: 'GUARDIAN' });
    const gid = (await detail(admin, child.body.id)).body.guardians[0].id;
    await env.DB.prepare('UPDATE guardians SET user_id = ? WHERE id = ?').bind(gUser.id, gid).run();
    const g = (await loginMobile(gUser)).accessToken;

    const own = await detail(g, child.body.id);
    expect(own.res.status).toBe(200);
    expect(own.body.notes).toBeNull();
    expect(own.body.attentionNote).toBeNull();
    expect((await detail(g, stranger.body.id)).res.status).toBe(404);
    expect((await api('/students', { headers: bearer(g) })).status).toBe(403);
  });
});

describe('Ảnh học sinh trên R2 (riêng tư)', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
  const upload = (token: string, id: number, bytes: Uint8Array, type = 'image/png') => {
    const fd = new FormData();
    fd.append('file', new File([bytes], 'anh.png', { type }));
    return api(`/students/${id}/photo`, { method: 'POST', headers: bearer(token), body: fd });
  };

  it('tải ảnh, đọc qua API có kiểm tra quyền, khóa R2 không chứa tên', async () => {
    const { body } = await create(admin, newStudent());
    const up = await upload(admin, body.id, png);
    expect(up.status).toBe(201);
    const { fileId } = (await up.json()) as { fileId: number };
    const f = await env.DB.prepare('SELECT r2_key FROM files WHERE id = ?').bind(fileId).first<{ r2_key: string }>();
    expect(f!.r2_key).toMatch(new RegExp(`^students/${body.id}/[0-9a-f-]{36}\\.png$`));

    const get = await api(`/files/${fileId}/content`, { headers: bearer(admin) });
    expect(get.status).toBe(200);
    expect(get.headers.get('Cache-Control')).toBe('private, max-age=300');
    expect(new Uint8Array(await get.arrayBuffer())).toEqual(png);

    expect((await api(`/files/${fileId}/content`)).status).toBe(401);
    const g = (await loginMobile(await createUser({ role: 'GUARDIAN' }))).accessToken;
    expect((await api(`/files/${fileId}/content`, { headers: bearer(g) })).status).toBe(404);
  });

  it('từ chối tệp không phải ảnh dù khai báo image/png', async () => {
    const { body } = await create(admin, newStudent());
    const r = await upload(admin, body.id, new TextEncoder().encode('<script>alert(1)</script>'));
    expect(r.status).toBe(422);
  });
});
