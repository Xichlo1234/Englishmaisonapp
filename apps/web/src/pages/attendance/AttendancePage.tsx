import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, ClipboardCheck, Lock } from 'lucide-react';
import { addDays, formatDateVN, isoWeekday, vnDate, WEEKDAY_LABELS } from '@ecm/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DateInput } from '@/components/ui/date-input';
import { NativeSelect } from '@/components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyBlock, ErrorBlock, LoadingBlock, PageHeader } from '@/components/common/page';
import { cn } from '@/lib/utils';
import { attendanceApi, attendanceKeys, STATUS_ORDER, STATUS_STYLE, type DayLesson } from '@/services/attendance';
import { classesApi, classKeys } from '@/services/classes';

export function AttendancePage() {
  return (
    <div>
      <PageHeader title="Điểm danh" description="Chọn buổi học để điểm danh. Giáo viên sửa được đến hết ngày học; 00:00 hệ thống tự khóa." />
      <Tabs defaultValue="day">
        <TabsList>
          <TabsTrigger value="day">Theo ngày</TabsTrigger>
          <TabsTrigger value="month">Tổng hợp tháng</TabsTrigger>
        </TabsList>
        <TabsContent value="day">
          <DayView />
        </TabsContent>
        <TabsContent value="month">
          <MonthMatrix />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function progressTone(l: DayLesson, today: string) {
  if (l.status === 'CANCELLED') return 'muted';
  if (l.attendanceStatus === 'SUBMITTED') return 'success';
  if (l.attendanceStatus === 'LOCKED') return l.marked ? 'success' : 'danger';
  if (l.lessonDate < today) return 'danger';
  if (l.attendanceStatus === 'DRAFT') return 'warning';
  return 'default';
}

function DayView() {
  const [params, setParams] = useSearchParams();
  const today = vnDate();
  const date = params.get('date') || today;
  const setDate = (d: string) => setParams(d && d !== today ? { date: d } : {}, { replace: true });
  const q = useQuery({ queryKey: attendanceKeys.day(date), queryFn: () => attendanceApi.day(date).then((r) => r.data), refetchInterval: 30_000 });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="icon" onClick={() => setDate(addDays(date, -1))} aria-label="Ngày trước">
          <ChevronLeft />
        </Button>
        <div className="w-40">
          <DateInput value={date} onChange={(d) => d && setDate(d)} aria-label="Ngày" />
        </div>
        <Button variant="outline" size="icon" onClick={() => setDate(addDays(date, 1))} aria-label="Ngày sau">
          <ChevronRight />
        </Button>
        {date !== today && (
          <Button variant="ghost" onClick={() => setDate(today)}>
            Hôm nay
          </Button>
        )}
        <span className="font-medium">
          {WEEKDAY_LABELS[isoWeekday(date)]}, {formatDateVN(date)}
        </span>
      </div>
      {q.isLoading ? (
        <LoadingBlock />
      ) : q.isError ? (
        <ErrorBlock error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data!.length ? (
        <Card>
          <EmptyBlock title="Không có buổi học trong ngày" />
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {q.data!.map((l) => {
            const tone = progressTone(l, today);
            const pct = l.total ? Math.round((l.marked / l.total) * 100) : 0;
            return (
              <Link key={l.id} to={`/diem-danh/${l.id}`} className="group">
                <Card className={cn('h-full border-l-4 transition-shadow group-hover:shadow-md', {
                  'border-l-success': tone === 'success',
                  'border-l-warning': tone === 'warning',
                  'border-l-destructive': tone === 'danger',
                  'border-l-primary': tone === 'default',
                  'border-l-slate-300 opacity-60': tone === 'muted',
                })}>
                  <CardContent className="flex flex-col gap-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-lg font-semibold">
                          {l.startTime}–{l.endTime}
                        </div>
                        <div className="font-medium group-hover:text-primary">
                          {l.classCode} · {l.className}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {l.teacherName}
                          {l.roomName && ` · ${l.roomName}`}
                        </div>
                      </div>
                      {l.status === 'CANCELLED' ? (
                        <Badge variant="muted">Đã hủy</Badge>
                      ) : l.attendanceStatus === 'LOCKED' ? (
                        <Badge variant={l.marked ? 'muted' : 'danger'}>
                          <Lock className="size-3" /> {l.marked ? 'Đã khóa' : 'Khóa – chưa điểm danh'}
                        </Badge>
                      ) : l.attendanceStatus === 'SUBMITTED' ? (
                        <Badge variant="success">Đã xác nhận</Badge>
                      ) : l.attendanceStatus === 'DRAFT' ? (
                        <Badge variant="warning">Đang điểm danh</Badge>
                      ) : (
                        <Badge variant={l.lessonDate < today ? 'danger' : 'default'}>Chưa điểm danh</Badge>
                      )}
                    </div>
                    {l.status !== 'CANCELLED' && (
                      <>
                        <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                          <div className="h-full rounded-full bg-success" style={{ width: `${pct}%` }} />
                        </div>
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>
                            {l.marked}/{l.total} đã chọn
                          </span>
                          <span>
                            {l.absent > 0 && <span className="text-destructive">{l.absent} vắng</span>}
                            {l.late > 0 && <span className="ml-2 text-yellow-700">{l.late} muộn</span>}
                          </span>
                        </div>
                        {l.attendanceStatus !== 'LOCKED' && l.attendanceStatus !== 'SUBMITTED' && (
                          <span className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-primary">
                            <ClipboardCheck className="size-4" /> Điểm danh
                          </span>
                        )}
                      </>
                    )}
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MonthMatrix() {
  const classes = useQuery({ queryKey: classKeys.list({ status: 'ALL', for: 'matrix' }), queryFn: () => classesApi.list({ status: 'ALL' }).then((r) => r.data) });
  const [classId, setClassId] = useState('');
  const [month, setMonth] = useState(vnDate().slice(0, 7));
  const cid = Number(classId || classes.data?.find((c) => c.status === 'OPEN')?.id || 0);
  const q = useQuery({ queryKey: attendanceKeys.matrix(cid, month), queryFn: () => attendanceApi.matrix(cid, month), enabled: !!cid });
  const moveMonth = (d: number) => {
    const [y, m] = month.split('-').map(Number) as [number, number];
    const t = new Date(Date.UTC(y, m - 1 + d, 1));
    setMonth(`${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`);
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect className="w-64" value={classId || String(cid || '')} onChange={(e) => setClassId(e.target.value)} aria-label="Lớp">
          {(classes.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.classCode} – {c.name}
            </option>
          ))}
        </NativeSelect>
        <Button variant="outline" size="icon" onClick={() => moveMonth(-1)} aria-label="Tháng trước">
          <ChevronLeft />
        </Button>
        <span className="w-32 whitespace-nowrap text-center font-medium">
          Tháng {Number(month.slice(5))}/{month.slice(0, 4)}
        </span>
        <Button variant="outline" size="icon" onClick={() => moveMonth(1)} aria-label="Tháng sau">
          <ChevronRight />
        </Button>
        <div className="flex flex-wrap gap-1.5 text-xs">
          {STATUS_ORDER.map((s) => (
            <span key={s} className={cn('rounded px-1.5 py-0.5', STATUS_STYLE[s].cell)}>
              {STATUS_STYLE[s].short} = {STATUS_STYLE[s].label}
            </span>
          ))}
        </div>
      </div>
      {!cid ? (
        <EmptyBlock title="Chưa có lớp học" />
      ) : q.isLoading ? (
        <LoadingBlock />
      ) : q.isError ? (
        <ErrorBlock error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data!.lessons.length ? (
        <Card>
          <EmptyBlock title="Không có buổi học trong tháng" />
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 bg-muted">Học sinh</TableHead>
                {q.data!.lessons.map((l) => (
                  <TableHead key={l.id} className="px-1 text-center">
                    <Link to={`/diem-danh/${l.id}`} className="hover:text-primary" title={`${formatDateVN(l.lessonDate)} ${l.startTime}`}>
                      {l.lessonDate.slice(8)}/{l.lessonDate.slice(5, 7)}
                    </Link>
                  </TableHead>
                ))}
                <TableHead className="text-center">Có mặt</TableHead>
                <TableHead className="text-center">Vắng</TableHead>
                <TableHead className="text-center">Muộn</TableHead>
                <TableHead className="text-center">Chuyên cần</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.data!.students.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="sticky left-0 whitespace-nowrap bg-background font-medium">
                    <Link to={`/hoc-sinh/${s.id}`} className="hover:text-primary">
                      {s.fullName}
                    </Link>
                  </TableCell>
                  {q.data!.lessons.map((l) => {
                    const v = s.cells[l.id];
                    return (
                      <TableCell key={l.id} className="px-1 text-center">
                        {v ? (
                          <span className={cn('inline-grid size-7 place-items-center rounded text-xs font-semibold', STATUS_STYLE[v].cell)} title={STATUS_STYLE[v].label}>
                            {STATUS_STYLE[v].short}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">·</span>
                        )}
                      </TableCell>
                    );
                  })}
                  <TableCell className="text-center">{s.stats.present}</TableCell>
                  <TableCell className="text-center">{s.stats.absent}</TableCell>
                  <TableCell className="text-center">{s.stats.late}</TableCell>
                  <TableCell className={cn('text-center font-medium', s.stats.rate !== null && s.stats.rate < 80 && 'text-destructive')}>
                    {s.stats.rate === null ? '—' : `${s.stats.rate}%`}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
