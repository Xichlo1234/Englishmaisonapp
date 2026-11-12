import type { InvoiceStatus } from './constants';

/** Định dạng VND: 1800000 → "1.800.000 ₫". Tiền luôn là số nguyên. */
export function formatVnd(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  const s = Math.abs(Math.trunc(amount))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}${s} ₫`;
}

export function isValidVnd(amount: unknown): amount is number {
  return typeof amount === 'number' && Number.isSafeInteger(amount);
}

/** Tính giảm giá (làm tròn xuống đến đồng). */
export function computeDiscount(
  gross: number,
  discountType: 'NONE' | 'AMOUNT' | 'PERCENT',
  discountValue: number,
): number {
  if (discountType === 'NONE' || discountValue <= 0) return 0;
  if (discountType === 'AMOUNT') return Math.min(gross, Math.trunc(discountValue));
  const pct = Math.min(100, discountValue);
  return Math.floor((gross * pct) / 100);
}

/**
 * Trạng thái hóa đơn được suy ra từ số liệu — không lưu tay.
 * `today` và `dueDate` dạng YYYY-MM-DD theo giờ Việt Nam.
 */
export function deriveInvoiceStatus(input: {
  amountDue: number;
  amountPaid: number;
  dueDate: string | null;
  today: string;
  isDraft?: boolean;
  isCancelled?: boolean;
}): InvoiceStatus {
  if (input.isCancelled) return 'CANCELLED';
  if (input.isDraft) return 'DRAFT';
  if (input.amountPaid >= input.amountDue) return 'PAID';
  const overdue = input.dueDate !== null && input.today > input.dueDate;
  if (overdue) return 'OVERDUE';
  return input.amountPaid > 0 ? 'PARTIAL' : 'UNPAID';
}
