import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/common/page';
import { useAuth } from '@/hooks/use-auth';
import { ChangePasswordForm } from './ChangePasswordForm';

export function AccountPage() {
  const { user } = useAuth();
  return (
    <div className="max-w-3xl">
      <PageHeader title="Tài khoản" />
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Thông tin</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[110px_1fr] gap-y-2 text-sm">
              <dt className="text-muted-foreground">Họ tên</dt>
              <dd>{user?.fullName}</dd>
              <dt className="text-muted-foreground">Vai trò</dt>
              <dd>{user?.roleName}</dd>
              <dt className="text-muted-foreground">Email</dt>
              <dd>{user?.email ?? '—'}</dd>
              <dt className="text-muted-foreground">Điện thoại</dt>
              <dd>{user?.phone ?? '—'}</dd>
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Đổi mật khẩu</CardTitle>
          </CardHeader>
          <CardContent>
            <ChangePasswordForm />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
