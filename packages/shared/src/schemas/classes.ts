import { z } from 'zod';
import { CLASS_STATUSES } from '../constants';
import { hhmm, isoDate, phoneSchema, versionField } from './common';

const reason = z.string().trim().min(3, 'Nhập lý do (tối thiểu 3 ký tự)').max(500);
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v === undefined ? undefined : v ? v : null));

// ───── Ca học, phòng ─────
export const shiftCreateSchema = z
  .object({
    name: z.string().trim().min(1, 'Nhập tên ca').max(50),
    startTime: hhmm,
    endTime: hhmm,
    sortOrder: z.number().int().min(0).max(999).optional(),
  })
  .refine((v) => v.startTime < v.endTime, { message: 'Giờ kết thúc phải sau giờ bắt đầu', path: ['endTime'] });
export const shiftUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(50).optional(),
    startTime: hhmm.optional(),
    endTime: hhmm.optional(),
    sortOrder: z.number().int().min(0).max(999).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => !v.startTime || !v.endTime || v.startTime < v.endTime, {
    message: 'Giờ kết thúc phải sau giờ bắt đầu',
    path: ['endTime'],
  });

export const roomSchema = z.object({
  name: z.string().trim().min(1, 'Nhập tên phòng').max(50),
  capacity: z.number().int().positive().max(500).optional().nullable(),
  isActive: z.boolean().optional(),
});

// ───── Lịch học (lặp hằng tuần) ─────
export const scheduleInputSchema = z.object({
  shiftId: z.number().int().positive(),
  weekday: z.number().int().min(1).max(7),
  teacherId: z.number().int().positive().optional().nullable(),
  roomId: z.number().int().positive().optional().nullable(),
});
export type ScheduleInput = z.infer<typeof scheduleInputSchema>;

export const scheduleAddSchema = scheduleInputSchema.extend({ effectiveFrom: isoDate.optional() });
export const scheduleEndSchema = z.object({ effectiveTo: isoDate, reason: reason.optional() });

// ───── Lớp học ─────
export const classCreateSchema = z
  .object({
    classCode: z
      .string()
      .trim()
      .min(2, 'Mã lớp tối thiểu 2 ký tự')
      .max(30)
      .regex(/^[A-Za-z0-9._-]+$/, 'Mã lớp chỉ gồm chữ không dấu, số, dấu . _ -')
      .transform((v) => v.toUpperCase()),
    name: z.string().trim().min(2, 'Nhập tên lớp').max(100),
    englishLevel: optText(50),
    mainTeacherId: z.number().int().positive({ message: 'Chọn giáo viên' }),
    maxStudents: z.number().int().min(1, 'Sĩ số tối thiểu 1').max(100),
    startDate: isoDate,
    endDate: isoDate.optional().nullable(),
    notes: optText(1000),
    schedules: z.array(scheduleInputSchema).max(14).default([]),
  })
  .refine((v) => !v.endDate || v.endDate >= v.startDate, { message: 'Ngày kết thúc phải sau ngày bắt đầu', path: ['endDate'] });
export type ClassCreateInput = z.infer<typeof classCreateSchema>;

export const classUpdateSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  englishLevel: optText(50),
  mainTeacherId: z.number().int().positive().optional(),
  maxStudents: z.number().int().min(1).max(100).optional(),
  startDate: isoDate.optional(),
  endDate: isoDate.optional().nullable(),
  notes: optText(1000),
  version: versionField,
});
export type ClassUpdateInput = z.infer<typeof classUpdateSchema>;

export const classListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum([...CLASS_STATUSES, 'ALL']).optional(),
  teacherId: z.coerce.number().int().positive().optional(),
  level: z.string().trim().max(50).optional(),
});

export const classCloseSchema = z.object({ closeDate: isoDate, reason, version: versionField });
export const classOpenSchema = z.object({ version: versionField });

// ───── Ghi danh / chuyển lớp ─────
export const enrollSchema = z.object({
  studentIds: z.array(z.number().int().positive()).min(1, 'Chọn ít nhất một học sinh').max(50),
  startDate: isoDate,
  /** Quản trị viên được vượt sĩ số tối đa khi có lý do. */
  overrideCapacityReason: z.string().trim().min(3).max(300).optional(),
});
export const transferSchema = z.object({
  toClassId: z.number().int().positive(),
  effectiveDate: isoDate,
  reason,
  overrideCapacityReason: z.string().trim().min(3).max(300).optional(),
});
export const enrollmentEndSchema = z.object({
  endDate: isoDate,
  reason,
  endReason: z.enum(['COMPLETED', 'DROP']).default('COMPLETED'),
});

// ───── Buổi học ─────
export const lessonCreateSchema = z
  .object({
    lessonDate: isoDate,
    startTime: hhmm,
    endTime: hhmm,
    teacherId: z.number().int().positive(),
    roomId: z.number().int().positive().optional().nullable(),
    topic: optText(300),
  })
  .refine((v) => v.startTime < v.endTime, { message: 'Giờ kết thúc phải sau giờ bắt đầu', path: ['endTime'] });
export const lessonUpdateSchema = z.object({
  teacherId: z.number().int().positive().optional(),
  roomId: z.number().int().positive().optional().nullable(),
  topic: optText(300),
  cancel: z.object({ reason }).optional(),
  restore: z.boolean().optional(),
  version: versionField,
});
export const calendarQuery = z
  .object({
    from: isoDate,
    to: isoDate,
    teacherId: z.coerce.number().int().positive().optional(),
    roomId: z.coerce.number().int().positive().optional(),
    classId: z.coerce.number().int().positive().optional(),
  })
  .refine((v) => v.from <= v.to, 'Khoảng ngày không hợp lệ')
  .refine((v) => (Date.parse(v.to) - Date.parse(v.from)) / 86400000 <= 62, 'Tối đa 62 ngày mỗi lần xem');

// ───── Giáo viên ─────
export const teacherCreateSchema = z
  .object({
    fullName: z.string().trim().min(2, 'Nhập họ tên').max(100),
    phone: phoneSchema.optional().nullable(),
    email: z.string().trim().toLowerCase().email('Email không hợp lệ').max(254).optional().nullable().or(z.literal('').transform(() => null)),
    specialty: optText(200),
    hiredDate: isoDate.optional().nullable(),
    notes: optText(1000),
  })
  .refine((v) => !!v.phone || !!v.email, { message: 'Cần số điện thoại hoặc email để đăng nhập', path: ['phone'] });
export const teacherUpdateSchema = z.object({
  fullName: z.string().trim().min(2).max(100).optional(),
  phone: phoneSchema.optional().nullable(),
  email: z.string().trim().toLowerCase().email('Email không hợp lệ').max(254).optional().nullable().or(z.literal('').transform(() => null)),
  specialty: optText(200),
  hiredDate: isoDate.optional().nullable(),
  notes: optText(1000),
});
