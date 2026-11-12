import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRightLeft, CalendarPlus, ChevronLeft, ChevronRight, Loader2, LogOut, Pencil, Phone, Play, Plus, Power, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { addDays, formatDateVN, isoWeekday, vnDate, WEEKDAY_LABELS } from '@ecm/shared';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { DateInput, TimeInput } from '@/components/ui/date-input';
import { NativeSelect } from '@/components/ui/native-select';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FormField } from '@/components/common/form-field';
import { EmptyBlock, ErrorBlock, errorMessage, LoadingBlock } from '@/components/common/page';
import { useRooms, useTeachers } from '@/hooks/use-catalog';
import { cn } from '@/lib/utils';
import {
  ATTENDANCE_SESSION_LABELS,
  CLASS_STATUS_LABELS,
  CLASS_STATUS_VARIANT,
  classesApi,
  classKeys,
  type ClassDetail,
  type LessonRow,
} from '@/services/classes';
import { studentKeys } from '@/services/students';
import { DateReasonDialog, EnrollStudentsSheet, TransferSheet } from './dialogs';
import { emptyScheduleRow, ScheduleRowsEditor, toScheduleInput, type ScheduleRow } from './ScheduleRowsEditor';

export function ClassDetailPage() {
  const id = Number(useParams().id);
  const q = useQuery({ queryKey: classKeys.detail(id), queryFn: () => classesApi.detail(id), enabled: Number.isInteger(id) });
  if (q.isLoading) return <LoadingBlock />;
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => q.refetch()} />;
  return <ClassView c={q.data!} />;
}

function useInvalidateClass(id: number) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: classKeys.all });
    qc.invalidateQueries({ queryKey: ['calendar'] });
    qc.invalidateQueries({ queryKey: studentKeys.all });
    qc.invalidateQueries({ queryKey: classKeys.detail(id) });
  };
}

