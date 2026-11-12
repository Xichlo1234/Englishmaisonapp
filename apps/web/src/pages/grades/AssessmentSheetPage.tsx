import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, History, Loader2, Lock, Megaphone, Save } from 'lucide-react';
import { toast } from 'sonner';
import { classify, computeWeightedAverage, formatDateVN } from '@ecm/shared';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ErrorBlock, errorMessage, LoadingBlock } from '@/components/common/page';
import { formatDateTimeVN } from '@/lib/format';
import { cn } from '@/lib/utils';
import { bandVariant, gradeKeys, gradesApi, type AssessmentSheet } from '@/services/grades';

export function AssessmentSheetPage() {
  const id = Number(useParams().id);
  const q = useQuery({ queryKey: gradeKeys.sheet(id), queryFn: () => gradesApi.sheet(id), refetchOnWindowFocus: false });
  if (q.isLoading) return <LoadingBlock />;
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => q.refetch()} />;
  return <Grid key={q.dataUpdatedAt} data={q.data!} reload={() => q.refetch()} />;
}

const key = (s: number, c: number) => `${s}:${c}`;
const fmt = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v).replace('.', ','));
/** Chấp nhận "7,5" hoặc "7.5". '' → null. NaN → undefined (không hợp lệ). */
function parseScore(t: string): number | null | undefined {
  const s = t.trim().replace(',', '.');
  if (!s) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return undefined;
  return Number(s);
}

