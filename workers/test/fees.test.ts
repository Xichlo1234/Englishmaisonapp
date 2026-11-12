import { createExecutionContext, createScheduledController, env, waitOnExecutionContext } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { addDays, vnDate } from '@ecm/shared';
import worker from '../src/index';
import { api, bearer, createUser, json, loginMobile } from './helpers';

type Err = { error: { code: string; message: string } };
let admin: string;
let admin2: string;
let n = 0;
const uid = () => `${Date.now().toString(36)}${++n}`;
const today = vnDate();
const period = today.slice(0, 7);
const post = (p: string, b: unknown, t = admin) => api(p, json(b, { headers: bearer(t) }));
const patch = (p: string, b: unknown, t = admin) => api(p, { ...json(b, { headers: bearer(t) }), method: 'PATCH' });
const get = async <T = any>(p: string, t = admin) => (await (await api(p, { headers: bearer(t) })).json()) as T;

async function newStudent() {
  const r = await post('/students', { fullName: 'Học Sinh Phí', startDate: '2026-01-01', guardians: [{ guardian: { fullName: 'Phụ Huynh', phone: `09${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}` } }] });
  return ((await r.json()) as { id: number }).id;
}
async function newPlan(billingType = 'MONTHLY', amount = 1_800_000, sessionCount?: number) {
  const r = await post('/fee-plans', { code: `P${uid()}`, name: `Gói ${billingType}`, billingType, amount, sessionCount });
  expect(r.status).toBe(201);
  return ((await r.json()) as { id: number }).id;
}
/** Học sinh + gói tháng giảm 10% + hóa đơn kỳ hiện tại đã phát hành (1.620.000). */
async function issuedInvoice() {
  const sid = await newStudent();
  const plan = await newPlan();
  expect((await post(`/students/${sid}/fee-plans`, { feePlanId: plan, discountType: 'PERCENT', discountValue: 10, discountReason: 'Anh chị em', effectiveFrom: `${period}-01` })).status).toBe(201);
  await post('/invoices/generate', { period });
  const list = await get<{ data: { id: number; status: string; amountDue: number }[] }>(`/invoices?studentId=${sid}&status=ALL`);
  const inv = list.data[0]!;
  await post('/invoices/issue', { ids: [inv.id] });
  return { sid, invoiceId: inv.id };
}
const pay = (invoiceId: number, amount: number, key = crypto.randomUUID(), t = admin) =>
  api(`/invoices/${invoiceId}/payments`, json({ amount, method: 'CASH' }, { headers: { ...bearer(t), 'Idempotency-Key': key } }));

beforeAll(async () => {
  admin = (await loginMobile(await createUser({ role: 'ADMIN' }))).accessToken;
  admin2 = (await loginMobile(await createUser({ role: 'OWNER' }))).accessToken;
});

describe('Gói học phí & tạo hóa đơn kỳ', () => {
  it('gói theo buổi bắt buộc số buổi; trùng gói tháng bị chặn', async () => {
    expect((await post('/fee-plans', { code: `X${uid()}`, name: 'Gói buổi', billingType: 'PER_SESSION', amount: 1_500_000 })).status).toBe(422);
    const sid = await newStudent();
    const plan = await newPlan();
    expect((await post(`/students/${sid}/fee-plans`, { feePlanId: plan, effectiveFrom: '2026-01-01' })).status).toBe(201);
    const dup = await post(`/students/${sid}/fee-plans`, { feePlanId: plan, effectiveFrom: '2026-06-01' });
    expect(dup.status).toBe(422);
    expect(((await dup.json()) as Err).error.code).toBe('PLAN_OVERLAP');
  });

  it('tạo nháp theo kỳ có giảm giá, tạo lại không trùng; phát hành → Chưa thanh toán', async () => {
    const sid = await newStudent();
    const plan = await newPlan();
    await post(`/students/${sid}/fee-plans`, { feePlanId: plan, discountType: 'PERCENT', discountValue: 10, discountReason: 'Anh chị em', effectiveFrom: `${period}-01` });
    const g1 = await (await post('/invoices/generate', { period })).json() as { created: number; dueDate: string };
    expect(g1.created).toBeGreaterThanOrEqual(1);
    expect(g1.dueDate).toBe(`${period}-10`);
    await post('/invoices/generate', { period });
    const list = await get<{ data: { id: number; invoiceCode: string; status: string; amountDue: number }[] }>(`/invoices?studentId=${sid}&status=ALL`);
    expect(list.data).toHaveLength(1);
    expect(list.data[0]).toMatchObject({ status: 'DRAFT', amountDue: 1_620_000 });
    expect(list.data[0]!.invoiceCode).toMatch(new RegExp(`^HD-${period.replace('-', '')}-\\d{4}$`));
    // chưa phát hành thì không thu được
    expect((await pay(list.data[0]!.id, 100_000)).status).toBe(422);
    await post('/invoices/issue', { ids: [list.data[0]!.id] });
    const d = await get<{ status: string }>(`/invoices/${list.data[0]!.id}`);
    expect(['UNPAID', 'OVERDUE']).toContain(d.status);
  });
});

