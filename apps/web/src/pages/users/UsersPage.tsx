import { useState } from 'react';
import { Link } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { KeyRound, Loader2, LockOpen, LogOut, MoreHorizontal, Plus, Search, Shield, UserCheck, UserX } from 'lucide-react';
import { toast } from 'sonner';
import { normalizePhone, normalizeSearch, ROLE_CODES, ROLE_NAMES, type RoleCode } from '@ecm/shared';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FormField } from '@/components/common/form-field';
import { EmptyBlock, ErrorBlock, errorMessage, LoadingBlock, PageHeader } from '@/components/common/page';
import { useAuth } from '@/hooks/use-auth';
import { formatDateTimeVN } from '@/lib/format';
import { usersApi, type UserRow } from '@/services/users';
import { CredentialDialog } from '../teachers/TeachersPage';

type Credential = { name: string; login: string; password: string };
const MANAGED_BY_OWNER: RoleCode[] = ['TEACHER', 'GUARDIAN', 'STUDENT'];

function StatusBadge({ u }: { u: UserRow }) {
  if (u.status !== 'ACTIVE') return <Badge variant="muted">Đã khóa</Badge>;
  if (u.lockedUntil) return <Badge variant="warning">Tạm khóa (sai mật khẩu)</Badge>;
  if (u.mustChangePassword) return <Badge variant="outline">Chưa đổi mật khẩu tạm</Badge>;
  return <Badge variant="success">Hoạt động</Badge>;
}

