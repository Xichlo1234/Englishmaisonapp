import type { ContentfulStatusCode } from 'hono/utils/http-status';

/** Lỗi nghiệp vụ có mã ổn định để client xử lý; message hiển thị được cho người dùng. */
export class AppError extends Error {
  constructor(
    public readonly status: ContentfulStatusCode,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const Errors = {
  unauthorized: (msg = 'Vui lòng đăng nhập') => new AppError(401, 'UNAUTHORIZED', msg),
  invalidCredentials: () => new AppError(401, 'INVALID_CREDENTIALS', 'Thông tin đăng nhập không đúng'),
  accountLocked: (until: string) =>
    new AppError(423, 'ACCOUNT_LOCKED', 'Tài khoản tạm khóa do đăng nhập sai nhiều lần. Vui lòng thử lại sau.', {
      lockedUntil: until,
    }),
  accountDisabled: () => new AppError(403, 'ACCOUNT_DISABLED', 'Tài khoản đã bị vô hiệu hóa'),
  forbidden: (msg = 'Bạn không có quyền thực hiện thao tác này') => new AppError(403, 'FORBIDDEN', msg),
  csrf: () => new AppError(403, 'CSRF_FAILED', 'Phiên làm việc không hợp lệ, vui lòng tải lại trang'),
  passwordChangeRequired: () =>
    new AppError(403, 'PASSWORD_CHANGE_REQUIRED', 'Bạn cần đổi mật khẩu trước khi tiếp tục'),
  notFound: (what = 'Dữ liệu') => new AppError(404, 'NOT_FOUND', `${what} không tồn tại`),
  conflict: (code: string, msg: string, details?: unknown) => new AppError(409, code, msg, details),
  versionConflict: () =>
    new AppError(409, 'VERSION_CONFLICT', 'Dữ liệu đã được người khác cập nhật. Vui lòng tải lại.'),
  validation: (details: unknown, msg = 'Dữ liệu không hợp lệ') => new AppError(422, 'VALIDATION_ERROR', msg, details),
  business: (code: string, msg: string, details?: unknown) => new AppError(422, code, msg, details),
  tooManyRequests: () => new AppError(429, 'TOO_MANY_REQUESTS', 'Thao tác quá nhanh, vui lòng thử lại sau ít phút'),
};
