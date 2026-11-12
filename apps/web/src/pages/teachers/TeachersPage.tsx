import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { Copy, KeyRound, Loader2, MoreHorizontal, Pencil, Plus, UserCheck, UserX } from 'lucide-react';
import { toast } from 'sonner';
import { isoDate, normalizePhone } from '@ecm/shared';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { DateInput } from '@/components/ui/date-input';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FormField } from '@/components/common/form-field';
import { EmptyBlock, ErrorBlock, errorMessage, LoadingBlock, PageHeader } from '@/components/common/page';
import { useTeachers } from '@/hooks/use-catalog';
import { formatDateTimeVN } from '@/lib/format';
import { classesApi, type TeacherRow } from '@/services/classes';

const schema = z
  .object({
    fullName: z.string().trim().min(2, 'Nhập họ tên'),
    phone: z.string().trim(),
    email: z.string().trim(),
    specialty: z.string().trim().max(200),
    hiredDate: z.union([z.literal(''), isoDate]),
  })
  .superRefine((v, ctx) => {
    if (v.phone && !normalizePhone(v.phone)) ctx.addIssue({ code: 'custom', path: ['phone'], message: 'Số điện thoại không hợp lệ' });
    if (v.email && !z.email().safeParse(v.email).success) ctx.addIssue({ code: 'custom', path: ['email'], message: 'Email không hợp lệ' });
    if (!v.phone && !v.email) ctx.addIssue({ code: 'custom', path: ['phone'], message: 'Cần số điện thoại hoặc email để đăng nhập' });
  });
type Values = z.infer<typeof schema>;

export function TeachersPage() {
  const [showInactive, setShowInactive] = useState(false);
  const teachers = useTeachers(true);
  const [editing, setEditing] = useState<TeacherRow | 'new' | null>(null);
  const [credential, setCredential] = useState<{ name: string; login: string; password: string } | null>(null);
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['teachers'] });

  const toggle = useMutation({
    mutationFn: (t: TeacherRow) => classesApi.setTeacherActive(t.id, t.status !== 'ACTIVE'),
    onSuccess: () => {
      refresh();
      toast.success('Đã cập nhật');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const reset = useMutation({
    mutationFn: (t: TeacherRow) => classesApi.resetPassword(t.userId!).then((r) => ({ t, ...r })),
    onSuccess: ({ t, tempPassword }) => setCredential({ name: t.fullName, login: t.email ?? t.phone ?? '', password: tempPassword }),
    onError: (e) => toast.error(errorMessage(e)),
  });

  const rows = (teachers.data ?? []).filter((t) => showInactive || t.status === 'ACTIVE');

  return (
    <div>
      <PageHeader
        title="Giáo viên"
        description="Mỗi giáo viên có một tài khoản đăng nhập riêng"
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus /> Thêm giáo viên
          </Button>
        }
      />
      <label className="mb-3 flex items-center gap-2 text-sm">
        <Checkbox checked={showInactive} onCheckedChange={(c) => setShowInactive(c === true)} /> Hiện cả giáo viên đã ngừng làm việc
      </label>
      {teachers.isLoading ? (
        <LoadingBlock />
      ) : teachers.isError ? (
        <ErrorBlock error={teachers.error} onRetry={() => teachers.refetch()} />
      ) : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mã</TableHead>
                <TableHead>Họ tên</TableHead>
                <TableHead>Liên hệ</TableHead>
                <TableHead>Lớp phụ trách</TableHead>
                <TableHead>Buổi/tuần</TableHead>
                <TableHead>Đăng nhập gần nhất</TableHead>
                <TableHead>Trạng thái</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-mono text-xs text-muted-foreground">{t.teacherCode}</TableCell>
                  <TableCell>
                    <div className="font-medium">{t.fullName}</div>
                    {t.specialty && <div className="text-xs text-muted-foreground">{t.specialty}</div>}
                  </TableCell>
                  <TableCell className="text-sm">
                    <div>{t.phone}</div>
                    <div className="text-muted-foreground">{t.email}</div>
                  </TableCell>
                  <TableCell>{t.classCount}</TableCell>
                  <TableCell>{t.weeklySessions}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{t.lastLoginAt ? formatDateTimeVN(t.lastLoginAt) : 'Chưa đăng nhập'}</TableCell>
                  <TableCell>
                    <Badge variant={t.status === 'ACTIVE' ? 'success' : 'muted'}>{t.status === 'ACTIVE' ? 'Đang làm việc' : 'Đã ngừng'}</Badge>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label={`Thao tác với ${t.fullName}`}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setEditing(t)}>
                          <Pencil /> Sửa thông tin
                        </DropdownMenuItem>
                        {t.status === 'ACTIVE' && (
                          <DropdownMenuItem
                            onSelect={() => {
                              if (window.confirm(`Cấp mật khẩu tạm mới cho ${t.fullName}? Mọi phiên đăng nhập hiện tại sẽ bị đăng xuất.`)) reset.mutate(t);
                            }}
                          >
                            <KeyRound /> Cấp lại mật khẩu
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          onSelect={() => {
                            const msg =
                              t.status === 'ACTIVE'
                                ? `Ngừng làm việc: khóa tài khoản đăng nhập của ${t.fullName}?`
                                : `Cho ${t.fullName} làm việc trở lại và mở tài khoản?`;
                            if (window.confirm(msg)) toggle.mutate(t);
                          }}
                        >
                          {t.status === 'ACTIVE' ? (
                            <>
                              <UserX /> Ngừng làm việc
                            </>
                          ) : (
                            <>
                              <UserCheck /> Làm việc trở lại
                            </>
                          )}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!rows.length && <EmptyBlock title="Chưa có giáo viên" description="Thêm giáo viên để có thể tạo lớp và xếp lịch dạy." />}
        </Card>
      )}

      <TeacherSheet
        teacher={editing}
        onClose={() => setEditing(null)}
        onCreated={(c) => setCredential(c)}
        onSaved={refresh}
      />
      <CredentialDialog credential={credential} onClose={() => setCredential(null)} />
    </div>
  );
}

