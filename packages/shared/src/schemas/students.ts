import { z } from 'zod';
import { GENDERS, STUDENT_STATUSES } from '../constants';
import { isoDate, phoneSchema, versionField } from './common';

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Tối đa ${max} ký tự`)
    .optional()
    .nullable()
    .transform((v) => (v === undefined ? undefined : v ? v : null));

export const RELATIONSHIPS = ['FATHER', 'MOTHER', 'OTHER'] as const;
export const RELATIONSHIP_LABELS: Record<(typeof RELATIONSHIPS)[number], string> = {
  FATHER: 'Bố',
  MOTHER: 'Mẹ',
  OTHER: 'Khác',
};

export const guardianInputSchema = z.object({
  fullName: z.string().trim().min(2, 'Nhập tên phụ huynh').max(100),
  phone: phoneSchema,
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('Email không hợp lệ')
    .max(254)
    .optional()
    .nullable()
    .or(z.literal('').transform(() => null)),
});
export type GuardianInput = z.infer<typeof guardianInputSchema>;

export const guardianLinkSchema = z.object({
  /** Liên kết phụ huynh đã có (theo id) hoặc tạo mới (guardian). */
  guardianId: z.number().int().positive().optional(),
  guardian: guardianInputSchema.optional(),
  relationship: z.enum(RELATIONSHIPS).default('OTHER'),
  isPrimary: z.boolean().default(false),
  receiveNotifications: z.boolean().default(true),
}).refine((v) => !!v.guardianId !== !!v.guardian, 'Chọn phụ huynh có sẵn hoặc nhập phụ huynh mới');
export type GuardianLinkInput = z.infer<typeof guardianLinkSchema>;

const profileFields = {
  fullName: z.string().trim().min(2, 'Họ tên tối thiểu 2 ký tự').max(100, 'Họ tên tối đa 100 ký tự'),
  dateOfBirth: isoDate.optional().nullable(),
  gender: z.enum(GENDERS).optional().nullable(),
  address: optText(300),
  schoolName: optText(150),
  schoolGrade: optText(30),
  startDate: isoDate,
  englishLevel: optText(50),
  needsAttention: z.boolean().optional(),
  attentionNote: optText(500),
  notes: optText(2000),
  photoConsent: z.boolean().optional(),
};

export const studentCreateSchema = z
  .object({
    ...profileFields,
    guardians: z.array(guardianLinkSchema).min(1, 'Cần ít nhất một phụ huynh').max(3, 'Tối đa 3 phụ huynh'),
  })
  .refine((v) => !v.dateOfBirth || v.dateOfBirth < v.startDate, {
    message: 'Ngày sinh phải trước ngày bắt đầu học',
    path: ['dateOfBirth'],
  });
export type StudentCreateInput = z.infer<typeof studentCreateSchema>;

export const studentUpdateSchema = z
  .object({
    fullName: profileFields.fullName.optional(),
    dateOfBirth: profileFields.dateOfBirth,
    gender: profileFields.gender,
    address: profileFields.address,
    schoolName: profileFields.schoolName,
    schoolGrade: profileFields.schoolGrade,
    startDate: isoDate.optional(),
    englishLevel: profileFields.englishLevel,
    needsAttention: z.boolean().optional(),
    attentionNote: profileFields.attentionNote,
    notes: profileFields.notes,
    photoConsent: z.boolean().optional(),
    version: versionField,
  });
export type StudentUpdateInput = z.infer<typeof studentUpdateSchema>;

export const studentListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum([...STUDENT_STATUSES, 'ALL']).optional(),
  level: z.string().trim().max(50).optional(),
  classId: z.coerce.number().int().positive().optional(),
  needsAttention: z.enum(['1', '0']).optional(),
  sort: z.enum(['name', 'code', 'startDate', 'recent']).default('name'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type StudentListQuery = z.infer<typeof studentListQuery>;

const reason = z.string().trim().min(3, 'Nhập lý do (tối thiểu 3 ký tự)').max(500);

export const studentPauseSchema = z
  .object({ effectiveDate: isoDate, until: isoDate.optional().nullable(), reason, version: versionField })
  .refine((v) => !v.until || v.until > v.effectiveDate, {
    message: 'Ngày quay lại phải sau ngày tạm nghỉ',
    path: ['until'],
  });
export const studentDropSchema = z.object({ effectiveDate: isoDate, reason, version: versionField });
export const studentReactivateSchema = z.object({ reason: reason.optional(), version: versionField });
export const studentArchiveSchema = z.object({ reason, version: versionField });
export const studentRestoreSchema = z.object({ version: versionField });

export const duplicateCheckQuery = z.object({
  fullName: z.string().trim().max(100).optional(),
  dateOfBirth: isoDate.optional(),
  phone: z.string().trim().max(20).optional(),
  excludeId: z.coerce.number().int().positive().optional(),
});

/** Chuyển trạng thái hợp lệ (xem tài liệu thiết kế §1.3 M02). */
export const STUDENT_TRANSITIONS = {
  pause: ['ACTIVE'],
  drop: ['ACTIVE', 'PAUSED'],
  reactivate: ['PAUSED', 'DROPPED', 'GRADUATED'],
  archive: ['ACTIVE', 'PAUSED', 'DROPPED', 'GRADUATED'],
  restore: ['ARCHIVED'],
} as const;
