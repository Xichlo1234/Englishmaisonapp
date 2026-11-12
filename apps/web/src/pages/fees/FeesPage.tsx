import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, FilePlus2, Loader2, Pencil, Plus, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  addDays,
  ADJUSTMENT_TYPE_LABELS,
  BILLING_TYPE_LABELS,
  formatDateVN,
  formatVnd,
  INVOICE_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  vnDate,
} from '@ecm/shared';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { DateInput } from '@/components/ui/date-input';
import { Input } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { NativeSelect } from '@/components/ui/native-select';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FormField } from '@/components/common/form-field';
import { EmptyBlock, ErrorBlock, errorMessage, LoadingBlock, PageHeader } from '@/components/common/page';
import { useAuth } from '@/hooks/use-auth';
import { useDebounced } from '@/hooks/use-debounce';
import { usePublicSettings } from '@/hooks/use-settings';
import { formatDateTimeVN } from '@/lib/format';
import { cn } from '@/lib/utils';
import { feeKeys, feesApi, INVOICE_VARIANT, type FeePlan } from '@/services/fees';

export function FeesPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'invoices';
  const pending = useQuery({ queryKey: feeKeys.adjustments('PENDING'), queryFn: () => feesApi.adjustments('PENDING').then((r) => r.data) });
  return (
    <div>
      <PageHeader title="Học phí" description="Hóa đơn theo kỳ, thu tiền, sổ thu và điều chỉnh có duyệt. Giao dịch đã ghi không sửa/xóa." />
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v }, { replace: true })}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="invoices">Công nợ</TabsTrigger>
          {can('fees.write') && <TabsTrigger value="generate">Tạo hóa đơn kỳ</TabsTrigger>}
          <TabsTrigger value="ledger">Sổ thu</TabsTrigger>
          <TabsTrigger value="adjustments">
            Điều chỉnh
            {!!pending.data?.length && <span className="ml-1 rounded-full bg-destructive px-1.5 text-[11px] text-white">{pending.data.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="plans">Gói học phí</TabsTrigger>
        </TabsList>
        <TabsContent value="invoices">
          <InvoicesTab />
        </TabsContent>
        {can('fees.write') && (
          <TabsContent value="generate">
            <GenerateTab />
          </TabsContent>
        )}
        <TabsContent value="ledger">
          <LedgerTab />
        </TabsContent>
        <TabsContent value="adjustments">
          <AdjustmentsTab />
        </TabsContent>
        <TabsContent value="plans">
          <PlansTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className={cn('rounded-lg px-4 py-3', tone)}>
      <div className="text-xs">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function InvoicesTab() {
  const [status, setStatus] = useState('OUTSTANDING');
  const [period, setPeriod] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q.trim(), 300);
  const f = { status, period: period || undefined, q: dq || undefined, page, pageSize: 50 };
  const list = useQuery({ queryKey: feeKeys.invoices(f), queryFn: () => feesApi.invoices(f), placeholderData: keepPreviousData });
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(Number(vnDate().slice(0, 4)), Number(vnDate().slice(5, 7)) - 1 - i + 1, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  });
  return (
    <div className="flex flex-col gap-4">
      {list.data && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Tile label="Phải thu (theo bộ lọc)" value={formatVnd(list.data.summary.due)} tone="bg-accent text-accent-foreground" />
          <Tile label="Đã thu" value={formatVnd(list.data.summary.paid)} tone="bg-success-soft text-green-900" />
          <Tile label="Còn thiếu" value={formatVnd(list.data.summary.remaining)} tone={list.data.summary.remaining ? 'bg-warning-soft text-yellow-900' : 'bg-secondary'} />
        </div>
      )}
      <Card className="grid gap-3 p-4 sm:grid-cols-[1fr_200px_160px]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} placeholder="Tìm học sinh, mã HS, mã hóa đơn…" className="pl-8" aria-label="Tìm hóa đơn" />
        </div>
        <NativeSelect value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))} aria-label="Trạng thái">
          <option value="OUTSTANDING">Còn nợ (chưa/một phần/quá hạn)</option>
          <option value="OVERDUE">Quá hạn</option>
          <option value="DRAFT">Nháp</option>
          <option value="PAID">Đã thanh toán</option>
          <option value="">Tất cả (trừ đã hủy)</option>
          <option value="CANCELLED">Đã hủy</option>
        </NativeSelect>
        <NativeSelect value={period} onChange={(e) => (setPeriod(e.target.value), setPage(1))} aria-label="Kỳ">
          <option value="">Mọi kỳ</option>
          {months.map((m) => (
            <option key={m} value={m}>
              Tháng {Number(m.slice(5))}/{m.slice(0, 4)}
            </option>
          ))}
        </NativeSelect>
      </Card>
      {list.isLoading ? (
        <LoadingBlock />
      ) : list.isError ? (
        <ErrorBlock error={list.error} onRetry={() => list.refetch()} />
      ) : !list.data!.data.length ? (
        <Card>
          <EmptyBlock title="Không có hóa đơn phù hợp" />
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mã HĐ</TableHead>
                <TableHead>Học sinh</TableHead>
                <TableHead>Kỳ / nội dung</TableHead>
                <TableHead className="text-right">Phải nộp</TableHead>
                <TableHead className="text-right">Đã nộp</TableHead>
                <TableHead className="text-right">Còn thiếu</TableHead>
                <TableHead>Hạn</TableHead>
                <TableHead>Trạng thái</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data!.data.map((i) => (
                <TableRow key={i.id}>
                  <TableCell>
                    <Link to={`/hoc-phi/hoa-don/${i.id}`} className="font-mono text-xs font-medium hover:text-primary">
                      {i.invoiceCode}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link to={`/hoc-sinh/${i.studentId}`} className="hover:text-primary">
                      {i.studentName}
                    </Link>
                    <div className="font-mono text-xs text-muted-foreground">{i.studentCode}</div>
                  </TableCell>
                  <TableCell className="text-sm">{/^\d{4}-\d{2}$/.test(i.periodLabel) ? `Tháng ${Number(i.periodLabel.slice(5))}/${i.periodLabel.slice(0, 4)}` : i.periodLabel}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatVnd(i.amountDue)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatVnd(i.amountPaid)}</TableCell>
                  <TableCell className={cn('text-right font-medium tabular-nums', i.remaining > 0 && 'text-destructive')}>{formatVnd(i.remaining)}</TableCell>
                  <TableCell>{formatDateVN(i.dueDate)}</TableCell>
                  <TableCell>
                    <Badge variant={INVOICE_VARIANT[i.status]}>{INVOICE_STATUS_LABELS[i.status]}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {list.data!.total > 50 && (
            <div className="flex items-center justify-between border-t px-4 py-3 text-sm">
              <span className="text-muted-foreground">
                Trang {page}/{Math.ceil(list.data!.total / 50)}
              </span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  Trước
                </Button>
                <Button size="sm" variant="outline" disabled={page * 50 >= list.data!.total} onClick={() => setPage(page + 1)}>
                  Sau
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function GenerateTab() {
  const qc = useQueryClient();
  const [period, setPeriod] = useState(vnDate().slice(0, 7));
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const drafts = useQuery({ queryKey: feeKeys.invoices({ status: 'DRAFT', period, pageSize: 200 }), queryFn: () => feesApi.invoices({ status: 'DRAFT', period, pageSize: 200 }) });
  const gen = useMutation({
    mutationFn: () => feesApi.generate(period),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['fees'] });
      toast.success(r.created ? `Đã tạo ${r.created} hóa đơn nháp (hạn ${formatDateVN(r.dueDate)})` : 'Không có hóa đơn mới cần tạo cho kỳ này');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const issue = useMutation({
    mutationFn: () => feesApi.issue([...selected]),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['fees'] });
      setSelected(new Set());
      toast.success(`Đã phát hành ${r.issued} hóa đơn`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const rows = drafts.data?.data ?? [];
  const months = [0, 1, 2].map((i) => {
    const d = new Date(Date.UTC(Number(vnDate().slice(0, 4)), Number(vnDate().slice(5, 7)) - 1 + i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  });
  return (
    <div className="flex flex-col gap-4">
      <Alert variant="info">
        <FilePlus2 />
        <span>
          Bước 1: tạo <b>hóa đơn nháp</b> cho học sinh đang học có gói theo tháng. Bước 2: kiểm tra, sửa giảm giá/hạn nếu cần. Bước 3: chọn và <b>phát hành</b>. Gói theo khóa / gói buổi
          tạo hóa đơn ở trang học sinh.
        </span>
      </Alert>
      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect className="w-44" value={period} onChange={(e) => (setPeriod(e.target.value), setSelected(new Set()))} aria-label="Kỳ thu">
          {months.map((m) => (
            <option key={m} value={m}>
              Tháng {Number(m.slice(5))}/{m.slice(0, 4)}
            </option>
          ))}
        </NativeSelect>
        <Button onClick={() => gen.mutate()} disabled={gen.isPending}>
          {gen.isPending ? <Loader2 className="animate-spin" /> : <Plus />} Tạo hóa đơn nháp
        </Button>
        <div className="flex-1" />
        <Button variant="success" disabled={!selected.size || issue.isPending} onClick={() => window.confirm(`Phát hành ${selected.size} hóa đơn?`) && issue.mutate()}>
          {issue.isPending && <Loader2 className="animate-spin" />} Phát hành {selected.size || ''} hóa đơn
        </Button>
      </div>
      {drafts.isLoading ? (
        <LoadingBlock />
      ) : !rows.length ? (
        <Card>
          <EmptyBlock title="Không có hóa đơn nháp trong kỳ" />
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={selected.size === rows.length}
                    onCheckedChange={(c) => setSelected(c === true ? new Set(rows.map((r) => r.id)) : new Set())}
                    aria-label="Chọn tất cả"
                  />
                </TableHead>
                <TableHead>Học sinh</TableHead>
                <TableHead>Nội dung</TableHead>
                <TableHead className="text-right">Phải nộp</TableHead>
                <TableHead>Hạn</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Checkbox
                      checked={selected.has(r.id)}
                      onCheckedChange={(c) => setSelected((s) => (c === true ? new Set(s).add(r.id) : new Set([...s].filter((x) => x !== r.id))))}
                      aria-label={`Chọn ${r.studentName}`}
                    />
                  </TableCell>
                  <TableCell>{r.studentName}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{r.note}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatVnd(r.amountDue)}</TableCell>
                  <TableCell>{formatDateVN(r.dueDate)}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" asChild>
                      <Link to={`/hoc-phi/hoa-don/${r.id}`}>
                        <Pencil /> Kiểm tra
                      </Link>
                    </Button>
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

function LedgerTab() {
  const [from, setFrom] = useState(vnDate().slice(0, 8) + '01');
  const [to, setTo] = useState(vnDate());
  const [method, setMethod] = useState('');
  const q = useQuery({ queryKey: feeKeys.payments({ from, to, method }), queryFn: () => feesApi.payments({ from, to, method: method || undefined }), enabled: !!from && !!to && from <= to });
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-2">
        <FormField label="Từ ngày" htmlFor="lg-from" className="w-40">
          <DateInput id="lg-from" value={from} onChange={setFrom} />
        </FormField>
        <FormField label="Đến ngày" htmlFor="lg-to" className="w-40">
          <DateInput id="lg-to" value={to} onChange={setTo} />
        </FormField>
        <FormField label="Phương thức" htmlFor="lg-m" className="w-40">
          <NativeSelect id="lg-m" value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="">Tất cả</option>
            {Object.entries(PAYMENT_METHOD_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </NativeSelect>
        </FormField>
      </div>
      {q.isLoading ? (
        <LoadingBlock />
      ) : q.isError ? (
        <ErrorBlock error={q.error} onRetry={() => q.refetch()} />
      ) : q.data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <Tile label={`Tổng thu (${q.data.summary.count} phiếu)`} value={formatVnd(q.data.summary.gross)} tone="bg-success-soft text-green-900" />
            {Object.entries(PAYMENT_METHOD_LABELS).map(([k, v]) => (
              <Tile key={k} label={v} value={formatVnd(q.data!.summary.byMethod[k] ?? 0)} tone="bg-secondary" />
            ))}
          </div>
          <p className="text-sm text-muted-foreground">
            Hoàn tiền/điều chỉnh đã duyệt trong kỳ: <b>{formatVnd(q.data.summary.adjustments)}</b> · Thực thu: <b>{formatVnd(q.data.summary.net)}</b>
          </p>
          <Card className="overflow-hidden p-0">
            {!q.data.data.length ? (
              <EmptyBlock title="Không có giao dịch" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Thời gian</TableHead>
                    <TableHead>Mã phiếu</TableHead>
                    <TableHead>Học sinh</TableHead>
                    <TableHead>Hóa đơn</TableHead>
                    <TableHead>Phương thức</TableHead>
                    <TableHead className="text-right">Số tiền</TableHead>
                    <TableHead>Người thu</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {q.data.data.map((p) => (
                    <TableRow key={p.id} className={cn(p.voided && 'text-muted-foreground line-through')}>
                      <TableCell className="whitespace-nowrap text-sm">{formatDateTimeVN(p.paidAt)}</TableCell>
                      <TableCell>
                        <Link to={`/hoc-phi/phieu-thu/${p.id}`} className="font-mono text-xs hover:text-primary">
                          {p.paymentCode}
                        </Link>
                      </TableCell>
                      <TableCell>{p.studentName}</TableCell>
                      <TableCell>
                        <Link to={`/hoc-phi/hoa-don/${p.invoiceId}`} className="font-mono text-xs hover:text-primary">
                          {p.invoiceCode}
                        </Link>
                      </TableCell>
                      <TableCell>{PAYMENT_METHOD_LABELS[p.method]}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatVnd(p.amount)}</TableCell>
                      <TableCell className="text-sm">{p.receivedBy}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
}

function AdjustmentsTab() {
  const { can, user } = useAuth();
  const qc = useQueryClient();
  const [status, setStatus] = useState('PENDING');
  const q = useQuery({ queryKey: feeKeys.adjustments(status || undefined), queryFn: () => feesApi.adjustments(status || undefined).then((r) => r.data) });
  const decide = useMutation({
    mutationFn: (p: { id: number; approve: boolean; note?: string }) => feesApi.decide(p.id, p.approve, p.note),
    onSuccess: (_, p) => (qc.invalidateQueries({ queryKey: ['fees'] }), toast.success(p.approve ? 'Đã duyệt' : 'Đã từ chối')),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="flex flex-col gap-4">
      <NativeSelect className="w-48" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Trạng thái phiếu">
        <option value="PENDING">Chờ duyệt</option>
        <option value="APPROVED">Đã duyệt</option>
        <option value="REJECTED">Đã từ chối</option>
        <option value="">Tất cả</option>
      </NativeSelect>
      {q.isLoading ? (
        <LoadingBlock />
      ) : !q.data?.length ? (
        <Card>
          <EmptyBlock title="Không có phiếu điều chỉnh" />
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mã phiếu</TableHead>
                <TableHead>Loại</TableHead>
                <TableHead>Học sinh / Hóa đơn</TableHead>
                <TableHead className="text-right">Số tiền</TableHead>
                <TableHead>Lý do</TableHead>
                <TableHead>Đề nghị</TableHead>
                <TableHead>Xử lý</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.data.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-mono text-xs">{a.adjustmentCode}</TableCell>
                  <TableCell>{ADJUSTMENT_TYPE_LABELS[a.type]}</TableCell>
                  <TableCell>
                    {a.studentName}
                    <div>
                      <Link to={`/hoc-phi/hoa-don/${a.invoiceId}`} className="font-mono text-xs text-muted-foreground hover:text-primary">
                        {a.invoiceCode}
                      </Link>
                    </div>
                  </TableCell>
                  <TableCell className={cn('text-right tabular-nums', a.amount < 0 ? 'text-destructive' : 'text-success')}>{formatVnd(a.amount)}</TableCell>
                  <TableCell className="max-w-56 text-sm">{a.reason}</TableCell>
                  <TableCell className="text-sm">
                    {a.requestedBy}
                    <div className="text-xs text-muted-foreground">{formatDateTimeVN(a.requestedAt)}</div>
                  </TableCell>
                  <TableCell>
                    {a.status === 'PENDING' ? (
                      can('fees.approve_adjustment') && (
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="success"
                            disabled={decide.isPending}
                            title={a.requestedById === user?.id ? 'Người đề nghị không tự duyệt khi có người duyệt khác' : undefined}
                            onClick={() => window.confirm(`Duyệt ${ADJUSTMENT_TYPE_LABELS[a.type].toLowerCase()} ${formatVnd(a.amount)}?`) && decide.mutate({ id: a.id, approve: true })}
                          >
                            <Check /> Duyệt
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={decide.isPending}
                            onClick={() => {
                              const note = window.prompt('Lý do từ chối');
                              if (note !== null) decide.mutate({ id: a.id, approve: false, note });
                            }}
                          >
                            <X /> Từ chối
                          </Button>
                        </div>
                      )
                    ) : (
                      <div className="text-sm">
                        <Badge variant={a.status === 'APPROVED' ? 'success' : 'muted'}>{a.status === 'APPROVED' ? 'Đã duyệt' : 'Đã từ chối'}</Badge>
                        <div className="text-xs text-muted-foreground">
                          {a.approvedBy} · {formatDateTimeVN(a.approvedAt)}
                        </div>
                      </div>
                    )}
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

function PlansTab() {
  const { can } = useAuth();
  const q = useQuery({ queryKey: feeKeys.plans, queryFn: () => feesApi.plans().then((r) => r.data) });
  const [editing, setEditing] = useState<FeePlan | 'new' | null>(null);
  return (
    <div className="flex flex-col gap-4">
      {can('fees.write') && (
        <Button className="self-start" onClick={() => setEditing('new')}>
          <Plus /> Thêm gói học phí
        </Button>
      )}
      {q.isLoading ? (
        <LoadingBlock />
      ) : !q.data?.length ? (
        <Card>
          <EmptyBlock title="Chưa có gói học phí" description="Tạo gói (theo tháng, theo khóa hoặc gói buổi) rồi gán cho học sinh." />
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {q.data.map((p) => (
            <Card key={p.id} className={cn(!p.isActive && 'opacity-60')}>
              <CardContent className="flex flex-col gap-1">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-mono text-xs text-muted-foreground">{p.code}</div>
                    <div className="font-semibold">{p.name}</div>
                  </div>
                  <Badge variant={p.isActive ? 'default' : 'muted'}>{BILLING_TYPE_LABELS[p.billingType]}</Badge>
                </div>
                <div className="text-xl font-semibold tabular-nums">{formatVnd(p.amount)}</div>
                <div className="text-sm text-muted-foreground">
                  {p.sessionCount ? `${p.sessionCount} buổi · ` : ''}
                  {p.englishLevel ? `${p.englishLevel} · ` : ''}
                  {p.studentCount} học sinh đang áp dụng
                </div>
                {can('fees.write') && (
                  <Button variant="ghost" size="sm" className="self-start" onClick={() => setEditing(p)}>
                    <Pencil /> Sửa
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <PlanSheet plan={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function PlanSheet({ plan, onClose }: { plan: FeePlan | 'new' | null; onClose: () => void }) {
  const qc = useQueryClient();
  const settings = usePublicSettings();
  const p = plan && plan !== 'new' ? plan : null;
  const [key, setKey] = useState<unknown>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<FeePlan['billingType']>('MONTHLY');
  const [amount, setAmount] = useState<number | null>(null);
  const [sessions, setSessions] = useState('');
  const [level, setLevel] = useState('');
  const [active, setActive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  if (plan !== key) {
    setKey(plan);
    setCode(p?.code ?? '');
    setName(p?.name ?? '');
    setType(p?.billingType ?? 'MONTHLY');
    setAmount(p?.amount ?? null);
    setSessions(p?.sessionCount ? String(p.sessionCount) : '');
    setLevel(p?.englishLevel ?? '');
    setActive(p ? !!p.isActive : true);
    setError(null);
  }
  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), amount: amount ?? 0, sessionCount: sessions ? Number(sessions) : null, englishLevel: level || null, isActive: active };
      return p ? feesApi.updatePlan(p.id, body) : feesApi.createPlan({ ...body, code: code.trim(), billingType: type });
    },
    onSuccess: () => (qc.invalidateQueries({ queryKey: ['fees'] }), toast.success('Đã lưu gói học phí'), onClose()),
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Sheet open={!!plan} onOpenChange={(o) => !o && onClose()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{p ? 'Sửa gói học phí' : 'Thêm gói học phí'}</SheetTitle>
        </SheetHeader>
        {error && <Alert variant="destructive">{error}</Alert>}
        <FormField label="Mã gói" htmlFor="fp-code" required hint={p ? 'Không đổi được mã' : 'VD: MOVERS-THANG'}>
          <Input id="fp-code" value={code} disabled={!!p} onChange={(e) => setCode(e.target.value.toUpperCase())} />
        </FormField>
        <FormField label="Tên gói" htmlFor="fp-name" required>
          <Input id="fp-name" value={name} onChange={(e) => setName(e.target.value)} />
        </FormField>
        <FormField label="Hình thức thu" htmlFor="fp-type" required>
          <NativeSelect id="fp-type" value={type} disabled={!!p} onChange={(e) => setType(e.target.value as FeePlan['billingType'])}>
            {Object.entries(BILLING_TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField label="Số tiền" htmlFor="fp-amount" required hint={p ? 'Đổi giá chỉ áp dụng cho hóa đơn tạo sau' : undefined}>
          <MoneyInput id="fp-amount" value={amount} onChange={setAmount} />
        </FormField>
        {type !== 'MONTHLY' && (
          <FormField label="Số buổi" htmlFor="fp-sessions" required={type === 'PER_SESSION'}>
            <Input id="fp-sessions" type="number" min={1} value={sessions} onChange={(e) => setSessions(e.target.value)} />
          </FormField>
        )}
        <FormField label="Áp dụng cho trình độ" htmlFor="fp-level">
          <NativeSelect id="fp-level" value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="">Mọi trình độ</option>
            {(settings.data?.english_levels ?? []).map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        {p && (
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={active} onCheckedChange={(c) => setActive(c === true)} /> Đang áp dụng
          </label>
        )}
        <SheetFooter>
          <Button variant="outline" onClick={onClose}>
            Hủy
          </Button>
          <Button
            disabled={save.isPending || name.trim().length < 2 || !amount || (!p && code.trim().length < 2) || (type === 'PER_SESSION' && !sessions)}
            onClick={() => (setError(null), save.mutate())}
          >
            {save.isPending && <Loader2 className="animate-spin" />} Lưu
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export const defaultDueDate = () => addDays(vnDate(), 7);
