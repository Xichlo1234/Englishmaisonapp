import type { RoleCode } from '@ecm/shared';
import { api } from '@/lib/api';

export interface UserRow {
  id: number;
  fullName: string;
  email: string | null;
  phone: string | null;
  role: RoleCode;
  status: 'ACTIVE' | 'DISABLED' | 'LOCKED';
  lockedUntil: string | null;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  teacherId: number | null;
  guardianId: number | null;
  studentId: number | null;
}

export const usersApi = {
  list: (q: { role?: string; status?: string; q?: string }) => api<{ data: UserRow[] }>('/users', { query: q }),
  createStaff: (body: { fullName: string; email: string | null; phone: string | null; role: 'ADMIN' | 'OWNER' }) =>
    api<{ id: number; tempPassword: string }>('/users', { body }),
  update: (id: number, body: { status?: 'ACTIVE' | 'DISABLED'; role?: 'ADMIN' | 'OWNER'; reason?: string }) =>
    api(`/users/${id}`, { method: 'PATCH', body }),
  unlock: (id: number) => api(`/users/${id}/unlock`, { body: {} }),
  revokeSessions: (id: number) => api(`/users/${id}/revoke-sessions`, { body: {} }),
  resetPassword: (id: number) => api<{ tempPassword: string }>(`/users/${id}/reset-password`, { body: {} }),
  createGuardianAccount: (guardianId: number) => api<{ login: string; tempPassword: string }>(`/guardians/${guardianId}/account`, { body: {} }),
};