function TeacherSheet({
  teacher,
  onClose,
  onCreated,
  onSaved,
}: {
  teacher: TeacherRow | 'new' | null;
  onClose: () => void;
  onCreated: (c: { name: string; login: string; password: string }) => void;
  onSaved: () => void;
}) {
  const isNew = teacher === 'new';
  const t = teacher && teacher !== 'new' ? teacher : null;
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    values: {
      fullName: t?.fullName ?? '',
      phone: t?.phone ?? '',
      email: t?.email ?? '',
      specialty: t?.specialty ?? '',
      hiredDate: t?.hiredDate ?? '',
    },
  });
  const [error, setError] = useState<string | null>(null);
  const e = form.formState.errors;
  const save = useMutation({
    mutationFn: async (v: Values) => {
      const body = {
        fullName: v.fullName,
        phone: v.phone || null,
        email: v.email || null,
        specialty: v.specialty || null,
        hiredDate: v.hiredDate || null,
      };
      if (isNew) return classesApi.createTeacher(body).then((r) => ({ ...r, body }));
      await classesApi.updateTeacher(t!.id, body);
      return null;
    },
    onSuccess: (r) => {
      onSaved();
      if (r) onCreated({ name: r.body.fullName, login: r.body.email ?? normalizePhone(r.body.phone ?? '') ?? '', password: r.tempPassword });
      else toast.success('Đã lưu');
      onClose();
    },
    onError: (err) => setError(errorMessage(err)),
  });
  return (
    <Sheet open={!!teacher} onOpenChange={(o) => !o && (setError(null), onClose())}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{isNew ? 'Thêm giáo viên' : 'Sửa thông tin giáo viên'}</SheetTitle>
        </SheetHeader>
        <form className="flex flex-1 flex-col gap-4" noValidate onSubmit={form.handleSubmit((v) => (setError(null), save.mutate(v)))}>
          {error && <Alert variant="destructive">{error}</Alert>}
          <FormField label="Họ và tên" htmlFor="t-name" required error={e.fullName?.message}>
            <Input id="t-name" {...form.register('fullName')} />
          </FormField>
          <FormField label="Số điện thoại" htmlFor="t-phone" error={e.phone?.message} hint="Dùng để đăng nhập">
            <Input id="t-phone" inputMode="tel" {...form.register('phone')} />
          </FormField>
          <FormField label="Email" htmlFor="t-email" error={e.email?.message} hint="Dùng để đăng nhập">
            <Input id="t-email" type="email" {...form.register('email')} />
          </FormField>
          <FormField label="Chuyên môn" htmlFor="t-spec">
            <Input id="t-spec" placeholder="VD: IELTS, Starters–Flyers" {...form.register('specialty')} />
          </FormField>
          <FormField label="Ngày bắt đầu làm việc" htmlFor="t-hired">
            <Controller
              control={form.control}
              name="hiredDate"
              render={({ field }) => <DateInput id="t-hired" value={field.value} onChange={field.onChange} onBlur={field.onBlur} />}
            />
          </FormField>
          {isNew && <p className="text-xs text-muted-foreground">Sau khi lưu, hệ thống tạo tài khoản với mật khẩu tạm (giáo viên phải đổi ở lần đăng nhập đầu).</p>}
          <SheetFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Hủy
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2 className="animate-spin" />} Lưu
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

/** Hiển thị mật khẩu tạm MỘT lần — không lưu ở đâu khác. */
export function CredentialDialog({ credential, onClose }: { credential: { name: string; login: string; password: string } | null; onClose: () => void }) {
  return (
    <Dialog open={!!credential} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Thông tin đăng nhập</DialogTitle>
          <DialogDescription>Mật khẩu tạm chỉ hiển thị một lần. Hãy gửi cho {credential?.name} qua kênh riêng.</DialogDescription>
        </DialogHeader>
        <div className="rounded-lg border bg-muted p-4 font-mono text-sm">
          <div>Đăng nhập: {credential?.login}</div>
          <div>
            Mật khẩu tạm: <b>{credential?.password}</b>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              navigator.clipboard?.writeText(`Đăng nhập: ${credential?.login}\nMật khẩu tạm: ${credential?.password}`);
              toast.success('Đã sao chép');
            }}
          >
            <Copy /> Sao chép
          </Button>
          <Button onClick={onClose}>Đã ghi lại</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
