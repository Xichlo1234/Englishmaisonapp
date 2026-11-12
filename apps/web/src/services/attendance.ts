import type { AttendanceStats, AttendanceStatus } from '@ecm/shared';
import { api } from '@/lib/api';

export interface DayLesson {
  id: number;
  classId: number;
  classCode: string;
  className: string;
  lessonDate: string;
  startTime: string;
  endTime: string;
  teacherName: string;
  roomName: string | null;
  status: string;
  attendanceStatus: string;
  total: number;
  marked: number;
  absent: number;
  late: number;
}

export interface SheetStudent {
  enrollmentId: number;
  studentId: number;
  studentCode: string;
  fullName: string;
  photoFileId: number | null;
  status: AttendanceStatus | null;
  lateMinutes: number | null;
  note: string | null;
  markedAt: string | null;
  markedBy: string | null;
  updatedBy: string | null;
}

export interface AttendanceSheet {
  lesson: {
    id: number;
    classId: number;
    classCode: string;
    className: string;
    lessonDate: string;
    startTime: string;
    endTime: string;
    teacherName: string;
    roomName: string | null;
    status: string;
    attendanceStatus: 'NOT_STARTED' | 'DRAFT' | 'SUBMITTED' | 'LOCKED';
    submittedAt: string | null;
    submittedBy: string | null;
    lockedAt: string | null;
    topic: string | null;
    version: number;
  };
  students: SheetStudent[];
  summary: AttendanceStats;
  unmarked: number;
  canEdit: boolean;
  blockReason: string | null;
  canUnlock: boolean;
}

export interface HistoryEntry {
  id: number;
  action: string;
  actorName: string | null;
  createdAt: string;
  reason: string | null;
  changes: { studentId: number; studentName: string; from: AttendanceStatus | null; to: AttendanceStatus }[];
  summary: AttendanceStats | null;
}

export interface Matrix {
  month: string;
  lessons: { id: number; lessonDate: string; startTime: string; attendanceStatus: string }[];
  students: { id: number; studentCode: string; fullName: string; cells: Record<string, AttendanceStatus | null>; stats: AttendanceStats }[];
}

export interface RecordInput {
  studentId: number;
  status: AttendanceStatus;
  lateMinutes?: number | null;
  note?: string | null;
}

export const attendanceKeys = {
  day: (date: string) => ['attendance', 'day', date] as const,
  sheet: (id: number) => ['attendance', 'sheet', id] as const,
  history: (id: number) => ['attendance', 'history', id] as const,
  matrix: (classId: number, month: string) => ['attendance', 'matrix', classId, month] as const,
  student: (id: number) => ['attendance', 'student', id] as const,
};

export const attendanceApi = {
  day: (date: string) => api<{ data: DayLesson[] }>('/attendance/lessons', { query: { date } }),
  sheet: (lessonId: number) => api<AttendanceSheet>(`/lessons/${lessonId}/attendance`),
  save: (lessonId: number, version: number, records: RecordInput[]) =>
    api<{ version: number; saved: number; attendanceStatus: string }>(`/lessons/${lessonId}/attendance`, { method: 'PUT', body: { version, records } }),
  submit: (lessonId: number, version: number) => api<{ version: number; absentNotified: number }>(`/lessons/${lessonId}/attendance/submit`, { body: { version } }),
  unlock: (lessonId: number, reason: string) => api(`/lessons/${lessonId}/attendance/unlock`, { body: { reason } }),
  history: (lessonId: number) => api<{ data: HistoryEntry[] }>(`/lessons/${lessonId}/attendance/history`),
  matrix: (classId: number, month: string) => api<Matrix>(`/attendance/classes/${classId}/matrix`, { query: { month } }),
  student: (studentId: number, from?: string, to?: string) =>
    api<{ from: string; to: string; stats: AttendanceStats; records: { lessonId: number; lessonDate: string; startTime: string; classCode: string; status: AttendanceStatus; lateMinutes: number | null; note: string | null }[] }>(
      `/attendance/students/${studentId}`,
      { query: { from, to } },
    ),
};

/** Màu & nhãn trạng thái điểm danh (xanh = có mặt, vàng = muộn, xanh dương = vắng có phép, đỏ = vắng không phép). */
export const STATUS_STYLE: Record<AttendanceStatus, { label: string; short: string; mobile: string; on: string; cell: string }> = {
  PRESENT: { label: 'Có mặt', short: 'C', mobile: 'Có mặt', on: 'bg-success text-white border-success', cell: 'bg-success-soft text-green-800' },
  LATE: { label: 'Đi muộn', short: 'M', mobile: 'Muộn', on: 'bg-amber-500 text-white border-amber-500', cell: 'bg-warning-soft text-yellow-800' },
  EXCUSED: { label: 'Vắng có phép', short: 'P', mobile: 'Vắng P', on: 'bg-sky-600 text-white border-sky-600', cell: 'bg-sky-100 text-sky-800' },
  UNEXCUSED: { label: 'Vắng không phép', short: 'K', mobile: 'Vắng KP', on: 'bg-destructive text-white border-destructive', cell: 'bg-danger-soft text-red-700' },
};
export const STATUS_ORDER: AttendanceStatus[] = ['PRESENT', 'LATE', 'EXCUSED', 'UNEXCUSED'];
