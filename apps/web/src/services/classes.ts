import { api } from '@/lib/api';

export type ClassStatus = 'PLANNED' | 'OPEN' | 'CLOSED';

export interface Shift {
  id: number;
  name: string;
  startTime: string;
  endTime: string;
  isActive: number | boolean;
  sortOrder: number;
  classCount?: number;
}
export interface Room {
  id: number;
  name: string;
  capacity: number | null;
  isActive: boolean;
}
export interface TeacherRow {
  id: number;
  teacherCode: string;
  fullName: string;
  phone?: string | null;
  email?: string | null;
  specialty?: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  hiredDate?: string | null;
  userId?: number;
  accountStatus?: string;
  lastLoginAt?: string | null;
  classCount?: number;
  weeklySessions?: number;
}
export interface ClassListRow {
  id: number;
  classCode: string;
  name: string;
  englishLevel: string | null;
  status: ClassStatus;
  startDate: string;
  endDate: string | null;
  maxStudents: number;
  mainTeacherId: number | null;
  mainTeacherName: string | null;
  activeStudents: number;
  schedules: { weekday: number; shiftName: string; startTime: string; endTime: string }[];
}
export interface ClassSchedule {
  id: number;
  shiftId: number;
  shiftName: string;
  startTime: string;
  endTime: string;
  weekday: number;
  teacherId: number;
  teacherName: string;
  roomId: number | null;
  roomName: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  active: boolean;
}
export interface ClassDetail {
  id: number;
  classCode: string;
  name: string;
  englishLevel: string | null;
  mainTeacherId: number | null;
  mainTeacher: { id: number; fullName: string } | null;
  maxStudents: number;
  startDate: string;
  endDate: string | null;
  status: ClassStatus;
  notes: string | null;
  version: number;
  closedAt: string | null;
  schedules: ClassSchedule[];
  students: {
    enrollmentId: number;
    studentId: number;
    studentCode: string;
    fullName: string;
    dateOfBirth: string | null;
    status: string;
    startDate: string;
    guardianPhone: string | null;
  }[];
  lessonStats: { total: number; done: number; upcoming: number; cancelled: number };
  canManage: boolean;
  canEnroll: boolean;
}
export interface LessonRow {
  id: number;
  lessonDate: string;
  startTime: string;
  endTime: string;
  teacherId: number;
  teacherName: string;
  roomId: number | null;
  roomName: string | null;
  status: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED';
  cancelReason: string | null;
  topic: string | null;
  attendanceStatus: string;
  isMakeup: number;
  version: number;
}
export interface CalendarLesson {
  id: number;
  classId: number;
  classCode: string;
  className: string;
  lessonDate: string;
  startTime: string;
  endTime: string;
  teacherId: number;
  teacherName: string;
  roomId: number | null;
  roomName: string | null;
  status: string;
  attendanceStatus: string;
  isMakeup: number;
}
export interface HistoryRow {
  id: number;
  studentId: number;
  studentCode: string;
  fullName: string;
  startDate: string;
  endDate: string | null;
  status: string;
  endReason: string | null;
  note: string | null;
  fromClassCode: string | null;
  toClassCode: string | null;
}
export interface ScheduleConflict {
  kind: 'TEACHER' | 'ROOM';
  classCode: string;
  detail: string;
}

export const classKeys = {
  all: ['classes'] as const,
  list: (f: object) => ['classes', 'list', f] as const,
  detail: (id: number) => ['classes', 'detail', id] as const,
  lessons: (id: number, from: string, to: string) => ['classes', 'lessons', id, from, to] as const,
  history: (id: number) => ['classes', 'history', id] as const,
  shifts: ['shifts'] as const,
  rooms: ['rooms'] as const,
  teachers: (all: boolean) => ['teachers', all] as const,
  calendar: (f: object) => ['calendar', f] as const,
};

