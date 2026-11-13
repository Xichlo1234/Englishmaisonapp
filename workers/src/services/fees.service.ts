/**
 * Học phí: gói học phí, gói riêng từng học sinh, hóa đơn (kỳ thu), giao dịch thu (BẤT BIẾN), điều chỉnh có duyệt.
 * - Tiền là số nguyên VND. invoices.amount_paid luôn = Σ payments + Σ điều chỉnh đã duyệt (cập nhật trong cùng batch).
 * - Giao dịch thu không sửa/xóa (trigger DB). Sai sót → phiếu điều chỉnh (REFUND / CORRECTION / VOID) cần người khác duyệt.
 * - Mã: HD-YYYYMM-0001 (hóa đơn), PT-YYYYMMDD-0001 (phiếu thu), DC-YYYYMMDD-0001 (điều chỉnh).
 */
import { sql, type SQL } from 'drizzle-orm';
import {
  addDays,
  computeDiscount,
  deriveInvoiceStatus,
  normalizeSearch,
  vnDate,
  type InvoiceStatus,
} from '@ecm/shared';
import type { AuthUser } from '../env';
import type { DB } from '../db/client';
import { runBatch, rowsOf, type BatchStatement } from '../lib/batch';
import { Errors } from '../lib/errors';
import { nowIso } from '../lib/time';
import { auditInsert, type AuditMeta } from './audit.service';
import { assertStudentAccess } from './scope';

/** Biểu thức trạng thái sau khi amount_paid thay đổi `delta` (dùng trong UPDATE — cột tham chiếu giá trị CŨ). */
const statusAfter = (delta: SQL | number, today: string) => sql`CASE
  WHEN status IN ('DRAFT', 'CANCELLED') THEN status
  WHEN amount_paid + ${delta} >= amount_due THEN 'PAID'
  WHEN due_date IS NOT NULL AND due_date < ${today} THEN 'OVERDUE'
  WHEN amount_paid + ${delta} > 0 THEN 'PARTIAL'
  ELSE 'UNPAID' END`;

async function setting<T>(db: DB, key: string, fallback: T): Promise<T> {
  const [r] = await db.all<{ value: string }>(sql`SELECT value FROM system_settings WHERE key = ${key}`);
  return r ? (JSON.parse(r.value) as T) : fallback;
}

// ───────────── Gói học phí ─────────────

export async function listFeePlans(db: DB) {
  return db.all<{
    id: number;
    code: string;
    name: string;
    billingType: string;
    amount: number;
    sessionCount: number | null;
    englishLevel: string | null;
    description: string | null;
    isActive: number;
    studentCount: number;
  }>(sql`SELECT f.id, f.code, f.name, f.billing_type AS billingType, f.amount, f.session_count AS sessionCount, f.english_level AS englishLevel,
                f.description, f.is_active AS isActive,
                (SELECT count(DISTINCT sfp.student_id) FROM student_fee_plans sfp WHERE sfp.fee_plan_id = f.id
                   AND (sfp.effective_to IS NULL OR sfp.effective_to >= ${vnDate()})) AS studentCount
           FROM fee_plans f ORDER BY f.is_active DESC, f.billing_type, f.name`);
}

export async function createFeePlan(
  db: DB,
  meta: AuditMeta,
  input: { code: string; name: string; billingType: string; amount: number; sessionCount?: number | null; englishLevel?: string | null; description?: string | null; isActive: boolean },
) {
  const [dup] = await db.all<{ id: number }>(sql`SELECT id FROM fee_plans WHERE code = ${input.code}`);
  if (dup) throw Errors.conflict('DUPLICATE_CODE', 'Mã gói đã tồn tại');
  const [row] = await db.all<{ id: number }>(sql`
    INSERT INTO fee_plans (code, name, billing_type, amount, session_count, english_level, description, is_active)
    VALUES (${input.code}, ${input.name}, ${input.billingType}, ${input.amount}, ${input.sessionCount ?? null}, ${input.englishLevel ?? null}, ${input.description ?? null}, ${input.isActive ? 1 : 0})
    RETURNING id`);
  await auditInsert(db, meta, { action: 'fee_plan.create', entityType: 'fee_plan', entityId: row!.id, after: input });
  return row!;
}

export async function updateFeePlan(db: DB, meta: AuditMeta, id: number, input: Record<string, unknown>) {
  const [p] = await db.all<{ id: number; billing_type: string }>(sql`SELECT id, billing_type FROM fee_plans WHERE id = ${id}`);
  if (!p) throw Errors.notFound('Gói học phí');
  if (p.billing_type === 'PER_SESSION' && input.sessionCount === null) throw Errors.validation([{ path: 'sessionCount', message: 'Gói theo buổi cần số buổi' }]);
  const map: Record<string, string> = { name: 'name', amount: 'amount', sessionCount: 'session_count', englishLevel: 'english_level', description: 'description', isActive: 'is_active' };
  const sets = Object.entries(input)
    .filter(([k, v]) => v !== undefined && map[k])
    .map(([k, v]) => sql`${sql.raw(map[k]!)} = ${typeof v === 'boolean' ? (v ? 1 : 0) : (v as string | number | null)}`);
  if (!sets.length) return;
  await runBatch(db, [
    sql`UPDATE fee_plans SET ${sql.join(sets, sql`, `)}, updated_at = ${nowIso()} WHERE id = ${id}`,
    auditInsert(db, meta, { action: 'fee_plan.update', entityType: 'fee_plan', entityId: id, after: input }),
  ]);
}

// ───────────── Gói của từng học sinh ─────────────

export async function addStudentFeePlan(
  db: DB,
  meta: AuditMeta,
  user: AuthUser,
  studentId: number,
  input: {
    feePlanId: number;
    classId?: number | null;
    customAmount?: number | null;
    discountType: 'NONE' | 'AMOUNT' | 'PERCENT';
    discountValue: number;
    discountReason?: string | null;
    effectiveFrom: string;
    effectiveTo?: string | null;
  },
) {
  const [s] = await db.all<{ id: number }>(sql`SELECT id FROM students WHERE id = ${studentId} AND deleted_at IS NULL`);
  if (!s) throw Errors.notFound('Học sinh');
  const [p] = await db.all<{ id: number; is_active: number; billing_type: string }>(sql`SELECT id, is_active, billing_type FROM fee_plans WHERE id = ${input.feePlanId}`);
  if (!p || !p.is_active) throw Errors.business('PLAN_NOT_ACTIVE', 'Gói học phí không tồn tại hoặc đã ngừng');
  // Một học sinh chỉ có một gói THÁNG hiệu lực tại một thời điểm (tránh thu trùng)
  if (p.billing_type === 'MONTHLY') {
    const [overlap] = await db.all<{ n: number }>(sql`
      SELECT count(*) AS n FROM student_fee_plans sfp JOIN fee_plans f ON f.id = sfp.fee_plan_id
       WHERE sfp.student_id = ${studentId} AND f.billing_type = 'MONTHLY'
         AND sfp.effective_from <= ${input.effectiveTo ?? '9999-12-31'} AND ${input.effectiveFrom} <= coalesce(sfp.effective_to, '9999-12-31')`);
    if (overlap!.n) throw Errors.business('PLAN_OVERLAP', 'Học sinh đã có gói theo tháng trong khoảng thời gian này. Hãy kết thúc gói cũ trước.');
  }
  const [row] = await db.all<{ id: number }>(sql`
    INSERT INTO student_fee_plans (student_id, fee_plan_id, class_id, custom_amount, discount_type, discount_value, discount_reason, effective_from, effective_to, created_by)
    VALUES (${studentId}, ${input.feePlanId}, ${input.classId ?? null}, ${input.customAmount ?? null}, ${input.discountType}, ${input.discountValue},
            ${input.discountReason ?? null}, ${input.effectiveFrom}, ${input.effectiveTo ?? null}, ${user.id})
    RETURNING id`);
  await auditInsert(db, meta, { action: 'student.fee_plan_add', entityType: 'student', entityId: studentId, after: input });
  return row!;
}

