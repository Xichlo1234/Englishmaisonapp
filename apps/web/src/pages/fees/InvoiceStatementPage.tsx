import { useRef, useState } from 'react';
import { useParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toBlob } from 'html-to-image';
import { ArrowLeft, Download, Loader2, Printer, Send } from 'lucide-react';
import { toast } from 'sonner';
import { ATTENDANCE_STATUS_LABELS, formatDateVN, formatVnd, isoWeekday, normalizeSearch, vnDate, WEEKDAY_LABELS } from '@ecm/shared';
import { Button } from '@/components/ui/button';
import { ErrorBlock, errorMessage, LoadingBlock } from '@/components/common/page';
import { useAuth } from '@/hooks/use-auth';
import { feeKeys, feesApi, type InvoiceStatement, type StatementLesson } from '@/services/fees';
import { vndInWords } from './ReceiptPage';

const periodName = (label: string) => (/^\d{4}-\d{2}$/.test(label) ? `tháng ${Number(label.slice(5))}/${label.slice(0, 4)}` : label);

function lessonStatus(l: StatementLesson, today: string) {
  if (l.status === 'LATE') return { text: `Đi muộn${l.lateMinutes ? ` ${l.lateMinutes} phút` : ''}`, cls: 'text-amber-700' };
  if (l.status === 'EXCUSED' || l.status === 'UNEXCUSED') return { text: ATTENDANCE_STATUS_LABELS[l.status], cls: 'font-semibold text-red-600' };
  if (l.status) return { text: ATTENDANCE_STATUS_LABELS[l.status], cls: 'text-green-700' };
  return l.date > today ? { text: 'Sắp học', cls: 'text-slate-500' } : { text: 'Chưa điểm danh', cls: 'text-slate-500' };
}

