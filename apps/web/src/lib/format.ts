import { formatDateVN, formatVnd, STUDENT_STATUS_LABELS, type StudentStatus } from '@ecm/shared';

export { formatDateVN, formatVnd };

export const STUDENT_STATUS_VARIANT: Record<StudentStatus, 'success' | 'warning' | 'danger' | 'muted' | 'default'> = {
  ACTIVE: 'success',
  PAUSED: 'warning',
  DROPPED: 'danger',
  GRADUATED: 'default',
  ARCHIVED: 'muted',
};
export const studentStatusLabel = (s: StudentStatus) => STUDENT_STATUS_LABELS[s];

export const GENDER_LABELS: Record<string, string> = { MALE: 'Nam', FEMALE: 'Nữ', OTHER: 'Khác' };

export function formatDateTimeVN(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ageFrom(dob: string | null | undefined): number | null {
  if (!dob) return null;
  const [y, m, d] = dob.split('-').map(Number) as [number, number, number];
  const now = new Date();
  let age = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) age--;
  return age;
}
