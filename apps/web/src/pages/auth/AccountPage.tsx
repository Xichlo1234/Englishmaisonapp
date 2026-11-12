import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Camera, Check, Loader2, Pencil, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { errorMessage, PageHeader } from '@/components/common/page';
import { UserAvatar } from '@/components/common/user-avatar';
import { compressImage } from '@/lib/image';
import { ME_KEY, useAuth } from '@/hooks/use-auth';
import { api } from '@/lib/api';

function AvatarEditor({ name, fileId }: { name: string; fileId: number | null }) {
  const input = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('files', await compressImage(file, 800), 'avatar.jpg');
      return api<{ fileId: number }>('/me/avatar', { form });
    },
    onSuccess: () => (qc.invalidateQueries({ queryKey: ME_KEY }), toast.success('Đã cập nhật ảnh đại diện')),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="flex flex-col items-center gap-3 sm:flex-row sm:gap-5">
      <UserAvatar name={name} fileId={fileId} className="size-32 text-4xl shadow-md" />
      <div className="flex flex-col items-center gap-1.5 sm:items-start">
        <input
          ref={input}
          type="file"
          accept="image/*"
          hidden
          aria-label="Chọn ảnh đại diện"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload.mutate(f);
            e.target.value = '';
          }}
        />
        <Button variant="outline" disabled={upload.isPending} onClick={() => input.current?.click()}>
          {upload.isPending ? <Loader2 className="animate-spin" /> : <Camera />} {fileId ? 'Đổi ảnh đại diện' : 'Tải ảnh đại diện'}
        </Button>
        <p className="text-xs text-muted-foreground">Ảnh JPG/PNG, tự thu nhỏ trước khi tải lên.</p>
      </div>
    </div>
  );
}

function NameEditor({ name }: { name: string }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: () => api('/me', { method: 'PATCH', body: { fullName: value } }),
    onSuccess: () => (qc.invalidateQueries({ queryKey: ME_KEY }), setEditing(false), toast.success('Đã đổi tên hiển thị')),
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!editing)
    return (
      <span className="flex items-center gap-1">
        {name}
        <Button variant="ghost" size="icon" className="size-7" aria-label="Đổi tên hiển thị" onClick={() => (setValue(name), setEditing(true))}>
          <Pencil className="size-3.5" />
        </Button>
      </span>
    );
  const valid = value.trim().length >= 2;
  return (
    <form className="flex items-center gap-1" onSubmit={(e) => (e.preventDefault(), valid && save.mutate())}>
      <Input aria-label="Họ tên mới" className="h-8" value={value} autoFocus onChange={(e) => setValue(e.target.value)} />
      <Button type="submit" size="icon" className="size-8 shrink-0" disabled={!valid || save.isPending} aria-label="Lưu tên">
        {save.isPending ? <Loader2 className="animate-spin" /> : <Check />}
      </Button>
      <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0" aria-label="Hủy" onClick={() => setEditing(false)}>
        <X />
      </Button>
    </form>
  );
}
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
          <CardContent className="flex flex-col gap-5">
            {user && <AvatarEditor name={user.fullName} fileId={user.avatarFileId} />}
            <dl className="grid grid-cols-[110px_1fr] gap-y-2 text-sm">
              <dt className="text-muted-foreground">Họ tên</dt>
              <dd>{user && <NameEditor name={user.fullName} />}</dd>
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
