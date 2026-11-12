import {
  BookOpen,
  CalendarClock,
  ClipboardCheck,
  GraduationCap,
  LayoutDashboard,
  Settings,
  Star,
  UserSquare2,
  Users,
  Wallet,
  BarChart3,
  type LucideIcon,
} from 'lucide-react';
import type { PermissionCode } from '@ecm/shared';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  permission: PermissionCode;
  /** Chỉ hiển thị module đã hoàn thiện — không có mục menu "đang phát triển". */
  ready: boolean;
}

/** Thứ tự theo tài liệu thiết kế (mục V). Bật `ready` khi module tương ứng hoàn thành và qua kiểm thử. */
export const NAV_ITEMS: NavItem[] = [
  { to: '/tong-quan', label: 'Tổng quan', icon: LayoutDashboard, permission: 'dashboard.read', ready: false },
  { to: '/hoc-sinh', label: 'Học sinh', icon: Users, permission: 'students.read', ready: true },
  { to: '/lop-hoc', label: 'Lớp học', icon: BookOpen, permission: 'classes.read', ready: false },
  { to: '/ca-hoc', label: 'Ca học', icon: CalendarClock, permission: 'classes.read', ready: false },
  { to: '/diem-danh', label: 'Điểm danh', icon: ClipboardCheck, permission: 'attendance.read', ready: false },
  { to: '/diem-so', label: 'Điểm số', icon: Star, permission: 'grades.read', ready: false },
  { to: '/hoc-phi', label: 'Học phí', icon: Wallet, permission: 'fees.read', ready: false },
  { to: '/giao-vien', label: 'Giáo viên', icon: UserSquare2, permission: 'teachers.write', ready: false },
  { to: '/bao-cao', label: 'Báo cáo', icon: BarChart3, permission: 'reports.read', ready: false },
  { to: '/cai-dat', label: 'Cài đặt', icon: Settings, permission: 'settings.manage', ready: false },
];

export const APP_ICON = GraduationCap;
