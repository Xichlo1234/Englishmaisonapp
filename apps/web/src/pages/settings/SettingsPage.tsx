import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/common/form-field';
import { ErrorBlock, errorMessage, LoadingBlock, PageHeader } from '@/components/common/page';
import { usePublicSettings } from '@/hooks/use-settings';
import { api } from '@/lib/api';

const schema = z.object({
  name: z.string().trim().min(2, 'Nhập tên trung tâm').max(120),
  address: z.string().trim().max(250),
  phone: z.string().trim().max(30),
});
type Values = z.infer<typeof schema>;

export function SettingsPage() {
  const settings = usePublicSettings();
  const qc = useQueryClient();
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { name: '', address: '', phone: '' } });
  useEffect(() => {
    if (settings.data)
      form.reset({ name: settings.data.center_name ?? '', address: settings.data.center_address ?? '', phone: settings.data.center_phone ?? '' });
  }, [settings.data, form]);
  const save = useMutation({
    mutationFn: (v: Values) => api('/settings/center', { method: 'PATCH', body: { name: v.name, address: v.address || null, phone: v.phone || null } }),
    onSuccess: () => (qc.invalidateQueries({ queryKey: ['settings'] }), qc.invalidateQueries({ queryKey: ['fees', 'statement'] }), toast.success('Đã lưu thông tin trung tâm')),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const e = form.formState.errors;
  return (
    <div className="max-w-2xl">
      <PageHeader title="Cài đặt" description="Thông tin trung tâm hiển thị ở góc trái màn hình và in trên hóa đơn, phiếu thu." />
      {settings.isLoading ? (
        <LoadingBlock />
      ) : settings.isError ? (
        <ErrorBlock error={settings.error} onRetry={() => settings.refetch()} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Thông tin trung tâm</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="flex flex-col gap-4" noValidate onSubmit={form.handleSubmit((v) => save.mutate(v))}>
              <FormField label="Tên trung tâm" htmlFor="c-name" required error={e.name?.message}>
                <Input id="c-name" {...form.register('name')} />
              </FormField>
              <FormField label="Địa chỉ" htmlFor="c-address" error={e.address?.message}>
                <Input id="c-address" {...form.register('address')} />
              </FormField>
              <FormField label="Số điện thoại liên hệ" htmlFor="c-phone" error={e.phone?.message}>
                <Input id="c-phone" inputMode="tel" {...form.register('phone')} />
              </FormField>
              <Button type="submit" className="self-start" disabled={save.isPending}>
                {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} Lưu
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
