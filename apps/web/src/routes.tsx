import type { ReactNode } from 'react';
import { createBrowserRouter, Navigate, useLocation } from 'react-router';
import type { PermissionCode } from '@ecm/shared';
import { EmptyBlock, LoadingBlock } from '@/components/common/page';
import { useAuth } from '@/hooks/use-auth';
import { AppLayout } from '@/layouts/AppLayout';
import { NAV_ITEMS } from '@/layouts/nav';
import { AccountPage } from '@/pages/auth/AccountPage';
import { ForceChangePasswordPage } from '@/pages/auth/ForceChangePasswordPage';
import { LoginPage } from '@/pages/auth/LoginPage';
import { StudentDetailPage } from '@/pages/students/StudentDetailPage';
import { StudentFormPage } from '@/pages/students/StudentFormPage';
import { StudentsListPage } from '@/pages/students/StudentsListPage';
import { ClassDetailPage } from '@/pages/classes/ClassDetailPage';
import { ClassFormPage } from '@/pages/classes/ClassFormPage';
import { ClassesListPage } from '@/pages/classes/ClassesListPage';
import { ShiftsPage } from '@/pages/shifts/ShiftsPage';
import { InvoiceStatementPage } from './pages/fees/InvoiceStatementPage';
import { SettingsPage } from './pages/settings/SettingsPage';
import { UsersPage } from './pages/users/UsersPage';
import { TeachersPage } from '@/pages/teachers/TeachersPage';
import { AttendancePage } from '@/pages/attendance/AttendancePage';
import { AttendanceSheetPage } from '@/pages/attendance/AttendanceSheetPage';
import { GradesPage } from '@/pages/grades/GradesPage';
import { AssessmentSheetPage } from '@/pages/grades/AssessmentSheetPage';
import { FeesPage } from '@/pages/fees/FeesPage';
import { InvoiceDetailPage } from '@/pages/fees/InvoiceDetailPage';
import { ReceiptPage } from '@/pages/fees/ReceiptPage';

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const location = useLocation();
  if (isLoading) return <LoadingBlock />;
  if (!user) return <Navigate to={`/dang-nhap?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (user.mustChangePassword) return <Navigate to="/doi-mat-khau" replace />;
  return <>{children}</>;
}

function RequirePermission({ perm, children }: { perm: PermissionCode; children: ReactNode }) {
  const { can } = useAuth();
  if (!can(perm)) return <EmptyBlock title="Bạn không có quyền truy cập trang này" />;
  return <>{children}</>;
}

/** Trang đầu: module đầu tiên người dùng có quyền; phụ huynh/học sinh được hướng dẫn dùng ứng dụng điện thoại. */
function HomeRedirect() {
  const { can } = useAuth();
  const first = NAV_ITEMS.find((i) => i.ready && can(i.permission));
  if (first) return <Navigate to={first.to} replace />;
  return (
    <EmptyBlock
      title="Vui lòng dùng ứng dụng điện thoại"
      description="Tài khoản phụ huynh/học sinh xem lịch học, điểm danh, kết quả học tập trên ứng dụng di động."
    />
  );
}

function NotFound() {
  return <EmptyBlock title="Không tìm thấy trang" description="Đường dẫn không tồn tại." />;
}

export const router = createBrowserRouter([
  { path: '/dang-nhap', element: <LoginPage /> },
  { path: '/doi-mat-khau', element: <ForceChangePasswordPage /> },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <HomeRedirect /> },
      { path: 'tai-khoan', element: <AccountPage /> },
      {
        path: 'hoc-sinh',
        children: [
          { index: true, element: <RequirePermission perm="students.read"><StudentsListPage /></RequirePermission> },
          { path: 'moi', element: <RequirePermission perm="students.write"><StudentFormPage /></RequirePermission> },
          { path: ':id', element: <RequirePermission perm="students.read"><StudentDetailPage /></RequirePermission> },
          { path: ':id/sua', element: <RequirePermission perm="students.write"><StudentFormPage /></RequirePermission> },
        ],
      },
      {
        path: 'lop-hoc',
        children: [
          { index: true, element: <RequirePermission perm="classes.read"><ClassesListPage /></RequirePermission> },
          { path: 'moi', element: <RequirePermission perm="classes.write"><ClassFormPage /></RequirePermission> },
          { path: ':id', element: <RequirePermission perm="classes.read"><ClassDetailPage /></RequirePermission> },
          { path: ':id/sua', element: <RequirePermission perm="classes.write"><ClassFormPage /></RequirePermission> },
        ],
      },
      { path: 'diem-danh', element: <RequirePermission perm="attendance.read"><AttendancePage /></RequirePermission> },
      { path: 'diem-danh/:lessonId', element: <RequirePermission perm="attendance.read"><AttendanceSheetPage /></RequirePermission> },
      { path: 'diem-so', element: <RequirePermission perm="grades.read"><GradesPage /></RequirePermission> },
      { path: 'diem-so/:id', element: <RequirePermission perm="grades.read"><AssessmentSheetPage /></RequirePermission> },
      { path: 'hoc-phi', element: <RequirePermission perm="fees.read"><FeesPage /></RequirePermission> },
      { path: 'hoc-phi/hoa-don/:id', element: <RequirePermission perm="fees.read"><InvoiceDetailPage /></RequirePermission> },
      { path: 'hoc-phi/hoa-don/:id/chi-tiet', element: <RequirePermission perm="fees.read"><InvoiceStatementPage /></RequirePermission> },
      { path: 'hoc-phi/phieu-thu/:id', element: <RequirePermission perm="fees.read"><ReceiptPage /></RequirePermission> },
      { path: 'ca-hoc', element: <RequirePermission perm="classes.read"><ShiftsPage /></RequirePermission> },
      { path: 'giao-vien', element: <RequirePermission perm="teachers.write"><TeachersPage /></RequirePermission> },
      { path: 'cai-dat', element: <RequirePermission perm="settings.manage"><SettingsPage /></RequirePermission> },
      { path: 'quan-ly-tai-khoan', element: <RequirePermission perm="users.manage"><UsersPage /></RequirePermission> },
      { path: '*', element: <NotFound /> },
    ],
  },
]);
