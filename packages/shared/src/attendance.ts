import type { AttendanceStatus } from './constants';

export interface AttendanceStats {
  /** Số buổi đã điểm danh cho học sinh. */
  total: number;
  present: number;
  late: number;
  excused: number;
  unexcused: number;
  absent: number;
  /** (Có mặt + Đi muộn) / Tổng × 100, làm tròn 1 chữ số; null nếu chưa có buổi. */
  rate: number | null;
}

export function computeAttendanceStats(statuses: AttendanceStatus[]): AttendanceStats {
  const s: AttendanceStats = { total: 0, present: 0, late: 0, excused: 0, unexcused: 0, absent: 0, rate: null };
  for (const st of statuses) {
    s.total++;
    if (st === 'PRESENT') s.present++;
    else if (st === 'LATE') s.late++;
    else if (st === 'EXCUSED') s.excused++;
    else if (st === 'UNEXCUSED') s.unexcused++;
  }
  s.absent = s.excused + s.unexcused;
  s.rate = s.total === 0 ? null : Math.round(((s.present + s.late) / s.total) * 1000) / 10;
  return s;
}