describe('Thu tiền (bất biến, chống trùng)', () => {
  it('thu một phần, gửi lại cùng mã không ghi trùng, không thu vượt, thu đủ → Đã thanh toán', async () => {
    const { invoiceId } = await issuedInvoice();
    const key = crypto.randomUUID();
    const r1 = await pay(invoiceId, 500_000, key);
    expect(r1.status).toBe(201);
    const p1 = (await r1.json()) as { paymentCode: string };
    expect(p1.paymentCode).toMatch(new RegExp(`^PT-${today.replaceAll('-', '')}-\\d{4}$`));
    const r2 = await pay(invoiceId, 500_000, key);
    expect(r2.status).toBe(200);
    expect(((await r2.json()) as { paymentCode: string }).paymentCode).toBe(p1.paymentCode);
    let d = await get<{ amount_paid: number; status: string; remaining: number; payments: unknown[] }>(`/invoices/${invoiceId}`);
    expect(d).toMatchObject({ amount_paid: 500_000, remaining: 1_120_000 });
    expect(d.payments).toHaveLength(1);
    expect(['PARTIAL', 'OVERDUE']).toContain(d.status);

    const over = await pay(invoiceId, 2_000_000);
    expect(over.status).toBe(422);
    expect(((await over.json()) as Err).error.code).toBe('OVERPAYMENT');
    expect((await pay(invoiceId, 1_120_000)).status).toBe(201);
    d = await get(`/invoices/${invoiceId}`);
    expect(d).toMatchObject({ status: 'PAID', remaining: 0 });
  });

  it('giao dịch không sửa/xóa được (kể cả trực tiếp trong DB); hóa đơn đã thu không hủy được', async () => {
    const { invoiceId } = await issuedInvoice();
    await pay(invoiceId, 300_000);
    const p = await env.DB.prepare('SELECT id FROM payments WHERE invoice_id = ?').bind(invoiceId).first<{ id: number }>();
    await expect(env.DB.prepare('UPDATE payments SET amount = 1 WHERE id = ?').bind(p!.id).run()).rejects.toThrow(/immutable/);
    await expect(env.DB.prepare('DELETE FROM payments WHERE id = ?').bind(p!.id).run()).rejects.toThrow(/immutable/);
    const c = await post(`/invoices/${invoiceId}/cancel`, { reason: 'Nhập nhầm' });
    expect(c.status).toBe(422);
    expect(((await c.json()) as Err).error.code).toBe('HAS_PAYMENTS');
  });
});

