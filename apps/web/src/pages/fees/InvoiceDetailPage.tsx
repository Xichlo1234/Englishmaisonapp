import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Ban, Banknote, Loader2, Printer, Save, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { ADJUSTMENT_TYPE_LABELS, formatDateVN, formatVnd, INVOICE_STATUS_LABELS, PAYMENT_METHOD_LABELS, vnDate } from '@ecm/shared';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DateInput } from '@/components/ui/date-input';
import { Input } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { NativeSelect } from '@/components/ui/native-select';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { FormField } from '@/components/common/form-field';
import { ErrorBlock, errorMessage, LoadingBlock } from '@/components/common/page';
import { useAuth } from '@/hooks/use-auth';
import { formatDateTimeVN } from '@/lib/format';
import { cn } from '@/lib/utils';
import { DateReasonDialog } from '@/pages/classes/dialogs';
import { feeKeys, feesApi, INVOICE_VARIANT, type InvoiceDetail } from '@/services/fees';

export function InvoiceDetailPage() {
  const id = Number(useParams().id);
  const q = useQuery({ queryKey: feeKeys.invoice(id), queryFn: () => feesApi.invoice(id) });
  if (q.isLoading) return <LoadingBlock />;
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => q.refetch()} />;
  return <View inv={q.data!} />;
}

