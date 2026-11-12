import type { PermissionCode, RoleCode } from './constants';

/** Định dạng lỗi chuẩn của API. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface Paginated<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface MeResponse {
  id: number;
  fullName: string;
  email: string | null;
  phone: string | null;
  role: RoleCode;
  roleName: string;
  permissions: PermissionCode[];
  mustChangePassword: boolean;
  teacherId: number | null;
  guardianId: number | null;
  studentId: number | null;
  avatarFileId: number | null;
}

export interface LoginResponse {
  user: MeResponse;
  /** Chỉ trả về cho client MOBILE; web nhận qua cookie HttpOnly. */
  accessToken?: string;
  refreshToken?: string;
  accessTokenExpiresIn: number;
}
