import { z } from 'zod';
import { ATTENDANCE_STATUSES } from '../constants';
import { isoDate, versionField } from './common';

export const attendanceRecordInput = z
  .object({
    studentId: z.number().int().positive(),
    status: z.enum(ATTENDANCE_STATUSES),
    lateMinutes: z.number().int().min(1).max(240).optional().nullable(),
    note: z
      .string()
      .trim()
      .max(300)
      .optional()
      .nullable()
      .transform((v) => (v ? v : null)),
  })
  .transform((r) => ({ ...r, lateMinutes: r.status === 'LATE' ? (r.lateMinutes ?? null) : null }));
export type AttendanceRecordInput = z.infer<typeof attendanceRecordInput>;

export const attendanceSaveSchema = z.object({
  records: z.array(attendanceRecordInput).max(100),
  version: versionField,
});
export const attendanceSubmitSchema = z.object({ version: versionField });
export const attendanceUnlockSchema = z.object({ reason: z.string().trim().min(3, 'Nhập lý do mở khóa').max(500) });

export const myLessonsQuery = z.object({ date: isoDate.optional() });
export const attendanceRangeQuery = z.object({ from: isoDate.optional(), to: isoDate.optional() });
export const attendanceMatrixQuery = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/, 'Tháng dạng YYYY-MM') });
