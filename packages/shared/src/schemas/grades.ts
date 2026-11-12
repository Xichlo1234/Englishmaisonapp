import { z } from 'zod';
import { isoDate } from './common';

export const criterionSaveSchema = z.object({
  criteria: z
    .array(
      z.object({
        id: z.number().int().positive().optional(),
        code: z
          .string()
          .trim()
          .regex(/^[A-Z0-9_]{2,30}$/, 'Mã tiêu chí: chữ in hoa không dấu, số, gạch dưới')
          .optional(),
        name: z.string().trim().min(1, 'Nhập tên tiêu chí').max(50),
        weight: z.number().positive('Trọng số phải lớn hơn 0').max(100),
        maxScore: z.number().positive('Thang điểm phải lớn hơn 0').max(1000),
        isActive: z.boolean(),
        sortOrder: z.number().int().min(0).max(999),
      }),
    )
    .min(1)
    .max(20),
});

export const gradeBandsSchema = z.object({
  bands: z
    .array(z.object({ min: z.number().min(0).max(10), label: z.string().trim().min(1).max(40) }))
    .min(2)
    .max(10),
});

export const assessmentTypeUpdateSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  criteriaIds: z.array(z.number().int().positive()).min(1, 'Chọn ít nhất một tiêu chí').optional(),
  isActive: z.boolean().optional(),
});

export const assessmentCreateSchema = z.object({
  classId: z.number().int().positive(),
  assessmentTypeId: z.number().int().positive(),
  title: z.string().trim().min(2, 'Nhập tên đợt đánh giá').max(120),
  assessedOn: isoDate,
  lessonId: z.number().int().positive().optional().nullable(),
});

export const assessmentListQuery = z.object({
  classId: z.coerce.number().int().positive().optional(),
  typeId: z.coerce.number().int().positive().optional(),
});

export const gradesSaveSchema = z.object({
  grades: z
    .array(
      z.object({
        studentId: z.number().int().positive(),
        criterionId: z.number().int().positive(),
        /** null = xóa điểm tiêu chí này */
        score: z.number().min(0).nullable(),
      }),
    )
    .max(2000)
    .default([]),
  comments: z
    .array(
      z.object({
        studentId: z.number().int().positive(),
        comment: z
          .string()
          .trim()
          .max(1000)
          .nullable()
          .transform((v) => (v ? v : null)),
      }),
    )
    .max(200)
    .default([]),
});

/** Cấu hình được chụp lại khi tạo đợt đánh giá — đổi cấu hình sau này không làm thay đổi kết quả cũ. */
export interface AssessmentSnapshot {
  criteria: { id: number; code: string; name: string; weight: number; maxScore: number }[];
  bands: { min: number; label: string }[];
}
