import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import { formatVnd, PAYMENT_METHOD_LABELS } from '@ecm/shared';
import { Button } from '@/components/ui/button';
import { ErrorBlock, LoadingBlock } from '@/components/common/page';
import { formatDateTimeVN } from '@/lib/format';
import { feeKeys, feesApi } from '@/services/fees';
import { vndInWords } from '@/lib/money-words';

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
      <article className="receipt relative overflow-hidden rounded-lg border bg-white p-8 text-[15px] leading-relaxed text-black shadow-sm print:border-0 print:p-0 print:shadow-none">
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
        {(!!r.voided || !!r.invoiceCancelled) && (
          <>
            <div
              aria-hidden
              className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-12 rounded-xl border-[6px] border-red-600/70 px-8 py-3 text-5xl font-black tracking-widest text-red-600/70"
            >
              ĐÃ HỦY
            </div>
            <p className="mb-4 text-center font-semibold text-red-600">
              {r.voided ? 'GIAO DỊCH ĐÃ BỊ HỦY' : 'KHOẢN THU ĐÃ ĐƯỢC HOÀN/ĐẢO — HÓA ĐƠN ĐÃ HỦY'} · không có giá trị thanh toán
            </p>
          </>
        )}
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
