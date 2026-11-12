import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCheck, CloudOff, History, Loader2, Lock, MessageSquarePlus, RefreshCw, Unlock } from 'lucide-react';
import { toast } from 'sonner';
import { formatDateVN, isoWeekday, WEEKDAY_LABELS, type AttendanceStatus } from '@ecm/shared';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ErrorBlock, errorMessage, LoadingBlock } from '@/components/common/page';
import { ApiError } from '@/lib/api';
import { formatDateTimeVN } from '@/lib/format';
import { cn } from '@/lib/utils';
import { DateReasonDialog } from '@/pages/classes/dialogs';
import { attendanceApi, attendanceKeys, STATUS_ORDER, STATUS_STYLE, type AttendanceSheet, type RecordInput } from '@/services/attendance';

export function AttendanceSheetPage() {
  const id = Number(useParams().lessonId);
  const q = useQuery({ queryKey: attendanceKeys.sheet(id), queryFn: () => attendanceApi.sheet(id), enabled: Number.isInteger(id), refetchOnWindowFocus: false });
  if (q.isLoading) return <LoadingBlock />;
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => q.refetch()} />;
  return <Sheet key={`${id}`} initial={q.data!} reload={() => q.refetch().then((r) => r.data!)} />;
}

type Local = { status: AttendanceStatus | null; lateMinutes: number | null; note: string | null };
type SaveState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved'; at: Date } | { kind: 'offline'; message: string } | { kind: 'error'; message: string };

