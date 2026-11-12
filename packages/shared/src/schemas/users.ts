import { z } from 'zod';
import { ROLE_CODES } from '../constants';
import { phoneSchema } from './common';

export const STAFF_ROLE_CODES = ['ADMIN', 'OWNER'] as const;
export const USER_STATUS_FILTERS = ['ACTIVE', 'LOCKED', 'DISABLED'] as const;

const optEmail = z
  .string()
  .trim()
  .toLowerCase()
  .email('Email không hợp lệ')
  .max(254)
  .optional()
  .nullable()
  .or(z.literal('').transform(() => null));

export const userListQuery = z.object({
  role: z.enum(ROLE_CODES).optional(),
  status: z.enum(USER_STATUS_FILTERS).optional(),
  q: z.string().trim().max(100).optional(),
});

export const staffCreateSchema = z
  .object({
    fullName: z.string().trim().min(2, 'Nhập họ tên').max(100),
    email: optEmail,
    phone: phoneSchema.optional().nullable().or(z.literal('').transform(() => null)),
    role: z.enum(STAFF_ROLE_CODES),
  })
  .refine((v) => !!v.phone || !!v.email, { message: 'Cần số điện thoại hoặc email để đăng nhập', path: ['email'] });

export const userUpdateSchema = z
  .object({
    status: z.enum(['ACTIVE', 'DISABLED']).optional(),
    role: z.enum(STAFF_ROLE_CODES).optional(),
    reason: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.status !== undefined || v.role !== undefined, 'Không có thay đổi nào');

export type StaffCreateInput = z.infer<typeof staffCreateSchema>;
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;

export const centerSettingsSchema = z.object({
  name: z.string().trim().min(2, 'Nhập tên trung tâm').max(120),
  address: z.string().trim().max(250).nullable().transform((v) => v || null),
  phone: z.string().trim().max(30).nullable().transform((v) => v || null),
});
export type CenterSettingsInput = z.infer<typeof centerSettingsSchema>;
