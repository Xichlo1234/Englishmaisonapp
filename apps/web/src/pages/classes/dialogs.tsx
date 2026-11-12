import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';
import { addDays, formatDateVN, vnDate, WEEKDAY_LABELS } from '@ecm/shared';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { DateInput } from '@/components/ui/date-input';
import { NativeSelect } from '@/components/ui/native-select';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { FormField } from '@/components/common/form-field';
import { errorMessage } from '@/components/common/page';
import { useAuth } from '@/hooks/use-auth';
import { useDebounced } from '@/hooks/use-debounce';
import { ApiError } from '@/lib/api';
import { classesApi, classKeys } from '@/services/classes';
import { studentKeys, studentsApi } from '@/services/students';

/** Hộp thoại xác nhận có ngày + lý do (đóng lớp, kết thúc ghi danh, kết thúc lịch, hủy buổi). */
export function DateReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  dateLabel,
  defaultDate = vnDate(),
  reasonRequired = true,
  confirmLabel,
  destructive,
  extra,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  dateLabel?: string;
  defaultDate?: string;
  reasonRequired?: boolean;
  confirmLabel: string;
  destructive?: boolean;
  extra?: React.ReactNode;
  onSubmit: (v: { date: string; reason: string }) => Promise<unknown>;
}) {
  const [date, setDate] = useState(defaultDate);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const close = (o: boolean) => {
    if (!o) {
      setReason('');
      setError(null);
      setDate(defaultDate);
    }
    onOpenChange(o);
  };
  const invalid = (reasonRequired && reason.trim().length < 3) || (!!dateLabel && !date);
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {error && <Alert variant="destructive">{error}</Alert>}
        {dateLabel && (
          <FormField label={dateLabel} htmlFor="drd-date" required>
            <DateInput id="drd-date" value={date} onChange={setDate} />
          </FormField>
        )}
        <FormField label="Lý do" htmlFor="drd-reason" required={reasonRequired}>
          <Textarea id="drd-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </FormField>
        {extra}
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>
            Hủy
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            disabled={invalid || pending}
            onClick={async () => {
              setPending(true);
              setError(null);
              try {
                await onSubmit({ date, reason: reason.trim() });
                close(false);
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setPending(false);
              }
            }}
          >
            {pending && <Loader2 className="animate-spin" />} {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Xếp học sinh vào lớp: tìm và chọn nhiều học sinh đang học. */
export function EnrollStudentsSheet({
  classId,
  classStartDate,
  remaining,
  open,
  onOpenChange,
}: {
  classId: number;
  classStartDate: string;
  remaining: number;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 300);
  const [selected, setSelected] = useState<Map<number, string>>(new Map());
  const [startDate, setStartDate] = useState(vnDate() > classStartDate ? vnDate() : classStartDate);
  const [override, setOverride] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [capacityHit, setCapacityHit] = useState(false);
  const list = useQuery({
    queryKey: ['students', 'picker', dq],
    queryFn: () => studentsApi.list({ q: dq || undefined, status: 'ACTIVE', pageSize: 30, sort: 'name' }),
    enabled: open,
  });
  const mut = useMutation({
    mutationFn: () =>
      classesApi.enroll(classId, {
        studentIds: [...selected.keys()],
        startDate,
        ...(override.trim() ? { overrideCapacityReason: override.trim() } : {}),
      }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: classKeys.all });
      qc.invalidateQueries({ queryKey: studentKeys.all });
      toast.success(`Đã xếp ${r.enrolled} học sinh vào lớp`);
      setSelected(new Map());
      setOverride('');
      setCapacityHit(false);
      onOpenChange(false);
    },
    onError: (e) => {
      setError(errorMessage(e));
      if (e instanceof ApiError && e.code === 'CLASS_FULL') setCapacityHit(true);
    },
  });
  const toggle = (id: number, name: string) =>
    setSelected((m) => {
      const n = new Map(m);
      if (n.has(id)) n.delete(id);
      else n.set(id, name);
      return n;
    });

  return (
    <Sheet open={open} onOpenChange={(o) => (setError(null), onOpenChange(o))}>
      <SheetContent className="max-w-lg">
        <SheetHeader>
          <SheetTitle>Thêm học sinh vào lớp</SheetTitle>
          <SheetDescription>Còn {Math.max(0, remaining)} chỗ trống. Chỉ hiển thị học sinh đang học.</SheetDescription>
        </SheetHeader>
        {error && <Alert variant="destructive">{error}</Alert>}
        <FormField label="Ngày vào lớp" htmlFor="enroll-date" required>
          <DateInput id="enroll-date" min={classStartDate} value={startDate} onChange={setStartDate} />
        </FormField>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm học sinh…" className="pl-8" aria-label="Tìm học sinh" />
        </div>
        <ul className="flex max-h-80 flex-col divide-y overflow-y-auto rounded-md border">
          {list.isLoading && <li className="p-3 text-sm text-muted-foreground">Đang tải…</li>}
          {list.data?.data.map((s) => {
            const inThis = s.currentClasses.some((c) => c.id === classId);
            return (
              <li key={s.id}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted/60">
                  <Checkbox checked={selected.has(s.id)} disabled={inThis} onCheckedChange={() => toggle(s.id, s.fullName)} />
                  <span className="flex-1">
                    <span className="font-medium">{s.fullName}</span>
                    <span className="ml-2 font-mono text-xs text-muted-foreground">{s.studentCode}</span>
                    <span className="block text-xs text-muted-foreground">
                      {s.englishLevel ?? '—'} · {s.currentClasses.length ? s.currentClasses.map((c) => c.code).join(', ') : 'Chưa xếp lớp'}
                    </span>
                  </span>
                  {inThis && <Badge variant="muted">Đã trong lớp</Badge>}
                </label>
              </li>
            );
          })}
          {list.data && !list.data.data.length && <li className="p-3 text-sm text-muted-foreground">Không tìm thấy học sinh</li>}
        </ul>
        {capacityHit && user?.role === 'ADMIN' && (
          <FormField label="Lý do vượt sĩ số (chỉ quản trị viên)" htmlFor="override">
            <Input id="override" value={override} onChange={(e) => setOverride(e.target.value)} />
          </FormField>
        )}
        <SheetFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Hủy
          </Button>
          <Button disabled={!selected.size || !startDate || mut.isPending} onClick={() => (setError(null), mut.mutate())}>
            {mut.isPending && <Loader2 className="animate-spin" />} Xếp {selected.size || ''} học sinh
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/** Chuyển lớp / chuyển ca cho một ghi danh đang hoạt động. */
export function TransferSheet({
  enrollment,
  onOpenChange,
}: {
  enrollment: { id: number; studentName: string; classId: number; classCode: string; startDate: string } | null;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [toClassId, setToClassId] = useState('');
  const [date, setDate] = useState(vnDate());
  const [reason, setReason] = useState('');
  const [override, setOverride] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [capacityHit, setCapacityHit] = useState(false);
  const classes = useQuery({
    queryKey: classKeys.list({ for: 'transfer' }),
    queryFn: () => classesApi.list({}).then((r) => r.data),
    enabled: !!enrollment,
  });
  const targets = (classes.data ?? []).filter((c) => c.id !== enrollment?.classId);
  const target = targets.find((c) => String(c.id) === toClassId);
  const mut = useMutation({
    mutationFn: () =>
      classesApi.transfer(enrollment!.id, {
        toClassId: Number(toClassId),
        effectiveDate: date,
        reason: reason.trim(),
        ...(override.trim() ? { overrideCapacityReason: override.trim() } : {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: classKeys.all });
      qc.invalidateQueries({ queryKey: studentKeys.all });
      toast.success('Đã chuyển lớp');
      close(false);
    },
    onError: (e) => {
      setError(errorMessage(e));
      if (e instanceof ApiError && e.code === 'CLASS_FULL') setCapacityHit(true);
    },
  });
  function close(o: boolean) {
    if (!o) {
      setToClassId('');
      setReason('');
      setOverride('');
      setError(null);
      setCapacityHit(false);
      setDate(vnDate());
    }
    onOpenChange(o);
  }
  return (
    <Sheet open={!!enrollment} onOpenChange={close}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Chuyển lớp / chuyển ca</SheetTitle>
          <SheetDescription>
            {enrollment?.studentName} đang học lớp <b>{enrollment?.classCode}</b> từ {formatDateVN(enrollment?.startDate)}. Điểm danh và điểm ở lớp cũ được giữ nguyên.
          </SheetDescription>
        </SheetHeader>
        {error && <Alert variant="destructive">{error}</Alert>}
        <FormField label="Lớp mới" htmlFor="tr-class" required>
          <NativeSelect id="tr-class" value={toClassId} onChange={(e) => setToClassId(e.target.value)}>
            <option value="">— Chọn lớp —</option>
            {targets.map((c) => (
              <option key={c.id} value={c.id} disabled={c.activeStudents >= c.maxStudents && user?.role !== 'ADMIN'}>
                {c.classCode} – {c.name} ({c.activeStudents}/{c.maxStudents}){c.englishLevel ? ` · ${c.englishLevel}` : ''}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        {target && (
          <div className="rounded-md bg-muted p-3 text-sm">
            <div>Giáo viên: {target.mainTeacherName ?? '—'}</div>
            <div>
              Lịch:{' '}
              {target.schedules.length ? target.schedules.map((s) => `${WEEKDAY_LABELS[s.weekday]} ${s.startTime}–${s.endTime}`).join(', ') : 'Chưa có lịch'}
            </div>
          </div>
        )}
        <FormField label="Học lớp mới từ ngày" htmlFor="tr-date" required hint={date ? `Lớp cũ kết thúc ngày ${formatDateVN(addDays(date, -1))}` : undefined}>
          <DateInput id="tr-date" value={date} onChange={setDate} />
        </FormField>
        <FormField label="Lý do" htmlFor="tr-reason" required>
          <Textarea id="tr-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="VD: Đổi sang ca tối cho phù hợp lịch học ở trường" />
        </FormField>
        {capacityHit && user?.role === 'ADMIN' && (
          <FormField label="Lý do vượt sĩ số (chỉ quản trị viên)" htmlFor="tr-override">
            <Input id="tr-override" value={override} onChange={(e) => setOverride(e.target.value)} />
          </FormField>
        )}
        <SheetFooter>
          <Button variant="outline" onClick={() => close(false)}>
            Hủy
          </Button>
          <Button disabled={!toClassId || !date || reason.trim().length < 3 || mut.isPending} onClick={() => (setError(null), mut.mutate())}>
            {mut.isPending && <Loader2 className="animate-spin" />} Xác nhận chuyển
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
