import { VN_TZ_OFFSET_MINUTES } from './constants';

const pad = (n: number) => String(n).padStart(2, '0');

/** Ngày nghiệp vụ (YYYY-MM-DD) theo giờ Việt Nam tại thời điểm `at`. */
export function vnDate(at: Date = new Date()): string {
  const shifted = new Date(at.getTime() + VN_TZ_OFFSET_MINUTES * 60_000);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/** Giờ hiện tại (HH:MM) theo giờ Việt Nam. */
export function vnTime(at: Date = new Date()): string {
  const shifted = new Date(at.getTime() + VN_TZ_OFFSET_MINUTES * 60_000);
  return `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
}

/** Chuyển ngày + giờ Việt Nam sang thời điểm UTC. */
export function vnToUtc(date: string, time = '00:00'): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - VN_TZ_OFFSET_MINUTES * 60_000);
}

/** Thứ trong tuần theo quy ước hệ thống: 1 = Thứ 2 … 7 = Chủ nhật. */
export function isoWeekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = CN
  return js === 0 ? 7 : js;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export const WEEKDAY_LABELS: Record<number, string> = {
  1: 'Thứ 2',
  2: 'Thứ 3',
  3: 'Thứ 4',
  4: 'Thứ 5',
  5: 'Thứ 6',
  6: 'Thứ 7',
  7: 'Chủ nhật',
};

/** Hai khoảng giờ [aStart, aEnd) và [bStart, bEnd) (định dạng HH:MM) có giao nhau không. */
export function timeRangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Hai khoảng ngày (to = null nghĩa là không giới hạn) có giao nhau không. */
export function dateRangesOverlap(
  aFrom: string,
  aTo: string | null,
  bFrom: string,
  bTo: string | null,
): boolean {
  const aEnd = aTo ?? '9999-12-31';
  const bEnd = bTo ?? '9999-12-31';
  return aFrom <= bEnd && bFrom <= aEnd;
}

/** Định dạng ngày hiển thị dd/MM/yyyy. */
export function formatDateVN(date: string | null | undefined): string {
  if (!date) return '';
  const [y, m, d] = date.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}