export const classesApi = {
  list: (f: { q?: string; status?: string; teacherId?: number; level?: string }) => api<{ data: ClassListRow[] }>('/classes', { query: f }),
  detail: (id: number) => api<ClassDetail>(`/classes/${id}`),
  create: (body: unknown) => api<{ id: number }>('/classes', { body }),
  update: (id: number, body: unknown) => api<{ version: number }>(`/classes/${id}`, { method: 'PATCH', body }),
  open: (id: number, version: number) => api<{ upcomingLessons: number }>(`/classes/${id}/open`, { body: { version } }),
  close: (id: number, body: unknown) => api(`/classes/${id}/close`, { body }),
  addSchedule: (id: number, body: unknown) => api(`/classes/${id}/schedules`, { body }),
  endSchedule: (scheduleId: number, body: unknown) => api(`/schedules/${scheduleId}/end`, { body }),
  checkConflicts: (body: unknown) => api<{ conflicts: ScheduleConflict[] }>('/schedules/check-conflicts', { body }),
  enroll: (id: number, body: unknown) => api<{ enrolled: number }>(`/classes/${id}/enrollments`, { body }),
  transfer: (enrollmentId: number, body: unknown) => api(`/enrollments/${enrollmentId}/transfer`, { body }),
  endEnrollment: (enrollmentId: number, body: unknown) => api(`/enrollments/${enrollmentId}/end`, { body }),
  history: (id: number) => api<{ data: HistoryRow[] }>(`/classes/${id}/enrollment-history`),
  lessons: (id: number, from: string, to: string) => api<{ data: LessonRow[] }>(`/classes/${id}/lessons`, { query: { from, to } }),
  addLesson: (id: number, body: unknown) => api(`/classes/${id}/lessons`, { body }),
  updateLesson: (lessonId: number, body: unknown) => api(`/lessons/${lessonId}`, { method: 'PATCH', body }),
  calendar: (q: { from: string; to: string; teacherId?: number; roomId?: number; classId?: number }) =>
    api<{ data: CalendarLesson[] }>('/calendar', { query: q }),

  shifts: () => api<{ data: Shift[] }>('/shifts'),
  createShift: (body: unknown) => api('/shifts', { body }),
  updateShift: (id: number, body: unknown) => api(`/shifts/${id}`, { method: 'PATCH', body }),
  rooms: () => api<{ data: Room[] }>('/rooms'),
  createRoom: (body: unknown) => api('/rooms', { body }),
  updateRoom: (id: number, body: unknown) => api(`/rooms/${id}`, { method: 'PATCH', body }),

  teachers: (all = false) => api<{ data: TeacherRow[] }>('/teachers', { query: { all: all ? 1 : undefined } }),
  createTeacher: (body: unknown) => api<{ id: number; teacherCode: string; tempPassword: string }>('/teachers', { body }),
  updateTeacher: (id: number, body: unknown) => api(`/teachers/${id}`, { method: 'PATCH', body }),
  setTeacherActive: (id: number, active: boolean) => api(`/teachers/${id}/${active ? 'activate' : 'deactivate'}`, { body: {} }),
  resetPassword: (userId: number) => api<{ tempPassword: string }>(`/users/${userId}/reset-password`, { body: {} }),
};

export const CLASS_STATUS_LABELS: Record<ClassStatus, string> = { PLANNED: 'Chuẩn bị', OPEN: 'Đang mở', CLOSED: 'Đã đóng' };
export const CLASS_STATUS_VARIANT: Record<ClassStatus, 'default' | 'success' | 'muted'> = { PLANNED: 'default', OPEN: 'success', CLOSED: 'muted' };
export const ATTENDANCE_SESSION_LABELS: Record<string, string> = {
  NOT_STARTED: 'Chưa điểm danh',
  DRAFT: 'Đang điểm danh',
  SUBMITTED: 'Đã điểm danh',
  LOCKED: 'Đã khóa',
};