export function UsersPage() {
  const { user: me } = useAuth();
  const [filters, setFilters] = useState({ role: '', status: '', q: '' });
  const [creating, setCreating] = useState(false);
  const [credential, setCredential] = useState<Credential | null>(null);
  const qc = useQueryClient();
  const isAdmin = me?.role === 'ADMIN';

  const users = useQuery({
    queryKey: ['users', filters.role, filters.status],
    queryFn: () => usersApi.list({ role: filters.role || undefined, status: filters.status || undefined }).then((r) => r.data),
    placeholderData: keepPreviousData,
  });
  const done = (msg: string) => () => (qc.invalidateQueries({ queryKey: ['users'] }), toast.success(msg));
  const onError = (e: unknown) => toast.error(errorMessage(e));

  const update = useMutation({
    mutationFn: (p: { u: UserRow; body: Parameters<typeof usersApi.update>[1]; msg: string }) => usersApi.update(p.u.id, p.body).then(() => p.msg),
    onSuccess: (msg) => (qc.invalidateQueries({ queryKey: ['users'] }), toast.success(msg)),
    onError,
  });
  const unlock = useMutation({ mutationFn: (u: UserRow) => usersApi.unlock(u.id), onSuccess: done('Đã mở khóa đăng nhập'), onError });
  const revoke = useMutation({ mutationFn: (u: UserRow) => usersApi.revokeSessions(u.id), onSuccess: done('Đã đăng xuất khỏi mọi thiết bị'), onError });
  const reset = useMutation({
    mutationFn: (u: UserRow) => usersApi.resetPassword(u.id).then((r) => ({ u, ...r })),
    onSuccess: ({ u, tempPassword }) => (qc.invalidateQueries({ queryKey: ['users'] }), setCredential({ name: u.fullName, login: u.email ?? u.phone ?? '', password: tempPassword })),
    onError,
  });

  const canManage = (u: UserRow) => u.id !== me?.id && (isAdmin || MANAGED_BY_OWNER.includes(u.role));
  const needle = normalizeSearch(filters.q);
  const rows = (users.data ?? []).filter((u) => !needle || normalizeSearch(`${u.fullName} ${u.email ?? ''} ${u.phone ?? ''}`).includes(needle));

  return (
    <div>
      <PageHeader
        title="Quản lý tài khoản"
        description="Khóa/mở tài khoản, cấp lại mật khẩu, đăng xuất khỏi mọi thiết bị. Mọi thao tác đều được ghi nhật ký."
        actions={
          isAdmin && (
            <Button onClick={() => setCreating(true)}>
              <Plus /> Thêm quản trị / chủ lớp
            </Button>
          )
        }
      />
      <div className="mb-3 flex flex-wrap gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Tìm tên, email, số điện thoại"
            aria-label="Tìm tài khoản"
            value={filters.q}
            onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
          />
        </div>
        <NativeSelect className="w-44" aria-label="Lọc vai trò" value={filters.role} onChange={(e) => setFilters((f) => ({ ...f, role: e.target.value }))}>
          <option value="">Mọi vai trò</option>
          {ROLE_CODES.map((r) => (
            <option key={r} value={r}>
              {ROLE_NAMES[r]}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect className="w-48" aria-label="Lọc trạng thái" value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
          <option value="">Mọi trạng thái</option>
          <option value="ACTIVE">Hoạt động</option>
          <option value="LOCKED">Tạm khóa (sai mật khẩu)</option>
          <option value="DISABLED">Đã khóa</option>
        </NativeSelect>
      </div>

      {users.isLoading ? (
        <LoadingBlock />
      ) : users.isError ? (
        <ErrorBlock error={users.error} onRetry={() => users.refetch()} />
      ) : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Họ tên</TableHead>
                <TableHead>Đăng nhập bằng</TableHead>
                <TableHead>Vai trò</TableHead>
                <TableHead>Đăng nhập gần nhất</TableHead>
                <TableHead>Trạng thái</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <div className="font-medium">
                      {u.fullName}
                      {u.id === me?.id && <span className="ml-1 text-xs text-muted-foreground">(bạn)</span>}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {u.phone && <div>{u.phone}</div>}
                    {u.email && <div className="text-muted-foreground">{u.email}</div>}
                  </TableCell>
                  <TableCell>{ROLE_NAMES[u.role]}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{u.lastLoginAt ? formatDateTimeVN(u.lastLoginAt) : 'Chưa đăng nhập'}</TableCell>
                  <TableCell>
                    <StatusBadge u={u} />
                  </TableCell>
                  <TableCell>
                    {canManage(u) && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label={`Thao tác với ${u.fullName}`}>
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {u.lockedUntil && (
                            <DropdownMenuItem onSelect={() => unlock.mutate(u)}>
                              <LockOpen /> Mở khóa đăng nhập
                            </DropdownMenuItem>
                          )}
                          {u.status === 'ACTIVE' && u.role !== 'ADMIN' && (
                            <DropdownMenuItem
                              onSelect={() =>
                                window.confirm(`Cấp mật khẩu tạm mới cho ${u.fullName}? Mọi phiên đăng nhập hiện tại sẽ bị đăng xuất.`) && reset.mutate(u)
                              }
                            >
                              <KeyRound /> Cấp lại mật khẩu
                            </DropdownMenuItem>
                          )}
                          {u.status === 'ACTIVE' && (
                            <DropdownMenuItem onSelect={() => window.confirm(`Đăng xuất ${u.fullName} khỏi mọi thiết bị?`) && revoke.mutate(u)}>
                              <LogOut /> Đăng xuất mọi thiết bị
                            </DropdownMenuItem>
                          )}
                          {isAdmin && (u.role === 'ADMIN' || u.role === 'OWNER') && (
                            <DropdownMenuItem
                              onSelect={() => {
                                const to = u.role === 'ADMIN' ? 'OWNER' : 'ADMIN';
                                if (window.confirm(`Đổi vai trò của ${u.fullName} thành ${ROLE_NAMES[to]}? Người này sẽ phải đăng nhập lại.`))
                                  update.mutate({ u, body: { role: to }, msg: `Đã đổi thành ${ROLE_NAMES[to]}` });
                              }}
                            >
                              <Shield /> Đổi thành {ROLE_NAMES[u.role === 'ADMIN' ? 'OWNER' : 'ADMIN']}
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          {u.role === 'TEACHER' ? (
                            <DropdownMenuItem asChild>
                              <Link to="/giao-vien">
                                <UserX /> Khóa/mở ở trang Giáo viên
                              </Link>
                            </DropdownMenuItem>
                          ) : u.status === 'ACTIVE' ? (
                            <DropdownMenuItem
                              className="text-destructive"
                              onSelect={() => {
                                const reason = window.prompt(`Khóa tài khoản ${u.fullName}. Lý do:`);
                                if (reason !== null) update.mutate({ u, body: { status: 'DISABLED', reason: reason || undefined }, msg: 'Đã khóa tài khoản' });
                              }}
                            >
                              <UserX /> Khóa tài khoản
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem onSelect={() => update.mutate({ u, body: { status: 'ACTIVE' }, msg: 'Đã mở tài khoản' })}>
                              <UserCheck /> Mở tài khoản
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!rows.length && <EmptyBlock title="Không có tài khoản phù hợp" description="Thử bỏ bớt bộ lọc." />}
        </Card>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        Tài khoản giáo viên tạo ở trang Giáo viên; tài khoản phụ huynh cấp ở trang hồ sơ học sinh (mục Phụ huynh).
      </p>

      <StaffSheet open={creating} onClose={() => setCreating(false)} onCreated={(c) => (qc.invalidateQueries({ queryKey: ['users'] }), setCredential(c))} />
      <CredentialDialog credential={credential} onClose={() => setCredential(null)} />
    </div>
  );
}

const staffSchema = z
  .object({
    fullName: z.string().trim().min(2, 'Nhập họ tên'),
    email: z.string().trim(),
    phone: z.string().trim(),
    role: z.enum(['ADMIN', 'OWNER']),
  })
  .superRefine((v, ctx) => {
    if (v.phone && !normalizePhone(v.phone)) ctx.addIssue({ code: 'custom', path: ['phone'], message: 'Số điện thoại không hợp lệ' });
    if (v.email && !z.email().safeParse(v.email).success) ctx.addIssue({ code: 'custom', path: ['email'], message: 'Email không hợp lệ' });
    if (!v.phone && !v.email) ctx.addIssue({ code: 'custom', path: ['email'], message: 'Cần email hoặc số điện thoại để đăng nhập' });
  });
type StaffValues = z.infer<typeof staffSchema>;

function StaffSheet({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (c: Credential) => void }) {
  const form = useForm<StaffValues>({ resolver: zodResolver(staffSchema), defaultValues: { fullName: '', email: '', phone: '', role: 'OWNER' } });
  const [error, setError] = useState<string | null>(null);
  const e = form.formState.errors;
  const close = () => (form.reset(), setError(null), onClose());
  const save = useMutation({
    mutationFn: (v: StaffValues) =>
      usersApi.createStaff({ fullName: v.fullName, email: v.email || null, phone: v.phone || null, role: v.role }).then((r) => ({ v, ...r })),
    onSuccess: ({ v, tempPassword }) => {
      onCreated({ name: v.fullName, login: v.email || normalizePhone(v.phone) || '', password: tempPassword });
      close();
    },
    onError: (err) => setError(errorMessage(err)),
  });
  return (
    <Sheet open={open} onOpenChange={(o) => !o && close()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Thêm quản trị viên / chủ lớp</SheetTitle>
        </SheetHeader>
        <form className="flex flex-1 flex-col gap-4" noValidate onSubmit={form.handleSubmit((v) => (setError(null), save.mutate(v)))}>
          {error && <Alert variant="destructive">{error}</Alert>}
          <FormField label="Vai trò" htmlFor="s-role" required hint="Chủ lớp: xem toàn bộ, duyệt hoàn tiền; không quản lý tài khoản quản trị.">
            <NativeSelect id="s-role" {...form.register('role')}>
              <option value="OWNER">{ROLE_NAMES.OWNER}</option>
              <option value="ADMIN">{ROLE_NAMES.ADMIN}</option>
            </NativeSelect>
          </FormField>
          <FormField label="Họ và tên" htmlFor="s-name" required error={e.fullName?.message}>
            <Input id="s-name" {...form.register('fullName')} />
          </FormField>
          <FormField label="Email" htmlFor="s-email" error={e.email?.message} hint="Dùng để đăng nhập">
            <Input id="s-email" type="email" {...form.register('email')} />
          </FormField>
          <FormField label="Số điện thoại" htmlFor="s-phone" error={e.phone?.message} hint="Dùng để đăng nhập">
            <Input id="s-phone" inputMode="tel" {...form.register('phone')} />
          </FormField>
          <p className="text-xs text-muted-foreground">Hệ thống tạo mật khẩu tạm; người dùng phải đổi ở lần đăng nhập đầu.</p>
          <SheetFooter>
            <Button type="button" variant="outline" onClick={close}>
              Hủy
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2 className="animate-spin" />} Tạo tài khoản
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