function Sheet({ initial, reload }: { initial: AttendanceSheet; reload: () => Promise<AttendanceSheet> }) {
  const qc = useQueryClient();
  const [sheet, setSheet] = useState(initial);
  const [rows, setRows] = useState<Map<number, Local>>(() => new Map(initial.students.map((s) => [s.studentId, { status: s.status, lateMinutes: s.lateMinutes, note: s.note }])));
  const dirty = useRef(new Set<number>());
  const version = useRef(initial.lesson.version);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<Promise<boolean> | null>(null);
  const [save, setSave] = useState<SaveState>({ kind: 'idle' });
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [noteOpen, setNoteOpen] = useState<Set<number>>(new Set());
  const editable = sheet.canEdit;
  const L = sheet.lesson;

  const applyServer = useCallback((s: AttendanceSheet) => {
    setSheet(s);
    version.current = s.lesson.version;
    setRows((prev) => {
      const next = new Map(prev);
      for (const st of s.students) if (!dirty.current.has(st.studentId)) next.set(st.studentId, { status: st.status, lateMinutes: st.lateMinutes, note: st.note });
      return next;
    });
  }, []);

  /** Gửi các dòng đã thay đổi. Trả về true nếu không còn thay đổi chưa lưu. */
  const flush = useCallback(async (): Promise<boolean> => {
    if (inflight.current) await inflight.current;
    const ids = [...dirty.current];
    const records: RecordInput[] = [];
    for (const id of ids) {
      const r = rows.get(id);
      if (r?.status) records.push({ studentId: id, status: r.status, lateMinutes: r.status === 'LATE' ? r.lateMinutes : null, note: r.note });
    }
    if (!records.length) return true;
    const run = (async () => {
      setSave({ kind: 'saving' });
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await attendanceApi.save(L.id, version.current, records);
          version.current = res.version;
          records.forEach((r) => dirty.current.delete(r.studentId));
          setSheet((s) => ({ ...s, lesson: { ...s.lesson, version: res.version, attendanceStatus: res.attendanceStatus as AttendanceSheet['lesson']['attendanceStatus'] } }));
          setSave({ kind: 'saved', at: new Date() });
          return true;
        } catch (e) {
          if (e instanceof ApiError && e.code === 'VERSION_CONFLICT' && attempt === 0) {
            // Người khác vừa lưu: tải phiên mới, giữ lựa chọn của mình rồi gửi lại
            applyServer(await reload());
            continue;
          }
          if (e instanceof ApiError && e.status === 0) setSave({ kind: 'offline', message: e.message });
          else setSave({ kind: 'error', message: errorMessage(e) });
          return false;
        }
      }
      return false;
    })();
    inflight.current = run;
    const ok = await run;
    inflight.current = null;
    return ok;
  }, [rows, L.id, reload, applyServer]);

  // Tự lưu nháp 1,2 giây sau thay đổi cuối
  const schedule = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 1200);
  };
  useEffect(() => {
    if (dirty.current.size) schedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  // Cảnh báo khi rời trang còn dữ liệu chưa lưu
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (dirty.current.size) e.preventDefault();
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, []);

  const setRow = (id: number, patch: Partial<Local>) => {
    if (!editable) return;
    dirty.current.add(id);
    setRows((prev) => new Map(prev).set(id, { ...prev.get(id)!, ...patch }));
  };
  const markAllPresent = () => {
    if (!editable) return;
    setRows((prev) => {
      const next = new Map(prev);
      for (const [id, r] of prev)
        if (!r.status) {
          next.set(id, { ...r, status: 'PRESENT' });
          dirty.current.add(id);
        }
      return next;
    });
  };

  const counts = useMemo(() => {
    const c = { PRESENT: 0, LATE: 0, EXCUSED: 0, UNEXCUSED: 0, unmarked: 0 };
    for (const r of rows.values()) r.status ? c[r.status]++ : c.unmarked++;
    return c;
  }, [rows]);

  async function submit() {
    setSubmitting(true);
    try {
      if (!(await flush())) return;
      const res = await attendanceApi.submit(L.id, version.current);
      toast.success(`Đã xác nhận điểm danh${res.absentNotified ? ` · đã báo ${res.absentNotified} học sinh vắng cho phụ huynh` : ''}`);
      setConfirming(false);
      applyServer(await reload());
      qc.invalidateQueries({ queryKey: ['attendance'] });
      qc.invalidateQueries({ queryKey: ['classes'] });
      qc.invalidateQueries({ queryKey: ['calendar'] });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSubmitting(false);
    }
  }

  const statusBadge =
    L.attendanceStatus === 'LOCKED' ? (
      <Badge variant="muted">
        <Lock className="size-3" /> Đã khóa
      </Badge>
    ) : L.attendanceStatus === 'SUBMITTED' ? (
      <Badge variant="success">Đã xác nhận</Badge>
    ) : L.attendanceStatus === 'DRAFT' ? (
      <Badge variant="warning">Nháp</Badge>
    ) : (
      <Badge variant="muted">Chưa điểm danh</Badge>
    );

  return (
    <div className="mx-auto max-w-4xl pb-28">
      <Button variant="ghost" size="sm" className="mb-3 -ml-2" asChild>
        <Link to={`/diem-danh?date=${L.lessonDate}`}>
          <ArrowLeft /> Buổi học trong ngày
        </Link>
      </Button>

      <Card className="mb-4">
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Link to={`/lop-hoc/${L.classId}`} className="text-lg font-semibold hover:text-primary">
                {L.classCode} – {L.className}
              </Link>
              {statusBadge}
            </div>
            <p className="text-sm text-muted-foreground">
              {WEEKDAY_LABELS[isoWeekday(L.lessonDate)]}, {formatDateVN(L.lessonDate)} · {L.startTime}–{L.endTime} · {L.teacherName}
              {L.roomName && ` · ${L.roomName}`}
            </p>
            {L.submittedAt && (
              <p className="text-xs text-muted-foreground">
                Xác nhận lúc {formatDateTimeVN(L.submittedAt)} bởi {L.submittedBy}
              </p>
            )}
          </div>
          <SaveIndicator state={save} onRetry={() => void flush()} />
        </CardContent>
      </Card>

      {!editable && sheet.blockReason && (
        <Alert variant={L.attendanceStatus === 'LOCKED' ? 'warning' : 'info'} className="mb-4">
          <Lock />
          <div className="flex flex-1 flex-wrap items-center justify-between gap-2">
            <span>{sheet.blockReason}</span>
            {sheet.canUnlock && (
              <Button size="sm" variant="outline" onClick={() => setUnlocking(true)}>
                <Unlock /> Mở khóa
              </Button>
            )}
          </div>
        </Alert>
      )}
      {save.kind === 'offline' && (
        <Alert variant="warning" className="mb-4">
          <CloudOff />
          <div className="flex flex-1 flex-wrap items-center justify-between gap-2">
            <span>Mất kết nối — lựa chọn của bạn vẫn được giữ trên trang này.</span>
            <Button size="sm" variant="outline" onClick={() => void flush()}>
              <RefreshCw /> Thử lại
            </Button>
          </div>
        </Alert>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        {STATUS_ORDER.map((s) => (
          <span key={s} className={cn('rounded-md px-2 py-1 font-medium', STATUS_STYLE[s].cell)}>
            {STATUS_STYLE[s].label}: {counts[s]}
          </span>
        ))}
        {counts.unmarked > 0 && <span className="rounded-md bg-secondary px-2 py-1 font-medium">Chưa chọn: {counts.unmarked}</span>}
        <div className="flex-1" />
        {editable && counts.unmarked > 0 && (
          <Button variant="success" onClick={markAllPresent}>
            <CheckCheck /> Tất cả có mặt
          </Button>
        )}
      </div>

      {sheet.students.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">Lớp chưa có học sinh vào ngày này.</CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <ol className="divide-y">
            {sheet.students.map((st, idx) => {
              const r = rows.get(st.studentId)!;
              return (
                <li
                  key={st.studentId}
                  tabIndex={0}
                  className="flex flex-col gap-2 px-4 py-3 outline-none focus-visible:bg-accent/60 sm:flex-row sm:items-center"
                  onKeyDown={(e) => {
                    const k = ['1', '2', '3', '4'].indexOf(e.key);
                    if (k >= 0) setRow(st.studentId, { status: STATUS_ORDER[k]! });
                    if (e.key === 'ArrowDown') (e.currentTarget.nextElementSibling as HTMLElement | null)?.focus();
                    if (e.key === 'ArrowUp') (e.currentTarget.previousElementSibling as HTMLElement | null)?.focus();
                  }}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <span className="w-6 text-right text-sm text-muted-foreground">{idx + 1}</span>
                    <div className="min-w-0">
                      <Link to={`/hoc-sinh/${st.studentId}`} className="font-medium hover:text-primary">
                        {st.fullName}
                      </Link>
                      <div className="font-mono text-xs text-muted-foreground">{st.studentCode}</div>
                    </div>
                  </div>
                  <div className="flex w-full flex-col gap-1.5 sm:w-auto sm:flex-row sm:items-center">
                    <div className="grid grid-cols-4 gap-1.5 sm:flex" role="radiogroup" aria-label={`Trạng thái ${st.fullName}`}>
                      {STATUS_ORDER.map((s) => (
                        <button
                          key={s}
                          type="button"
                          role="radio"
                          aria-checked={r.status === s}
                          aria-label={STATUS_STYLE[s].label}
                          title={STATUS_STYLE[s].label}
                          disabled={!editable}
                          onClick={() => setRow(st.studentId, { status: s })}
                          className={cn(
                            'h-12 rounded-lg border px-1 text-sm font-medium transition-colors disabled:cursor-not-allowed sm:h-10 sm:min-w-[4.5rem] sm:px-3',
                            r.status === s ? STATUS_STYLE[s].on : 'border-input bg-background hover:bg-accent disabled:opacity-60',
                          )}
                        >
                          <span className="sm:hidden">{STATUS_STYLE[s].mobile}</span>
                          <span className="hidden sm:inline">{STATUS_STYLE[s].label}</span>
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-1.5">
                      {r.status === 'LATE' && (
                        <Input
                          type="number"
                          min={1}
                          max={240}
                          placeholder="Số phút muộn"
                          aria-label="Số phút đi muộn"
                          disabled={!editable}
                          className="h-11 flex-1 sm:h-10 sm:w-24 sm:flex-none"
                          value={r.lateMinutes ?? ''}
                          onChange={(e) => setRow(st.studentId, { lateMinutes: e.target.value ? Math.min(240, Math.max(1, Number(e.target.value))) : null })}
                        />
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-11 sm:size-10"
                        aria-label="Ghi chú"
                        disabled={!editable && !r.note}
                        onClick={() => setNoteOpen((s) => new Set(s).add(st.studentId))}
                      >
                        <MessageSquarePlus className={cn(r.note && 'text-primary')} />
                      </Button>
                    </div>
                  </div>
                  {(noteOpen.has(st.studentId) || r.note) && (
                    <Input
                      placeholder="Ghi chú (VD: kẹt xe, ốm…)"
                      className="sm:hidden"
                      disabled={!editable}
                      value={r.note ?? ''}
                      onChange={(e) => setRow(st.studentId, { note: e.target.value || null })}
                    />
                  )}
                  {(noteOpen.has(st.studentId) || r.note) && (
                    <Input
                      placeholder="Ghi chú"
                      className="hidden w-44 sm:block"
                      disabled={!editable}
                      value={r.note ?? ''}
                      onChange={(e) => setRow(st.studentId, { note: e.target.value || null })}
                    />
                  )}
                </li>
              );
            })}
          </ol>
        </Card>
      )}
      {editable && <p className="mt-2 text-xs text-muted-foreground">Mẹo: chọn một dòng rồi bấm phím 1–4 để chọn nhanh, ↑↓ để chuyển dòng. Thay đổi được tự lưu nháp.</p>}

      <div className="mt-6">
        <Button variant="outline" size="sm" onClick={() => setShowHistory((v) => !v)}>
          <History /> {showHistory ? 'Ẩn' : 'Xem'} lịch sử chỉnh sửa
        </Button>
        {showHistory && <HistoryPanel lessonId={L.id} />}
      </div>

      {editable && sheet.students.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 px-4 py-3 backdrop-blur md:left-60">
          <div className="mx-auto flex max-w-4xl items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">
              {counts.unmarked ? `Còn ${counts.unmarked} học sinh chưa chọn` : 'Đã chọn đủ học sinh'}
            </span>
            <Button size="lg" disabled={counts.unmarked > 0 || submitting} onClick={() => setConfirming(true)}>
              {L.attendanceStatus === 'SUBMITTED' ? 'Xác nhận lại' : 'Xác nhận điểm danh'}
            </Button>
          </div>
        </div>
      )}

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Xác nhận điểm danh</DialogTitle>
            <DialogDescription>
              {L.classCode} · {formatDateVN(L.lessonDate)} {L.startTime}. Vẫn sửa được đến hết ngày học (00:00 hệ thống tự khóa).
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2 text-sm">
            {STATUS_ORDER.map((s) => (
              <div key={s} className={cn('rounded-md px-3 py-2', STATUS_STYLE[s].cell)}>
                {STATUS_STYLE[s].label}: <b>{counts[s]}</b>
              </div>
            ))}
          </div>
          {counts.EXCUSED + counts.UNEXCUSED > 0 && <p className="text-sm text-muted-foreground">Phụ huynh (có tài khoản) của học sinh vắng sẽ nhận được thông báo.</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Xem lại
            </Button>
            <Button onClick={() => void submit()} disabled={submitting}>
              {submitting && <Loader2 className="animate-spin" />} Xác nhận
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DateReasonDialog
        open={unlocking}
        onOpenChange={setUnlocking}
        title="Mở khóa phiên điểm danh"
        description="Phiên sẽ tự khóa lại vào 00:00 tối nay. Lý do được ghi vào lịch sử."
        confirmLabel="Mở khóa"
        onSubmit={async ({ reason }) => {
          await attendanceApi.unlock(L.id, reason);
          applyServer(await reload());
          toast.success('Đã mở khóa');
        }}
      />
    </div>
  );
}

function SaveIndicator({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  if (state.kind === 'saving')
    return (
      <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Đang lưu…
      </span>
    );
  if (state.kind === 'saved')
    return <span className="text-sm text-success">Đã lưu nháp lúc {state.at.toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</span>;
  if (state.kind === 'error')
    return (
      <span className="flex items-center gap-2 text-sm text-destructive">
        {state.message}
        <Button size="sm" variant="outline" onClick={onRetry}>
          Thử lại
        </Button>
      </span>
    );
  return null;
}

const ACTION_LABEL: Record<string, string> = {
  'attendance.mark': 'Điểm danh',
  'attendance.edit': 'Sửa điểm danh',
  'attendance.edit_after_submit': 'Sửa sau khi xác nhận',
  'attendance.submit': 'Xác nhận',
  'attendance.unlock': 'Mở khóa',
};

function HistoryPanel({ lessonId }: { lessonId: number }) {
  const q = useQuery({ queryKey: attendanceKeys.history(lessonId), queryFn: () => attendanceApi.history(lessonId).then((r) => r.data) });
  if (q.isLoading) return <LoadingBlock />;
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => q.refetch()} />;
  return (
    <Card className="mt-3">
      <CardHeader>
        <CardTitle>Lịch sử chỉnh sửa</CardTitle>
      </CardHeader>
      <CardContent>
        {!q.data!.length ? (
          <p className="text-sm text-muted-foreground">Chưa có thao tác nào.</p>
        ) : (
          <ul className="flex flex-col divide-y text-sm">
            {q.data!.map((h) => (
              <li key={h.id} className="py-2.5">
                <div>
                  <b>{ACTION_LABEL[h.action] ?? h.action}</b> · {h.actorName ?? 'Hệ thống'} · <span className="text-muted-foreground">{formatDateTimeVN(h.createdAt)}</span>
                </div>
                {h.reason && <div className="text-muted-foreground">Lý do: {h.reason}</div>}
                {h.changes.length > 0 && (
                  <ul className="mt-1 flex flex-wrap gap-1.5">
                    {h.changes.map((c) => (
                      <li key={c.studentId} className="rounded bg-secondary px-2 py-0.5 text-xs">
                        {c.studentName}: {c.from ? `${STATUS_STYLE[c.from].label} → ` : ''}
                        {STATUS_STYLE[c.to].label}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