describe('Điều chỉnh có duyệt', () => {
  it('hoàn tiền: chờ duyệt không đổi số đã thu; người đề nghị không tự duyệt; người khác duyệt → giảm số đã thu', async () => {
    const { invoiceId } = await issuedInvoice();
    await pay(invoiceId, 1_000_000);
    const r = await post(`/invoices/${invoiceId}/adjustments`, { type: 'REFUND', amount: 200_000, reason: 'Nghỉ 2 buổi do ốm' });
    expect(r.status).toBe(201);
    const adj = (await r.json()) as { id: number; adjustmentCode: string };
    expect(adj.adjustmentCode).toMatch(/^DC-\d{8}-\d{4}$/);
    expect((await get<{ amount_paid: number }>(`/invoices/${invoiceId}`)).amount_paid).toBe(1_000_000);
    const self = await post(`/adjustments/${adj.id}/approve`, {});
    expect(self.status).toBe(422);
    expect(((await self.json()) as Err).error.code).toBe('SELF_APPROVAL');
    expect((await post(`/adjustments/${adj.id}/approve`, { note: 'Đồng ý' }, admin2)).status).toBe(200);
    expect((await get<{ amount_paid: number }>(`/invoices/${invoiceId}`)).amount_paid).toBe(800_000);
    expect((await post(`/adjustments/${adj.id}/approve`, {}, admin2)).status).toBe(422);
  });

  it('hủy giao dịch nhập nhầm (VOID) và từ chối điều chỉnh; không điều chỉnh vượt số đã thu', async () => {
    const { invoiceId } = await issuedInvoice();
    const r = await pay(invoiceId, 600_000);
    const pid = ((await r.json()) as { id: number }).id;
    expect((await post(`/invoices/${invoiceId}/adjustments`, { type: 'REFUND', amount: 700_000, reason: 'Hoàn quá số thu' })).status).toBe(422);
    const v = (await (await post(`/invoices/${invoiceId}/adjustments`, { type: 'VOID', paymentId: pid, reason: 'Thu nhầm học sinh' })).json()) as { id: number };
    await post(`/adjustments/${v.id}/approve`, {}, admin2);
    const d = await get<{ amount_paid: number; payments: { voided: number }[] }>(`/invoices/${invoiceId}`);
    expect(d.amount_paid).toBe(0);
    expect(d.payments[0]!.voided).toBe(1);
    expect((await post(`/invoices/${invoiceId}/adjustments`, { type: 'VOID', paymentId: pid, reason: 'Hủy lần hai' })).status).toBe(422);

    await pay(invoiceId, 100_000);
    const c = (await (await post(`/invoices/${invoiceId}/adjustments`, { type: 'CORRECTION', direction: 'DECREASE', amount: 50_000, reason: 'Ghi nhầm số' })).json()) as { id: number };
    expect((await post(`/adjustments/${c.id}/reject`, { note: 'Không đúng' }, admin2)).status).toBe(200);
    expect((await get<{ amount_paid: number }>(`/invoices/${invoiceId}`)).amount_paid).toBe(100_000);
    const audit = await env.DB.prepare(`SELECT count(*) n FROM audit_logs WHERE entity_type = 'invoice' AND entity_id = ? AND action LIKE 'adjustment.%'`).bind(invoiceId).first<{ n: number }>();
    expect(audit!.n).toBe(4); // đề nghị VOID, duyệt, đề nghị CORRECTION, từ chối (2 yêu cầu sai bị chặn từ đầu, không ghi)
  });
});

