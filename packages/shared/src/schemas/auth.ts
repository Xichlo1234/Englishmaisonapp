import { z } from 'zod';

export const PASSWORD_MIN_LENGTH = 8;

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Mật khẩu tối thiểu ${PASSWORD_MIN_LENGTH} ký tự`)
  .max(128, 'Mật khẩu tối đa 128 ký tự')
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'Mật khẩu phải có cả chữ và số');

export const loginSchema = z.object({
  identifier: z.string().trim().min(3, 'Nhập số điện thoại hoặc email').max(254),
  password: z.string().min(1, 'Nhập mật khẩu').max(128),
  client: z.enum(['WEB', 'MOBILE']).default('WEB'),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(20).max(200).optional(),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Nhập mật khẩu hiện tại'),
    newPassword: passwordSchema,
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: 'Mật khẩu mới phải khác mật khẩu hiện tại',
    path: ['newPassword'],
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const registerDeviceSchema = z.object({
  fcmToken: z.string().min(10).max(4096),
  platform: z.enum(['ANDROID', 'IOS']),
});
