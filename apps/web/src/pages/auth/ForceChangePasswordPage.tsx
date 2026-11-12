import { Navigate, useNavigate } from 'react-router';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';
import { ChangePasswordForm } from './ChangePasswordForm';

export function ForceChangePasswordPage() {
  const { user, refetchMe, logout } = useAuth();
  const navigate = useNavigate();
  if (!user) return <Navigate to="/dang-nhap" replace />;
  if (!user.mustChangePassword) return <Navigate to="/" replace />;
  return (
    <div className="grid min-h-screen place-items-center bg-muted px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Đổi mật khẩu lần đầu</CardTitle>
          <CardDescription>Xin chào {user.fullName}. Vì lý do bảo mật, vui lòng đặt mật khẩu mới trước khi sử dụng.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ChangePasswordForm
            onDone={async () => {
              await refetchMe();
              navigate('/', { replace: true });
            }}
          />
          <Button variant="ghost" onClick={() => logout().then(() => navigate('/dang-nhap'))}>
            Đăng xuất
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
