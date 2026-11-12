import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { formatDateVN, validateGradeBands, vnDate, type GradeBand } from '@ecm/shared';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { DateInput } from '@/components/ui/date-input';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FormField } from '@/components/common/form-field';
import { EmptyBlock, ErrorBlock, errorMessage, LoadingBlock, PageHeader } from '@/components/common/page';
import { useAuth } from '@/hooks/use-auth';
import { classesApi, classKeys } from '@/services/classes';
import { gradeKeys, gradesApi, type GradingConfig } from '@/services/grades';

export function GradesPage() {
  const { can } = useAuth();
  return (
    <div>
      <PageHeader title="Điểm số" description="Đợt đánh giá theo lớp, nhập điểm theo tiêu chí, điểm trung bình theo trọng số và xếp loại" />
      <Tabs defaultValue="list">
        <TabsList>
          <TabsTrigger value="list">Đợt đánh giá</TabsTrigger>
          {can('grading.config') && <TabsTrigger value="config">Cấu hình</TabsTrigger>}
        </TabsList>
        <TabsContent value="list">
          <AssessmentsTab />
        </TabsContent>
        {can('grading.config') && (
          <TabsContent value="config">
            <ConfigTab />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

function AssessmentsTab() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const classes = useQuery({ queryKey: classKeys.list({ status: 'ALL', for: 'grades' }), queryFn: () => classesApi.list({ status: 'ALL' }).then((r) => r.data) });
  const classId = Number(params.get('classId') || classes.data?.find((c) => c.status === 'OPEN')?.id || classes.data?.[0]?.id || 0);
  const list = useQuery({ queryKey: gradeKeys.list(classId), queryFn: () => gradesApi.list(classId).then((r) => r.data), enabled: !!classId });
  const [creating, setCreating] = useState(false);
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: (id: number) => gradesApi.remove(id),
    onSuccess: () => (qc.invalidateQueries({ queryKey: ['assessments'] }), toast.success('Đã xóa đợt đánh giá')),
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (classes.isLoading) return <LoadingBlock />;
  if (!classes.data?.length) return <EmptyBlock title="Chưa có lớp học" />;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect className="w-72" value={classId} onChange={(e) => setParams({ classId: e.target.value }, { replace: true })} aria-label="Lớp">
          {classes.data.map((c) => (
            <option key={c.id} value={c.id}>
              {c.classCode} – {c.name}
            </option>
          ))}
        </NativeSelect>
        <div className="flex-1" />
        {can('grades.write') && (
          <Button onClick={() => setCreating(true)}>
            <Plus /> Tạo đợt đánh giá
          </Button>
        )}
      </div>
      {list.isLoading ? (
        <LoadingBlock />
      ) : list.isError ? (
        <ErrorBlock error={list.error} onRetry={() => list.refetch()} />
      ) : !list.data!.length ? (
        <Card>
          <EmptyBlock title="Lớp chưa có đợt đánh giá" description="Tạo đợt đánh giá (theo buổi, định kỳ, kiểm tra tháng, cuối khóa) để nhập điểm." />
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ngày</TableHead>
                <TableHead>Đợt đánh giá</TableHead>
                <TableHead>Loại</TableHead>
                <TableHead className="text-center">Đã chấm</TableHead>
                <TableHead className="text-center">TB lớp</TableHead>
                <TableHead>Trạng thái</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data!.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>{formatDateVN(a.assessedOn)}</TableCell>
                  <TableCell>
                    <Link to={`/diem-so/${a.id}`} className="font-medium hover:text-primary">
                      {a.title}
                    </Link>
                  </TableCell>
                  <TableCell>{a.typeName}</TableCell>
                  <TableCell className="text-center">{a.gradedStudents}</TableCell>
                  <TableCell className="text-center tabular-nums">{a.classAverage === null ? '—' : String(a.classAverage).replace('.', ',')}</TableCell>
                  <TableCell>
                    <Badge variant={a.status === 'PUBLISHED' ? 'success' : 'warning'}>{a.status === 'PUBLISHED' ? 'Đã công bố' : 'Nháp'}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" asChild>
                      <Link to={`/diem-so/${a.id}`}>{a.status === 'PUBLISHED' ? 'Xem' : 'Nhập điểm'}</Link>
                    </Button>
                    {a.status === 'DRAFT' && a.gradedStudents === 0 && can('grades.write') && (
                      <Button variant="ghost" size="icon" aria-label="Xóa đợt" onClick={() => window.confirm(`Xóa đợt "${a.title}"?`) && remove.mutate(a.id)}>
                        <Trash2 className="text-destructive" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <CreateSheet classId={classId} open={creating} onOpenChange={setCreating} />
    </div>
  );
}

function CreateSheet({ classId, open, onOpenChange }: { classId: number; open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate();
  const cfg = useQuery({ queryKey: gradeKeys.config, queryFn: gradesApi.config, enabled: open });
  const [typeId, setTypeId] = useState('');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(vnDate());
  const [error, setError] = useState<string | null>(null);
  const types = (cfg.data?.types ?? []).filter((t) => t.isActive);
  const tid = typeId || String(types.find((t) => t.code === 'LESSON')?.id ?? types[0]?.id ?? '');
  const create = useMutation({
    mutationFn: () => gradesApi.create({ classId, assessmentTypeId: Number(tid), title: title.trim(), assessedOn: date }),
    onSuccess: (r) => navigate(`/diem-so/${r.id}`),
    onError: (e) => setError(errorMessage(e)),
  });
  const type = types.find((t) => String(t.id) === tid);
  return (
    <Sheet open={open} onOpenChange={(o) => (setError(null), onOpenChange(o))}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Tạo đợt đánh giá</SheetTitle>
        </SheetHeader>
        {error && <Alert variant="destructive">{error}</Alert>}
        <FormField label="Loại đánh giá" htmlFor="as-type" required>
          <NativeSelect id="as-type" value={tid} onChange={(e) => setTypeId(e.target.value)}>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        {type && cfg.data && (
          <p className="-mt-2 text-xs text-muted-foreground">
            Tiêu chí: {cfg.data.criteria.filter((c) => type.criteriaIds.includes(c.id) && c.isActive).map((c) => c.name).join(', ')}
          </p>
        )}
        <FormField label="Tên đợt" htmlFor="as-title" required>
          <Input id="as-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="VD: Kiểm tra tháng 11/2026" />
        </FormField>
        <FormField label="Ngày đánh giá" htmlFor="as-date" required>
          <DateInput id="as-date" value={date} max={vnDate()} onChange={setDate} />
        </FormField>
        <p className="text-xs text-muted-foreground">Cấu hình tiêu chí, trọng số và thang xếp loại hiện tại được lưu cùng đợt này — thay đổi cấu hình sau này không ảnh hưởng kết quả của đợt.</p>
        <SheetFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Hủy
          </Button>
          <Button disabled={!tid || title.trim().length < 2 || !date || create.isPending} onClick={() => (setError(null), create.mutate())}>
            {create.isPending && <Loader2 className="animate-spin" />} Tạo và nhập điểm
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ───────────── Cấu hình ─────────────

function ConfigTab() {
  const q = useQuery({ queryKey: gradeKeys.config, queryFn: gradesApi.config });
  if (q.isLoading) return <LoadingBlock />;
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => q.refetch()} />;
  return (
    <div className="grid gap-6 xl:grid-cols-2" key={JSON.stringify(q.data)}>
      <CriteriaEditor cfg={q.data!} />
      <div className="flex flex-col gap-6">
        <BandsEditor bands={q.data!.bands} />
        <TypesEditor cfg={q.data!} />
      </div>
    </div>
  );
}

function CriteriaEditor({ cfg }: { cfg: GradingConfig }) {
  const qc = useQueryClient();
  const [rows, setRows] = useState(cfg.criteria.map((c) => ({ ...c, weight: String(c.weight).replace('.', ','), maxScore: String(c.maxScore).replace('.', ',') })));
  const [error, setError] = useState<string | null>(null);
  const set = (i: number, p: Partial<(typeof rows)[number]>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const save = useMutation({
    mutationFn: () =>
      gradesApi.saveCriteria(
        rows.map((r, i) => ({
          ...(r.id > 0 ? { id: r.id } : { code: r.code }),
          name: r.name.trim(),
          weight: Number(r.weight.replace(',', '.')),
          maxScore: Number(r.maxScore.replace(',', '.')),
          isActive: r.isActive,
          sortOrder: i + 1,
        })),
      ),
    onSuccess: () => (qc.invalidateQueries({ queryKey: gradeKeys.config }), toast.success('Đã lưu tiêu chí')),
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Tiêu chí, trọng số, thang điểm</CardTitle>
        <p className="text-sm text-muted-foreground">Chỉ áp dụng cho đợt đánh giá tạo sau khi lưu. Không xóa tiêu chí — tắt "Đang dùng" để ngừng.</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error && <Alert variant="destructive">{error}</Alert>}
        <div className="grid grid-cols-[1fr_80px_80px_70px] gap-2 text-xs font-semibold uppercase text-muted-foreground">
          <span>Tiêu chí</span>
          <span>Trọng số</span>
          <span>Điểm tối đa</span>
          <span>Đang dùng</span>
        </div>
        {rows.map((r, i) => (
          <div key={r.id} className="grid grid-cols-[1fr_80px_80px_70px] items-center gap-2">
            <Input value={r.name} onChange={(e) => set(i, { name: e.target.value })} aria-label="Tên tiêu chí" />
            <Input inputMode="decimal" value={r.weight} onChange={(e) => set(i, { weight: e.target.value })} aria-label={`Trọng số ${r.name}`} />
            <Input inputMode="decimal" value={r.maxScore} onChange={(e) => set(i, { maxScore: e.target.value })} aria-label={`Điểm tối đa ${r.name}`} />
            <Checkbox checked={r.isActive} onCheckedChange={(c) => set(i, { isActive: c === true })} aria-label={`Đang dùng ${r.name}`} />
          </div>
        ))}
        <div className="flex justify-between">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRows((r) => [...r, { id: -Date.now(), code: `TC_${Date.now().toString(36).toUpperCase()}`, name: '', weight: '1', maxScore: '10', isActive: true, sortOrder: r.length + 1 }])}
          >
            <Plus /> Thêm tiêu chí
          </Button>
          <Button size="sm" disabled={save.isPending || rows.some((r) => !r.name.trim())} onClick={() => (setError(null), save.mutate())}>
            {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} Lưu tiêu chí
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function BandsEditor({ bands }: { bands: GradeBand[] }) {
  const qc = useQueryClient();
  const [rows, setRows] = useState(bands.map((b) => ({ min: String(b.min).replace('.', ','), label: b.label })));
  const parsed = rows.map((r) => ({ min: Number(r.min.replace(',', '.')), label: r.label.trim() }));
  const err = parsed.some((p) => Number.isNaN(p.min)) ? 'Ngưỡng phải là số' : validateGradeBands(parsed);
  const save = useMutation({
    mutationFn: () => gradesApi.saveBands(parsed),
    onSuccess: () => (qc.invalidateQueries({ queryKey: gradeKeys.config }), toast.success('Đã lưu thang xếp loại')),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Thang xếp loại (thang 10)</CardTitle>
        <p className="text-sm text-muted-foreground">Mỗi mức áp dụng khi điểm TB ≥ ngưỡng. Phải có mức bắt đầu từ 0.</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-6 text-sm text-muted-foreground">≥</span>
            <Input className="w-20" inputMode="decimal" value={r.min} onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, min: e.target.value } : y)))} aria-label="Ngưỡng" />
            <Input value={r.label} onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)))} aria-label="Nhãn xếp loại" />
            <Button variant="ghost" size="icon" disabled={rows.length <= 2} onClick={() => setRows((x) => x.filter((_, j) => j !== i))} aria-label="Bỏ mức">
              <Trash2 className="text-destructive" />
            </Button>
          </div>
        ))}
        {err && <p className="text-sm text-destructive">{err}</p>}
        <div className="flex justify-between">
          <Button variant="outline" size="sm" disabled={rows.length >= 10} onClick={() => setRows((x) => [...x, { min: '', label: '' }])}>
            <Plus /> Thêm mức
          </Button>
          <Button size="sm" disabled={!!err || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} Lưu thang xếp loại
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function TypesEditor({ cfg }: { cfg: GradingConfig }) {
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (p: { id: number; criteriaIds: number[] }) => gradesApi.updateType(p.id, { criteriaIds: p.criteriaIds }),
    onSuccess: () => (qc.invalidateQueries({ queryKey: gradeKeys.config }), toast.success('Đã lưu')),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const active = cfg.criteria.filter((c) => c.isActive);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Tiêu chí theo loại đánh giá</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {cfg.types.map((t) => (
          <div key={t.id}>
            <div className="mb-1.5 text-sm font-medium">{t.name}</div>
            <div className="flex flex-wrap gap-3">
              {active.map((c) => (
                <label key={c.id} className="flex items-center gap-1.5 text-sm">
                  <Checkbox
                    checked={t.criteriaIds.includes(c.id)}
                    disabled={save.isPending}
                    onCheckedChange={(v) => {
                      const ids = v === true ? [...t.criteriaIds, c.id] : t.criteriaIds.filter((x) => x !== c.id);
                      if (!ids.length) return toast.error('Cần ít nhất một tiêu chí');
                      save.mutate({ id: t.id, criteriaIds: ids });
                    }}
                  />
                  {c.name}
                </label>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
