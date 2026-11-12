import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/common/form-field';
import { errorMessage } from '@/components/common/page';
import { useAuth } from '@/hooks/use-auth';
import { APP_ICON } from '@/layouts/nav';

const schema = z.object({
  identifier: z.string().trim().min(3, 'Nhập số điện thoại hoặc email'),
  password: z.string().min(1, 'Nhập mật khẩu'),
});
type FormValues = z.infer<typeof schema>;

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { identifier: '', password: '' } });
  const next = new URLSearchParams(location.search).get('next') || '/';

  if (user) return <Navigate to={user.mustChangePassword ? '/doi-mat-khau' : next} replace />;

  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      const me = await login(v.identifier, v.password);
      navigate(me.mustChangePassword ? '/doi-mat-khau' : next, { replace: true });
    } catch (e) {
      setError(errorMessage(e));
    }
  });

  const Icon = APP_ICON;
  return (
    <div className="relative min-h-screen bg-[#f6eee2]">
      <div aria-hidden className="login-hero absolute inset-x-0 top-0 h-[40vh] min-h-60 lg:inset-0 lg:h-auto">
        <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-b from-transparent to-[#f6eee2] lg:hidden" />
      </div>
      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col items-center px-4 pb-10 pt-[max(13rem,32vh)] lg:items-start lg:justify-center lg:px-16 lg:py-10">
        <div className="mb-6 hidden max-w-md lg:block">
          <div className="flex items-center gap-3 text-[#183d46]">
            <span className="grid size-11 place-items-center rounded-xl bg-primary text-white shadow-[0_4px_0_#0f514d]">
              <Icon className="size-6" />
            </span>
            <span className="text-lg font-semibold">Quản lý lớp học tiếng Anh</span>
          </div>
          <p className="mt-6 text-3xl font-bold leading-tight text-[#183d46]">Điểm danh, chấm điểm, học phí — tất cả ở một nơi.</p>
          <p className="mt-2 text-[#647976]">Dữ liệu đồng bộ giữa máy tính và điện thoại.</p>
        </div>
        <Card className="relative w-full max-w-sm rounded-2xl border-[#e4e8de] bg-[#fffefa] shadow-[0_18px_40px_-12px_rgb(38_95_80/0.25)]">
          <CardHeader className="items-center text-center">
            <span className="mb-2 grid size-11 place-items-center rounded-xl bg-primary text-white lg:hidden">
              <Icon className="size-6" />
            </span>
            <CardTitle className="text-lg">Đăng nhập</CardTitle>
            <CardDescription>Hệ thống quản lý lớp học tiếng Anh</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
              {error && <Alert variant="destructive">{error}</Alert>}
              <FormField label="Số điện thoại hoặc email" htmlFor="identifier" error={form.formState.errors.identifier?.message}>
                <Input id="identifier" autoComplete="username" autoFocus {...form.register('identifier')} />
              </FormField>
              <FormField label="Mật khẩu" htmlFor="password" error={form.formState.errors.password?.message}>
                <div className="relative">
                  <Input id="password" type={show ? 'text' : 'password'} autoComplete="current-password" className="pr-10" {...form.register('password')} />
                  <button
                    type="button"
                    onClick={() => setShow((s) => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                    aria-label={show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                  >
                    {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </FormField>
              <Button type="submit" size="lg" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting && <Loader2 className="animate-spin" />} Đăng nhập
              </Button>
              <p className="text-center text-xs text-muted-foreground">Quên mật khẩu? Liên hệ quản trị viên để được cấp lại.</p>
            </form>
          </CardContent>
        </Card>
        <p className="mt-6 max-w-sm text-center text-sm text-[#647976] lg:hidden">Điểm danh, chấm điểm, học phí — tất cả ở một nơi.</p>
      </div>
    </div>
  );
}