function Grid({ data, reload }: { data: AssessmentSheet; reload: () => unknown }) {
  const qc = useQueryClient();
  const { snapshot, assessment: A } = data;
  const crit = snapshot.criteria;
  const initial = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of data.students) for (const c of crit) m.set(key(s.studentId, c.id), fmt(s.scores[c.id]));
    return m;
  }, [data, crit]);
  const initialComments = useMemo(() => new Map(data.students.map((s) => [s.studentId, s.comment ?? ''])), [data]);
  const [cells, setCells] = useState(initial);
  const [comments, setComments] = useState(initialComments);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const editable = data.canEdit;

  const dirtyCells = [...cells].filter(([k, v]) => initial.get(k) !== v);
  const dirtyComments = [...comments].filter(([sid, v]) => (initialComments.get(sid) ?? '') !== v);
  const invalid = new Set<string>();
  for (const s of data.students)
    for (const c of crit) {
      const v = parseScore(cells.get(key(s.studentId, c.id)) ?? '');
      if (v === undefined || (v !== null && v > c.maxScore)) invalid.add(key(s.studentId, c.id));
    }
  const dirty = dirtyCells.length + dirtyComments.length;

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  async function save() {
    if (invalid.size) return toast.error('Có ô điểm không hợp lệ (tô đỏ). Hãy sửa trước khi lưu.');
    setSaving(true);
    try {
      await gradesApi.save(A.id, {
        grades: dirtyCells.map(([k, v]) => {
          const [sid, cid] = k.split(':').map(Number) as [number, number];
          return { studentId: sid, criterionId: cid, score: parseScore(v) ?? null };
        }),
        comments: dirtyComments.map(([sid, v]) => ({ studentId: sid, comment: v.trim() || null })),
      });
      toast.success('Đã lưu điểm');
      qc.invalidateQueries({ queryKey: ['assessments'] });
      await reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    setPublishing(true);
    try {
      const r = await gradesApi.publish(A.id);
      toast.success(`Đã công bố kết quả${r.notified ? ` · đã gửi ${r.notified} thông báo cho phụ huynh` : ''}`);
      setConfirmPublish(false);
      qc.invalidateQueries({ queryKey: ['assessments'] });
      await reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setPublishing(false);
    }
  }

  /** Enter → ô bên dưới cùng cột (nhập điểm theo cột như bảng tính). */
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>, row: number, col: number) => {
    if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = document.querySelector<HTMLInputElement>(`[data-cell="${row + (e.key === 'ArrowUp' ? -1 : 1)}:${col}"]`);
      next?.focus();
      next?.select();
    }
  };

  const totalWeight = crit.reduce((s, c) => s + c.weight, 0);

  return (
    <div className="pb-24">
      <Button variant="ghost" size="sm" className="mb-3 -ml-2" asChild>
        <Link to={`/diem-so?classId=${A.classId}`}>
          <ArrowLeft /> Đợt đánh giá của lớp {A.classCode}
        </Link>
      </Button>
      <Card className="mb-4">
        <CardContent className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-semibold">{A.title}</h1>
              <Badge variant={A.status === 'PUBLISHED' ? 'success' : 'warning'}>{A.status === 'PUBLISHED' ? 'Đã công bố' : 'Nháp'}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {A.classCode} – {A.className} · {A.typeName} · {formatDateVN(A.assessedOn)}
              {A.publishedAt && ` · công bố ${formatDateTimeVN(A.publishedAt)}`}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Trọng số:{' '}
              {crit.map((c) => `${c.name} ×${c.weight}${c.maxScore !== 10 ? ` (thang ${c.maxScore})` : ''}`).join(' · ')} — điểm TB quy về thang 10, chỉ tính tiêu chí có điểm.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setShowHistory((v) => !v)}>
              <History /> Lịch sử
            </Button>
            {data.canPublish && (
              <Button variant="success" onClick={() => setConfirmPublish(true)} disabled={!!dirty}>
                <Megaphone /> Công bố
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
      {!editable && data.blockReason && (
        <Alert variant="info" className="mb-4">
          <Lock /> {data.blockReason}
        </Alert>
      )}

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-muted">
            <tr className="border-b">
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-muted-foreground">Học sinh</th>
              {crit.map((c) => (
                <th key={c.id} className="px-1 py-2 text-center text-xs font-semibold text-muted-foreground" title={`Trọng số ${c.weight}/${totalWeight}, tối đa ${c.maxScore}`}>
                  {c.name}
                  <div className="font-normal">/{c.maxScore}</div>
                </th>
              ))}
              <th className="px-2 py-2 text-center text-xs font-semibold uppercase text-muted-foreground">TB</th>
              <th className="px-2 py-2 text-left text-xs font-semibold uppercase text-muted-foreground">Xếp loại</th>
              <th className="px-2 py-2 text-left text-xs font-semibold uppercase text-muted-foreground">Nhận xét</th>
            </tr>
          </thead>
          <tbody>
            {data.students.map((s, row) => {
              const scores: Record<number, number | null> = {};
              let bad = false;
              for (const c of crit) {
                const v = parseScore(cells.get(key(s.studentId, c.id)) ?? '');
                if (v === undefined || (v !== null && v > c.maxScore)) bad = true;
                scores[c.id] = v ?? null;
              }
              const avg = bad ? null : computeWeightedAverage(crit, scores);
              const label = classify(avg, snapshot.bands);
              return (
                <tr key={s.studentId} className="border-b last:border-0">
                  <td className="whitespace-nowrap px-3 py-1.5">
                    <Link to={`/hoc-sinh/${s.studentId}`} className="font-medium hover:text-primary">
                      {s.fullName}
                    </Link>
                  </td>
                  {crit.map((c, col) => {
                    const k = key(s.studentId, c.id);
                    const changed = initial.get(k) !== cells.get(k);
                    return (
                      <td key={c.id} className="px-1 py-1.5 text-center">
                        <input
                          data-cell={`${row}:${col}`}
                          inputMode="decimal"
                          aria-label={`${c.name} – ${s.fullName}`}
                          disabled={!editable}
                          value={cells.get(k) ?? ''}
                          onChange={(e) => setCells((m) => new Map(m).set(k, e.target.value))}
                          onKeyDown={(e) => onKey(e, row, col)}
                          onFocus={(e) => e.target.select()}
                          className={cn(
                            'h-9 w-14 rounded-md border border-input bg-background text-center tabular-nums outline-none focus:border-ring focus:ring-2 focus:ring-ring/30 disabled:bg-muted',
                            changed && 'border-primary bg-accent',
                            invalid.has(k) && 'border-destructive bg-danger-soft',
                          )}
                        />
                      </td>
                    );
                  })}
                  <td className="px-2 py-1.5 text-center font-semibold tabular-nums">{avg === null ? '—' : fmt(avg)}</td>
                  <td className="px-2 py-1.5">{label && <Badge variant={bandVariant(label, snapshot.bands)}>{label}</Badge>}</td>
                  <td className="px-2 py-1.5">
                    <input
                      aria-label={`Nhận xét – ${s.fullName}`}
                      disabled={!editable}
                      value={comments.get(s.studentId) ?? ''}
                      onChange={(e) => setComments((m) => new Map(m).set(s.studentId, e.target.value))}
                      placeholder="Nhận xét…"
                      className={cn(
                        'h-9 w-full min-w-48 rounded-md border border-input bg-background px-2 outline-none focus:border-ring focus:ring-2 focus:ring-ring/30 disabled:bg-muted',
                        (initialComments.get(s.studentId) ?? '') !== (comments.get(s.studentId) ?? '') && 'border-primary bg-accent',
                      )}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!data.students.length && <p className="p-6 text-center text-sm text-muted-foreground">Lớp không có học sinh vào ngày đánh giá.</p>}
      </Card>
      {editable && <p className="mt-2 text-xs text-muted-foreground">Nhập điểm như bảng tính: Enter hoặc ↓ để xuống ô dưới, Tab để sang ô phải. Dùng dấu phẩy hoặc chấm cho số thập phân.</p>}

      {showHistory && <HistoryCard id={A.id} />}

      {editable && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 px-4 py-3 backdrop-blur md:left-60">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">{dirty ? `${dirty} thay đổi chưa lưu` : 'Không có thay đổi'}</span>
            <Button size="lg" onClick={() => void save()} disabled={!dirty || saving || invalid.size > 0}>
              {saving ? <Loader2 className="animate-spin" /> : <Save />} Lưu điểm
            </Button>
          </div>
        </div>
      )}

      <Dialog open={confirmPublish} onOpenChange={setConfirmPublish}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Công bố kết quả "{A.title}"</DialogTitle>
            <DialogDescription>
              Phụ huynh và học sinh sẽ xem được điểm và nhận xét. Sau khi công bố, giáo viên không sửa được điểm (quản trị viên vẫn sửa được, có ghi lịch sử).
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmPublish(false)}>
              Hủy
            </Button>
            <Button variant="success" disabled={publishing} onClick={() => void publish()}>
              {publishing && <Loader2 className="animate-spin" />} Công bố
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const ACTIONS: Record<string, string> = {
  'grade.create': 'Nhập điểm',
  'grade.update': 'Sửa điểm',
  'grade.update_after_publish': 'Sửa điểm sau khi công bố',
  'assessment.comment': 'Nhận xét',
  'assessment.publish': 'Công bố',
  'assessment.create': 'Tạo đợt đánh giá',
};

function HistoryCard({ id }: { id: number }) {
  const q = useQuery({ queryKey: gradeKeys.history(id), queryFn: () => gradesApi.history(id).then((r) => r.data) });
  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>Lịch sử thay đổi</CardTitle>
      </CardHeader>
      <CardContent>
        {q.isLoading ? (
          <LoadingBlock />
        ) : (
          <ul className="flex flex-col divide-y text-sm">
            {(q.data ?? []).map((h) => (
              <li key={h.id} className="py-2">
                <b>{ACTIONS[h.action] ?? h.action}</b> · {h.actorName} · <span className="text-muted-foreground">{formatDateTimeVN(h.createdAt)}</span>
                {h.changes.length > 0 && (
                  <ul className="mt-1 flex flex-wrap gap-1.5">
                    {h.changes.map((c, i) => (
                      <li key={i} className="rounded bg-secondary px-2 py-0.5 text-xs">
                        {c.student} – {c.criterion}: {c.from === null ? '' : `${fmt(c.from)} → `}
                        {c.to === null ? '(xóa)' : fmt(c.to)}
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
