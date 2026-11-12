import { describe, expect, it } from 'vitest';
import {
  addDays,
  classify,
  computeAttendanceStats,
  computeDiscount,
  computeWeightedAverage,
  dateRangesOverlap,
  DEFAULT_ROLE_PERMISSIONS,
  deriveInvoiceStatus,
  formatVnd,
  isoDate,
  isoWeekday,
  loginSchema,
  normalizePhone,
  normalizeSearch,
  passwordSchema,
  phoneSchema,
  timeRangesOverlap,
  validateGradeBands,
  vnDate,
  vnToUtc,
  type CriterionConfig,
} from '../src';

const crit = (id: number, weight = 1, maxScore = 10): CriterionConfig => ({
  id,
  code: `C${id}`,
  name: `C${id}`,
  weight,
  maxScore,
});
const six = [1, 2, 3, 4, 5, 6].map((i) => crit(i));

describe('Tính điểm trung bình theo trọng số', () => {
  it('trọng số bằng nhau (ví dụ trong tài liệu thiết kế: 8,17 → Giỏi)', () => {
    const avg = computeWeightedAverage(six, { 1: 8, 2: 7, 3: 9, 4: 6, 5: 10, 6: 9 });
    expect(avg).toBe(8.17);
    expect(classify(avg)).toBe('Giỏi');
  });
  it('Speaking trọng số 2 → 8,00', () => {
    const c = six.map((x) => (x.id === 2 ? { ...x, weight: 2 } : x));
    expect(computeWeightedAverage(c, { 1: 8, 2: 7, 3: 9, 4: 6, 5: 10, 6: 9 })).toBe(8);
  });
  it('quy đổi thang điểm khác 10', () => {
    expect(computeWeightedAverage([crit(1, 1, 100), crit(2, 1, 5)], { 1: 80, 2: 4 })).toBe(8);
  });
  it('bỏ qua tiêu chí chưa có điểm (Q8)', () => {
    expect(computeWeightedAverage(six, { 1: 8, 3: 6 })).toBe(7);
  });
  it('không có điểm → null', () => {
    expect(computeWeightedAverage(six, {})).toBeNull();
    expect(classify(null)).toBeNull();
  });
  it('từ chối điểm ngoài khoảng', () => {
    expect(() => computeWeightedAverage(six, { 1: 11 })).toThrow(RangeError);
    expect(() => computeWeightedAverage(six, { 1: -1 })).toThrow(RangeError);
  });
});

describe('Xếp loại mặc định', () => {
  it.each([
    [10, 'Xuất sắc'],
    [9, 'Xuất sắc'],
    [8.99, 'Giỏi'],
    [8, 'Giỏi'],
    [7.99, 'Khá'],
    [6.5, 'Khá'],
    [6.49, 'Trung bình'],
    [5, 'Trung bình'],
    [4.99, 'Cần cải thiện'],
    [0, 'Cần cải thiện'],
  ])('%s → %s', (avg, label) => expect(classify(avg)).toBe(label));

  it('thang tùy chỉnh', () => {
    expect(classify(7, [{ min: 0, label: 'Đạt' }, { min: 7, label: 'Tốt' }])).toBe('Tốt');
  });
  it('kiểm tra thang xếp loại', () => {
    expect(validateGradeBands([{ min: 5, label: 'A' }, { min: 8, label: 'B' }])).toMatch(/từ 0/);
    expect(validateGradeBands([{ min: 0, label: 'A' }, { min: 0, label: 'B' }])).toMatch(/trùng/);
    expect(validateGradeBands([{ min: 0, label: 'A' }, { min: 5, label: 'B' }])).toBeNull();
  });
});

describe('Chuyên cần', () => {
  it('tính thống kê và tỷ lệ', () => {
    const s = computeAttendanceStats(['PRESENT', 'PRESENT', 'LATE', 'EXCUSED', 'UNEXCUSED', 'PRESENT']);
    expect(s).toMatchObject({ total: 6, present: 3, late: 1, excused: 1, unexcused: 1, absent: 2 });
    expect(s.rate).toBe(66.7);
  });
  it('chưa có buổi → tỷ lệ null', () => {
    expect(computeAttendanceStats([]).rate).toBeNull();
  });
});

