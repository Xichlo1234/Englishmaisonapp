import { GraduationCap } from 'lucide-react';
import accounts from '@/assets/menu/accounts.svg';
import attendance from '@/assets/menu/attendance.svg';
import classes from '@/assets/menu/classes.svg';
import dashboard from '@/assets/menu/dashboard.svg';
import fees from '@/assets/menu/fees.svg';
import grades from '@/assets/menu/grades.svg';
import reports from '@/assets/menu/reports.svg';
import schedule from '@/assets/menu/schedule.svg';
import settings from '@/assets/menu/settings.svg';
import students from '@/assets/menu/students.svg';
import teachers from '@/assets/menu/teachers.svg';
import type { PermissionCode } from '@ecm/shared';

export interface NavItem {
  to: string;
  label: string;
  /** English Maison 3D menu icon (design/english-maison-3d/icons/svg). */
  icon: string;
  permission: PermissionCode;
  /** Chỉ hiển thị module đã hoàn thiện — không có mục menu "đang phát triển". */
  ready: boolean;
}

/** Thứ tự theo tài liệu thiết kế (mục V). Bật `ready` khi module tương ứng hoàn thành và qua kiểm thử. */
export const NAV_ITEMS: NavItem[] = [
  { to: '/tong-quan', label: 'Tổng quan', icon: dashboard, permission: 'dashboard.read', ready: false },
  { to: '/hoc-sinh', label: 'Học sinh', icon: students, permission: 'students.read', ready: true },
  { to: '/lop-hoc', label: 'Lớp học', icon: classes, permission: 'classes.read', ready: true },
  { to: '/ca-hoc', label: 'Ca học', icon: schedule, permission: 'classes.read', ready: true },
  { to: '/diem-danh', label: 'Điểm danh', icon: attendance, permission: 'attendance.read', ready: true },
  { to: '/diem-so', label: 'Điểm số', icon: grades, permission: 'grades.read', ready: true },
  { to: '/hoc-phi', label: 'Học phí', icon: fees, permission: 'fees.read', ready: true },
  { to: '/giao-vien', label: 'Giáo viên', icon: teachers, permission: 'teachers.write', ready: true },
  { to: '/quan-ly-tai-khoan', label: 'Tài khoản', icon: accounts, permission: 'users.manage', ready: true },
  { to: '/bao-cao', label: 'Báo cáo', icon: reports, permission: 'reports.read', ready: false },
  { to: '/cai-dat', label: 'Cài đặt', icon: settings, permission: 'settings.manage', ready: true },
];

export const APP_ICON = GraduationCap;