function View({ inv }: { inv: InvoiceDetail }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [paying, setPaying] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ['fees'] });
  const canWrite = can('fees.write');
  const open = ['UNPAID', 'PARTIAL', 'OVERDUE'].includes(inv.status);
  const period = /^\d{4}-\d{2}$/.test(inv.period_label) ? `Tháng ${Number(inv.period_label.slice(5))}/${inv.period_label.slice(0, 4)}` : inv.period_label;

  return (
    <div className="max-w-5xl">
      <Button variant="ghost" size="sm" className="mb-3 -ml-2" asChild>
        <Link to="/hoc-phi">
          <ArrowLeft /> Học phí
        </Link>
      </Button>
      <Card className="mb-4">
        <CardContent className="flex flex-col gap-4 md:flex-row md:items-start">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm text-muted-foreground">{inv.invoice_code}</span>
              <Badge variant={INVOICE_VARIANT[inv.status]}>{INVOICE_STATUS_LABELS[inv.status]}</Badge>
            </div>
            <h1 className="mt-1 text-xl font-semibold">
              <Link to={`/hoc-sinh/${inv.student_id}`} className="hover:text-primary">
                {inv.student_name}
              </Link>{' '}
              <span className="text-base font-normal text-muted-foreground">· {period}</span>
            </h1>
            <p className="text-sm text-muted-foreground">
              {inv.plan_name && `${inv.plan_name} · `}
              {inv.sessions_purchased && `${inv.sessions_purchased} buổi · `}Hạn nộp {formatDateVN(inv.due_date)}
              {inv.note && ` · ${inv.note}`}
            </p>
            {inv.status === 'CANCELLED' && <p className="text-sm text-destructive">Đã hủy: {inv.cancel_reason}</p>}
          </div>
          {canWrite && (
            <div className="flex flex-wrap gap-2">
              {open && inv.remaining > 0 && (
                <Button size="lg" onClick={() => setPaying(true)}>
                  <Banknote /> Thu tiền
                </Button>
              )}
              {inv.status !== 'DRAFT' && inv.status !== 'CANCELLED' && (
                <Button variant="outline" onClick={() => setAdjusting(true)}>
                  <Undo2 /> Đề nghị điều chỉnh
                </Button>
              )}
              {inv.status !== 'CANCELLED' && inv.amount_paid === 0 && (
                <Button variant="ghost" onClick={() => setCancelling(true)}>
                  <Ban /> Hủy hóa đơn
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        {[
          ['Học phí', formatVnd(inv.gross_amount), 'bg-secondary'],
          ['Giảm giá', formatVnd(inv.discount_amount), 'bg-secondary'],
          ['Đã nộp', formatVnd(inv.amount_paid), 'bg-success-soft text-green-900'],
          ['Còn thiếu', formatVnd(inv.remaining), inv.remaining > 0 ? 'bg-warning-soft text-yellow-900' : 'bg-success-soft text-green-900'],
        ].map(([l, v, t]) => (
          <div key={l} className={cn('rounded-lg px-4 py-3', t)}>
            <div className="text-xs">{l}</div>
            <div className="text-xl font-semibold tabular-nums">{v}</div>
          </div>
        ))}
      </div>

      {inv.status === 'DRAFT' && canWrite && <DraftEditor inv={inv} onDone={refresh} />}

      <Card className="mb-4 overflow-hidden p-0">
        <CardHeader>
          <CardTitle>Giao dịch thu</CardTitle>
        </CardHeader>
        {!inv.payments.length ? (
          <p className="px-5 pb-5 text-sm text-muted-foreground">Chưa có giao dịch.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mã phiếu</TableHead>
                <TableHead>Thời gian</TableHead>
                <TableHead>Phương thức</TableHead>
                <TableHead className="text-right">Số tiền</TableHead>
                <TableHead>Người thu</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {inv.payments.map((p) => (
                <TableRow key={p.id} className={cn(p.voided && 'text-muted-foreground')}>
                  <TableCell className="font-mono text-xs">
                    {p.paymentCode}
                    {!!p.voided && (
                      <Badge variant="muted" className="ml-2">
                        Đã hủy
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{formatDateTimeVN(p.paidAt)}</TableCell>
                  <TableCell>
                    {PAYMENT_METHOD_LABELS[p.method]}
                    {p.referenceNo && <div className="text-xs text-muted-foreground">Mã GD: {p.referenceNo}</div>}
                  </TableCell>
                  <TableCell className={cn('text-right tabular-nums', p.voided && 'line-through')}>{formatVnd(p.amount)}</TableCell>
                  <TableCell className="text-sm">{p.receivedBy}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" asChild>
                      <Link to={`/hoc-phi/phieu-thu/${p.id}`}>
                        <Printer /> Phiếu thu
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {inv.adjustments.length > 0 && (
        <Card className="overflow-hidden p-0">
          <CardHeader>
            <CardTitle>Điều chỉnh</CardTitle>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mã</TableHead>
                <TableHead>Loại</TableHead>
                <TableHead className="text-right">Số tiền</TableHead>
                <TableHead>Lý do</TableHead>
                <TableHead>Trạng thái</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {inv.adjustments.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-mono text-xs">{a.adjustmentCode}</TableCell>
                  <TableCell>{ADJUSTMENT_TYPE_LABELS[a.type]}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatVnd(a.amount)}</TableCell>
                  <TableCell className="text-sm">
                    {a.reason}
                    <div className="text-xs text-muted-foreground">
                      {a.requestedBy} · {formatDateTimeVN(a.requestedAt)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={a.status === 'APPROVED' ? 'success' : a.status === 'PENDING' ? 'warning' : 'muted'}>
                      {a.status === 'APPROVED' ? 'Đã duyệt' : a.status === 'PENDING' ? 'Chờ duyệt' : 'Từ chối'}
                    </Badge>
                    {a.approvedBy && <div className="text-xs text-muted-foreground">{a.approvedBy}</div>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <PaySheet inv={inv} open={paying} onOpenChange={setPaying} onDone={refresh} />
      <AdjustSheet inv={inv} open={adjusting} onOpenChange={setAdjusting} onDone={refresh} />
      <DateReasonDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title={`Hủy hóa đơn ${inv.invoice_code}`}
        description="Chỉ hủy được hóa đơn chưa thu tiền. Hóa đơn đã hủy vẫn được lưu để đối chiếu."
        confirmLabel="Hủy hóa đơn"
        destructive
        onSubmit={async ({ reason }) => {
          await feesApi.cancel(inv.id, reason);
          refresh();
          toast.success('Đã hủy hóa đơn');
        }}
      />
    </div>
  );
}

function DraftEditor({ inv, onDone }: { inv: InvoiceDetail; onDone: () => void }) {
  const [discount, setDiscount] = useState<number | null>(inv.discount_amount);
  const [due, setDue] = useState(inv.due_date ?? '');
  const save = useMutation({
    mutationFn: () => feesApi.updateDraft(inv.id, { discountAmount: discount ?? 0, dueDate: due }),
    onSuccess: () => (onDone(), toast.success('Đã lưu hóa đơn nháp')),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>Hóa đơn nháp — kiểm tra trước khi phát hành</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-end gap-3">
        <FormField label="Giảm giá" htmlFor="dr-disc" className="w-48">
          <MoneyInput id="dr-disc" value={discount} onChange={setDiscount} />
        </FormField>
        <FormField label="Hạn nộp" htmlFor="dr-due" className="w-44">
          <DateInput id="dr-due" value={due} onChange={setDue} />
        </FormField>
        <Button variant="outline" disabled={save.isPending || !due} onClick={() => save.mutate()}>
          {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} Lưu
        </Button>
        <Button
          variant="success"
          onClick={async () => {
            try {
              await feesApi.issue([inv.id]);
              onDone();
              toast.success('Đã phát hành hóa đơn');
            } catch (e) {
              toast.error(errorMessage(e));
            }
          }}
        >
          Phát hành
        </Button>
      </CardContent>
    </Card>
  );
}

function PaySheet({ inv, open, onOpenChange, onDone }: { inv: InvoiceDetail; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [amount, setAmount] = useState<number | null>(inv.remaining);
  const [method, setMethod] = useState('CASH');
  const [ref, setRef] = useState('');
  const [date, setDate] = useState(vnDate());
  const [note, setNote] = useState('');
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: number; paymentCode: string } | null>(null);
  const pay = useMutation({
    // Cùng một mã chống trùng cho mọi lần bấm/gửi lại của lần thu này
    mutationFn: () => feesApi.pay(inv.id, { amount, method, referenceNo: ref || null, paidAt: date, note: note || null, idempotencyKey: key }),
    onSuccess: (r) => {
      setDone(r);
      onDone();
      toast.success(`Đã thu ${formatVnd(amount ?? 0)} — phiếu ${r.paymentCode}`);
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const close = (o: boolean) => {
    if (!o) {
      setDone(null);
      setError(null);
      setKey(crypto.randomUUID());
      setAmount(inv.remaining);
      setRef('');
      setNote('');
    }
    onOpenChange(o);
  };
  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Thu tiền</SheetTitle>
          <SheetDescription>
            {inv.student_name} · {inv.invoice_code} · còn thiếu {formatVnd(inv.remaining)}
          </SheetDescription>
        </SheetHeader>
        {done ? (
          <>
            <Alert variant="success">Đã ghi nhận phiếu thu {done.paymentCode}. Giao dịch không sửa/xóa được; nếu sai hãy đề nghị điều chỉnh.</Alert>
            <SheetFooter>
              <Button variant="outline" onClick={() => close(false)}>
                Xong
              </Button>
              <Button asChild>
                <Link to={`/hoc-phi/phieu-thu/${done.id}`}>
                  <Printer /> In phiếu thu
                </Link>
              </Button>
            </SheetFooter>
          </>
        ) : (
          <>
            {error && <Alert variant="destructive">{error}</Alert>}
            <FormField label="Số tiền" htmlFor="pay-amount" required error={amount !== null && amount > inv.remaining ? 'Vượt số còn thiếu' : undefined}>
              <MoneyInput id="pay-amount" value={amount} onChange={setAmount} autoFocus />
            </FormField>
            <FormField label="Phương thức" htmlFor="pay-method" required>
              <NativeSelect id="pay-method" value={method} onChange={(e) => setMethod(e.target.value)}>
                {Object.entries(PAYMENT_METHOD_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            {method !== 'CASH' && (
              <FormField label="Mã giao dịch ngân hàng" htmlFor="pay-ref">
                <Input id="pay-ref" value={ref} onChange={(e) => setRef(e.target.value)} />
              </FormField>
            )}
            <FormField label="Ngày thu" htmlFor="pay-date" required>
              <DateInput id="pay-date" value={date} max={vnDate()} onChange={setDate} />
            </FormField>
            <FormField label="Ghi chú" htmlFor="pay-note">
              <Input id="pay-note" value={note} onChange={(e) => setNote(e.target.value)} />
            </FormField>
            <SheetFooter>
              <Button variant="outline" onClick={() => close(false)}>
                Hủy
              </Button>
              <Button disabled={!amount || amount > inv.remaining || !date || pay.isPending} onClick={() => (setError(null), pay.mutate())}>
                {pay.isPending && <Loader2 className="animate-spin" />} Xác nhận thu {amount ? formatVnd(amount) : ''}
              </Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function AdjustSheet({ inv, open, onOpenChange, onDone }: { inv: InvoiceDetail; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [type, setType] = useState<'REFUND' | 'CORRECTION' | 'VOID'>('REFUND');
  const [amount, setAmount] = useState<number | null>(null);
  const [direction, setDirection] = useState<'INCREASE' | 'DECREASE'>('DECREASE');
  const [paymentId, setPaymentId] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const live = inv.payments.filter((p) => !p.voided);
  const m = useMutation({
    mutationFn: () =>
      feesApi.requestAdjustment(inv.id, {
        type,
        reason: reason.trim(),
        ...(type === 'VOID' ? { paymentId: Number(paymentId) } : { amount }),
        ...(type === 'CORRECTION' ? { direction } : {}),
      }),
    onSuccess: () => {
      onDone();
      toast.success('Đã gửi đề nghị — chờ quản lý khác duyệt');
      onOpenChange(false);
      setReason('');
      setAmount(null);
    },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Sheet open={open} onOpenChange={(o) => (setError(null), onOpenChange(o))}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Đề nghị điều chỉnh</SheetTitle>
          <SheetDescription>Giao dịch đã ghi không sửa được. Đề nghị cần một quản lý khác duyệt mới có hiệu lực.</SheetDescription>
        </SheetHeader>
        {error && <Alert variant="destructive">{error}</Alert>}
        <FormField label="Loại" htmlFor="adj-type" required>
          <NativeSelect id="adj-type" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
            {Object.entries(ADJUSTMENT_TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        {type === 'VOID' ? (
          <FormField label="Giao dịch cần hủy" htmlFor="adj-pay" required>
            <NativeSelect id="adj-pay" value={paymentId} onChange={(e) => setPaymentId(e.target.value)}>
              <option value="">— Chọn giao dịch —</option>
              {live.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.paymentCode} · {formatVnd(p.amount)} · {formatDateTimeVN(p.paidAt)}
                </option>
              ))}
            </NativeSelect>
          </FormField>
        ) : (
          <>
            {type === 'CORRECTION' && (
              <FormField label="Hướng điều chỉnh số đã nộp" htmlFor="adj-dir" required>
                <NativeSelect id="adj-dir" value={direction} onChange={(e) => setDirection(e.target.value as typeof direction)}>
                  <option value="DECREASE">Giảm (ghi thừa)</option>
                  <option value="INCREASE">Tăng (ghi thiếu)</option>
                </NativeSelect>
              </FormField>
            )}
            <FormField label="Số tiền" htmlFor="adj-amount" required>
              <MoneyInput id="adj-amount" value={amount} onChange={setAmount} />
            </FormField>
          </>
        )}
        <FormField label="Lý do" htmlFor="adj-reason" required>
          <Textarea id="adj-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </FormField>
        <SheetFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Hủy
          </Button>
          <Button disabled={m.isPending || reason.trim().length < 5 || (type === 'VOID' ? !paymentId : !amount)} onClick={() => (setError(null), m.mutate())}>
            {m.isPending && <Loader2 className="animate-spin" />} Gửi đề nghị
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