describe('Học phí', () => {
  const base = { amountDue: 1_800_000, dueDate: '2026-11-10', today: '2026-11-05' };
  it('trạng thái hóa đơn', () => {
    expect(deriveInvoiceStatus({ ...base, amountPaid: 0 })).toBe('UNPAID');
    expect(deriveInvoiceStatus({ ...base, amountPaid: 500_000 })).toBe('PARTIAL');
    expect(deriveInvoiceStatus({ ...base, amountPaid: 1_800_000 })).toBe('PAID');
    expect(deriveInvoiceStatus({ ...base, amountPaid: 500_000, today: '2026-11-11' })).toBe('OVERDUE');
    expect(deriveInvoiceStatus({ ...base, amountPaid: 0, today: '2026-11-10' })).toBe('UNPAID');
    expect(deriveInvoiceStatus({ ...base, amountPaid: 1_800_000, today: '2026-12-01' })).toBe('PAID');
    expect(deriveInvoiceStatus({ ...base, amountPaid: 0, isCancelled: true })).toBe('CANCELLED');
    expect(deriveInvoiceStatus({ ...base, amountDue: 0, amountPaid: 0 })).toBe('PAID');
  });
  it('giảm giá', () => {
    expect(computeDiscount(1_800_000, 'PERCENT', 10)).toBe(180_000);
    expect(computeDiscount(1_000_001, 'PERCENT', 33)).toBe(330_000);
    expect(computeDiscount(500_000, 'AMOUNT', 600_000)).toBe(500_000);
    expect(computeDiscount(500_000, 'NONE', 10)).toBe(0);
  });
  it('định dạng VND', () => {
    expect(formatVnd(1_800_000)).toBe('1.800.000 ₫');
    expect(formatVnd(0)).toBe('0 ₫');
    expect(formatVnd(-50_000)).toBe('-50.000 ₫');
  });
});

describe('Ngày giờ Việt Nam', () => {
  it('ngày theo UTC+7', () => {
    expect(vnDate(new Date('2026-11-12T16:59:00Z'))).toBe('2026-11-12');
    expect(vnDate(new Date('2026-11-12T17:00:00Z'))).toBe('2026-11-13');
  });
  it('chuyển giờ VN sang UTC', () => {
    expect(vnToUtc('2026-11-12', '14:00').toISOString()).toBe('2026-11-12T07:00:00.000Z');
  });
  it('thứ trong tuần', () => {
    expect(isoWeekday('2026-11-12')).toBe(4); // Thứ 5
    expect(isoWeekday('2026-11-15')).toBe(7); // Chủ nhật
    expect(isoWeekday('2026-11-16')).toBe(1); // Thứ 2
  });
  it('cộng ngày qua tháng/năm', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
  });
  it('giao nhau khoảng giờ/khoảng ngày', () => {
    expect(timeRangesOverlap('14:00', '15:30', '15:00', '16:00')).toBe(true);
    expect(timeRangesOverlap('14:00', '15:30', '15:30', '17:00')).toBe(false);
    expect(dateRangesOverlap('2026-01-01', null, '2027-01-01', '2027-02-01')).toBe(true);
    expect(dateRangesOverlap('2026-01-01', '2026-06-30', '2026-07-01', null)).toBe(false);
  });
  it('ngày không tồn tại bị từ chối', () => {
    expect(isoDate.safeParse('2026-02-30').success).toBe(false);
    expect(isoDate.safeParse('2028-02-29').success).toBe(true);
  });
});

describe('Chuẩn hóa văn bản', () => {
  it('bỏ dấu tiếng Việt cho tìm kiếm', () => {
    expect(normalizeSearch('  Nguyễn   Thị Đào ')).toBe('nguyen thi dao');
  });
  it('số điện thoại', () => {
    expect(normalizePhone('0912 345 678')).toBe('0912345678');
    expect(normalizePhone('+84912345678')).toBe('0912345678');
    expect(normalizePhone('84912345678')).toBe('0912345678');
    expect(normalizePhone('12345')).toBeNull();
    expect(phoneSchema.safeParse('abc').success).toBe(false);
  });
});

describe('Xác thực đầu vào & phân quyền mặc định', () => {
  it('mật khẩu', () => {
    expect(passwordSchema.safeParse('abc12345').success).toBe(true);
    expect(passwordSchema.safeParse('abcdefgh').success).toBe(false);
    expect(passwordSchema.safeParse('a1').success).toBe(false);
  });
  it('login mặc định WEB', () => {
    expect(loginSchema.parse({ identifier: 'admin@x.vn', password: 'x' }).client).toBe('WEB');
  });
  it('giáo viên không có quyền học phí, cấu hình', () => {
    const t = DEFAULT_ROLE_PERMISSIONS.TEACHER;
    expect(t).not.toContain('fees.read');
    expect(t).not.toContain('settings.manage');
    expect(t).toContain('attendance.write');
  });
  it('chủ lớp không cấu hình hệ thống nhưng duyệt được điều chỉnh', () => {
    const o = DEFAULT_ROLE_PERMISSIONS.OWNER;
    expect(o).not.toContain('settings.manage');
    expect(o).toContain('fees.approve_adjustment');
  });
  it('phụ huynh/học sinh chỉ có self.read', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.GUARDIAN).toEqual(['self.read']);
    expect(DEFAULT_ROLE_PERMISSIONS.STUDENT).toEqual(['self.read']);
  });
});
