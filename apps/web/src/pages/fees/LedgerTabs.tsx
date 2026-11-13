import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Download, Loader2, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { formatDateVN, formatVnd, isoWeekday, PAYMENT_METHOD_LABELS, vnDate, WEEKDAY_LABELS } from '@ecm/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { DateInput } from '@/components/ui/date-input';
import { NativeSelect } from '@/components/ui/native-select';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FormField } from '@/components/common/form-field';
import { EmptyBlock, ErrorBlock, errorMessage, LoadingBlock } from '@/components/common/page';
import { useAuth } from '@/hooks/use-auth';
import { formatDateTimeVN } from '@/lib/format';
import { cn } from '@/lib/utils';
import { feeKeys, feesApi, type LedgerEntry } from '@/services/fees';
import { downloadDailyXlsx, downloadLedgerXlsx, entryLabel } from './exportLedger';

const monthStart = () => vnDate().slice(0, 8) + '01';

function Tile({ label, value, tone, big }: { label: string; value: string; tone: string; big?: boolean }) {
  return (
    <div className={cn('rounded-lg px-4 py-3', tone)}>
      <div className="text-xs">{label}</div>
      <div className={cn('font-semibold tabular-nums', big ? 'text-2xl' : 'text-lg')}>{value}</div>
    </div>
  );
}