function ClassView({ c }: { c: ClassDetail }) {
  const invalidate = useInvalidateClass(c.id);
  const [closing, setClosing] = useState(false);
  const open = useMutation({
    mutationFn: () => classesApi.open(c.id, c.version),
    onSuccess: (r) => {
      invalidate();
      toast.success(`Đã mở lớp. Có ${r.upcomingLessons} buổi học sắp tới.`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const activeSchedules = c.schedules.filter((s) => s.active);
  const full = c.students.length >= c.maxStudents;

  return (
    <div className="max-w-6xl">
      <Button variant="ghost" size="sm" className="mb-3 -ml-2" asChild>
        <Link to="/lop-hoc">
          <ArrowLeft /> Danh sách lớp
        </Link>
      </Button>
      <Card className="mb-6">
        <CardContent className="flex flex-col gap-4 md:flex-row md:items-start">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm text-muted-foreground">{c.classCode}</span>
              <Badge variant={CLASS_STATUS_VARIANT[c.status]}>{CLASS_STATUS_LABELS[c.status]}</Badge>
            </div>
            <h1 className="mt-1 text-xl font-semibold">{c.name}</h1>
            <div className="mt-2 grid gap-x-8 gap-y-1 text-sm text-muted-foreground sm:grid-cols-2">
              <span>Giáo viên chính: {c.mainTeacher?.fullName ?? '—'}</span>
              <span>Trình độ: {c.englishLevel ?? '—'}</span>
              <span>
                Thời gian: {formatDateVN(c.startDate)} → {c.endDate ? formatDateVN(c.endDate) : 'chưa xác định'}
              </span>
              <span className={cn(full && 'font-medium text-destructive')}>
                Sĩ số: {c.students.length}/{c.maxStudents}
              </span>
              <span>
                Lịch: {activeSchedules.length ? activeSchedules.map((s) => `${WEEKDAY_LABELS[s.weekday]} ${s.startTime}–${s.endTime}`).join(', ') : 'chưa có'}
              </span>
              <span>
                Buổi học: {c.lessonStats.done} đã qua · {c.lessonStats.upcoming} sắp tới
              </span>
            </div>
          </div>
          {c.canManage && (
            <div className="flex flex-wrap gap-2">
              {c.status !== 'CLOSED' && (
                <Button variant="outline" asChild>
                  <Link to={`/lop-hoc/${c.id}/sua`}>
                    <Pencil /> Sửa
                  </Link>
                </Button>
              )}
              {c.status !== 'OPEN' && (
                <Button
                  onClick={() => {
                    if (c.status === 'CLOSED' && !window.confirm('Mở lại lớp đã đóng? Học sinh cần được xếp lại vào lớp.')) return;
                    open.mutate();
                  }}
                  disabled={open.isPending}
                >
                  {open.isPending ? <Loader2 className="animate-spin" /> : <Play />} {c.status === 'CLOSED' ? 'Mở lại lớp' : 'Mở lớp'}
                </Button>
              )}
              {c.status !== 'CLOSED' && (
                <Button variant="outline" onClick={() => setClosing(true)}>
                  <Power /> Đóng lớp
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
      {c.status === 'PLANNED' && c.canManage && (
        <Alert variant="info" className="mb-4">
          Lớp đang ở trạng thái chuẩn bị. Bấm "Mở lớp" để hệ thống sinh các buổi học theo lịch (8 tuần tới, tự động gia hạn hằng ngày).
        </Alert>
      )}

      <Tabs defaultValue="students">
        <TabsList>
          <TabsTrigger value="students">Học sinh ({c.students.length})</TabsTrigger>
          <TabsTrigger value="schedule">Lịch học</TabsTrigger>
          <TabsTrigger value="lessons">Buổi học</TabsTrigger>
          <TabsTrigger value="history">Lịch sử sĩ số</TabsTrigger>
        </TabsList>
        <TabsContent value="students">
          <StudentsTab c={c} />
        </TabsContent>
        <TabsContent value="schedule">
          <ScheduleTab c={c} />
        </TabsContent>
        <TabsContent value="lessons">
          <LessonsTab c={c} />
        </TabsContent>
        <TabsContent value="history">
          <HistoryTab classId={c.id} maxStudents={c.maxStudents} />
        </TabsContent>
      </Tabs>

      <DateReasonDialog
        open={closing}
        onOpenChange={setClosing}
        title={`Đóng lớp ${c.classCode}`}
        description="Học sinh sẽ được rút khỏi lớp từ sau ngày đóng, các buổi học sau ngày đó bị xóa. Điểm danh, điểm và học phí đã có được giữ nguyên."
        dateLabel="Ngày học cuối cùng"
        confirmLabel="Đóng lớp"
        destructive
        onSubmit={async ({ date, reason }) => {
          await classesApi.close(c.id, { closeDate: date, reason, version: c.version });
          invalidate();
          toast.success('Đã đóng lớp');
        }}
      />
    </div>
  );
}

// ───────────── Học sinh ─────────────

function StudentsTab({ c }: { c: ClassDetail }) {
  const invalidate = useInvalidateClass(c.id);
  const [adding, setAdding] = useState(false);
  const [transfer, setTransfer] = useState<{ id: number; studentName: string; classId: number; classCode: string; startDate: string } | null>(null);
  const [ending, setEnding] = useState<{ id: number; name: string } | null>(null);
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Học sinh đang học</CardTitle>
        {c.canEnroll && c.status !== 'CLOSED' && (
          <Button size="sm" onClick={() => setAdding(true)}>
            <UserPlus /> Thêm học sinh
          </Button>
        )}
      </CardHeader>
      <CardContent className="p-0">
        {c.students.length === 0 ? (
          <EmptyBlock title="Lớp chưa có học sinh" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mã</TableHead>
                <TableHead>Họ tên</TableHead>
                <TableHead>Ngày sinh</TableHead>
                <TableHead>Vào lớp</TableHead>
                <TableHead>SĐT phụ huynh</TableHead>
                {c.canEnroll && <TableHead className="text-right">Thao tác</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {c.students.map((s) => (
                <TableRow key={s.enrollmentId}>
                  <TableCell className="font-mono text-xs text-muted-foreground">{s.studentCode}</TableCell>
                  <TableCell>
                    <Link to={`/hoc-sinh/${s.studentId}`} className="font-medium hover:text-primary">
                      {s.fullName}
                    </Link>
                  </TableCell>
                  <TableCell>{formatDateVN(s.dateOfBirth)}</TableCell>
                  <TableCell>{formatDateVN(s.startDate)}</TableCell>
                  <TableCell>
                    {s.guardianPhone && (
                      <a href={`tel:${s.guardianPhone}`} className="flex items-center gap-1 hover:text-primary">
                        <Phone className="size-3.5" /> {s.guardianPhone}
                      </a>
                    )}
                  </TableCell>
                  {c.canEnroll && (
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setTransfer({ id: s.enrollmentId, studentName: s.fullName, classId: c.id, classCode: c.classCode, startDate: s.startDate })}
                      >
                        <ArrowRightLeft /> Chuyển lớp/ca
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setEnding({ id: s.enrollmentId, name: s.fullName })}>
                        <LogOut /> Rời lớp
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <EnrollStudentsSheet classId={c.id} classStartDate={c.startDate} remaining={c.maxStudents - c.students.length} open={adding} onOpenChange={setAdding} />
      <TransferSheet enrollment={transfer} onOpenChange={(o) => !o && setTransfer(null)} />
      <DateReasonDialog
        open={!!ending}
        onOpenChange={(o) => !o && setEnding(null)}
        title={`${ending?.name} rời lớp ${c.classCode}`}
        description="Dùng khi học sinh hoàn thành hoặc thôi học lớp này. Để chuyển sang lớp khác, dùng 'Chuyển lớp/ca'."
        dateLabel="Ngày học cuối cùng"
        confirmLabel="Xác nhận"
        onSubmit={async ({ date, reason }) => {
          await classesApi.endEnrollment(ending!.id, { endDate: date, reason, endReason: 'COMPLETED' });
          invalidate();
          toast.success('Đã cập nhật');
        }}
      />
    </Card>
  );
}

// ───────────── Lịch học ─────────────

function ScheduleTab({ c }: { c: ClassDetail }) {
  const invalidate = useInvalidateClass(c.id);
  const [adding, setAdding] = useState(false);
  const [ending, setEnding] = useState<number | null>(null);
  const [rows, setRows] = useState<ScheduleRow[]>([emptyScheduleRow()]);
  const today = vnDate();
  const [from, setFrom] = useState(c.startDate > today ? c.startDate : today);
  const [error, setError] = useState<string | null>(null);
  const add = useMutation({
    mutationFn: () => classesApi.addSchedule(c.id, { ...toScheduleInput(rows[0]!), effectiveFrom: from }),
    onSuccess: () => {
      invalidate();
      toast.success('Đã thêm lịch');
      setAdding(false);
      setRows([emptyScheduleRow()]);
    },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Lịch học hằng tuần</CardTitle>
        {c.canManage && c.status !== 'CLOSED' && (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus /> Thêm lịch
          </Button>
        )}
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Thứ</TableHead>
              <TableHead>Ca</TableHead>
              <TableHead>Giáo viên</TableHead>
              <TableHead>Phòng</TableHead>
              <TableHead>Hiệu lực</TableHead>
              {c.canManage && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {c.schedules.map((s) => (
              <TableRow key={s.id} className={cn(!s.active && 'text-muted-foreground')}>
                <TableCell className="font-medium">{WEEKDAY_LABELS[s.weekday]}</TableCell>
                <TableCell>
                  {s.shiftName} ({s.startTime}–{s.endTime})
                </TableCell>
                <TableCell>{s.teacherName}</TableCell>
                <TableCell>{s.roomName ?? '—'}</TableCell>
                <TableCell>
                  {formatDateVN(s.effectiveFrom)} → {s.effectiveTo ? formatDateVN(s.effectiveTo) : '…'}
                  {!s.active && (
                    <Badge variant="muted" className="ml-2">
                      Đã kết thúc
                    </Badge>
                  )}
                </TableCell>
                {c.canManage && (
                  <TableCell className="text-right">
                    {s.active && c.status !== 'CLOSED' && (
                      <Button variant="ghost" size="sm" onClick={() => setEnding(s.id)}>
                        Kết thúc lịch
                      </Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!c.schedules.length && <EmptyBlock title="Chưa có lịch học" />}
      </CardContent>

      <Sheet open={adding} onOpenChange={(o) => (setError(null), setAdding(o))}>
        <SheetContent className="max-w-2xl">
          <SheetHeader>
            <SheetTitle>Thêm lịch học</SheetTitle>
          </SheetHeader>
          {error && <Alert variant="destructive">{error}</Alert>}
          <FormField label="Áp dụng từ ngày" htmlFor="sch-from" required>
            <DateInput id="sch-from" min={c.startDate} value={from} onChange={setFrom} />
          </FormField>
          <ScheduleRowsEditor rows={rows} onChange={setRows} mainTeacherId={c.mainTeacherId ?? ''} effectiveFrom={from} effectiveTo={c.endDate} allowMultiple={false} />
          <SheetFooter>
            <Button variant="outline" onClick={() => setAdding(false)}>
              Hủy
            </Button>
            <Button disabled={!rows[0]?.shiftId || add.isPending} onClick={() => (setError(null), add.mutate())}>
              {add.isPending && <Loader2 className="animate-spin" />} Lưu lịch
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
      <DateReasonDialog
        open={ending !== null}
        onOpenChange={(o) => !o && setEnding(null)}
        title="Kết thúc lịch học"
        description="Lịch được giữ trong lịch sử. Các buổi học sau ngày kết thúc (chưa điểm danh) sẽ bị xóa. Để đổi ca/giáo viên, hãy kết thúc lịch cũ rồi thêm lịch mới."
        dateLabel="Buổi cuối cùng theo lịch này vào ngày"
        reasonRequired={false}
        confirmLabel="Kết thúc lịch"
        onSubmit={async ({ date, reason }) => {
          await classesApi.endSchedule(ending!, { effectiveTo: date, ...(reason ? { reason } : {}) });
          invalidate();
          toast.success('Đã kết thúc lịch');
        }}
      />
    </Card>
  );
}

// ───────────── Buổi học ─────────────

function monthRange(anchor: string) {
  const [y, m] = anchor.split('-').map(Number) as [number, number];
  const from = `${y}-${String(m).padStart(2, '0')}-01`;
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  return { from, to: addDays(next, -1) };
}

function LessonsTab({ c }: { c: ClassDetail }) {
  const invalidate = useInvalidateClass(c.id);
  const [anchor, setAnchor] = useState(vnDate().slice(0, 8) + '01');
  const { from, to } = monthRange(anchor);
  const lessons = useQuery({ queryKey: classKeys.lessons(c.id, from, to), queryFn: () => classesApi.lessons(c.id, from, to).then((r) => r.data) });
  const [makeup, setMakeup] = useState(false);
  const [cancelling, setCancelling] = useState<LessonRow | null>(null);
  const [editing, setEditing] = useState<LessonRow | null>(null);
  const today = vnDate();
  const move = (dir: number) => {
    const [y, m] = anchor.split('-').map(Number) as [number, number];
    const d = new Date(Date.UTC(y, m - 1 + dir, 1));
    setAnchor(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`);
  };
  const restore = useMutation({
    mutationFn: (l: LessonRow) => classesApi.updateLesson(l.id, { restore: true, version: l.version }),
    onSuccess: () => (invalidate(), toast.success('Đã khôi phục buổi học')),
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => move(-1)} aria-label="Tháng trước">
            <ChevronLeft />
          </Button>
          <CardTitle>
            Tháng {Number(anchor.slice(5, 7))}/{anchor.slice(0, 4)}
          </CardTitle>
          <Button variant="outline" size="icon" onClick={() => move(1)} aria-label="Tháng sau">
            <ChevronRight />
          </Button>
        </div>
        {c.canManage && c.status === 'OPEN' && (
          <Button size="sm" onClick={() => setMakeup(true)}>
            <CalendarPlus /> Thêm buổi bù
          </Button>
        )}
      </CardHeader>
      <CardContent className="p-0">
        {lessons.isLoading ? (
          <LoadingBlock />
        ) : lessons.isError ? (
          <ErrorBlock error={lessons.error} onRetry={() => lessons.refetch()} />
        ) : !lessons.data!.length ? (
          <EmptyBlock title="Không có buổi học trong tháng" description={c.status === 'PLANNED' ? 'Buổi học được tạo khi mở lớp.' : undefined} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ngày</TableHead>
                <TableHead>Giờ</TableHead>
                <TableHead>Giáo viên</TableHead>
                <TableHead>Phòng</TableHead>
                <TableHead>Điểm danh</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lessons.data!.map((l) => (
                <TableRow key={l.id} className={cn(l.status === 'CANCELLED' && 'text-muted-foreground', l.lessonDate === today && 'bg-accent/50')}>
                  <TableCell className="whitespace-nowrap">
                    {WEEKDAY_LABELS[isoWeekday(l.lessonDate)]}, {formatDateVN(l.lessonDate)}
                    {!!l.isMakeup && (
                      <Badge variant="default" className="ml-2">
                        Buổi bù
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {l.startTime}–{l.endTime}
                  </TableCell>
                  <TableCell>{l.teacherName}</TableCell>
                  <TableCell>{l.roomName ?? '—'}</TableCell>
                  <TableCell>
                    {l.status === 'CANCELLED' ? (
                      <Badge variant="muted" title={l.cancelReason ?? ''}>
                        Đã hủy{l.cancelReason ? `: ${l.cancelReason}` : ''}
                      </Badge>
                    ) : (
                      <Badge
                        variant={
                          l.attendanceStatus === 'SUBMITTED' || l.attendanceStatus === 'LOCKED'
                            ? 'success'
                            : l.lessonDate < today
                              ? 'warning'
                              : 'muted'
                        }
                      >
                        {ATTENDANCE_SESSION_LABELS[l.attendanceStatus]}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    {l.status !== 'CANCELLED' && l.lessonDate <= addDays(today, 0) && (
                      <Button variant="ghost" size="sm" asChild>
                        <Link to={`/diem-danh/${l.id}`}>Điểm danh</Link>
                      </Button>
                    )}
                  {c.canManage && (
                    <>
                      {l.status === 'CANCELLED' ? (
                        <Button variant="ghost" size="sm" onClick={() => restore.mutate(l)} disabled={restore.isPending}>
                          Khôi phục
                        </Button>
                      ) : (
                        l.attendanceStatus === 'NOT_STARTED' && (
                          <>
                            <Button variant="ghost" size="sm" onClick={() => setEditing(l)}>
                              Dạy thay / đổi phòng
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => setCancelling(l)}>
                              Hủy buổi
                            </Button>
                          </>
                        )
                      )}
                    </>
                  )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <MakeupSheet c={c} open={makeup} onOpenChange={setMakeup} />
      <LessonEditSheet lesson={editing} onClose={() => setEditing(null)} onDone={invalidate} />
      <DateReasonDialog
        open={!!cancelling}
        onOpenChange={(o) => !o && setCancelling(null)}
        title={cancelling ? `Hủy buổi ${formatDateVN(cancelling.lessonDate)} ${cancelling.startTime}` : ''}
        description="Buổi bị hủy không tính vào chuyên cần và học phí theo buổi."
        confirmLabel="Hủy buổi học"
        destructive
        onSubmit={async ({ reason }) => {
          await classesApi.updateLesson(cancelling!.id, { cancel: { reason }, version: cancelling!.version });
          invalidate();
          toast.success('Đã hủy buổi học');
        }}
      />
    </Card>
  );
}

function MakeupSheet({ c, open, onOpenChange }: { c: ClassDetail; open: boolean; onOpenChange: (o: boolean) => void }) {
  const invalidate = useInvalidateClass(c.id);
  const teachers = useTeachers();
  const rooms = useRooms();
  const [date, setDate] = useState(vnDate());
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [teacherId, setTeacherId] = useState(String(c.mainTeacherId ?? ''));
  const [roomId, setRoomId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const mut = useMutation({
    mutationFn: () => classesApi.addLesson(c.id, { lessonDate: date, startTime: start, endTime: end, teacherId: Number(teacherId), roomId: roomId ? Number(roomId) : null }),
    onSuccess: () => {
      invalidate();
      toast.success('Đã thêm buổi bù');
      onOpenChange(false);
    },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Sheet open={open} onOpenChange={(o) => (setError(null), onOpenChange(o))}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Thêm buổi học bù</SheetTitle>
        </SheetHeader>
        {error && <Alert variant="destructive">{error}</Alert>}
        <FormField label="Ngày" htmlFor="mk-date" required>
          <DateInput id="mk-date" value={date} onChange={setDate} />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Bắt đầu" htmlFor="mk-start" required>
            <TimeInput id="mk-start" value={start} onChange={setStart} />
          </FormField>
          <FormField label="Kết thúc" htmlFor="mk-end" required>
            <TimeInput id="mk-end" value={end} onChange={setEnd} />
          </FormField>
        </div>
        <FormField label="Giáo viên" htmlFor="mk-teacher" required>
          <NativeSelect id="mk-teacher" value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
            <option value="">—</option>
            {(teachers.data ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.fullName}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField label="Phòng" htmlFor="mk-room">
          <NativeSelect id="mk-room" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
            <option value="">Không gán phòng</option>
            {(rooms.data ?? []).filter((r) => r.isActive).map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <SheetFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Hủy
          </Button>
          <Button disabled={!date || !start || !end || start >= end || !teacherId || mut.isPending} onClick={() => (setError(null), mut.mutate())}>
            {mut.isPending && <Loader2 className="animate-spin" />} Lưu
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function LessonEditSheet({ lesson, onClose, onDone }: { lesson: LessonRow | null; onClose: () => void; onDone: () => void }) {
  const teachers = useTeachers();
  const rooms = useRooms();
  const [teacherId, setTeacherId] = useState('');
  const [roomId, setRoomId] = useState('');
  const [key, setKey] = useState<LessonRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (lesson !== key) {
    setKey(lesson);
    setTeacherId(String(lesson?.teacherId ?? ''));
    setRoomId(String(lesson?.roomId ?? ''));
    setError(null);
  }
  const mut = useMutation({
    mutationFn: () => classesApi.updateLesson(lesson!.id, { teacherId: Number(teacherId), roomId: roomId ? Number(roomId) : null, version: lesson!.version }),
    onSuccess: () => {
      onDone();
      toast.success('Đã cập nhật buổi học');
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Sheet open={!!lesson} onOpenChange={(o) => !o && onClose()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>
            Buổi {lesson && formatDateVN(lesson.lessonDate)} {lesson?.startTime}–{lesson?.endTime}
          </SheetTitle>
        </SheetHeader>
        {error && <Alert variant="destructive">{error}</Alert>}
        <FormField label="Giáo viên dạy (dạy thay)" htmlFor="le-teacher">
          <NativeSelect id="le-teacher" value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
            {(teachers.data ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.fullName}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField label="Phòng" htmlFor="le-room">
          <NativeSelect id="le-room" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
            <option value="">Không gán phòng</option>
            {(rooms.data ?? []).filter((r) => r.isActive).map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <SheetFooter>
          <Button variant="outline" onClick={onClose}>
            Hủy
          </Button>
          <Button disabled={mut.isPending} onClick={() => (setError(null), mut.mutate())}>
            {mut.isPending && <Loader2 className="animate-spin" />} Lưu
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ───────────── Lịch sử sĩ số ─────────────

const END_LABELS: Record<string, string> = { TRANSFER: 'Chuyển lớp', PAUSE: 'Tạm nghỉ', DROP: 'Nghỉ học', CLASS_CLOSED: 'Lớp đóng', COMPLETED: 'Hoàn thành' };

function HistoryTab({ classId, maxStudents }: { classId: number; maxStudents: number }) {
  const q = useQuery({ queryKey: classKeys.history(classId), queryFn: () => classesApi.history(classId).then((r) => r.data) });
  // Sĩ số cuối mỗi tháng (12 tháng gần nhất có dữ liệu)
  const series = useMemo(() => {
    if (!q.data?.length) return [];
    const first = q.data.reduce((m, e) => (e.startDate < m ? e.startDate : m), '9999-12-31');
    const out: { label: string; n: number }[] = [];
    let [y, m] = first.split('-').map(Number) as [number, number];
    const [ty, tm] = vnDate().split('-').map(Number) as [number, number];
    while (y < ty || (y === ty && m <= tm)) {
      const end = addDays(m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`, -1);
      const at = end > vnDate() ? vnDate() : end;
      out.push({ label: `${m}/${String(y).slice(2)}`, n: q.data.filter((e) => e.startDate <= at && (!e.endDate || e.endDate >= at)).length });
      m++;
      if (m > 12) (m = 1), y++;
    }
    return out.slice(-12);
  }, [q.data]);
  if (q.isLoading) return <LoadingBlock />;
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => q.refetch()} />;
  const max = Math.max(maxStudents, ...series.map((s) => s.n), 1);
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
      <Card>
        <CardHeader>
          <CardTitle>Sĩ số cuối mỗi tháng</CardTitle>
        </CardHeader>
        <CardContent>
          {series.length ? (
            <div className="flex h-48 items-end gap-2" role="img" aria-label="Biểu đồ sĩ số theo tháng">
              {series.map((s) => (
                <div key={s.label} className="flex flex-1 flex-col items-center gap-1">
                  <span className="text-xs font-medium">{s.n}</span>
                  <div className="w-full rounded-t bg-primary/80" style={{ height: `${(s.n / max) * 150}px` }} />
                  <span className="text-[11px] text-muted-foreground">{s.label}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Chưa có dữ liệu</p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Vào / ra lớp</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Học sinh</TableHead>
                <TableHead>Vào lớp</TableHead>
                <TableHead>Rời lớp</TableHead>
                <TableHead>Ghi chú</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.data!.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>
                    <Link to={`/hoc-sinh/${e.studentId}`} className="hover:text-primary">
                      {e.fullName}
                    </Link>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatDateVN(e.startDate)}
                    {e.fromClassCode && <div className="text-xs text-muted-foreground">từ {e.fromClassCode}</div>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {e.endDate ? formatDateVN(e.endDate) : <Badge variant="success">Đang học</Badge>}
                    {e.endReason && (
                      <div className="text-xs text-muted-foreground">
                        {END_LABELS[e.endReason] ?? e.endReason}
                        {e.toClassCode && ` → ${e.toClassCode}`}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="max-w-56 truncate text-sm text-muted-foreground" title={e.note ?? ''}>
                    {e.note}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!q.data!.length && <EmptyBlock title="Chưa có học sinh nào vào lớp" />}
        </CardContent>
      </Card>
    </div>
  );
}