function LessonTable({ lessons, today }: { lessons: StatementLesson[]; today: string }) {
  return (
    <table className="w-full border-collapse text-[13px]">
      <thead>
        <tr className="bg-slate-100 text-left text-slate-600">
          <th className="border border-slate-200 px-2 py-1.5 font-medium">STT</th>
          <th className="border border-slate-200 px-2 py-1.5 font-medium">Ngày</th>
          <th className="border border-slate-200 px-2 py-1.5 font-medium">Thời gian</th>
          <th className="border border-slate-200 px-2 py-1.5 font-medium">Lớp</th>
          <th className="border border-slate-200 px-2 py-1.5 font-medium">Tình trạng</th>
        </tr>
      </thead>
      <tbody>
        {lessons.map((l, i) => {
          const st = lessonStatus(l, today);
          return (
            <tr key={`${l.date}-${l.startTime}-${i}`}>
              <td className="border border-slate-200 px-2 py-1 text-center tabular-nums">{i + 1}</td>
              <td className="border border-slate-200 px-2 py-1 tabular-nums">
                {WEEKDAY_LABELS[isoWeekday(l.date)]}, {formatDateVN(l.date)}
              </td>
              <td className="border border-slate-200 px-2 py-1 tabular-nums">
                {l.startTime} – {l.endTime}
              </td>
              <td className="border border-slate-200 px-2 py-1">{l.className}</td>
              <td className={`border border-slate-200 px-2 py-1 ${st.cls}`}>{st.text}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function countBy(lessons: StatementLesson[]) {
  const c = { attended: 0, late: 0, excused: 0, unexcused: 0 };
  for (const l of lessons) {
    if (l.status === 'PRESENT') c.attended++;
    else if (l.status === 'LATE') (c.attended++, c.late++);
    else if (l.status === 'EXCUSED') c.excused++;
    else if (l.status === 'UNEXCUSED') c.unexcused++;
  }
  return c;
}

/** Tờ hóa đơn khổ cố định — dùng để xuất ảnh PNG / in. */
export function StatementSheet({ s }: { s: InvoiceStatement }) {
  const today = vnDate();
  const inv = s.invoice;
  const a = s.absence;
  const ac = a ? countBy(a.lessons) : null;
  const row = (label: React.ReactNode, value: string, cls = '') => (
    <tr className={cls}>
      <td className="py-1 pr-4">{label}</td>
      <td className="py-1 text-right tabular-nums">{value}</td>
    </tr>
  );
  return (
    <div className="w-[760px] bg-white p-8 text-[14px] leading-snug text-slate-900" style={{ fontFamily: 'Inter, "Segoe UI", Arial, sans-serif' }}>
      <div className="flex items-start justify-between border-b-2 border-primary pb-4">
        <div>
          <div className="text-xl font-bold text-primary">{s.center.name}</div>
          {s.center.address && <div className="text-slate-600">{s.center.address}</div>}
          {s.center.phone && <div className="text-slate-600">ĐT: {s.center.phone}</div>}
        </div>
        <div className="text-right">
          <div className="text-lg font-bold tracking-wide">HÓA ĐƠN HỌC PHÍ</div>
          <div className="font-mono text-slate-600">{inv.code}</div>
          {inv.issuedAt && <div className="text-slate-600">Ngày lập: {formatDateVN(inv.issuedAt.slice(0, 10))}</div>}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1">
        <div>
          Học sinh: <b>{s.student.fullName}</b>
        </div>
        <div>Mã học sinh: {s.student.code}</div>
        <div>
          Kỳ học phí: <b>{periodName(inv.periodLabel)}</b>
        </div>
        <div>Gói học phí: {inv.planName ?? '—'}</div>
        {inv.periodStart && inv.periodEnd && (
          <div>
            Thời gian: {formatDateVN(inv.periodStart)} – {formatDateVN(inv.periodEnd)}
          </div>
        )}
        <div>
          Hạn nộp: <b>{formatDateVN(inv.dueDate)}</b>
        </div>
      </div>

      <table className="mt-4 w-full border-t border-slate-200">
        <tbody>
          {row('Học phí', formatVnd(inv.grossAmount))}
          {inv.discountAmount > 0 && row('Giảm giá', `− ${formatVnd(inv.discountAmount)}`)}
          {a &&
            inv.absenceDeduction > 0 &&
            row(
              <>
                Khấu trừ buổi vắng {periodName(a.periodLabel)}
                <div className="text-xs text-slate-500">
                  {a.count} buổi vắng / {a.sessionTotal} buổi × {formatVnd(a.unitPrice ?? 0)}/buổi
                </div>
              </>,
              `− ${formatVnd(inv.absenceDeduction)}`,
            )}
          {inv.amountPaid > 0 ? (
            <>
              {row('Phải nộp', formatVnd(inv.amountDue), 'border-t border-slate-300 font-bold text-[15px]')}
              {row('Đã nộp', formatVnd(inv.amountPaid))}
              {row('Còn phải nộp', formatVnd(inv.remaining), 'font-bold text-primary text-[16px]')}
            </>
          ) : (
            row('Phải nộp', formatVnd(inv.amountDue), 'border-t border-slate-300 font-bold text-primary text-[16px]')
          )}
        </tbody>
      </table>
      <div className="mt-1 text-right text-[13px] italic text-slate-600">Bằng chữ: {vndInWords(inv.remaining)}</div>

      {a && (
        <section className="mt-5">
          <h3 className="mb-1 font-semibold">
            Chi tiết buổi học {periodName(a.periodLabel)} ({formatDateVN(a.periodStart)} – {formatDateVN(a.periodEnd)})
          </h3>
          <p className="mb-2 text-[13px] text-slate-600">
            {a.lessons.length} buổi · đi học {ac!.attended}
            {ac!.late > 0 && ` (muộn ${ac!.late})`} · vắng có phép {ac!.excused} · vắng không phép {ac!.unexcused}
          </p>
          <LessonTable lessons={a.lessons} today={today} />
        </section>
      )}

      {s.lessons.length > 0 && (
        <section className="mt-5">
          <h3 className="mb-2 font-semibold">
            Lịch học {periodName(inv.periodLabel)} ({s.lessons.length} buổi)
          </h3>
          <LessonTable lessons={s.lessons} today={today} />
        </section>
      )}

      {inv.note && <p className="mt-4 text-[13px] text-slate-600">Ghi chú: {inv.note}</p>}
      <p className="mt-6 border-t border-slate-200 pt-3 text-center text-xs text-slate-500">
        Buổi vắng (có phép và không phép) được khấu trừ vào học phí kỳ sau. Mọi thắc mắc vui lòng liên hệ {s.center.name}.
      </p>
    </div>
  );
}

export function InvoiceStatementPage() {
  const id = Number(useParams().id);
  const { can } = useAuth();
  const sheet = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);
  const q = useQuery({ queryKey: feeKeys.statement(id), queryFn: () => feesApi.statement(id) });
  const send = useMutation({
    mutationFn: () => feesApi.sendToGuardians(id),
    onSuccess: (r) =>
      toast.success(`Đã gửi cho ${r.sent} phụ huynh${r.withoutAccount ? ` (${r.withoutAccount} phụ huynh chưa có tài khoản)` : ''}`),
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (q.isLoading) return <LoadingBlock />;
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => q.refetch()} />;
  const s = q.data!;
  const issued = s.invoice.status !== 'DRAFT' && s.invoice.status !== 'CANCELLED';

  const download = async () => {
    setExporting(true);
    try {
      const blob = await toBlob(sheet.current!.firstElementChild as HTMLElement, { pixelRatio: 2, backgroundColor: '#ffffff', cacheBust: true });
      if (!blob) throw new Error('Ảnh rỗng');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      // Non-ASCII download names are dropped by Chromium (file becomes "download").
      link.download = `${s.invoice.code}-${normalizeSearch(s.student.fullName).replace(/[^a-z0-9]+/g, '-')}.png`;
      link.href = url;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      toast.error(`Không tạo được ảnh: ${errorMessage(e)}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden" data-print-hide>
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => history.back()}>
          <ArrowLeft /> Quay lại
        </Button>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => window.print()}>
            <Printer /> In
          </Button>
          <Button variant="outline" disabled={exporting} onClick={download}>
            {exporting ? <Loader2 className="animate-spin" /> : <Download />} Tải ảnh
          </Button>
          {can('fees.write') && (
            <Button
              disabled={!issued || send.isPending}
              title={issued ? undefined : 'Phát hành hóa đơn trước khi gửi'}
              onClick={() => window.confirm('Gửi hóa đơn này cho phụ huynh (xem trên ứng dụng điện thoại)?') && send.mutate()}
            >
              {send.isPending ? <Loader2 className="animate-spin" /> : <Send />} Gửi cho phụ huynh
            </Button>
          )}
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border bg-slate-50 p-4 print:border-0 print:p-0">
        <div ref={sheet} className="mx-auto w-fit shadow-sm print:shadow-none">
          <StatementSheet s={s} />
        </div>
      </div>
    </div>
  );
}
