import type { PermissionCode, RoleCode } from '@ecm/shared';

/** Bindings và biến môi trường của Worker (xem wrangler.jsonc). */
export interface Bindings {
  DB: D1Database;
  FILES: R2Bucket;
  ASSETS: Fetcher;
  LOGIN_LIMITER?: RateLimit;

  APP_ENV: 'development' | 'staging' | 'production' | 'test';
  APP_ORIGIN: string;
  ACCESS_TOKEN_TTL_SECONDS: string;
  REFRESH_TTL_WEB_DAYS: string;
  REFRESH_TTL_MOBILE_DAYS: string;
  PBKDF2_ITERATIONS: string;
  MAX_UPLOAD_MB: string;
  FCM_PROJECT_ID: string;

  // Secrets
  JWT_SECRET: string;
  FCM_CLIENT_EMAIL?: string;
  FCM_PRIVATE_KEY?: string;
}

export interface AuthUser {
  id: number;
  sessionId: number;
  role: RoleCode;
  fullName: string;
  permissions: Set<PermissionCode>;
  mustChangePassword: boolean;
  teacherId: number | null;
  guardianId: number | null;
  studentId: number | null;
  /** Xác thực qua cookie (web) hay Bearer (mobile). */
  via: 'cookie' | 'bearer';
}

export interface Variables {
  requestId: string;
  user: AuthUser;
}

export type AppEnv = { Bindings: Bindings; Variables: Variables };