describe('Quá hạn, gói buổi, phân quyền', () => {
  it('cron 00:00: hóa đơn quá hạn chuyển "Quá hạn" + thông báo phụ huynh một lần', async () => {
    const sid = await newStudent();
    const gUser = await createUser({ role: 'GUARDIAN' });
    const gid = (await get<{ guardians: { id: number }[] }>(`/students/${sid}`)).guardians[0]!.id;
    await env.DB.prepare('UPDATE guardians SET user_id = ? WHERE id = ?').bind(gUser.id, gid).run();
    const inv = (await (await post('/invoices', { studentId: sid, periodLabel: 'Khóa hè', grossAmount: 2_000_000, dueDate: addDays(today, 5) })).json()) as { id: number };
    await env.DB.prepare('UPDATE invoices SET due_date = ? WHERE id = ?').bind(addDays(today, -1), inv.id).run();
    for (let i = 0; i < 2; i++) {
      const ctx = createExecutionContext();
      await worker.scheduled(createScheduledController({ cron: '0 17 * * *', scheduledTime: Date.now() }), env, ctx);
      await waitOnExecutionContext(ctx);
    }
    expect((await get<{ status: string }>(`/invoices/${inv.id}`)).status).toBe('OVERDUE');
    const notes = await env.DB.prepare(`SELECT body FROM notifications WHERE type = 'FEE_OVERDUE' AND user_id = ?`).bind(gUser.id).all<{ body: string }>();
    expect(notes.results).toHaveLength(1);
    expect(notes.results[0]!.body).toContain('2.000.000 ₫');
    const outstanding = await get<{ data: { id: number }[] }>(`/invoices?status=OVERDUE&studentId=${sid}`);
    expect(outstanding.data.map((x) => x.id)).toEqual([inv.id]);

    // phụ huynh xem học phí của con (không thấy gói/nháp); học sinh khác → 404; giáo viên không có quyền
    const g = (await loginMobile(gUser)).accessToken;
    const mine = await get<{ plans: unknown[]; invoices: unknown[]; outstanding: number }>(`/students/${sid}/fees`, g);
    expect(mine.plans).toHaveLength(0);
    expect(mine.outstanding).toBe(2_000_000);
    expect((await api(`/students/${await newStudent()}/fees`, { headers: bearer(g) })).status).toBe(404);
    const t = (await loginMobile(await createUser({ role: 'TEACHER' }))).accessToken;
    expect((await api('/invoices', { headers: bearer(t) })).status).toBe(403);
  });

  it('gói buổi: số buổi còn lại = đã mua − (có mặt + muộn + vắng không phép)', async () => {
    const sid = await newStudent();
    await post('/invoices', { studentId: sid, periodLabel: 'Gói 12 buổi', periodStart: addDays(today, -10), sessionsPurchased: 12, grossAmount: 1_800_000, dueDate: today });
    const t = await post('/teachers', { fullName: 'GV Phí', email: `gv${uid()}@t.vn` });
    const teacherId = ((await t.json()) as { id: number }).id;
    const shift = ((await (await post('/shifts', { name: `C${uid()}`, startTime: '06:00', endTime: '07:00' })).json()) as { id: number }).id;
    const cls = ((await (await post('/classes', { classCode: `F${uid()}`, name: 'Lớp phí', mainTeacherId: teacherId, maxStudents: 5, startDate: addDays(today, -10), schedules: [{ shiftId: shift, weekday: 1 }] })).json()) as { id: number }).id;
    const marker = await createUser();
    const statuses = ['PRESENT', 'LATE', 'EXCUSED', 'UNEXCUSED'];
    for (const [i, st] of statuses.entries()) {
      const l = await env.DB.prepare(`INSERT INTO lessons (class_id, lesson_date, start_time, end_time, teacher_id) VALUES (?, ?, '06:00', '07:00', ?) RETURNING id`)
        .bind(cls, addDays(today, -i - 1), teacherId)
        .first<{ id: number }>();
      await env.DB.prepare(`INSERT INTO attendance_records (lesson_id, student_id, status, marked_by, marked_at) VALUES (?, ?, ?, ?, '2026-01-01T00:00:00Z')`).bind(l!.id, sid, st, marker.id).run();
    }
    const f = await get<{ sessions: { purchased: number; used: number; remaining: number } }>(`/students/${sid}/fees`);
    expect(f.sessions).toMatchObject({ purchased: 12, used: 3, remaining: 9 });
  });

  it('khấu trừ buổi vắng (có phép + không phép) của kỳ trước vào hóa đơn kỳ sau, mỗi kỳ chỉ trừ một lần', async () => {
    const sid = await newStudent();
    const plan = await newPlan('MONTHLY', 1_800_000);
    await post(`/students/${sid}/fee-plans`, { feePlanId: plan, effectiveFrom: '2026-10-01' });
    const t = await post('/teachers', { fullName: 'GV Vắng', email: `gv${uid()}@t.vn` });
    const teacherId = ((await t.json()) as { id: number }).id;
    const shift = ((await (await post('/shifts', { name: `C${uid()}`, startTime: '05:00', endTime: '06:00' })).json()) as { id: number }).id;
    const cls = ((await (await post('/classes', { classCode: `V${uid()}`, name: 'Lớp vắng', mainTeacherId: teacherId, maxStudents: 5, startDate: '2026-10-01', schedules: [{ shiftId: shift, weekday: 7 }] })).json()) as { id: number }).id;
    await env.DB.prepare(`INSERT INTO class_enrollments (class_id, student_id, start_date, status) VALUES (?, ?, '2026-10-01', 'ACTIVE')`).bind(cls, sid).run();
    const marker = await createUser();
    // 8 buổi diễn ra trong tháng 10 + 1 buổi bị hủy (không tính); vắng 2 có phép + 1 không phép; muộn vẫn tính là đi học
    const statuses = ['EXCUSED', 'EXCUSED', 'UNEXCUSED', 'LATE', 'PRESENT', 'PRESENT', 'PRESENT', 'PRESENT'];
    for (const [i, st] of statuses.entries()) {
      const l = await env.DB.prepare(`INSERT INTO lessons (class_id, lesson_date, start_time, end_time, teacher_id) VALUES (?, ?, '05:00', '06:00', ?) RETURNING id`)
        .bind(cls, `2026-10-${String(i * 3 + 2).padStart(2, '0')}`, teacherId)
        .first<{ id: number }>();
      await env.DB.prepare(`INSERT INTO attendance_records (lesson_id, student_id, status, marked_by, marked_at) VALUES (?, ?, ?, ?, '2026-10-01T00:00:00Z')`).bind(l!.id, sid, st, marker.id).run();
    }
    await env.DB.prepare(`INSERT INTO lessons (class_id, lesson_date, start_time, end_time, teacher_id, status) VALUES (?, '2026-10-30', '05:00', '06:00', ?, 'CANCELLED')`).bind(cls, teacherId).run();

    await post('/invoices/generate', { period: '2026-10' });
    const oct = (await get<{ data: { id: number; amountDue: number }[] }>(`/invoices?studentId=${sid}&period=2026-10&status=ALL`)).data[0]!;
    expect(oct.amountDue).toBe(1_800_000);
    // nháp kỳ trước chưa phát hành thì chưa làm căn cứ khấu trừ
    await post('/invoices/generate', { period: '2026-11' });
    let nov = (await get<{ data: { id: number; amountDue: number }[] }>(`/invoices?studentId=${sid}&period=2026-11&status=ALL`)).data[0]!;
    expect(nov.amountDue).toBe(1_800_000);
    expect((await post(`/invoices/${nov.id}/cancel`, { reason: 'Tạo lại sau khi phát hành kỳ trước' })).status).toBe(200);

    await post('/invoices/issue', { ids: [oct.id] });
    await post('/invoices/generate', { period: '2026-11' });
    nov = (await get<{ data: { id: number; amountDue: number; status: string }[] }>(`/invoices?studentId=${sid}&period=2026-11`)).data[0]!;
    expect(nov.amountDue).toBe(1_125_000); // 1.800.000 − 3 × 225.000
    const d = await get<{ gross_amount: number; discount_amount: number; absence_deduction: number; absence_count: number; absence_session_total: number; absence_unit_price: number }>(`/invoices/${nov.id}`);
    expect(d).toMatchObject({ gross_amount: 1_800_000, discount_amount: 675_000, absence_deduction: 675_000, absence_count: 3, absence_session_total: 8, absence_unit_price: 225_000 });

    // nháp: chưa gửi được cho phụ huynh
    expect(((await (await post(`/invoices/${nov.id}/send`, {})).json()) as Err).error.code).toBe('NOT_ISSUED');

    // sửa giảm giá tay trên nháp: khoản trừ buổi vắng vẫn giữ
    expect((await patch(`/invoices/${nov.id}`, { discountAmount: 100_000 })).status).toBe(200);
    expect(await get(`/invoices/${nov.id}`)).toMatchObject({ discount_amount: 775_000, absence_deduction: 675_000, amount_due: 1_025_000 });

    await post('/invoices/issue', { ids: [nov.id] });
    type Statement = {
      center: { name: string };
      student: { fullName: string };
      invoice: { grossAmount: number; discountAmount: number; absenceDeduction: number; amountDue: number };
      absence: { periodLabel: string; count: number; sessionTotal: number; unitPrice: number; lessons: { date: string; status: string | null }[] };
    };
    const st = await get<Statement>(`/invoices/${nov.id}/statement`);
    expect(st.invoice).toMatchObject({ grossAmount: 1_800_000, discountAmount: 100_000, absenceDeduction: 675_000, amountDue: 1_025_000 });
    expect(st.absence).toMatchObject({ periodLabel: '2026-10', count: 3, sessionTotal: 8, unitPrice: 225_000 });
    expect(st.absence.lessons.map((l) => l.status)).toEqual(statuses);
    expect(st.center.name).toBeTruthy();

    // gửi cho phụ huynh: chưa có tài khoản → báo rõ; cấp tài khoản → gửi được, phụ huynh xem được hóa đơn chi tiết của con
    expect(((await (await post(`/invoices/${nov.id}/send`, {})).json()) as Err).error.code).toBe('NO_GUARDIAN_ACCOUNT');
    const detail = await get<{ guardians: { id: number; phone: string }[] }>(`/students/${sid}`);
    const acc = (await (await post(`/guardians/${detail.guardians[0]!.id}/account`, {})).json()) as { login: string; tempPassword: string };
    const sent = await post(`/invoices/${nov.id}/send`, {});
    expect(await sent.json()).toEqual({ sent: 1, withoutAccount: 0 });
    const gl = await api('/auth/login', json({ identifier: acc.login, password: acc.tempPassword, client: 'MOBILE' }));
    const gToken = ((await gl.json()) as { accessToken: string }).accessToken;
    await env.DB.prepare(`UPDATE users SET must_change_password = 0 WHERE phone = ?`).bind(acc.login).run();
    const gs = await api(`/invoices/${nov.id}/statement`, { headers: bearer(gToken) });
    expect(gs.status).toBe(200);
    expect(((await gs.json()) as Statement).invoice.amountDue).toBe(1_025_000);
    const n = await env.DB.prepare(`SELECT type, data FROM notifications WHERE user_id = (SELECT id FROM users WHERE phone = ?)`).bind(acc.login).first<{ type: string; data: string }>();
    expect(n).toMatchObject({ type: 'FEE_DUE' });
    expect(JSON.parse(n!.data)).toEqual({ invoiceId: nov.id, kind: 'INVOICE' });
    // phụ huynh học sinh khác không xem được
    const other = await createUser({ role: 'GUARDIAN' });
    expect((await api(`/invoices/${nov.id}/statement`, { headers: bearer((await loginMobile(other)).accessToken) })).status).toBe(404);

    // tháng 10 đã được dùng làm căn cứ → tháng 12 không trừ lại
    await post('/invoices/generate', { period: '2026-12' });
    const dec = (await get<{ data: { amountDue: number }[] }>(`/invoices?studentId=${sid}&period=2026-12&status=ALL`)).data[0]!;
    expect(dec.amountDue).toBe(1_800_000); // tháng 11 chưa có buổi học nào trong lớp này
  });

  it('sổ thu tổng hợp theo phương thức', async () => {
    const { invoiceId } = await issuedInvoice();
    await api(`/invoices/${invoiceId}/payments`, json({ amount: 200_000, method: 'BANK_TRANSFER', referenceNo: 'FT123' }, { headers: { ...bearer(admin), 'Idempotency-Key': crypto.randomUUID() } }));
    const led = await get<{ summary: { gross: number; byMethod: Record<string, number> }; data: { invoiceId: number }[] }>(`/payments?from=${today}&to=${today}`);
    expect(led.data.some((p) => p.invoiceId === invoiceId)).toBe(true);
    expect(led.summary.byMethod.BANK_TRANSFER).toBeGreaterThanOrEqual(200_000);
    const pid = led.data.find((p) => p.invoiceId === invoiceId) as unknown as { id: number };
    const receipt = await get<{ paymentCode: string; studentName: string }>(`/payments/${pid.id}/receipt`);
    expect(receipt.studentName).toBe('Học Sinh Phí');
    expect((await patch(`/invoices/${invoiceId}`, { discountAmount: 0 })).status).toBe(422); // đã phát hành thì không sửa trực tiếp
  });
});
