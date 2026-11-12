import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import { formatVnd, PAYMENT_METHOD_LABELS } from '@ecm/shared';
import { Button } from '@/components/ui/button';
import { ErrorBlock, LoadingBlock } from '@/components/common/page';
import { formatDateTimeVN } from '@/lib/format';
import { feeKeys, feesApi } from '@/services/fees';

const ONES = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
function readTriple(n: number, full: boolean): string {
  const h = Math.floor(n / 100);
  const t = Math.floor((n % 100) / 10);
  const u = n % 10;
  const out: string[] = [];
  if (full || h) out.push(`${ONES[h]} trăm`);
  if (t > 1) out.push(`${ONES[t]} mươi`);
  else if (t === 1) out.push('mười');
  else if ((full || h) && u) out.push('lẻ');
  if (u) out.push(t > 1 && u === 1 ? 'mốt' : t >= 1 && u === 5 ? 'lăm' : t > 1 && u === 4 ? 'tư' : ONES[u]!);
  return out.join(' ');
}
/** Đọc số tiền bằng chữ (VD 1.620.000 → "Một triệu sáu trăm hai mươi nghìn đồng"). */
export function vndInWords(amount: number): string {
  if (amount === 0) return 'Không đồng';
  const units = ['', ' nghìn', ' triệu', ' tỷ'];
  const groups: number[] = [];
  let n = Math.abs(Math.trunc(amount));
  while (n > 0) {
    groups.push(n % 1000);
    n = Math.floor(n / 1000);
  }
  const parts: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i]!;
    if (!g) continue;
    parts.push(readTriple(g, i < groups.length - 1) + units[i % 4]);
  }
  const s = parts.join(' ').replace(/\s+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1) + ' đồng';
}

/** Phiếu thu in được (In / Lưu PDF bằng hộp thoại in của trình duyệt). */
export function ReceiptPage() {
  const id = Number(useParams().id);
  const q = useQuery({ queryKey: feeKeys.receipt(id), queryFn: () => feesApi.receipt(id) });
  if (q.isLoading) return <LoadingBlock />;
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => q.refetch()} />;
  const r = q.data!;
  const period = /^\d{4}-\d{2}$/.test(r.periodLabel) ? `Học phí tháng ${Number(r.periodLabel.slice(5))}/${r.periodLabel.slice(0, 4)}` : r.periodLabel;
  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => history.back()}>
          <ArrowLeft /> Quay lại
        </Button>
        <Button onClick={() => window.print()}>
          <Printer /> In / Lưu PDF
        </Button>
      </div>
      <article className="receipt rounded-lg border bg-white p-8 text-[15px] leading-relaxed text-black shadow-sm print:border-0 print:p-0 print:shadow-none">
        <header className="mb-6 flex items-start justify-between">
          <div>
            <div className="font-semibold">{r.centerName || 'Lớp học tiếng Anh'}</div>
          </div>
          <div className="text-right text-sm">
            <div>
              Số: <b className="font-mono">{r.paymentCode}</b>
            </div>
            <div>{formatDateTimeVN(r.paidAt)}</div>
          </div>
        </header>
        <h1 className="mb-6 text-center text-2xl font-bold tracking-wide">PHIẾU THU</h1>
        {!!r.voided && <p className="mb-4 text-center font-semibold text-red-600">GIAO DỊCH ĐÃ BỊ HỦY</p>}
        <dl className="grid grid-cols-[170px_1fr] gap-y-2">
          <dt>Người nộp:</dt>
          <dd>{r.guardianName ?? '—'}</dd>
          <dt>Học sinh:</dt>
          <dd>
            {r.studentName} ({r.studentCode})
          </dd>
          <dt>Nội dung:</dt>
          <dd>
            {period} — hóa đơn {r.invoiceCode}
          </dd>
          <dt>Số tiền:</dt>
          <dd className="text-lg font-bold">{formatVnd(r.amount)}</dd>
          <dt>Bằng chữ:</dt>
          <dd className="italic">{vndInWords(r.amount)}</dd>
          <dt>Hình thức:</dt>
          <dd>
            {PAYMENT_METHOD_LABELS[r.method as keyof typeof PAYMENT_METHOD_LABELS]}
            {r.referenceNo && ` — mã GD ${r.referenceNo}`}
          </dd>
          <dt>Còn thiếu sau phiếu:</dt>
          <dd>{formatVnd(r.amountDue - r.amountPaid)}</dd>
          {r.note && (
            <>
              <dt>Ghi chú:</dt>
              <dd>{r.note}</dd>
            </>
          )}
        </dl>
        <footer className="mt-12 grid grid-cols-2 text-center text-sm">
          <div>
            <div className="font-semibold">Người nộp tiền</div>
            <div className="text-xs italic">(Ký, ghi rõ họ tên)</div>
          </div>
          <div>
            <div className="font-semibold">Người thu tiền</div>
            <div className="text-xs italic">(Ký, ghi rõ họ tên)</div>
            <div className="mt-16">{r.receivedBy}</div>
          </div>
        </footer>
      </article>
      <p className="mt-3 text-center text-xs text-muted-foreground print:hidden">
        <Link to="/hoc-phi?tab=ledger" className="hover:text-primary">
          Xem sổ thu
        </Link>
      </p>
    </div>
  );
}
