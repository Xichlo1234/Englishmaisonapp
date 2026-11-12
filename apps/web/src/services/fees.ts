import type { AttendanceStatus, InvoiceStatus } from '@ecm/shared';
import { api } from '@/lib/api';

export interface FeePlan {
  id: number;
  code: string;
  name: string;
  billingType: 'MONTHLY' | 'COURSE' | 'PER_SESSION';
  amount: number;
  sessionCount: number | null;
  englishLevel: string | null;
  description: string | null;
  isActive: number;
  studentCount: number;
}
export interface InvoiceRow {
  id: number;
  invoiceCode: string;
  studentId: number;
  studentCode: string;
  studentName: string;
  periodLabel: string;
  amountDue: number;
  amountPaid: number;
  remaining: number;
  dueDate: string | null;
  status: InvoiceStatus;
  note: string | null;
  sessionsPurchased: number | null;
}
export interface PaymentRow {
  id: number;
  paymentCode: string;
  amount: number;
  method: 'CASH' | 'BANK_TRANSFER' | 'OTHER';
  referenceNo: string | null;
  paidAt: string;
  note: string | null;
  receivedBy: string;
  voided: number;
}
export interface AdjustmentRow {
  id: number;
  adjustmentCode: string;
  type: 'REFUND' | 'CORRECTION' | 'VOID';
  amount: number;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  paymentId?: number | null;
  invoiceId?: number;
  invoiceCode?: string;
  studentName?: string;
  requestedBy: string;
  requestedById?: number;
  requestedAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  decisionNote?: string | null;
}
export interface InvoiceDetail {
  id: number;
  invoice_code: string;
  student_id: number;
  student_name: string;
  student_code: string;
  plan_name: string | null;
  billing_type: string | null;
  period_label: string;
  period_start: string | null;
  period_end: string | null;
  sessions_purchased: number | null;
  gross_amount: number;
  discount_amount: number;
  absence_deduction: number;
  absence_count: number;
  absence_session_total: number | null;
  absence_unit_price: number | null;
  amount_due: number;
  amount_paid: number;
  remaining: number;
  due_date: string | null;
  status: InvoiceStatus;
  note: string | null;
  issued_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_by_name: string | null;
  payments: PaymentRow[];
  adjustments: AdjustmentRow[];
}
export interface StudentFees {
  plans: {
    id: number;
    feePlanId: number;
    planName: string;
    billingType: FeePlan['billingType'];
    planAmount: number;
    customAmount: number | null;
    discountType: 'NONE' | 'AMOUNT' | 'PERCENT';
    discountValue: number;
    discountReason: string | null;
    effectiveFrom: string;
    effectiveTo: string | null;
    sessionCount: number | null;
  }[];
  invoices: (InvoiceRow & { invoiceCode: string })[];
  sessions: { purchased: number; used: number; remaining: number; since: string } | null;
  outstanding: number;
}

export const feeKeys = {
  plans: ['fees', 'plans'] as const,
  invoices: (f: object) => ['fees', 'invoices', f] as const,
  invoice: (id: number) => ['fees', 'invoice', id] as const,
  payments: (f: object) => ['fees', 'payments', f] as const,
  adjustments: (s?: string) => ['fees', 'adjustments', s ?? 'all'] as const,
  student: (id: number) => ['fees', 'student', id] as const,
  receipt: (id: number) => ['fees', 'receipt', id] as const,
  statement: (id: number) => ['fees', 'statement', id] as const,
};

export interface StatementLesson {
  date: string;
  startTime: string;
  endTime: string;
  className: string;
  status: AttendanceStatus | null;
  lateMinutes: number | null;
}
export interface InvoiceStatement {
  center: { name: string; address: string | null; phone: string | null };
  student: { id: number; fullName: string; code: string; dateOfBirth: string | null };
  invoice: {
    id: number;
    code: string;
    planName: string | null;
    periodLabel: string;
    periodStart: string | null;
    periodEnd: string | null;
    issuedAt: string | null;
    dueDate: string | null;
    status: InvoiceStatus;
    grossAmount: number;
    discountAmount: number;
    absenceDeduction: number;
    amountDue: number;
    amountPaid: number;
    remaining: number;
    note: string | null;
  };
  absence: { periodLabel: string; periodStart: string; periodEnd: string; count: number; sessionTotal: number | null; unitPrice: number | null; lessons: StatementLesson[] } | null;
  lessons: StatementLesson[];
}

export const feesApi = {
  statement: (id: number) => api<InvoiceStatement>(`/invoices/${id}/statement`),
  sendToGuardians: (id: number) => api<{ sent: number; withoutAccount: number }>(`/invoices/${id}/send`, { body: {} }),
  plans: () => api<{ data: FeePlan[] }>('/fee-plans'),
  createPlan: (b: unknown) => api('/fee-plans', { body: b }),
  updatePlan: (id: number, b: unknown) => api(`/fee-plans/${id}`, { method: 'PATCH', body: b }),
  invoices: (q: Record<string, string | number | undefined>) =>
    api<{ data: InvoiceRow[]; total: number; summary: { due: number; paid: number; remaining: number } }>('/invoices', { query: q }),
  invoice: (id: number) => api<InvoiceDetail>(`/invoices/${id}`),
  generate: (period: string) => api<{ created: number; skipped: number; dueDate: string }>('/invoices/generate', { body: { period } }),
  issue: (ids: number[]) => api<{ issued: number }>('/invoices/issue', { body: { ids } }),
  createInvoice: (b: unknown) => api<{ id: number }>('/invoices', { body: b }),
  updateDraft: (id: number, b: unknown) => api(`/invoices/${id}`, { method: 'PATCH', body: b }),
  cancel: (id: number, reason: string) => api(`/invoices/${id}/cancel`, { body: { reason } }),
  pay: (id: number, b: unknown) => api<{ id: number; paymentCode: string; duplicate: boolean }>(`/invoices/${id}/payments`, { body: b }),
  requestAdjustment: (id: number, b: unknown) => api(`/invoices/${id}/adjustments`, { body: b }),
  adjustments: (status?: string) => api<{ data: AdjustmentRow[] }>('/adjustments', { query: { status } }),
  decide: (id: number, approve: boolean, note?: string) => api(`/adjustments/${id}/${approve ? 'approve' : 'reject'}`, { body: { note: note || null } }),
  payments: (q: { from: string; to: string; method?: string }) =>
    api<{
      data: (PaymentRow & { studentName: string; studentCode: string; invoiceCode: string; invoiceId: number })[];
      summary: { gross: number; adjustments: number; net: number; byMethod: Record<string, number>; count: number };
    }>('/payments', { query: q }),
  receipt: (id: number) => api<Record<string, any>>(`/payments/${id}/receipt`),
  studentFees: (id: number) => api<StudentFees>(`/students/${id}/fees`),
  addStudentPlan: (id: number, b: unknown) => api(`/students/${id}/fee-plans`, { body: b }),
  endStudentPlan: (id: number, effectiveTo: string) => api(`/student-fee-plans/${id}/end`, { body: { effectiveTo } }),
};

export const INVOICE_VARIANT: Record<InvoiceStatus, 'success' | 'warning' | 'danger' | 'muted' | 'default'> = {
  DRAFT: 'muted',
  UNPAID: 'default',
  PARTIAL: 'warning',
  PAID: 'success',
  OVERDUE: 'danger',
  CANCELLED: 'muted',
};
