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
  /** Màu nhận diện riêng của từng mục (ô biểu tượng + trạng thái đang chọn). */
  tone: { icon: string; active: string };
}

const tone = (icon: string, active: string) => ({ icon, active });

/** Thứ tự theo tài liệu thiết kế (mục V). Bật `ready` khi module tương ứng hoàn thành và qua kiểm thử. */
export const NAV_ITEMS: NavItem[] = [
  { to: '/tong-quan', label: 'Tổng quan', icon: LayoutDashboard, permission: 'dashboard.read', ready: false, tone: tone('bg-blue-100 text-blue-600', 'bg-blue-50 text-blue-700 ring-blue-200') },
  { to: '/hoc-sinh', label: 'Học sinh', icon: Users, permission: 'students.read', ready: true, tone: tone('bg-indigo-100 text-indigo-600', 'bg-indigo-50 text-indigo-700 ring-indigo-200') },
  { to: '/lop-hoc', label: 'Lớp học', icon: BookOpen, permission: 'classes.read', ready: true, tone: tone('bg-violet-100 text-violet-600', 'bg-violet-50 text-violet-700 ring-violet-200') },
  { to: '/ca-hoc', label: 'Ca học', icon: CalendarClock, permission: 'classes.read', ready: true, tone: tone('bg-amber-100 text-amber-600', 'bg-amber-50 text-amber-800 ring-amber-200') },
  { to: '/diem-danh', label: 'Điểm danh', icon: ClipboardCheck, permission: 'attendance.read', ready: true, tone: tone('bg-emerald-100 text-emerald-600', 'bg-emerald-50 text-emerald-700 ring-emerald-200') },
  { to: '/diem-so', label: 'Điểm số', icon: Star, permission: 'grades.read', ready: false, tone: tone('bg-pink-100 text-pink-600', 'bg-pink-50 text-pink-700 ring-pink-200') },
  { to: '/hoc-phi', label: 'Học phí', icon: Wallet, permission: 'fees.read', ready: false, tone: tone('bg-teal-100 text-teal-600', 'bg-teal-50 text-teal-700 ring-teal-200') },
  { to: '/giao-vien', label: 'Giáo viên', icon: UserSquare2, permission: 'teachers.write', ready: true, tone: tone('bg-orange-100 text-orange-600', 'bg-orange-50 text-orange-700 ring-orange-200') },
  { to: '/bao-cao', label: 'Báo cáo', icon: BarChart3, permission: 'reports.read', ready: false, tone: tone('bg-cyan-100 text-cyan-600', 'bg-cyan-50 text-cyan-700 ring-cyan-200') },
  { to: '/cai-dat', label: 'Cài đặt', icon: Settings, permission: 'settings.manage', ready: false, tone: tone('bg-slate-200 text-slate-600', 'bg-slate-100 text-slate-800 ring-slate-300') },
];

export const APP_ICON = GraduationCap;
