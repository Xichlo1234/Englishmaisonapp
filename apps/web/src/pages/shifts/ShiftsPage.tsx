import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Loader2, Pencil, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { addDays, formatDateVN, isoWeekday, vnDate, WEEKDAY_LABELS } from '@ecm/shared';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { TimeInput } from '@/components/ui/date-input';
import { NativeSelect } from '@/components/ui/native-select';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FormField } from '@/components/common/form-field';
import { ErrorBlock, errorMessage, LoadingBlock, PageHeader } from '@/components/common/page';
import { useAuth } from '@/hooks/use-auth';
import { useRooms, useShifts, useTeachers } from '@/hooks/use-catalog';
import { cn } from '@/lib/utils';
import { classesApi, classKeys, type CalendarLesson, type Room, type Shift } from '@/services/classes';

export function ShiftsPage() {
  const { can } = useAuth();
  return (
    <div>
      <PageHeader title="Ca học & lịch" description="Khung giờ học, phòng học và lịch tổng hợp theo ngày / tuần / tháng" />
      <Tabs defaultValue="calendar">
        <TabsList>
          <TabsTrigger value="calendar">Lịch</TabsTrigger>
          <TabsTrigger value="shifts">Ca học</TabsTrigger>
          <TabsTrigger value="rooms">Phòng học</TabsTrigger>
        </TabsList>
        <TabsContent value="calendar">
          <CalendarView />
        </TabsContent>
        <TabsContent value="shifts">
          <ShiftsPanel canEdit={can('classes.write')} />
        </TabsContent>
        <TabsContent value="rooms">
          <RoomsPanel canEdit={can('classes.write')} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ───────────── Lịch ─────────────

type View = 'day' | 'week' | 'month';

function rangeOf(view: View, anchor: string) {
  if (view === 'day') return { from: anchor, to: anchor };
  if (view === 'week') {
    const from = addDays(anchor, 1 - isoWeekday(anchor));
    return { from, to: addDays(from, 6) };
  }
  const [y, m] = anchor.split('-').map(Number) as [number, number];
  const from = `${y}-${String(m).padStart(2, '0')}-01`;
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  return { from, to: addDays(next, -1) };
}

function shiftAnchor(view: View, anchor: string, dir: 1 | -1) {
  if (view === 'day') return addDays(anchor, dir);
  if (view === 'week') return addDays(anchor, 7 * dir);
  const [y, m] = anchor.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + dir, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

function lessonTone(l: CalendarLesson) {
  if (l.status === 'CANCELLED') return 'border-slate-200 bg-slate-50 text-slate-400 line-through';
  if (l.attendanceStatus === 'SUBMITTED' || l.attendanceStatus === 'LOCKED') return 'border-green-200 bg-success-soft/60';
  if (l.lessonDate < vnDate() && l.attendanceStatus !== 'SUBMITTED') return 'border-yellow-300 bg-warning-soft/70';
  return 'border-teal-200 bg-accent';
}

function LessonChip({ l, compact }: { l: CalendarLesson; compact?: boolean }) {
  return (
    <Link
      to={`/lop-hoc/${l.classId}`}
      className={cn('block rounded-md border px-2 py-1 text-xs leading-snug hover:ring-2 hover:ring-ring/30', lessonTone(l))}
      title={`${l.classCode} – ${l.className}\n${l.startTime}–${l.endTime} · ${l.teacherName}${l.roomName ? ` · ${l.roomName}` : ''}`}
    >
      <div className="font-semibold">
        {l.startTime} {l.classCode}
        {!!l.isMakeup && <span className="ml-1 font-normal text-primary">(bù)</span>}
      </div>
      {!compact && (
        <div className="truncate text-muted-foreground">
          {l.teacherName}
          {l.roomName && ` · ${l.roomName}`}
        </div>
      )}
    </Link>
  );
}

function CalendarView() {
  const { can } = useAuth();
  const [view, setView] = useState<View>('week');
  const [anchor, setAnchor] = useState(vnDate());
  const [teacherId, setTeacherId] = useState('');
  const [roomId, setRoomId] = useState('');
  const teachers = useTeachers();
  const rooms = useRooms(can('classes.read'));
  const range = rangeOf(view, anchor);
  const q = {
    ...range,
    teacherId: teacherId ? Number(teacherId) : undefined,
    roomId: roomId ? Number(roomId) : undefined,
  };
  const cal = useQuery({ queryKey: classKeys.calendar(q), queryFn: () => classesApi.calendar(q).then((r) => r.data) });
  const byDate = useMemo(() => {
    const m = new Map<string, CalendarLesson[]>();
    for (const l of cal.data ?? []) m.set(l.lessonDate, [...(m.get(l.lessonDate) ?? []), l]);
    return m;
  }, [cal.data]);
  const today = vnDate();

  const title =
    view === 'day'
      ? `${WEEKDAY_LABELS[isoWeekday(anchor)]}, ${formatDateVN(anchor)}`
      : view === 'week'
        ? `${formatDateVN(range.from)} – ${formatDateVN(range.to)}`
        : `Tháng ${Number(anchor.slice(5, 7))}/${anchor.slice(0, 4)}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" onClick={() => setAnchor(shiftAnchor(view, anchor, -1))} aria-label="Trước">
            <ChevronLeft />
          </Button>
          <Button variant="outline" onClick={() => setAnchor(today)}>
            Hôm nay
          </Button>
          <Button variant="outline" size="icon" onClick={() => setAnchor(shiftAnchor(view, anchor, 1))} aria-label="Sau">
            <ChevronRight />
          </Button>
        </div>
        <span className="min-w-48 font-semibold">{title}</span>
        <div className="flex-1" />
        <NativeSelect value={teacherId} onChange={(e) => setTeacherId(e.target.value)} aria-label="Lọc giáo viên" className="w-48">
          <option value="">Mọi giáo viên</option>
          {(teachers.data ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.fullName}
            </option>
          ))}
        </NativeSelect>
        {rooms.data && rooms.data.length > 0 && (
          <NativeSelect value={roomId} onChange={(e) => setRoomId(e.target.value)} aria-label="Lọc phòng" className="w-36">
            <option value="">Mọi phòng</option>
            {rooms.data.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </NativeSelect>
        )}
        <div className="inline-flex rounded-md border p-0.5">
          {(['day', 'week', 'month'] as View[]).map((v) => (
            <Button key={v} size="sm" variant={view === v ? 'default' : 'ghost'} onClick={() => setView(v)}>
              {v === 'day' ? 'Ngày' : v === 'week' ? 'Tuần' : 'Tháng'}
            </Button>
          ))}
        </div>
      </div>

      {cal.isError ? (
        <ErrorBlock error={cal.error} onRetry={() => cal.refetch()} />
      ) : cal.isLoading ? (
        <LoadingBlock />
      ) : view === 'day' ? (
        <Card>
          <CardContent className="flex flex-col gap-2">
            {(byDate.get(anchor) ?? []).map((l) => (
              <LessonChip key={l.id} l={l} />
            ))}
            {!byDate.get(anchor)?.length && <p className="py-8 text-center text-sm text-muted-foreground">Không có buổi học</p>}
          </CardContent>
        </Card>
      ) : view === 'week' ? (
        <div className="grid gap-2 overflow-x-auto md:grid-cols-7">
          {Array.from({ length: 7 }, (_, i) => addDays(range.from, i)).map((d) => (
            <div key={d} className={cn('min-h-40 rounded-lg border p-2', d === today && 'border-primary ring-1 ring-primary/30')}>
              <div className="mb-2 text-xs font-semibold text-muted-foreground">
                {WEEKDAY_LABELS[isoWeekday(d)]} <span className={cn(d === today && 'text-primary')}>{formatDateVN(d).slice(0, 5)}</span>
              </div>
              <div className="flex flex-col gap-1.5">
                {(byDate.get(d) ?? []).map((l) => (
                  <LessonChip key={l.id} l={l} />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <MonthGrid from={range.from} to={range.to} byDate={byDate} today={today} onPick={(d) => (setAnchor(d), setView('day'))} />
      )}
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="size-3 rounded border border-teal-200 bg-accent" /> Sắp diễn ra
        </span>
        <span className="flex items-center gap-1">
          <span className="size-3 rounded border border-green-200 bg-success-soft" /> Đã điểm danh
        </span>
        <span className="flex items-center gap-1">
          <span className="size-3 rounded border border-yellow-300 bg-warning-soft" /> Đã qua, chưa điểm danh
        </span>
        <span className="flex items-center gap-1">
          <span className="size-3 rounded border bg-slate-50" /> Đã hủy
        </span>
      </div>
    </div>
  );
}

function MonthGrid({
  from,
  to,
  byDate,
  today,
  onPick,
}: {
  from: string;
  to: string;
  byDate: Map<string, CalendarLesson[]>;
  today: string;
  onPick: (d: string) => void;
}) {
  const start = addDays(from, 1 - isoWeekday(from));
  const days: string[] = [];
  for (let d = start; d <= to || isoWeekday(d) !== 1; d = addDays(d, 1)) days.push(d);
  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[700px] grid-cols-7 gap-px overflow-hidden rounded-lg border bg-border">
        {[1, 2, 3, 4, 5, 6, 7].map((w) => (
          <div key={w} className="bg-muted px-2 py-1.5 text-xs font-semibold text-muted-foreground">
            {WEEKDAY_LABELS[w]}
          </div>
        ))}
        {days.map((d) => {
          const items = byDate.get(d) ?? [];
          const inMonth = d >= from && d <= to;
          return (
            <button
              key={d}
              type="button"
              onClick={() => onPick(d)}
              className={cn('flex min-h-24 flex-col gap-1 bg-background p-1.5 text-left hover:bg-muted/60', !inMonth && 'bg-muted/40 text-muted-foreground')}
            >
              <span className={cn('text-xs font-medium', d === today && 'grid size-5 place-items-center rounded-full bg-primary text-white')}>
                {Number(d.slice(8))}
              </span>
              {items.slice(0, 3).map((l) => (
                <span key={l.id} className={cn('truncate rounded border px-1 text-[11px]', lessonTone(l))}>
                  {l.startTime} {l.classCode}
                </span>
              ))}
              {items.length > 3 && <span className="text-[11px] text-muted-foreground">+{items.length - 3} buổi</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ───────────── Ca học ─────────────

function ShiftsPanel({ canEdit }: { canEdit: boolean }) {
  const shifts = useShifts();
  const [editing, setEditing] = useState<Shift | 'new' | null>(null);
  if (shifts.isLoading) return <LoadingBlock />;
  if (shifts.isError) return <ErrorBlock error={shifts.error} onRetry={() => shifts.refetch()} />;
  return (
    <Card className="max-w-3xl">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Khung giờ ca học</CardTitle>
        {canEdit && (
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus /> Thêm ca
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {shifts.data!.map((s) => (
            <li key={s.id} className="flex items-center gap-4 py-3">
              <span className="w-28 font-medium">{s.name}</span>
              <span className="font-mono">
                {s.startTime} – {s.endTime}
              </span>
              <span className="flex-1 text-sm text-muted-foreground">{s.classCount ? `${s.classCount} lớp đang dùng` : 'Chưa có lớp'}</span>
              {!s.isActive && <Badge variant="muted">Ngừng sử dụng</Badge>}
              {canEdit && (
                <Button variant="ghost" size="sm" onClick={() => setEditing(s)}>
                  <Pencil /> Sửa
                </Button>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
      <ShiftSheet shift={editing} onClose={() => setEditing(null)} />
    </Card>
  );
}

function ShiftSheet({ shift, onClose }: { shift: Shift | 'new' | null; onClose: () => void }) {
  const qc = useQueryClient();
  const s = shift && shift !== 'new' ? shift : null;
  const [name, setName] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [active, setActive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState<unknown>(null);
  if (shift !== key) {
    setKey(shift);
    setName(s?.name ?? '');
    setStart(s?.startTime ?? '');
    setEnd(s?.endTime ?? '');
    setActive(s ? !!s.isActive : true);
    setError(null);
  }
  const save = useMutation({
    mutationFn: () =>
      s
        ? classesApi.updateShift(s.id, { name, startTime: start, endTime: end, isActive: active })
        : classesApi.createShift({ name, startTime: start, endTime: end }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: classKeys.shifts });
      qc.invalidateQueries({ queryKey: ['calendar'] });
      qc.invalidateQueries({ queryKey: classKeys.all });
      toast.success('Đã lưu ca học');
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const invalid = !name.trim() || !start || !end || start >= end;
  return (
    <Sheet open={!!shift} onOpenChange={(o) => !o && onClose()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{s ? 'Sửa ca học' : 'Thêm ca học'}</SheetTitle>
          {s && <SheetDescription>Đổi giờ chỉ áp dụng cho các buổi học chưa diễn ra. Buổi đã học giữ nguyên giờ cũ.</SheetDescription>}
        </SheetHeader>
        {error && <Alert variant="destructive">{error}</Alert>}
        <FormField label="Tên ca" htmlFor="sh-name" required>
          <Input id="sh-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="VD: Ca 4" />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Bắt đầu" htmlFor="sh-start" required>
            <TimeInput id="sh-start" value={start} onChange={setStart} />
          </FormField>
          <FormField label="Kết thúc" htmlFor="sh-end" required error={start && end && start >= end ? 'Phải sau giờ bắt đầu' : undefined}>
            <TimeInput id="sh-end" value={end} onChange={setEnd} />
          </FormField>
        </div>
        {s && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="accent-primary" /> Đang sử dụng
          </label>
        )}
        <SheetFooter>
          <Button variant="outline" onClick={onClose}>
            Hủy
          </Button>
          <Button disabled={invalid || save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <Loader2 className="animate-spin" />} Lưu
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ───────────── Phòng học ─────────────

function RoomsPanel({ canEdit }: { canEdit: boolean }) {
  const rooms = useRooms();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [capacity, setCapacity] = useState('');
  const add = useMutation({
    mutationFn: () => classesApi.createRoom({ name, capacity: capacity ? Number(capacity) : null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: classKeys.rooms });
      setName('');
      setCapacity('');
      toast.success('Đã thêm phòng');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const toggle = useMutation({
    mutationFn: (r: Room) => classesApi.updateRoom(r.id, { name: r.name, capacity: r.capacity, isActive: !r.isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: classKeys.rooms }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (rooms.isLoading) return <LoadingBlock />;
  if (rooms.isError) return <ErrorBlock error={rooms.error} onRetry={() => rooms.refetch()} />;
  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle>Phòng học</CardTitle>
        <p className="text-sm text-muted-foreground">Không bắt buộc. Khi gán phòng cho lịch học, hệ thống kiểm tra trùng phòng.</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {canEdit && (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) add.mutate();
            }}
          >
            <FormField label="Tên phòng" htmlFor="room-name" className="w-48">
              <Input id="room-name" value={name} onChange={(e) => setName(e.target.value)} />
            </FormField>
            <FormField label="Sức chứa" htmlFor="room-cap" className="w-28">
              <Input id="room-cap" type="number" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} />
            </FormField>
            <Button type="submit" disabled={!name.trim() || add.isPending}>
              <Plus /> Thêm phòng
            </Button>
          </form>
        )}
        <ul className="divide-y">
          {rooms.data!.map((r) => (
            <li key={r.id} className="flex items-center gap-4 py-2.5">
              <span className="w-40 font-medium">{r.name}</span>
              <span className="flex-1 text-sm text-muted-foreground">{r.capacity ? `${r.capacity} chỗ` : ''}</span>
              {!r.isActive && <Badge variant="muted">Ngừng sử dụng</Badge>}
              {canEdit && (
                <Button variant="ghost" size="sm" onClick={() => toggle.mutate(r)}>
                  {r.isActive ? 'Ngừng sử dụng' : 'Dùng lại'}
                </Button>
              )}
            </li>
          ))}
          {!rooms.data!.length && <li className="py-4 text-sm text-muted-foreground">Chưa có phòng học.</li>}
        </ul>
      </CardContent>
    </Card>
  );
}
