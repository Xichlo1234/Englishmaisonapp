import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, FilePlus2, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { addDays, BILLING_TYPE_LABELS, computeDiscount, formatDateVN, formatVnd, INVOICE_STATUS_LABELS, vnDate } from '@ecm/shared';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DateInput } from '@/components/ui/date-input';
import { Input } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { NativeSelect } from '@/components/ui/native-select';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FormField } from '@/components/common/form-field';
import { EmptyBlock, ErrorBlock, errorMessage, LoadingBlock } from '@/components/common/page';
import { useAuth } from '@/hooks/use-auth';
import { cn } from '@/lib/utils';
import { DateReasonDialog } from '@/pages/classes/dialogs';
import { feeKeys, feesApi, INVOICE_VARIANT, type StudentFees } from '@/services/fees';

export function StudentFeesTab({ studentId, studentName }: { studentId: number; studentName: string }) {
  const { can } = useAuth();
  const q = useQuery({ queryKey: feeKeys.student(studentId), queryFn: () => feesApi.studentFees(studentId) });
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [invoicing, setInvoicing] = useState(false);
  const [ending, setEnding] = useState<number | null>(null);
  if (q.isLoading) return <LoadingBlock />;
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => q.refetch()} />;
  const f = q.data!;
  const today = vnDate();
  const refresh = () => qc.invalidateQueries({ queryKey: ['fees'] });
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className={cn('rounded-lg px-4 py-3', f.outstanding ? 'bg-warning-soft text-yellow-900' : 'bg-success-soft text-green-900')}>
          <div className="text-xs">Còn nợ</div>
          <div className="text-xl font-semibold tabular-nums">{formatVnd(f.outstanding)}</div>
        </div>
        {f.sessions && (
          <div className={cn('rounded-lg px-4 py-3', f.sessions.remaining <= 2 ? 'bg-danger-soft text-red-800' : 'bg-accent text-accent-foreground')}>
            <div className="text-xs">Gói buổi: còn lại / đã mua</div>
            <div className="text-xl font-semibold tabular-nums">
              {f.sessions.remaining} / {f.sessions.purchased} buổi
            </div>
            <div className="text-xs">
              Đã dùng {f.sessions.used} buổi từ {formatDateVN(f.sessions.since)}
              {f.sessions.remaining <= 2 && ' — sắp hết, cần gia hạn'}
            </div>
          </div>
        )}
      </div>
      {f.sessions && f.sessions.remaining <= 2 && (
        <Alert variant="warning">
          <AlertTriangle /> Gói buổi của học sinh còn {f.sessions.remaining} buổi. Cách tính: có mặt, đi muộn, vắng không phép bị trừ buổi; vắng có phép không trừ.
        </Alert>
      )}

      {can('fees.read') && (
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Gói học phí áp dụng</CardTitle>
            {can('fees.write') && (
              <Button size="sm" onClick={() => setAdding(true)}>
                <Plus /> Gán gói
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {!f.plans.length ? (
              <p className="text-sm text-muted-foreground">Chưa gán gói học phí.</p>
            ) : (
              <ul className="flex flex-col divide-y">
                {f.plans.map((p) => {
                  const active = !p.effectiveTo || p.effectiveTo >= today;
                  const base = p.customAmount ?? p.planAmount;
                  const disc = computeDiscount(base, p.discountType, p.discountValue);
                  return (
                    <li key={p.id} className={cn('flex flex-wrap items-center gap-3 py-2.5', !active && 'text-muted-foreground')}>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">
                          {p.planName} <Badge variant="outline">{BILLING_TYPE_LABELS[p.billingType]}</Badge>
                        </div>
                        <div className="text-sm">
                          {formatVnd(base - disc)}
                          {disc > 0 && (
                            <span className="text-muted-foreground">
                              {' '}
                              (giảm {p.discountType === 'PERCENT' ? `${p.discountValue}%` : formatVnd(p.discountValue)}: {p.discountReason})
                            </span>
                          )}{' '}
                          · {formatDateVN(p.effectiveFrom)} → {p.effectiveTo ? formatDateVN(p.effectiveTo) : 'nay'}
                        </div>
                      </div>
                      {active && can('fees.write') && (
                        <Button variant="ghost" size="sm" onClick={() => setEnding(p.id)}>
                          Kết thúc gói
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="overflow-hidden p-0">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Hóa đơn</CardTitle>
          {can('fees.write') && (
            <Button size="sm" variant="outline" onClick={() => setInvoicing(true)}>
              <FilePlus2 /> Tạo hóa đơn
            </Button>
          )}
        </CardHeader>
        {!f.invoices.length ? (
          <EmptyBlock title="Chưa có hóa đơn" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mã</TableHead>
                <TableHead>Kỳ / nội dung</TableHead>
                <TableHead className="text-right">Phải nộp</TableHead>
                <TableHead className="text-right">Còn thiếu</TableHead>
                <TableHead>Hạn</TableHead>
                <TableHead>Trạng thái</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {f.invoices.map((i) => (
                <TableRow key={i.id}>
                  <TableCell>
                    <Link to={`/hoc-phi/hoa-don/${i.id}`} className="font-mono text-xs hover:text-primary">
                      {i.invoiceCode}
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm">
                    {/^\d{4}-\d{2}$/.test(i.periodLabel) ? `Tháng ${Number(i.periodLabel.slice(5))}/${i.periodLabel.slice(0, 4)}` : i.periodLabel}
                    {i.sessionsPurchased && <span className="text-muted-foreground"> · {i.sessionsPurchased} buổi</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatVnd(i.amountDue)}</TableCell>
                  <TableCell className={cn('text-right tabular-nums', i.remaining > 0 && 'font-medium text-destructive')}>{formatVnd(i.remaining)}</TableCell>
                  <TableCell>{formatDateVN(i.dueDate)}</TableCell>
                  <TableCell>
                    <Badge variant={INVOICE_VARIANT[i.status]}>{INVOICE_STATUS_LABELS[i.status]}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <AssignPlanSheet studentId={studentId} open={adding} onOpenChange={setAdding} onDone={refresh} />
      <InvoiceSheet studentId={studentId} studentName={studentName} fees={f} open={invoicing} onOpenChange={setInvoicing} onDone={refresh} />
      <DateReasonDialog
        open={ending !== null}
        onOpenChange={(o) => !o && setEnding(null)}
        title="Kết thúc gói học phí"
        description="Gói không còn được dùng để tạo hóa đơn sau ngày kết thúc. Hóa đơn đã có giữ nguyên."
        dateLabel="Ngày kết thúc"
        reasonRequired={false}
        confirmLabel="Kết thúc gói"
        onSubmit={async ({ date }) => {
          await feesApi.endStudentPlan(ending!, date);
          refresh();
          toast.success('Đã kết thúc gói');
        }}
      />
    </div>
  );
}

function AssignPlanSheet({ studentId, open, onOpenChange, onDone }: { studentId: number; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const plans = useQuery({ queryKey: feeKeys.plans, queryFn: () => feesApi.plans().then((r) => r.data), enabled: open });
  const [planId, setPlanId] = useState('');
  const [custom, setCustom] = useState<number | null>(null);
  const [dType, setDType] = useState<'NONE' | 'AMOUNT' | 'PERCENT'>('NONE');
  const [dValue, setDValue] = useState('');
  const [dReason, setDReason] = useState('');
  const [from, setFrom] = useState(vnDate().slice(0, 8) + '01');
  const [error, setError] = useState<string | null>(null);
  const plan = plans.data?.find((p) => String(p.id) === planId);
  const base = custom ?? plan?.amount ?? 0;
  const disc = computeDiscount(base, dType, Number(dValue.replace(/\D/g, '')) || 0);
  const m = useMutation({
    mutationFn: () =>
      feesApi.addStudentPlan(studentId, {
        feePlanId: Number(planId),
        customAmount: custom,
        discountType: dType,
        discountValue: dType === 'NONE' ? 0 : Number(dValue.replace(/\D/g, '')) || 0,
        discountReason: dType === 'NONE' ? null : dReason,
        effectiveFrom: from,
      }),
    onSuccess: () => (onDone(), toast.success('Đã gán gói học phí'), onOpenChange(false)),
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Sheet open={open} onOpenChange={(o) => (setError(null), onOpenChange(o))}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Gán gói học phí</SheetTitle>
        </SheetHeader>
        {error && <Alert variant="destructive">{error}</Alert>}
        <FormField label="Gói" htmlFor="sp-plan" required>
          <NativeSelect id="sp-plan" value={planId} onChange={(e) => setPlanId(e.target.value)}>
            <option value="">— Chọn gói —</option>
            {(plans.data ?? [])
              .filter((p) => p.isActive)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {BILLING_TYPE_LABELS[p.billingType]} · {formatVnd(p.amount)}
                </option>
              ))}
          </NativeSelect>
        </FormField>
        <FormField label="Giá riêng cho học sinh (nếu khác giá gói)" htmlFor="sp-custom">
          <MoneyInput id="sp-custom" value={custom} onChange={setCustom} placeholder={plan ? formatVnd(plan.amount) : ''} />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Giảm giá" htmlFor="sp-dtype">
            <NativeSelect id="sp-dtype" value={dType} onChange={(e) => setDType(e.target.value as typeof dType)}>
              <option value="NONE">Không</option>
              <option value="PERCENT">Theo %</option>
              <option value="AMOUNT">Số tiền</option>
            </NativeSelect>
          </FormField>
          {dType !== 'NONE' && (
            <FormField label={dType === 'PERCENT' ? '% giảm' : 'Số tiền giảm'} htmlFor="sp-dval">
              {dType === 'PERCENT' ? (
                <Input id="sp-dval" inputMode="numeric" value={dValue} onChange={(e) => setDValue(e.target.value)} />
              ) : (
                <MoneyInput id="sp-dval" value={dValue ? Number(dValue) : null} onChange={(v) => setDValue(v ? String(v) : '')} />
              )}
            </FormField>
          )}
        </div>
        {dType !== 'NONE' && (
          <FormField label="Lý do giảm giá" htmlFor="sp-dreason" required>
            <Input id="sp-dreason" value={dReason} onChange={(e) => setDReason(e.target.value)} placeholder="VD: Anh chị em cùng học" />
          </FormField>
        )}
        <FormField label="Áp dụng từ ngày" htmlFor="sp-from" required>
          <DateInput id="sp-from" value={from} onChange={setFrom} />
        </FormField>
        {plan && (
          <p className="rounded-md bg-muted p-3 text-sm">
            Phải nộp mỗi kỳ: <b>{formatVnd(base - disc)}</b>
            {disc > 0 && ` (đã giảm ${formatVnd(disc)})`}
          </p>
        )}
        <SheetFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Hủy
          </Button>
          <Button disabled={!planId || !from || m.isPending || (dType !== 'NONE' && (!dValue || dReason.trim().length < 2))} onClick={() => (setError(null), m.mutate())}>
            {m.isPending && <Loader2 className="animate-spin" />} Lưu
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/** Hóa đơn thủ công: gói theo khóa / gói buổi, hoặc khoản thu khác. */
function InvoiceSheet({
  studentId,
  fees,
  open,
  onOpenChange,
  onDone,
}: {
  studentId: number;
  studentName: string;
  fees: StudentFees;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}) {
  const today = vnDate();
  const usable = fees.plans.filter((p) => (!p.effectiveTo || p.effectiveTo >= today) && p.billingType !== 'MONTHLY');
  const [sfpId, setSfpId] = useState('');
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [discount, setDiscount] = useState<number | null>(0);
  const [sessions, setSessions] = useState('');
  const [due, setDue] = useState(addDays(today, 7));
  const [error, setError] = useState<string | null>(null);
  const pick = (id: string) => {
    setSfpId(id);
    const p = usable.find((x) => String(x.id) === id);
    if (p) {
      const base = p.customAmount ?? p.planAmount;
      setAmount(base);
      setDiscount(computeDiscount(base, p.discountType, p.discountValue));
      setLabel(p.billingType === 'PER_SESSION' ? `${p.planName} (${p.sessionCount} buổi)` : p.planName);
      setSessions(p.sessionCount ? String(p.sessionCount) : '');
    }
  };
  const m = useMutation({
    mutationFn: () =>
      feesApi.createInvoice({
        studentId,
        studentFeePlanId: sfpId ? Number(sfpId) : null,
        periodLabel: label.trim(),
        periodStart: today,
        sessionsPurchased: sessions ? Number(sessions) : null,
        grossAmount: amount,
        discountAmount: discount ?? 0,
        dueDate: due,
        issue: true,
      }),
    onSuccess: () => (onDone(), toast.success('Đã tạo hóa đơn'), onOpenChange(false)),
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Sheet open={open} onOpenChange={(o) => (setError(null), onOpenChange(o))}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Tạo hóa đơn</SheetTitle>
        </SheetHeader>
        <p className="text-sm text-muted-foreground">Dùng cho gói theo khóa, gói buổi hoặc khoản thu khác. Học phí theo tháng tạo ở Học phí → Tạo hóa đơn kỳ.</p>
        {error && <Alert variant="destructive">{error}</Alert>}
        {usable.length > 0 && (
          <FormField label="Theo gói của học sinh" htmlFor="iv-plan">
            <NativeSelect id="iv-plan" value={sfpId} onChange={(e) => pick(e.target.value)}>
              <option value="">— Khoản thu khác —</option>
              {usable.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.planName} · {BILLING_TYPE_LABELS[p.billingType]}
                </option>
              ))}
            </NativeSelect>
          </FormField>
        )}
        <FormField label="Nội dung" htmlFor="iv-label" required>
          <Input id="iv-label" value={label} onChange={(e) => setLabel(e.target.value)} />
        </FormField>
        <FormField label="Số tiền" htmlFor="iv-amount" required>
          <MoneyInput id="iv-amount" value={amount} onChange={setAmount} />
        </FormField>
        <FormField label="Giảm giá" htmlFor="iv-disc">
          <MoneyInput id="iv-disc" value={discount} onChange={setDiscount} />
        </FormField>
        <FormField label="Số buổi (gói buổi)" htmlFor="iv-sessions">
          <Input id="iv-sessions" type="number" min={1} value={sessions} onChange={(e) => setSessions(e.target.value)} />
        </FormField>
        <FormField label="Hạn nộp" htmlFor="iv-due" required>
          <DateInput id="iv-due" value={due} onChange={setDue} />
        </FormField>
        <SheetFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Hủy
          </Button>
          <Button disabled={!amount || label.trim().length < 2 || !due || (discount ?? 0) > (amount ?? 0) || m.isPending} onClick={() => (setError(null), m.mutate())}>
            {m.isPending && <Loader2 className="animate-spin" />} Tạo và phát hành
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