export async function endStudentFeePlan(db: DB, meta: AuditMeta, id: number, effectiveTo: string) {
  const [r] = await db.all<{ student_id: number; effective_from: string }>(sql`SELECT student_id, effective_from FROM student_fee_plans WHERE id = ${id}`);
  if (!r) throw Errors.notFound('Gói học phí của học sinh');
  if (effectiveTo < r.effective_from) throw Errors.validation([{ path: 'effectiveTo', message: 'Ngày kết thúc phải sau ngày bắt đầu' }]);
  await runBatch(db, [
    sql`UPDATE student_fee_plans SET effective_to = ${effectiveTo}, updated_at = ${nowIso()} WHERE id = ${id}`,
    auditInsert(db, meta, { action: 'student.fee_plan_end', entityType: 'student', entityId: r.student_id, after: { studentFeePlanId: id, effectiveTo } }),
  ]);
}

// ───────────── Hóa đơn ─────────────

const invoiceCodeSql = (period: string) =>
  sql`printf('HD-%s-%04d', ${period.replace('-', '')}, (SELECT count(*) + 1 FROM invoices WHERE invoice_code LIKE ${`HD-${period.replace('-', '')}-%`}))`;

export interface AbsenceDeduction {
  amount: number;
  count: number;
  sessionTotal: number | null;
  unitPrice: number | null;
  sourceInvoiceId: number | null;
}
const NO_DEDUCTION: AbsenceDeduction = { amount: 0, count: 0, sessionTotal: null, unitPrice: null, sourceInvoiceId: null };

/**
 * Every absence (excused or not) in the previous invoice period of the same student fee plan is refunded on the next one:
 * net fee of that period × absences ÷ non-cancelled lessons held. Each previous invoice is used as a source at most once.
 */
export async function absenceDeductionFor(db: DB, sfpId: number, beforeDate: string): Promise<AbsenceDeduction> {
  const [prev] = await db.all<{ id: number; student_id: number; class_id: number | null; period_start: string; period_end: string; net: number }>(sql`
    SELECT i.id, i.student_id, sfp.class_id, i.period_start, i.period_end, i.gross_amount - (i.discount_amount - i.absence_deduction) AS net
      FROM invoices i JOIN student_fee_plans sfp ON sfp.id = i.student_fee_plan_id
     WHERE i.student_fee_plan_id = ${sfpId} AND i.status NOT IN ('DRAFT', 'CANCELLED')
       AND i.period_start IS NOT NULL AND i.period_end < ${beforeDate}
       AND NOT EXISTS (SELECT 1 FROM invoices n WHERE n.absence_source_invoice_id = i.id AND n.status <> 'CANCELLED')
     ORDER BY i.period_end DESC LIMIT 1`);
  if (!prev || prev.net <= 0) return NO_DEDUCTION;
  const [r] = await db.all<{ total: number; absent: number }>(sql`
    SELECT count(*) AS total,
           coalesce(sum(EXISTS (SELECT 1 FROM attendance_records ar WHERE ar.lesson_id = l.id AND ar.student_id = ${prev.student_id}
                                  AND ar.status IN ('EXCUSED', 'UNEXCUSED'))), 0) AS absent
      FROM lessons l
     WHERE l.status <> 'CANCELLED' AND l.lesson_date BETWEEN ${prev.period_start} AND ${prev.period_end}
       ${prev.class_id ? sql`AND l.class_id = ${prev.class_id}` : sql.empty()}
       AND EXISTS (SELECT 1 FROM class_enrollments ce WHERE ce.class_id = l.class_id AND ce.student_id = ${prev.student_id}
                     AND ce.start_date <= l.lesson_date AND coalesce(ce.end_date, '9999-12-31') >= l.lesson_date)`);
  if (!r || !r.total || !r.absent) return { ...NO_DEDUCTION, sessionTotal: r?.total ?? null };
  return {
    amount: Math.round((prev.net * r.absent) / r.total),
    count: r.absent,
    sessionTotal: r.total,
    unitPrice: Math.round(prev.net / r.total),
    sourceInvoiceId: prev.id,
  };
}

/**
 * Tạo NHÁP hóa đơn tháng cho học sinh đang học có gói THÁNG hiệu lực trong kỳ (chưa có hóa đơn kỳ đó).
 * Quản lý kiểm tra rồi phát hành (Q7).
 */
