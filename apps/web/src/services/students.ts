import type { Paginated, StudentStatus } from '@ecm/shared';
import { api } from '@/lib/api';

export interface StudentListRow {
  id: number;
  studentCode: string;
  fullName: string;
  dateOfBirth: string | null;
  gender: string | null;
  englishLevel: string | null;
  status: StudentStatus;
  startDate: string;
  needsAttention: boolean;
  schoolName: string | null;
  currentClasses: { id: number; code: string; name: string }[];
  primaryGuardian: { name: string; phone: string } | null;
  photoFileId: number | null;
}

export interface StudentExportRow extends StudentListRow {
  address: string | null;
  schoolGrade: string | null;
}

export interface GuardianOfStudent {
  id: number;
  fullName: string;
  phone: string;
  email: string | null;
  relationship: 'FATHER' | 'MOTHER' | 'OTHER';
  isPrimary: boolean;
  receiveNotifications: boolean;
  hasAccount: boolean;
}

export interface EnrollmentOfStudent {
  id: number;
  classId: number;
  classCode: string;
  className: string;
  startDate: string;
  endDate: string | null;
  status: 'ACTIVE' | 'ENDED';
  endReason: string | null;
  note: string | null;
  transferredFromId: number | null;
}

export interface StudentDetail {
  id: number;
  studentCode: string;
  fullName: string;
  dateOfBirth: string | null;
  gender: 'MALE' | 'FEMALE' | 'OTHER' | null;
  address: string | null;
  schoolName: string | null;
  schoolGrade: string | null;
  startDate: string;
  englishLevel: string | null;
  status: StudentStatus;
  statusBeforeArchive: string | null;
  pauseUntil: string | null;
  needsAttention: boolean;
  attentionNote: string | null;
  notes: string | null;
  photoFileId: number | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  guardians: GuardianOfStudent[];
  enrollments: EnrollmentOfStudent[];
  canEdit: boolean;
}

export interface TimelineEntry {
  id: number;
  action: string;
  before: unknown;
  after: unknown;
  reason: string | null;
  createdAt: string;
  actorName: string | null;
}

export interface StudentFilters {
  q?: string;
  status?: string;
  level?: string;
  needsAttention?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
}

export const studentKeys = {
  all: ['students'] as const,
  list: (f: StudentFilters) => ['students', 'list', f] as const,
  detail: (id: number) => ['students', 'detail', id] as const,
  timeline: (id: number) => ['students', 'timeline', id] as const,
};

export const studentsApi = {
  list: (f: StudentFilters) => api<Paginated<StudentListRow>>('/students', { query: { ...f } }),
  export: (f: StudentFilters) => api<{ data: StudentExportRow[] }>('/students/export', { query: { ...f, page: undefined, pageSize: undefined } }),
  detail: (id: number) => api<StudentDetail>(`/students/${id}`),
  timeline: (id: number) => api<{ data: TimelineEntry[] }>(`/students/${id}/timeline`),
  create: (body: unknown) => api<{ id: number; studentCode: string }>('/students', { body }),
  update: (id: number, body: unknown) => api<{ version: number }>(`/students/${id}`, { method: 'PATCH', body }),
  action: (id: number, action: 'pause' | 'drop' | 'reactivate' | 'archive' | 'restore', body: unknown) =>
    api<{ status: StudentStatus; version: number }>(`/students/${id}/${action}`, { body }),
  remove: (id: number) => api(`/students/${id}`, { method: 'DELETE' }),
  duplicates: (q: { fullName?: string; dateOfBirth?: string; phone?: string; excludeId?: number }) =>
    api<{ data: { id: number; studentCode: string; fullName: string; dateOfBirth: string | null; status: string }[] }>(
      '/students/check-duplicates',
      { query: q },
    ),
  findGuardians: (phone: string) =>
    api<{ data: { id: number; fullName: string; phone: string; email: string | null; children: string | null }[] }>('/guardians', {
      query: { phone },
    }),
  linkGuardian: (id: number, body: unknown) => api(`/students/${id}/guardians`, { body }),
  updateGuardian: (id: number, guardianId: number, body: unknown) =>
    api(`/students/${id}/guardians/${guardianId}`, { method: 'PATCH', body }),
  unlinkGuardian: (id: number, guardianId: number) => api(`/students/${id}/guardians/${guardianId}`, { method: 'DELETE' }),
  uploadPhoto: (id: number, file: Blob) => {
    const form = new FormData();
    form.append('file', file, 'photo.jpg');
    return api<{ fileId: number }>(`/students/${id}/photo`, { form });
  },
};