function useExport() {
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error(`Không xuất được Excel: ${errorMessage(e)}`);
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

/** Sổ thu: phiếu thu (+) ghi theo ngày thu, bút toán đảo (−) ghi theo ngày duyệt; số nổi bật là thực thu. */
export function LedgerTab({ initialFrom, initialTo }: { initialFrom?: string; initialTo?: string }) {
  const { can } = useAuth();
  const [from, setFrom] = useState(initialFrom ?? monthStart());
  const [to, setTo] = useState(initialTo ?? vnDate());
  const [method, setMethod] = useState('');
  const [hideCancelled, setHideCancelled] = useState(false);
  const exp = useExport();
  const q = useQuery({ queryKey: feeKeys.payments({ from, to, method }), queryFn: () => feesApi.payments({ from, to, method: method || undefined }), enabled: !!from && !!to && from <= to });

  const visible = (q.data?.data ?? []).filter((e) => {
    if (!hideCancelled) return true;
    if (e.kind === 'RECEIPT') return e.status === 'ACTIVE';
    return e.type !== 'VOID' && !(q.data?.data ?? []).some((r) => r.kind === 'RECEIPT' && r.invoiceId === e.invoiceId && r.status === 'REVERSED');
  });
  const sum = q.data?.summary;

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
        <label className="mb-2 flex items-center gap-2 text-sm">
          <Checkbox checked={hideCancelled} onCheckedChange={(c) => setHideCancelled(c === true)} /> Ẩn các phiếu đã hủy / đã đảo
        </label>
        {q.data && (
          <Button variant="outline" className="ml-auto" disabled={exp.busy || !q.data.data.length} onClick={() => exp.run(() => downloadLedgerXlsx(q.data!.data, { from, to }, q.data!.summary))}>
            {exp.busy ? <Loader2 className="animate-spin" /> : <Download />} Xuất Excel
          </Button>
        )}
      </div>
      {q.isLoading ? (
        <LoadingBlock />
      ) : q.isError ? (
        <ErrorBlock error={q.error} onRetry={() => q.refetch()} />
      ) : sum ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Tile label="Thực thu" value={formatVnd(sum.net)} tone="bg-success-soft text-green-900 lg:col-span-1" big />
            <Tile label={`Phiếu thu (${sum.receiptCount} phiếu)`} value={formatVnd(sum.receipts)} tone="bg-secondary" />
            <Tile label="Hoàn / hủy / điều chỉnh" value={formatVnd(sum.adjustments)} tone={sum.adjustments ? 'bg-danger-soft text-red-800' : 'bg-secondary'} />
            <Tile label="Tiền mặt thực thu" value={formatVnd(sum.byMethod.CASH ?? 0)} tone="bg-secondary" />
            <Tile label="Chuyển khoản thực thu" value={formatVnd(sum.byMethod.BANK_TRANSFER ?? 0)} tone="bg-secondary" />
          </div>
          <Card className="overflow-hidden p-0">
            {!visible.length ? (
              <EmptyBlock title="Không có giao dịch" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Thời điểm</TableHead>
                    <TableHead>Chứng từ</TableHead>
                    <TableHead>Học sinh</TableHead>
                    <TableHead>Hóa đơn</TableHead>
                    <TableHead>Phương thức</TableHead>
                    <TableHead className="text-right">Số tiền</TableHead>
                    <TableHead>Người thu / duyệt</TableHead>
                    {can('fees.write') && <TableHead />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((e) => (
                    <LedgerRow key={`${e.kind}-${e.id}`} e={e} canWrite={can('fees.write')} />
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

function LedgerRow({ e, canWrite }: { e: LedgerEntry; canWrite: boolean }) {
  const struck = e.kind === 'RECEIPT' && e.status !== 'ACTIVE';
  return (
    <TableRow className={cn(e.kind === 'ADJUSTMENT' && 'bg-danger-soft/40', struck && 'text-muted-foreground')} data-testid={`ledger-${e.kind.toLowerCase()}`}>
      <TableCell className="whitespace-nowrap text-sm">{formatDateTimeVN(e.at)}</TableCell>
      <TableCell>
        {e.kind === 'RECEIPT' ? (
          <Link to={`/hoc-phi/phieu-thu/${e.id}`} className={cn('font-mono text-xs hover:text-primary', struck && 'line-through')}>
            {e.code}
          </Link>
        ) : (
          <span className="font-mono text-xs">{e.code}</span>
        )}
        <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs">
          {e.kind === 'ADJUSTMENT' ? (
            <span className="text-red-700" title={e.reason}>
              {entryLabel(e)}
            </span>
          ) : e.status === 'VOIDED' ? (
            <Badge variant="muted">Đã hủy</Badge>
          ) : e.status === 'REVERSED' ? (
            <Badge variant="muted">Đã đảo</Badge>
          ) : null}
          {e.kind === 'RECEIPT' && e.invoiceCancelled && <Badge variant="danger">HĐ đã hủy</Badge>}
        </div>
      </TableCell>
      <TableCell>{e.studentName}</TableCell>
      <TableCell>
        <Link to={`/hoc-phi/hoa-don/${e.invoiceId}`} className="whitespace-nowrap font-mono text-xs text-primary underline-offset-2 hover:underline">
          {e.invoiceCode}
        </Link>
      </TableCell>
      <TableCell>{PAYMENT_METHOD_LABELS[e.method]}</TableCell>
      <TableCell className={cn('whitespace-nowrap text-right tabular-nums', e.amount < 0 && 'text-red-700', struck && 'line-through')}>{formatVnd(e.amount)}</TableCell>
      <TableCell className="text-sm">
        {e.actor}
        {e.kind === 'ADJUSTMENT' && <div className="max-w-56 truncate text-xs text-muted-foreground">{e.reason}</div>}
      </TableCell>
      {canWrite && (
        <TableCell className="text-right">
          {e.kind === 'RECEIPT' && e.status === 'ACTIVE' && (
            <Button variant="ghost" size="sm" asChild>
              <Link to={`/hoc-phi/hoa-don/${e.invoiceId}?huy=${e.id}`}>
                <Pencil /> Hủy / sửa
              </Link>
            </Button>
          )}
        </TableCell>
      )}
    </TableRow>
  );
}

/** Tổng hợp thu theo từng ngày (giờ VN); bấm một ngày để mở Sổ thu của ngày đó. */
export function DailyTab({ onOpenDay }: { onOpenDay: (day: string) => void }) {
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(vnDate());
  const [onlyActive, setOnlyActive] = useState(false);
  const exp = useExport();
  const valid = !!from && !!to && from <= to;
  const q = useQuery({ queryKey: feeKeys.daily({ from, to }), queryFn: () => feesApi.dailyCollections({ from, to }), enabled: valid });
  const rows = (q.data?.data ?? []).filter((r) => !onlyActive || r.receiptCount || r.adjustmentCount);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-2">
        <FormField label="Từ ngày" htmlFor="dl-from" className="w-40">
          <DateInput id="dl-from" value={from} onChange={setFrom} />
        </FormField>
        <FormField label="Đến ngày" htmlFor="dl-to" className="w-40">
          <DateInput id="dl-to" value={to} onChange={setTo} />
        </FormField>
        <label className="mb-2 flex items-center gap-2 text-sm">
          <Checkbox checked={onlyActive} onCheckedChange={(c) => setOnlyActive(c === true)} /> Chỉ hiện ngày có phát sinh
        </label>
        {q.data && (
          <Button variant="outline" className="ml-auto" disabled={exp.busy} onClick={() => exp.run(() => downloadDailyXlsx(q.data!.data, { from, to }, q.data!.totals))}>
            {exp.busy ? <Loader2 className="animate-spin" /> : <Download />} Xuất Excel
          </Button>
        )}
      </div>
      {!valid ? (
        <p className="text-sm text-destructive">Khoảng ngày không hợp lệ</p>
      ) : q.isLoading ? (
        <LoadingBlock />
      ) : q.isError ? (
        <ErrorBlock error={q.error} onRetry={() => q.refetch()} />
      ) : q.data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label="Thực thu trong kỳ" value={formatVnd(q.data.totals.net)} tone="bg-success-soft text-green-900" big />
            <Tile label="Tiền mặt thực thu" value={formatVnd(q.data.totals.cashNet)} tone="bg-secondary" />
            <Tile label={`Phiếu thu (${q.data.totals.receiptCount})`} value={formatVnd(q.data.totals.cash + q.data.totals.bank + q.data.totals.other)} tone="bg-secondary" />
            <Tile label="Hoàn / hủy / điều chỉnh" value={formatVnd(q.data.totals.adjustments)} tone={q.data.totals.adjustments ? 'bg-danger-soft text-red-800' : 'bg-secondary'} />
          </div>
          <Card className="overflow-hidden p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ngày</TableHead>
                  <TableHead className="text-right">Số phiếu</TableHead>
                  <TableHead className="text-right">Tiền mặt</TableHead>
                  <TableHead className="text-right">Chuyển khoản</TableHead>
                  <TableHead className="text-right">Khác</TableHead>
                  <TableHead className="text-right">Hoàn / đảo</TableHead>
                  <TableHead className="text-right">Tiền mặt thực thu</TableHead>
                  <TableHead className="text-right">Thực thu</TableHead>
                  <TableHead className="text-right">Lũy kế</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const empty = !r.receiptCount && !r.adjustmentCount;
                  return (
                    <TableRow
                      key={r.day}
                      data-testid="daily-row"
                      className={cn(empty ? 'text-muted-foreground' : 'cursor-pointer hover:bg-accent/50')}
                      onClick={() => !empty && onOpenDay(r.day)}
                      title={empty ? undefined : 'Xem sổ thu ngày này'}
                    >
                      <TableCell className="whitespace-nowrap">
                        {WEEKDAY_LABELS[isoWeekday(r.day)]}, {formatDateVN(r.day)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{r.receiptCount || ''}</TableCell>
                      <Money v={r.cash} />
                      <Money v={r.bank} />
                      <Money v={r.other} />
                      <Money v={r.adjustments} />
                      <Money v={r.cashNet} />
                      <TableCell className="text-right font-semibold tabular-nums">{empty ? '' : formatVnd(r.net)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{formatVnd(r.runningNet)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
              <TableFooter>
                <TableRow className="font-semibold">
                  <TableCell>Tổng</TableCell>
                  <TableCell className="text-right tabular-nums">{q.data.totals.receiptCount}</TableCell>
                  <Money v={q.data.totals.cash} always />
                  <Money v={q.data.totals.bank} always />
                  <Money v={q.data.totals.other} always />
                  <Money v={q.data.totals.adjustments} always />
                  <Money v={q.data.totals.cashNet} always />
                  <TableCell className="text-right tabular-nums">{formatVnd(q.data.totals.net)}</TableCell>
                  <TableCell />
                </TableRow>
              </TableFooter>
            </Table>
          </Card>
        </>
      ) : null}
    </div>
  );
}

function Money({ v, always }: { v: number; always?: boolean }) {
  return <TableCell className={cn('text-right tabular-nums', v < 0 && 'text-red-700')}>{v || always ? formatVnd(v) : ''}</TableCell>;
}
