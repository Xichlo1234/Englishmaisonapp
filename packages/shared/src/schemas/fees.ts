import { z } from 'zod';
import { BILLING_TYPES, INVOICE_STATUSES, PAYMENT_METHODS } from '../constants';
import { isoDate, vndAmount } from './common';

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v === undefined ? undefined : v ? v : null));

export const BILLING_TYPE_LABELS: Record<(typeof BILLING_TYPES)[number], string> = {
  MONTHLY: 'Theo tháng',
  COURSE: 'Theo khóa',
  PER_SESSION: 'Theo gói buổi',
};
export const PAYMENT_METHOD_LABELS: Record<(typeof PAYMENT_METHODS)[number], string> = {
  CASH: 'Tiền mặt',
  BANK_TRANSFER: 'Chuyển khoản',
  OTHER: 'Khác',
};
export const ADJUSTMENT_TYPE_LABELS = { REFUND: 'Hoàn tiền', CORRECTION: 'Điều chỉnh sai sót', VOID: 'Hủy giao dịch nhập nhầm' } as const;

export const feePlanSchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9._-]{2,30}$/, 'Mã gói: chữ không dấu, số, . _ -')
      .transform((v) => v.toUpperCase()),
    name: z.string().trim().min(2, 'Nhập tên gói').max(100),
    billingType: z.enum(BILLING_TYPES),
    amount: vndAmount,
    sessionCount: z.number().int().positive().max(500).optional().nullable(),
    englishLevel: optText(50),
    description: optText(500),
    isActive: z.boolean().default(true),
  })
  .refine((v) => v.billingType !== 'PER_SESSION' || !!v.sessionCount, { message: 'Gói theo buổi cần số buổi', path: ['sessionCount'] });
export const feePlanUpdateSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  amount: vndAmount.optional(),
  sessionCount: z.number().int().positive().max(500).optional().nullable(),
  englishLevel: optText(50),
  description: optText(500),
  isActive: z.boolean().optional(),
});

export const studentFeePlanSchema = z
  .object({
    feePlanId: z.number().int().positive(),
    classId: z.number().int().positive().optional().nullable(),
    customAmount: vndAmount.optional().nullable(),
    discountType: z.enum(['NONE', 'AMOUNT', 'PERCENT']).default('NONE'),
    discountValue: z.number().int().min(0).default(0),
    discountReason: optText(300),
    effectiveFrom: isoDate,
    effectiveTo: isoDate.optional().nullable(),
  })
  .refine((v) => v.discountType !== 'PERCENT' || v.discountValue <= 100, { message: 'Giảm giá % tối đa 100', path: ['discountValue'] })
  .refine((v) => v.discountType === 'NONE' || v.discountValue > 0, { message: 'Nhập mức giảm giá', path: ['discountValue'] })
  .refine((v) => v.discountType === 'NONE' || !!v.discountReason, { message: 'Nhập lý do giảm giá', path: ['discountReason'] })
  .refine((v) => !v.effectiveTo || v.effectiveTo >= v.effectiveFrom, { message: 'Ngày kết thúc phải sau ngày bắt đầu', path: ['effectiveTo'] });
export const studentFeePlanEndSchema = z.object({ effectiveTo: isoDate });

export const invoiceGenerateSchema = z.object({ period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Kỳ dạng YYYY-MM') });
export const invoiceIssueSchema = z.object({ ids: z.array(z.number().int().positive()).min(1).max(500) });
export const invoiceCreateSchema = z.object({
  studentId: z.number().int().positive(),
  studentFeePlanId: z.number().int().positive().optional().nullable(),
  periodLabel: z.string().trim().min(2, 'Nhập kỳ thu / nội dung').max(100),
  periodStart: isoDate.optional().nullable(),
  periodEnd: isoDate.optional().nullable(),
  sessionsPurchased: z.number().int().positive().max(500).optional().nullable(),
  grossAmount: vndAmount.refine((v) => v > 0, 'Số tiền phải lớn hơn 0'),
  discountAmount: vndAmount.default(0),
  dueDate: isoDate,
  note: optText(500),
  issue: z.boolean().default(true),
});
export const invoiceDraftUpdateSchema = z.object({
  discountAmount: vndAmount.optional(),
  dueDate: isoDate.optional(),
  note: optText(500),
});
export const invoiceCancelSchema = z.object({ reason: z.string().trim().min(3, 'Nhập lý do').max(500) });
export const invoiceListQuery = z.object({
  status: z.enum([...INVOICE_STATUSES, 'OUTSTANDING', 'ALL']).optional(),
  period: z.string().max(100).optional(),
  classId: z.coerce.number().int().positive().optional(),
  studentId: z.coerce.number().int().positive().optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const paymentCreateSchema = z.object({
  amount: vndAmount.refine((v) => v > 0, 'Số tiền phải lớn hơn 0'),
  method: z.enum(PAYMENT_METHODS),
  referenceNo: optText(100),
  paidAt: isoDate.optional(),
  note: optText(300),
  /** Khóa chống ghi trùng khi bấm hai lần / gửi lại do mạng (client tự sinh UUID). */
  idempotencyKey: z.string().trim().min(8).max(100),
});
export const paymentListQuery = z.object({
  from: isoDate,
  to: isoDate,
  method: z.enum(PAYMENT_METHODS).optional(),
});

export const adjustmentCreateSchema = z
  .object({
    type: z.enum(['REFUND', 'CORRECTION', 'VOID']),
    /** Số tiền dương; hệ thống tự xác định dấu. CORRECTION dùng direction. */
    amount: vndAmount.optional(),
    direction: z.enum(['INCREASE', 'DECREASE']).optional(),
    paymentId: z.number().int().positive().optional(),
    reason: z.string().trim().min(5, 'Nhập lý do (tối thiểu 5 ký tự)').max(500),
  })
  .refine((v) => v.type !== 'VOID' || !!v.paymentId, { message: 'Chọn giao dịch cần hủy', path: ['paymentId'] })
  .refine((v) => v.type === 'VOID' || (!!v.amount && v.amount > 0), { message: 'Nhập số tiền', path: ['amount'] })
  .refine((v) => v.type !== 'CORRECTION' || !!v.direction, { message: 'Chọn tăng hoặc giảm', path: ['direction'] });
export const adjustmentDecisionSchema = z.object({ note: optText(300) });
