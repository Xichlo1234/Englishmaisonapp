import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { passwordSchema } from '@ecm/shared';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/common/form-field';
import { errorMessage } from '@/components/common/page';
import { api } from '@/lib/api';

const schema = z
  .object({
    currentPassword: z.string().min(1, 'Nhập mật khẩu hiện tại'),
    newPassword: passwordSchema,
    confirm: z.string(),
  })
  .refine((v) => v.newPassword === v.confirm, { message: 'Mật khẩu nhập lại không khớp', path: ['confirm'] })
  .refine((v) => v.newPassword !== v.currentPassword, { message: 'Mật khẩu mới phải khác mật khẩu hiện tại', path: ['newPassword'] });
type Values = z.infer<typeof schema>;

export function ChangePasswordForm({ onDone }: { onDone?: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { currentPassword: '', newPassword: '', confirm: '' } });
  const e = form.formState.errors;

  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      await api('/me/change-password', { body: { currentPassword: v.currentPassword, newPassword: v.newPassword } });
      toast.success('Đã đổi mật khẩu. Các thiết bị khác đã được đăng xuất.');
      form.reset();
      onDone?.();
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      {error && <Alert variant="destructive">{error}</Alert>}
      <FormField label="Mật khẩu hiện tại" htmlFor="cp" error={e.currentPassword?.message}>
        <Input id="cp" type="password" autoComplete="current-password" {...form.register('currentPassword')} />
      </FormField>
      <FormField label="Mật khẩu mới" htmlFor="np" error={e.newPassword?.message} hint="Tối thiểu 8 ký tự, có cả chữ và số">
        <Input id="np" type="password" autoComplete="new-password" {...form.register('newPassword')} />
      </FormField>
      <FormField label="Nhập lại mật khẩu mới" htmlFor="cf" error={e.confirm?.message}>
        <Input id="cf" type="password" autoComplete="new-password" {...form.register('confirm')} />
      </FormField>
      <Button type="submit" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting && <Loader2 className="animate-spin" />} Đổi mật khẩu
      </Button>
    </form>
  );
}
