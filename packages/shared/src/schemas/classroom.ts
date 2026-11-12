import { z } from 'zod';
import { isoDate } from './common';

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => v || null);

export const classPostCreateSchema = z.object({
  content: z.string().trim().min(1, 'Nhập nội dung buổi học').max(2000),
  postDate: isoDate.optional(),
});

export const homeworkCreateSchema = z.object({
  title: z.string().trim().min(2, 'Nhập tên bài tập').max(200),
  description: optText(2000),
  dueDate: isoDate,
});

export const homeworkSubmitSchema = z.object({
  studentId: z.coerce.number().int().positive(),
  note: optText(1000),
});

export const homeworkReviewSchema = z.object({
  studentId: z.number().int().positive(),
  result: z.enum(['DONE', 'NOT_DONE']),
  comment: optText(500),
});

export const feedQuery = z.object({
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type HomeworkReviewInput = z.infer<typeof homeworkReviewSchema>;