export async function generateMonthlyDrafts(db: DB, meta: AuditMeta, user: AuthUser, period: string) {
  const [y, m] = period.split('-').map(Number) as [number, number];
  const start = `${period}-01`;
  const end = addDays(m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`, -1);
  const dueDay = Math.min(28, Math.max(1, await setting<number>(db, 'invoice_due_day', 10)));
  const dueDate = `${period}-${String(dueDay).padStart(2, '0')}`;
  const candidates = await db.all<{
    sfp_id: number;
    student_id: number;
    amount: number;
    custom_amount: number | null;
    discount_type: 'NONE' | 'AMOUNT' | 'PERCENT';
    discount_value: number;
    plan_name: string;
    exists_invoice: number;
  }>(sql`
    SELECT sfp.id AS sfp_id, sfp.student_id, f.amount, sfp.custom_amount, sfp.discount_type, sfp.discount_value, f.name AS plan_name,
           EXISTS (SELECT 1 FROM invoices i WHERE i.student_id = sfp.student_id AND i.student_fee_plan_id = sfp.id
                     AND i.period_label = ${period} AND i.status <> 'CANCELLED') AS exists_invoice
      FROM student_fee_plans sfp JOIN fee_plans f ON f.id = sfp.fee_plan_id JOIN students s ON s.id = sfp.student_id
     WHERE f.billing_type = 'MONTHLY' AND s.status = 'ACTIVE' AND s.deleted_at IS NULL
       AND sfp.effective_from <= ${end} AND coalesce(sfp.effective_to, '9999-12-31') >= ${start}`);
  const todo = candidates.filter((c) => !c.exists_invoice);
  if (todo.length) {
    const deductions = await Promise.all(todo.map((c) => absenceDeductionFor(db, c.sfp_id, start)));
    const stmts: BatchStatement[] = todo.map((c, idx) => {
      const gross = c.custom_amount ?? c.amount;
      const planDiscount = computeDiscount(gross, c.discount_type, c.discount_value);
      const d = deductions[idx]!;
      const absence = Math.min(d.amount, gross - planDiscount);
      const discount = planDiscount + absence;
      return sql`INSERT INTO invoices (invoice_code, student_id, student_fee_plan_id, period_label, period_start, period_end, gross_amount, discount_amount,
                                       absence_deduction, absence_count, absence_session_total, absence_unit_price, absence_source_invoice_id,
                                       amount_due, due_date, status, note, created_by)
                 VALUES (${invoiceCodeSql(period)}, ${c.student_id}, ${c.sfp_id}, ${period}, ${start}, ${end}, ${gross}, ${discount},
                         ${absence}, ${d.count}, ${d.sessionTotal}, ${d.unitPrice}, ${d.sourceInvoiceId},
                         ${gross - discount}, ${dueDate}, 'DRAFT', ${`Học phí ${c.plan_name} tháng ${m}/${y}`}, ${user.id})`;
    });
    stmts.push(auditInsert(db, meta, { action: 'invoice.generate', entityType: 'invoice', after: { period, created: todo.length } }));
    await runBatch(db, stmts);
  }
  return { created: todo.length, skipped: candidates.length - todo.length, period, dueDate };
}

export async function issueInvoices(db: DB, meta: AuditMeta, ids: number[]) {
  const now = nowIso();
  const today = vnDate();
  const res = await runBatch(db, [
    sql`UPDATE invoices SET status = CASE WHEN due_date IS NOT NULL AND due_date < ${today} THEN 'OVERDUE' ELSE 'UNPAID' END,
               issued_at = ${now}, updated_at = ${now}, version = version + 1
         WHERE status = 'DRAFT' AND id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`,
    auditInsert(db, meta, { action: 'invoice.issue', entityType: 'invoice', after: { ids } }),
  ]);
  return { issued: res[0]?.meta.changes ?? 0 };
}

export async function createInvoice(
  db: DB,
  meta: AuditMeta,
  user: AuthUser,
  input: {
    studentId: number;
    studentFeePlanId?: number | null;
    periodLabel: string;
    periodStart?: string | null;
    periodEnd?: string | null;
    sessionsPurchased?: number | null;
    grossAmount: number;
    discountAmount: number;
    dueDate: string;
    note?: string | null;
    issue: boolean;
  },
) {
  const [s] = await db.all<{ id: number }>(sql`SELECT id FROM students WHERE id = ${input.studentId} AND deleted_at IS NULL`);
  if (!s) throw Errors.notFound('Học sinh');
  if (input.discountAmount > input.grossAmount) throw Errors.validation([{ path: 'discountAmount', message: 'Giảm giá lớn hơn số tiền' }]);
  if (input.studentFeePlanId) {
    const [sfp] = await db.all<{ student_id: number }>(sql`SELECT student_id FROM student_fee_plans WHERE id = ${input.studentFeePlanId}`);
    if (!sfp || sfp.student_id !== input.studentId) throw Errors.business('PLAN_MISMATCH', 'Gói học phí không thuộc học sinh này');
    const [dup] = await db.all<{ n: number }>(
      sql`SELECT count(*) AS n FROM invoices WHERE student_id = ${input.studentId} AND student_fee_plan_id = ${input.studentFeePlanId} AND period_label = ${input.periodLabel} AND status <> 'CANCELLED'`,
    );
    if (dup!.n) throw Errors.conflict('DUPLICATE_INVOICE', 'Đã có hóa đơn cho kỳ này');
  }
  const d = input.studentFeePlanId && input.periodStart ? await absenceDeductionFor(db, input.studentFeePlanId, input.periodStart) : NO_DEDUCTION;
  const absence = Math.min(d.amount, input.grossAmount - input.discountAmount);
  const discount = input.discountAmount + absence;
  const period = vnDate().slice(0, 7);
  const today = vnDate();
  const status: InvoiceStatus = !input.issue ? 'DRAFT' : input.dueDate < today ? 'OVERDUE' : 'UNPAID';
  const [row] = await db.all<{ id: number; invoice_code: string }>(sql`
    INSERT INTO invoices (invoice_code, student_id, student_fee_plan_id, period_label, period_start, period_end, sessions_purchased,
                          gross_amount, discount_amount, absence_deduction, absence_count, absence_session_total, absence_unit_price, absence_source_invoice_id,
                          amount_due, due_date, status, note, issued_at, created_by)
    VALUES (${invoiceCodeSql(period)}, ${input.studentId}, ${input.studentFeePlanId ?? null}, ${input.periodLabel}, ${input.periodStart ?? null},
            ${input.periodEnd ?? null}, ${input.sessionsPurchased ?? null}, ${input.grossAmount}, ${discount},
            ${absence}, ${d.count}, ${d.sessionTotal}, ${d.unitPrice}, ${d.sourceInvoiceId},
            ${input.grossAmount - discount}, ${input.dueDate}, ${status}, ${input.note ?? null}, ${input.issue ? nowIso() : null}, ${user.id})
    RETURNING id, invoice_code`);
  await auditInsert(db, meta, { action: 'invoice.create', entityType: 'invoice', entityId: row!.id, after: input });
  return { id: row!.id, invoiceCode: row!.invoice_code };
}

export async function updateDraftInvoice(db: DB, meta: AuditMeta, id: number, input: { discountAmount?: number; dueDate?: string; note?: string | null }) {
  const [i] = await db.all<{ status: string; gross_amount: number; discount_amount: number; absence_deduction: number; due_date: string | null; note: string | null }>(
    sql`SELECT status, gross_amount, discount_amount, absence_deduction, due_date, note FROM invoices WHERE id = ${id}`,
  );
  if (!i) throw Errors.notFound('Hóa đơn');
  if (i.status !== 'DRAFT') throw Errors.business('NOT_DRAFT', 'Chỉ sửa được hóa đơn nháp. Hóa đơn đã phát hành cần điều chỉnh qua phiếu điều chỉnh.');
  // discountAmount from the client is the manual discount only; the absence deduction stays on top of it.
  const discount = input.discountAmount !== undefined ? input.discountAmount + i.absence_deduction : i.discount_amount;
  if (discount > i.gross_amount) throw Errors.validation([{ path: 'discountAmount', message: 'Giảm giá lớn hơn số tiền' }]);
  await runBatch(db, [
    sql`UPDATE invoices SET discount_amount = ${discount}, amount_due = gross_amount - ${discount}, due_date = ${input.dueDate ?? i.due_date},
               note = ${input.note !== undefined ? input.note : i.note}, updated_at = ${nowIso()}, version = version + 1
         WHERE id = ${id} AND status = 'DRAFT'`,
    auditInsert(db, meta, { action: 'invoice.update_draft', entityType: 'invoice', entityId: id, before: i, after: input }),
  ]);
}

export async function cancelInvoice(db: DB, meta: AuditMeta, id: number, reason: string) {
  const [i] = await db.all<{ status: string; amount_paid: number; pending: number }>(sql`
    SELECT status, amount_paid, (SELECT count(*) FROM payment_adjustments a WHERE a.invoice_id = invoices.id AND a.status = 'PENDING') AS pending
      FROM invoices WHERE id = ${id}`);
  if (!i) throw Errors.notFound('Hóa đơn');
  if (i.status === 'CANCELLED') throw Errors.business('ALREADY_CANCELLED', 'Hóa đơn đã hủy');
  if (i.amount_paid > 0) throw Errors.business('HAS_PAYMENTS', 'Hóa đơn đã thu tiền. Cần hoàn tiền/hủy giao dịch (có duyệt) trước khi hủy hóa đơn.');
  if (i.pending) throw Errors.business('PENDING_ADJUSTMENTS', 'Hóa đơn còn phiếu điều chỉnh chờ duyệt');
  await runBatch(db, [
    sql`UPDATE invoices SET status = 'CANCELLED', cancelled_at = ${nowIso()}, cancel_reason = ${reason}, updated_at = ${nowIso()}, version = version + 1
         WHERE id = ${id} AND amount_paid = 0 AND status <> 'CANCELLED'`,
    auditInsert(db, meta, { action: 'invoice.cancel', entityType: 'invoice', entityId: id, reason }),
  ]);
}

export async function listInvoices(
  db: DB,
  q: { status?: string; period?: string; classId?: number; studentId?: number; q?: string; page: number; pageSize: number },
) {
  const today = vnDate();
  const conds: SQL[] = [sql`1 = 1`];
  if (q.status === 'OUTSTANDING') conds.push(sql`i.status IN ('UNPAID', 'PARTIAL', 'OVERDUE')`);
  else if (q.status === 'OVERDUE') conds.push(sql`(i.status = 'OVERDUE' OR (i.status IN ('UNPAID', 'PARTIAL') AND i.due_date < ${today}))`);
  else if (q.status && q.status !== 'ALL') conds.push(sql`i.status = ${q.status}`);
  else if (!q.status) conds.push(sql`i.status <> 'CANCELLED'`);
  if (q.period) conds.push(sql`i.period_label = ${q.period}`);
  if (q.studentId) conds.push(sql`i.student_id = ${q.studentId}`);
  if (q.classId)
    conds.push(sql`EXISTS (SELECT 1 FROM class_enrollments ce WHERE ce.student_id = i.student_id AND ce.class_id = ${q.classId} AND ce.status = 'ACTIVE')`);
  if (q.q) {
    const t = `%${normalizeSearch(q.q).replace(/[%_]/g, '')}%`;
    conds.push(sql`(s.full_name_search LIKE ${t} OR lower(s.student_code) LIKE ${t} OR lower(i.invoice_code) LIKE ${t})`);
  }
  const where = sql.join(conds, sql` AND `);
  const [rows, totals] = await runBatch(db, [
    sql`SELECT i.id, i.invoice_code AS invoiceCode, i.student_id AS studentId, s.student_code AS studentCode, s.full_name AS studentName,
               i.period_label AS periodLabel, i.amount_due AS amountDue, i.amount_paid AS amountPaid, i.due_date AS dueDate, i.status,
               i.note, i.sessions_purchased AS sessionsPurchased
          FROM invoices i JOIN students s ON s.id = i.student_id
         WHERE ${where}
         ORDER BY CASE i.status WHEN 'DRAFT' THEN 0 WHEN 'OVERDUE' THEN 1 WHEN 'PARTIAL' THEN 2 WHEN 'UNPAID' THEN 3 ELSE 4 END, i.due_date, s.full_name_search
         LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`,
    sql`SELECT count(*) AS n, coalesce(sum(CASE WHEN i.status NOT IN ('DRAFT','CANCELLED') THEN i.amount_due END), 0) AS due,
               coalesce(sum(CASE WHEN i.status NOT IN ('DRAFT','CANCELLED') THEN i.amount_paid END), 0) AS paid
          FROM invoices i JOIN students s ON s.id = i.student_id WHERE ${where}`,
  ]);
  const t = rowsOf<{ n: number; due: number; paid: number }>(totals)[0]!;
  return {
    data: rowsOf<{ id: number; amountDue: number; amountPaid: number; dueDate: string | null; status: InvoiceStatus }>(rows).map((r) => ({
      ...r,
      remaining: r.amountDue - r.amountPaid,
      status: deriveInvoiceStatus({ amountDue: r.amountDue, amountPaid: r.amountPaid, dueDate: r.dueDate, today, isDraft: r.status === 'DRAFT', isCancelled: r.status === 'CANCELLED' }),
    })),
    page: q.page,
    pageSize: q.pageSize,
    total: t.n,
    summary: { due: t.due, paid: t.paid, remaining: t.due - t.paid },
  };
}

export async function getInvoice(db: DB, user: AuthUser, id: number) {
  const [i] = await db.all<Record<string, unknown> & { student_id: number; amount_due: number; amount_paid: number; due_date: string | null; status: InvoiceStatus }>(sql`
    SELECT i.*, s.full_name AS student_name, s.student_code, f.name AS plan_name, f.billing_type, cu.full_name AS created_by_name
      FROM invoices i JOIN students s ON s.id = i.student_id
      LEFT JOIN student_fee_plans sfp ON sfp.id = i.student_fee_plan_id LEFT JOIN fee_plans f ON f.id = sfp.fee_plan_id
      LEFT JOIN users cu ON cu.id = i.created_by
     WHERE i.id = ${id}`);
  if (!i) throw Errors.notFound('Hóa đơn');
  if (!user.permissions.has('fees.read')) {
    await assertStudentAccess(db, user, i.student_id);
    if (i.status === 'DRAFT') throw Errors.notFound('Hóa đơn');
  }
  const payments = await db.all(sql`
    SELECT p.id, p.payment_code AS paymentCode, p.amount, p.method, p.reference_no AS referenceNo, p.paid_at AS paidAt, p.note,
           u.full_name AS receivedBy, p.created_at AS createdAt,
           EXISTS (SELECT 1 FROM payment_adjustments a WHERE a.payment_id = p.id AND a.type = 'VOID' AND a.status = 'APPROVED') AS voided
      FROM payments p JOIN users u ON u.id = p.received_by WHERE p.invoice_id = ${id} ORDER BY p.id`);
  const adjustments = await db.all(sql`
    SELECT a.id, a.adjustment_code AS adjustmentCode, a.type, a.amount, a.reason, a.status, a.payment_id AS paymentId,
           ru.full_name AS requestedBy, a.requested_at AS requestedAt, au.full_name AS approvedBy, a.approved_at AS approvedAt, a.decision_note AS decisionNote
      FROM payment_adjustments a JOIN users ru ON ru.id = a.requested_by LEFT JOIN users au ON au.id = a.approved_by
     WHERE a.invoice_id = ${id} ORDER BY a.id`);
  const today = vnDate();
  return {
    ...i,
    status: deriveInvoiceStatus({ amountDue: i.amount_due, amountPaid: i.amount_paid, dueDate: i.due_date, today, isDraft: i.status === 'DRAFT', isCancelled: i.status === 'CANCELLED' }),
    remaining: i.amount_due - i.amount_paid,
    payments,
    adjustments,
  };
}

// ───────────── Thu tiền (bất biến) ─────────────

export async function recordPayment(
  db: DB,
  meta: AuditMeta,
  user: AuthUser,
  invoiceId: number,
  input: { amount: number; method: string; referenceNo?: string | null; paidAt?: string; note?: string | null; idempotencyKey: string },
) {
  // Bấm hai lần / gửi lại → trả về giao dịch đã ghi
  const [existing] = await db.all<{ id: number; payment_code: string; invoice_id: number }>(
    sql`SELECT id, payment_code, invoice_id FROM payments WHERE idempotency_key = ${input.idempotencyKey}`,
  );
  if (existing) {
    if (existing.invoice_id !== invoiceId) throw Errors.conflict('IDEMPOTENCY_KEY_REUSED', 'Mã chống trùng đã dùng cho hóa đơn khác');
    return { id: existing.id, paymentCode: existing.payment_code, duplicate: true };
  }
  const [i] = await db.all<{ id: number; student_id: number; status: string; amount_due: number; amount_paid: number; version: number }>(
    sql`SELECT id, student_id, status, amount_due, amount_paid, version FROM invoices WHERE id = ${invoiceId}`,
  );
  if (!i) throw Errors.notFound('Hóa đơn');
  if (i.status === 'DRAFT') throw Errors.business('INVOICE_DRAFT', 'Hóa đơn chưa phát hành');
  if (i.status === 'CANCELLED') throw Errors.business('INVOICE_CANCELLED', 'Hóa đơn đã hủy');
  const remaining = i.amount_due - i.amount_paid;
  if (remaining <= 0) throw Errors.business('INVOICE_PAID', 'Hóa đơn đã thanh toán đủ');
  if (input.amount > remaining) throw Errors.business('OVERPAYMENT', `Số tiền vượt số còn thiếu (${remaining.toLocaleString('vi-VN')} ₫)`, { remaining });
  const today = vnDate();
  const paidAt = input.paidAt ?? today;
  if (paidAt > today) throw Errors.validation([{ path: 'paidAt', message: 'Ngày thu không được ở tương lai' }]);
  const dayCode = paidAt.replaceAll('-', '');
  const paidAtIso = paidAt === today ? nowIso() : `${paidAt}T05:00:00.000Z`; // 12:00 giờ VN cho ngày thu nhập lùi
  const guard = sql`(SELECT version FROM invoices WHERE id = ${invoiceId}) = ${i.version + 1}`;
  const res = await runBatch(db, [
    sql`UPDATE invoices SET amount_paid = amount_paid + ${input.amount}, status = ${statusAfter(input.amount, today)},
               version = version + 1, updated_at = ${nowIso()}
         WHERE id = ${invoiceId} AND version = ${i.version} AND amount_paid + ${input.amount} <= amount_due`,
    sql`INSERT INTO payments (payment_code, invoice_id, student_id, amount, method, reference_no, paid_at, received_by, note, idempotency_key)
        SELECT printf('PT-%s-%04d', ${dayCode}, (SELECT count(*) + 1 FROM payments WHERE payment_code LIKE ${`PT-${dayCode}-%`})),
               ${invoiceId}, ${i.student_id}, ${input.amount}, ${input.method}, ${input.referenceNo ?? null}, ${paidAtIso}, ${user.id}, ${input.note ?? null}, ${input.idempotencyKey}
         WHERE ${guard}`,
    sql`INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, after_data, ip, user_agent, request_id)
        SELECT ${user.id}, 'payment.create', 'invoice', ${invoiceId}, ${JSON.stringify({ ...input })}, ${meta.ip}, ${meta.userAgent}, ${meta.requestId} WHERE ${guard}`,
    sql`SELECT id, payment_code FROM payments WHERE idempotency_key = ${input.idempotencyKey}`,
  ]);
  if (!res[0]?.meta.changes) throw Errors.versionConflict();
  const p = rowsOf<{ id: number; payment_code: string }>(res[3])[0]!;
  return { id: p.id, paymentCode: p.payment_code, duplicate: false };
}

export type LedgerEntry =
  | {
      kind: 'RECEIPT';
      id: number;
      at: string;
      code: string;
      amount: number;
      method: string;
      studentName: string;
      studentCode: string;
      invoiceId: number;
      invoiceCode: string;
      actor: string;
      /** VOIDED: cancelled by an approved VOID; REVERSED: its invoice was cancelled after the money was reversed. */
      status: 'ACTIVE' | 'VOIDED' | 'REVERSED';
      invoiceCancelled: boolean;
    }
  | {
      kind: 'ADJUSTMENT';
      id: number;
      at: string;
      code: string;
      amount: number;
      method: string;
      studentName: string;
      studentCode: string;
      invoiceId: number;
      invoiceCode: string;
      actor: string;
      type: 'REFUND' | 'CORRECTION' | 'VOID';
      paymentCode: string | null;
      reason: string;
    };

const vnDay = (col: SQL) => sql`date(${col}, '+7 hours')`;

/**
 * Cash journal: receipts on their payment date and approved adjustments (reversals/refunds/corrections) on their
 * approval date, so a closed day never changes. Totals per method are net of adjustments.
 */
export async function listPayments(db: DB, q: { from: string; to: string; method?: string }) {
  const [receipts, adjustments] = await runBatch(db, [
    sql`SELECT p.id, p.paid_at AS at, p.payment_code AS code, p.amount, p.method, s.full_name AS studentName, s.student_code AS studentCode,
               i.id AS invoiceId, i.invoice_code AS invoiceCode, u.full_name AS actor, (i.status = 'CANCELLED') AS invoiceCancelled,
               EXISTS (SELECT 1 FROM payment_adjustments a WHERE a.payment_id = p.id AND a.type = 'VOID' AND a.status = 'APPROVED') AS voided
          FROM payments p JOIN students s ON s.id = p.student_id JOIN invoices i ON i.id = p.invoice_id JOIN users u ON u.id = p.received_by
         WHERE ${vnDay(sql`p.paid_at`)} BETWEEN ${q.from} AND ${q.to} ${q.method ? sql`AND p.method = ${q.method}` : sql.empty()}
         ORDER BY p.paid_at DESC, p.id DESC LIMIT 2000`,
    sql`SELECT a.id, a.approved_at AS at, a.adjustment_code AS code, a.amount, coalesce(a.method, 'OTHER') AS method, a.type, a.reason,
               s.full_name AS studentName, s.student_code AS studentCode, i.id AS invoiceId, i.invoice_code AS invoiceCode,
               u.full_name AS actor, p.payment_code AS paymentCode
          FROM payment_adjustments a JOIN invoices i ON i.id = a.invoice_id JOIN students s ON s.id = i.student_id
          JOIN users u ON u.id = a.approved_by LEFT JOIN payments p ON p.id = a.payment_id
         WHERE a.status = 'APPROVED' AND ${vnDay(sql`a.approved_at`)} BETWEEN ${q.from} AND ${q.to}
               ${q.method ? sql`AND coalesce(a.method, 'OTHER') = ${q.method}` : sql.empty()}
         ORDER BY a.approved_at DESC, a.id DESC LIMIT 2000`,
  ]);
  type ReceiptRow = Omit<Extract<LedgerEntry, { kind: 'RECEIPT' }>, 'kind' | 'status' | 'invoiceCancelled'> & { voided: number; invoiceCancelled: number };
  type AdjustmentRow = Omit<Extract<LedgerEntry, { kind: 'ADJUSTMENT' }>, 'kind'>;
  const entries: LedgerEntry[] = [
    ...rowsOf<ReceiptRow>(receipts).map(({ voided, invoiceCancelled, ...r }) => ({
      ...r,
      kind: 'RECEIPT' as const,
      status: voided ? ('VOIDED' as const) : invoiceCancelled ? ('REVERSED' as const) : ('ACTIVE' as const),
      invoiceCancelled: !!invoiceCancelled,
    })),
    ...rowsOf<AdjustmentRow>(adjustments).map((r) => ({ ...r, kind: 'ADJUSTMENT' as const })),
  ].sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : y.id - x.id));

  const byMethod: Record<string, number> = {};
  let receiptTotal = 0;
  let adjustmentTotal = 0;
  let receiptCount = 0;
  for (const e of entries) {
    byMethod[e.method] = (byMethod[e.method] ?? 0) + e.amount;
    if (e.kind === 'RECEIPT') (receiptTotal += e.amount), receiptCount++;
    else adjustmentTotal += e.amount;
  }
  return { data: entries, summary: { receipts: receiptTotal, adjustments: adjustmentTotal, net: receiptTotal + adjustmentTotal, byMethod, receiptCount } };
}

/** One row per day (VN time) in [from, to]: receipts by method, adjustments, net and running net. */
export async function dailyCollections(db: DB, q: { from: string; to: string }) {
  const [r, a] = await runBatch(db, [
    sql`SELECT ${vnDay(sql`paid_at`)} AS day, count(*) AS n,
               coalesce(sum(CASE WHEN method = 'CASH' THEN amount END), 0) AS cash,
               coalesce(sum(CASE WHEN method = 'BANK_TRANSFER' THEN amount END), 0) AS bank,
               coalesce(sum(CASE WHEN method NOT IN ('CASH', 'BANK_TRANSFER') THEN amount END), 0) AS other
          FROM payments WHERE ${vnDay(sql`paid_at`)} BETWEEN ${q.from} AND ${q.to} GROUP BY day`,
    sql`SELECT ${vnDay(sql`approved_at`)} AS day, count(*) AS n, coalesce(sum(amount), 0) AS total,
               coalesce(sum(CASE WHEN method = 'CASH' THEN amount END), 0) AS cash
          FROM payment_adjustments WHERE status = 'APPROVED' AND ${vnDay(sql`approved_at`)} BETWEEN ${q.from} AND ${q.to} GROUP BY day`,
  ]);
  const rec = new Map(rowsOf<{ day: string; n: number; cash: number; bank: number; other: number }>(r).map((x) => [x.day, x]));
  const adj = new Map(rowsOf<{ day: string; n: number; total: number; cash: number }>(a).map((x) => [x.day, x]));
  const last = q.to < vnDate() ? q.to : vnDate();
  const days: {
    day: string;
    receiptCount: number;
    cash: number;
    bank: number;
    other: number;
    adjustmentCount: number;
    adjustments: number;
    cashNet: number;
    net: number;
    runningNet: number;
  }[] = [];
  let running = 0;
  for (let d = q.from; d <= last; d = addDays(d, 1)) {
    const x = rec.get(d);
    const y = adj.get(d);
    const receipts = (x?.cash ?? 0) + (x?.bank ?? 0) + (x?.other ?? 0);
    const net = receipts + (y?.total ?? 0);
    running += net;
    days.push({
      day: d,
      receiptCount: x?.n ?? 0,
      cash: x?.cash ?? 0,
      bank: x?.bank ?? 0,
      other: x?.other ?? 0,
      adjustmentCount: y?.n ?? 0,
      adjustments: y?.total ?? 0,
      cashNet: (x?.cash ?? 0) + (y?.cash ?? 0),
      net,
      runningNet: running,
    });
  }
  const sum = (k: 'receiptCount' | 'cash' | 'bank' | 'other' | 'adjustmentCount' | 'adjustments' | 'cashNet' | 'net') => days.reduce((t, d) => t + d[k], 0);
  return {
    data: days,
    totals: {
      receiptCount: sum('receiptCount'),
      cash: sum('cash'),
      bank: sum('bank'),
      other: sum('other'),
      adjustmentCount: sum('adjustmentCount'),
      adjustments: sum('adjustments'),
      cashNet: sum('cashNet'),
      net: sum('net'),
    },
  };
}

export async function getReceipt(db: DB, id: number) {
  const [p] = await db.all<Record<string, unknown>>(sql`
    SELECT p.id, p.payment_code AS paymentCode, p.amount, p.method, p.reference_no AS referenceNo, p.paid_at AS paidAt, p.note,
           u.full_name AS receivedBy, s.full_name AS studentName, s.student_code AS studentCode, i.invoice_code AS invoiceCode,
           i.period_label AS periodLabel, i.amount_due AS amountDue, i.amount_paid AS amountPaid,
           (SELECT g.full_name FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id WHERE sg.student_id = s.id ORDER BY sg.is_primary DESC LIMIT 1) AS guardianName,
           (SELECT value FROM system_settings WHERE key = 'center_name') AS centerName,
           EXISTS (SELECT 1 FROM payment_adjustments a WHERE a.payment_id = p.id AND a.type = 'VOID' AND a.status = 'APPROVED') AS voided,
           (i.status = 'CANCELLED') AS invoiceCancelled
      FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN students s ON s.id = p.student_id JOIN users u ON u.id = p.received_by
     WHERE p.id = ${id}`);
  if (!p) throw Errors.notFound('Phiếu thu');
  return { ...p, centerName: p.centerName ? JSON.parse(p.centerName as string) : '' };
}

// ───────────── Điều chỉnh (có duyệt) ─────────────

export async function requestAdjustment(
  db: DB,
  meta: AuditMeta,
  user: AuthUser,
  invoiceId: number,
  input: { type: 'REFUND' | 'CORRECTION' | 'VOID'; amount?: number; direction?: 'INCREASE' | 'DECREASE'; paymentId?: number; method?: string; reason: string },
) {
  const [i] = await db.all<{ status: string; amount_due: number; amount_paid: number }>(sql`SELECT status, amount_due, amount_paid FROM invoices WHERE id = ${invoiceId}`);
  if (!i) throw Errors.notFound('Hóa đơn');
  if (i.status === 'DRAFT' || i.status === 'CANCELLED') throw Errors.business('INVALID_INVOICE', 'Chỉ điều chỉnh hóa đơn đã phát hành');
  let amount: number;
  let method = input.method;
  if (input.type === 'VOID') {
    const [p] = await db.all<{ amount: number; invoice_id: number; method: string; voided: number; pending: number }>(sql`
      SELECT amount, invoice_id, method,
             EXISTS (SELECT 1 FROM payment_adjustments a WHERE a.payment_id = payments.id AND a.type = 'VOID' AND a.status = 'APPROVED') AS voided,
             EXISTS (SELECT 1 FROM payment_adjustments a WHERE a.payment_id = payments.id AND a.status = 'PENDING') AS pending
        FROM payments WHERE id = ${input.paymentId!}`);
    if (!p || p.invoice_id !== invoiceId) throw Errors.notFound('Giao dịch');
    if (p.voided) throw Errors.business('ALREADY_VOIDED', 'Giao dịch đã được hủy');
    if (p.pending) throw Errors.business('PENDING_EXISTS', 'Giao dịch đang có phiếu chờ duyệt');
    amount = -p.amount;
    method = p.method;
  } else if (input.type === 'REFUND') amount = -input.amount!;
  else amount = input.direction === 'INCREASE' ? input.amount! : -input.amount!;
  const next = i.amount_paid + amount;
  if (next < 0) throw Errors.business('ADJUST_BELOW_ZERO', 'Số tiền điều chỉnh vượt số đã thu');
  if (next > i.amount_due) throw Errors.business('ADJUST_ABOVE_DUE', 'Số đã thu sau điều chỉnh vượt số phải nộp');
  const today = vnDate().replaceAll('-', '');
  const [row] = await db.all<{ id: number; adjustment_code: string }>(sql`
    INSERT INTO payment_adjustments (adjustment_code, invoice_id, payment_id, type, amount, method, reason, status, requested_by, requested_at)
    VALUES (printf('DC-%s-%04d', ${today}, (SELECT count(*) + 1 FROM payment_adjustments WHERE adjustment_code LIKE ${`DC-${today}-%`})),
            ${invoiceId}, ${input.paymentId ?? null}, ${input.type}, ${amount}, ${method ?? null}, ${input.reason}, 'PENDING', ${user.id}, ${nowIso()})
    RETURNING id, adjustment_code`);
  await auditInsert(db, meta, { action: 'adjustment.request', entityType: 'invoice', entityId: invoiceId, after: { ...input, amount, adjustmentId: row!.id } });
  return { id: row!.id, adjustmentCode: row!.adjustment_code };
}

export async function decideAdjustment(db: DB, meta: AuditMeta, user: AuthUser, id: number, approve: boolean, note?: string | null) {
  const [a] = await db.all<{ id: number; invoice_id: number; amount: number; status: string; requested_by: number }>(
    sql`SELECT id, invoice_id, amount, status, requested_by FROM payment_adjustments WHERE id = ${id}`,
  );
  if (!a) throw Errors.notFound('Phiếu điều chỉnh');
  if (a.status !== 'PENDING') throw Errors.business('ALREADY_DECIDED', 'Phiếu đã được xử lý');
  if (a.requested_by === user.id) {
    // Người đề nghị không tự duyệt, trừ khi chỉ có một người có quyền duyệt
    const [n] = await db.all<{ n: number }>(sql`
      SELECT count(*) AS n FROM users u JOIN role_permissions rp ON rp.role_id = u.role_id JOIN permissions p ON p.id = rp.permission_id
       WHERE p.code = 'fees.approve_adjustment' AND u.status = 'ACTIVE' AND u.deleted_at IS NULL`);
    if (n!.n >= 2) throw Errors.business('SELF_APPROVAL', 'Người đề nghị không được tự duyệt. Cần một quản lý khác duyệt.');
  }
  const now = nowIso();
  const today = vnDate();
  const stmts: BatchStatement[] = [
    sql`UPDATE payment_adjustments SET status = ${approve ? 'APPROVED' : 'REJECTED'}, approved_by = ${user.id}, approved_at = ${now}, decision_note = ${note ?? null}
         WHERE id = ${id} AND status = 'PENDING'`,
  ];
  if (approve)
    stmts.push(sql`UPDATE invoices SET amount_paid = amount_paid + ${a.amount}, status = ${statusAfter(a.amount, today)}, version = version + 1, updated_at = ${now}
                    WHERE id = ${a.invoice_id} AND (SELECT status FROM payment_adjustments WHERE id = ${id}) = 'APPROVED'
                      AND (SELECT approved_at FROM payment_adjustments WHERE id = ${id}) = ${now}`);
  stmts.push(
    auditInsert(db, meta, {
      action: approve ? 'adjustment.approve' : 'adjustment.reject',
      entityType: 'invoice',
      entityId: a.invoice_id,
      after: { adjustmentId: id, amount: a.amount, selfApproved: a.requested_by === user.id },
      reason: note ?? null,
    }),
  );
  const res = await runBatch(db, stmts);
  if (!res[0]?.meta.changes) throw Errors.conflict('ALREADY_DECIDED', 'Phiếu vừa được người khác xử lý');
}

export async function listAdjustments(db: DB, status?: string) {
  return db.all(sql`
    SELECT a.id, a.adjustment_code AS adjustmentCode, a.type, a.amount, a.reason, a.status, a.invoice_id AS invoiceId, i.invoice_code AS invoiceCode,
           s.full_name AS studentName, ru.full_name AS requestedBy, a.requested_by AS requestedById, a.requested_at AS requestedAt,
           au.full_name AS approvedBy, a.approved_at AS approvedAt
      FROM payment_adjustments a JOIN invoices i ON i.id = a.invoice_id JOIN students s ON s.id = i.student_id
      JOIN users ru ON ru.id = a.requested_by LEFT JOIN users au ON au.id = a.approved_by
     ${status ? sql`WHERE a.status = ${status}` : sql``}
     ORDER BY a.status = 'PENDING' DESC, a.id DESC LIMIT 300`);
}

// ───────────── Học phí của học sinh ─────────────

export async function studentFees(db: DB, user: AuthUser, studentId: number) {
  await assertStudentAccess(db, user, studentId);
  const family = !user.permissions.has('fees.read');
  const plans = family
    ? []
    : await db.all(sql`
        SELECT sfp.id, sfp.fee_plan_id AS feePlanId, f.name AS planName, f.billing_type AS billingType, f.amount AS planAmount,
               sfp.custom_amount AS customAmount, sfp.discount_type AS discountType, sfp.discount_value AS discountValue,
               sfp.discount_reason AS discountReason, sfp.effective_from AS effectiveFrom, sfp.effective_to AS effectiveTo, f.session_count AS sessionCount
          FROM student_fee_plans sfp JOIN fee_plans f ON f.id = sfp.fee_plan_id
         WHERE sfp.student_id = ${studentId} ORDER BY sfp.effective_from DESC`);
  const invoices = await db.all<{ id: number; amountDue: number; amountPaid: number; dueDate: string | null; status: InvoiceStatus }>(sql`
    SELECT id, invoice_code AS invoiceCode, period_label AS periodLabel, amount_due AS amountDue, amount_paid AS amountPaid, due_date AS dueDate,
           status, sessions_purchased AS sessionsPurchased, note
      FROM invoices WHERE student_id = ${studentId} ${family ? sql`AND status NOT IN ('DRAFT', 'CANCELLED')` : sql``}
     ORDER BY coalesce(period_start, created_at) DESC, id DESC`);
  // Số buổi còn lại cho gói buổi (Q6): mua (hóa đơn có số buổi, đã phát hành) − đã dùng (điểm danh trạng thái bị trừ, từ ngày mua đầu tiên)
  const deduct = await setting<string[]>(db, 'per_session_deduct_statuses', ['PRESENT', 'LATE', 'UNEXCUSED']);
  const [bal] = await db.all<{ purchased: number; since: string | null }>(sql`
    SELECT coalesce(sum(sessions_purchased), 0) AS purchased, min(coalesce(period_start, date(issued_at, '+7 hours'))) AS since
      FROM invoices WHERE student_id = ${studentId} AND sessions_purchased IS NOT NULL AND status NOT IN ('DRAFT', 'CANCELLED')`);
  let sessions: { purchased: number; used: number; remaining: number; since: string } | null = null;
  if (bal?.purchased && bal.since) {
    const [u] = await db.all<{ n: number }>(sql`
      SELECT count(*) AS n FROM attendance_records a JOIN lessons l ON l.id = a.lesson_id
       WHERE a.student_id = ${studentId} AND l.status <> 'CANCELLED' AND l.lesson_date >= ${bal.since}
         AND a.status IN (${sql.join(deduct.map((d) => sql`${d}`), sql`, `)})`);
    sessions = { purchased: bal.purchased, used: u!.n, remaining: bal.purchased - u!.n, since: bal.since };
  }
  const today = vnDate();
  const inv = invoices.map((r) => ({
    ...r,
    remaining: r.amountDue - r.amountPaid,
    status: deriveInvoiceStatus({ amountDue: r.amountDue, amountPaid: r.amountPaid, dueDate: r.dueDate, today, isDraft: r.status === 'DRAFT', isCancelled: r.status === 'CANCELLED' }),
  }));
  const outstanding = inv.filter((r) => ['UNPAID', 'PARTIAL', 'OVERDUE'].includes(r.status)).reduce((s, r) => s + r.remaining, 0);
  return { plans, invoices: inv, sessions, outstanding };
}

// ───────────── Cron ─────────────

/** 00:00: chuyển hóa đơn quá hạn sang OVERDUE + thông báo phụ huynh (một lần cho mỗi hóa đơn). */
export async function markOverdue(db: DB, today = vnDate()) {
  const notify = (await setting<{ fee?: boolean }>(db, 'notifications_enabled', {})).fee !== false;
  const res = await runBatch(db, [
    sql`UPDATE invoices SET status = 'OVERDUE', version = version + 1, updated_at = ${nowIso()}
         WHERE status IN ('UNPAID', 'PARTIAL') AND due_date < ${today} AND amount_paid < amount_due`,
    sql`INSERT OR IGNORE INTO notifications (user_id, type, title, body, data, student_id, dedupe_key, push_status)
        SELECT g.user_id, 'FEE_OVERDUE', 'Học phí quá hạn: ' || s.full_name,
               'Hóa đơn ' || i.invoice_code || ' (' || i.period_label || ') còn thiếu ' || replace(printf('%,d', i.amount_due - i.amount_paid), ',', '.') || ' ₫, hạn ' || strftime('%d/%m/%Y', i.due_date) || '.',
               json_object('invoiceId', i.id), s.id, 'overdue:' || i.id, 'PENDING'
          FROM invoices i JOIN students s ON s.id = i.student_id JOIN student_guardians sg ON sg.student_id = s.id JOIN guardians g ON g.id = sg.guardian_id
         WHERE ${notify ? 1 : 0} = 1 AND i.status = 'OVERDUE' AND sg.receive_notifications = 1 AND g.user_id IS NOT NULL`,
  ]);
  return res[0]?.meta.changes ?? 0;
}

/** 08:00: nhắc học phí sắp đến hạn (N ngày trước hạn, cấu hình fee_reminder_days_before). */
export async function remindDue(db: DB, today = vnDate()) {
  if ((await setting<{ fee?: boolean }>(db, 'notifications_enabled', {})).fee === false) return 0;
  const days = await setting<number>(db, 'fee_reminder_days_before', 3);
  const target = addDays(today, days);
  const r = await db.run(sql`
    INSERT OR IGNORE INTO notifications (user_id, type, title, body, data, student_id, dedupe_key, push_status)
    SELECT g.user_id, 'FEE_DUE', 'Nhắc học phí: ' || s.full_name,
           'Hóa đơn ' || i.invoice_code || ' (' || i.period_label || ') còn ' || replace(printf('%,d', i.amount_due - i.amount_paid), ',', '.') || ' ₫, hạn ' || strftime('%d/%m/%Y', i.due_date) || '.',
           json_object('invoiceId', i.id), s.id, 'due:' || i.id, 'PENDING'
      FROM invoices i JOIN students s ON s.id = i.student_id JOIN student_guardians sg ON sg.student_id = s.id JOIN guardians g ON g.id = sg.guardian_id
     WHERE i.status IN ('UNPAID', 'PARTIAL') AND i.due_date BETWEEN ${today} AND ${target} AND sg.receive_notifications = 1 AND g.user_id IS NOT NULL`);
  return r.meta.changes ?? 0;
}

// ───────────── Hóa đơn chi tiết (gửi phụ huynh) ─────────────

async function studentLessons(db: DB, studentId: number, classId: number | null, from: string, to: string) {
  return db.all<{ date: string; startTime: string; endTime: string; className: string; status: string | null; lateMinutes: number | null }>(sql`
    SELECT l.lesson_date AS date, l.start_time AS startTime, l.end_time AS endTime, c.name AS className,
           ar.status, ar.late_minutes AS lateMinutes
      FROM lessons l JOIN classes c ON c.id = l.class_id
      LEFT JOIN attendance_records ar ON ar.lesson_id = l.id AND ar.student_id = ${studentId}
     WHERE l.status <> 'CANCELLED' AND l.lesson_date BETWEEN ${from} AND ${to}
       ${classId ? sql`AND l.class_id = ${classId}` : sql.empty()}
       AND EXISTS (SELECT 1 FROM class_enrollments ce WHERE ce.class_id = l.class_id AND ce.student_id = ${studentId}
                     AND ce.start_date <= l.lesson_date AND coalesce(ce.end_date, '9999-12-31') >= l.lesson_date)
     ORDER BY l.lesson_date, l.start_time`);
}

export async function invoiceStatement(db: DB, user: AuthUser, id: number) {
  const inv = (await getInvoice(db, user, id)) as Awaited<ReturnType<typeof getInvoice>> & Record<string, any>;
  const [sfp] = inv.student_fee_plan_id
    ? await db.all<{ class_id: number | null }>(sql`SELECT class_id FROM student_fee_plans WHERE id = ${inv.student_fee_plan_id}`)
    : [];
  const classId = sfp?.class_id ?? null;
  const [source] = inv.absence_source_invoice_id
    ? await db.all<{ period_label: string; period_start: string; period_end: string }>(
        sql`SELECT period_label, period_start, period_end FROM invoices WHERE id = ${inv.absence_source_invoice_id}`,
      )
    : [];
  const settings = await db.all<{ key: string; value: string }>(
    sql`SELECT key, value FROM system_settings WHERE key IN ('center_name', 'center_address', 'center_phone')`,
  );
  const center = Object.fromEntries(settings.map((s) => [s.key, JSON.parse(s.value) as string]));
  const [student] = await db.all<{ full_name: string; student_code: string; date_of_birth: string | null }>(
    sql`SELECT full_name, student_code, date_of_birth FROM students WHERE id = ${inv.student_id}`,
  );
  return {
    center: { name: center.center_name ?? '', address: center.center_address ?? null, phone: center.center_phone ?? null },
    student: { id: inv.student_id, fullName: student!.full_name, code: student!.student_code, dateOfBirth: student!.date_of_birth },
    invoice: {
      id: inv.id as number,
      code: inv.invoice_code as string,
      planName: inv.plan_name as string | null,
      periodLabel: inv.period_label as string,
      periodStart: inv.period_start as string | null,
      periodEnd: inv.period_end as string | null,
      issuedAt: inv.issued_at as string | null,
      dueDate: inv.due_date as string | null,
      status: inv.status,
      grossAmount: inv.gross_amount as number,
      discountAmount: (inv.discount_amount as number) - (inv.absence_deduction as number),
      absenceDeduction: inv.absence_deduction as number,
      amountDue: inv.amount_due,
      amountPaid: inv.amount_paid,
      remaining: inv.remaining,
      note: inv.note as string | null,
    },
    absence: source
      ? {
          periodLabel: source.period_label,
          periodStart: source.period_start,
          periodEnd: source.period_end,
          count: inv.absence_count as number,
          sessionTotal: inv.absence_session_total as number | null,
          unitPrice: inv.absence_unit_price as number | null,
          lessons: await studentLessons(db, inv.student_id, classId, source.period_start, source.period_end),
        }
      : null,
    lessons: inv.period_start && inv.period_end ? await studentLessons(db, inv.student_id, classId, inv.period_start, inv.period_end) : [],
  };
}

export async function sendInvoiceToGuardians(db: DB, meta: AuditMeta, id: number) {
  const [i] = await db.all<{ id: number; invoice_code: string; student_id: number; status: string; period_label: string; amount_due: number; amount_paid: number; due_date: string | null; student_name: string }>(sql`
    SELECT i.id, i.invoice_code, i.student_id, i.status, i.period_label, i.amount_due, i.amount_paid, i.due_date, s.full_name AS student_name
      FROM invoices i JOIN students s ON s.id = i.student_id WHERE i.id = ${id}`);
  if (!i) throw Errors.notFound('Hóa đơn');
  if (i.status === 'DRAFT' || i.status === 'CANCELLED') throw Errors.business('NOT_ISSUED', 'Chỉ gửi được hóa đơn đã phát hành');
  const guardians = await db.all<{ user_id: number | null; full_name: string }>(sql`
    SELECT g.user_id, g.full_name FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
     WHERE sg.student_id = ${i.student_id} AND g.deleted_at IS NULL`);
  const recipients = guardians.filter((g) => g.user_id).map((g) => g.user_id!);
  if (!recipients.length)
    throw Errors.business('NO_GUARDIAN_ACCOUNT', 'Chưa phụ huynh nào của học sinh có tài khoản. Hãy cấp tài khoản ở hồ sơ học sinh, hoặc tải ảnh hóa đơn để gửi qua Zalo/tin nhắn.');
  const remaining = i.amount_due - i.amount_paid;
  const body = `Hóa đơn ${i.invoice_code} (${i.period_label}) của ${i.student_name}: ${remaining.toLocaleString('vi-VN')} ₫ cần nộp${i.due_date ? `, hạn ${i.due_date.split('-').reverse().join('/')}` : ''}.`;
  await runBatch(db, [
    ...recipients.map(
      (uid) => sql`INSERT INTO notifications (user_id, type, title, body, data, student_id, push_status)
                   VALUES (${uid}, 'FEE_DUE', ${`Hóa đơn học phí ${i.period_label}`}, ${body}, ${JSON.stringify({ invoiceId: i.id, kind: 'INVOICE' })}, ${i.student_id}, 'PENDING')`,
    ),
    auditInsert(db, meta, { action: 'invoice.send', entityType: 'invoice', entityId: id, after: { recipients } }),
  ]);
  return { sent: recipients.length, withoutAccount: guardians.length - recipients.length };
}
