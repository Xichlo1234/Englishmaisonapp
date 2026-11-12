import type { AssessmentSnapshot, GradeBand } from '@ecm/shared';
import { api } from '@/lib/api';

export interface GradingConfig {
  criteria: { id: number; code: string; name: string; weight: number; maxScore: number; isActive: boolean; sortOrder: number }[];
  types: { id: number; code: string; name: string; criteriaIds: number[]; isActive: boolean }[];
  bands: GradeBand[];
}
export interface AssessmentRow {
  id: number;
  classId: number;
  classCode: string;
  title: string;
  typeName: string;
  assessedOn: string;
  status: 'DRAFT' | 'PUBLISHED';
  gradedStudents: number;
  classAverage: number | null;
}
export interface AssessmentSheet {
  assessment: {
    id: number;
    classId: number;
    classCode: string;
    className: string;
    typeName: string;
    title: string;
    assessedOn: string;
    status: 'DRAFT' | 'PUBLISHED';
    publishedAt: string | null;
    createdBy: string | null;
    lessonId: number | null;
  };
  snapshot: AssessmentSnapshot;
  students: {
    studentId: number;
    studentCode: string;
    fullName: string;
    scores: Record<number, number>;
    average: number | null;
    classification: string | null;
    comment: string | null;
  }[];
  canEdit: boolean;
  blockReason: string | null;
  canPublish: boolean;
}
export interface StudentResult {
  id: number;
  title: string;
  typeName: string;
  assessedOn: string;
  classCode: string;
  status: string;
  average: number | null;
  classification: string | null;
  comment: string | null;
  scores: { criterionId: number; name: string; maxScore: number; score: number | null }[];
}
export interface GradeHistory {
  id: number;
  action: string;
  actorName: string | null;
  createdAt: string;
  changes: { student: string; criterion: string; from: number | null; to: number | null }[];
}

export const gradeKeys = {
  config: ['grading', 'config'] as const,
  list: (classId: number) => ['assessments', 'list', classId] as const,
  sheet: (id: number) => ['assessments', 'sheet', id] as const,
  history: (id: number) => ['assessments', 'history', id] as const,
  student: (id: number) => ['assessments', 'student', id] as const,
};

export const gradesApi = {
  config: () => api<GradingConfig>('/grading/config'),
  saveCriteria: (criteria: unknown[]) => api('/grading/criteria', { method: 'PUT', body: { criteria } }),
  saveBands: (bands: GradeBand[]) => api('/grading/bands', { method: 'PUT', body: { bands } }),
  updateType: (id: number, body: unknown) => api(`/grading/types/${id}`, { method: 'PATCH', body }),
  list: (classId: number) => api<{ data: AssessmentRow[] }>('/assessments', { query: { classId } }),
  create: (body: unknown) => api<{ id: number }>('/assessments', { body }),
  sheet: (id: number) => api<AssessmentSheet>(`/assessments/${id}`),
  save: (id: number, body: { grades: { studentId: number; criterionId: number; score: number | null }[]; comments: { studentId: number; comment: string | null }[] }) =>
    api<{ saved: number }>(`/assessments/${id}/grades`, { method: 'PUT', body }),
  publish: (id: number) => api<{ notified: number }>(`/assessments/${id}/publish`, { body: {} }),
  remove: (id: number) => api(`/assessments/${id}`, { method: 'DELETE' }),
  history: (id: number) => api<{ data: GradeHistory[] }>(`/assessments/${id}/history`),
  studentResults: (studentId: number) => api<{ data: StudentResult[] }>(`/students/${studentId}/results`),
};

/** Màu badge theo xếp loại (theo vị trí trong thang, không phụ thuộc nhãn tùy chỉnh). */
export function bandVariant(label: string | null, bands: GradeBand[]): 'success' | 'default' | 'warning' | 'danger' | 'muted' {
  if (!label) return 'muted';
  const sorted = [...bands].sort((a, b) => b.min - a.min);
  const i = sorted.findIndex((b) => b.label === label);
  if (i < 0) return 'muted';
  if (i === sorted.length - 1) return 'danger';
  if (i <= 1) return 'success';
  if (i === sorted.length - 2) return 'warning';
  return 'default';
}
