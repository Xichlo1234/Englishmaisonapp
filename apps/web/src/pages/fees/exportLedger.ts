import { ADJUSTMENT_TYPE_LABELS, formatDateVN, PAYMENT_METHOD_LABELS } from '@ecm/shared';
import { formatDateTimeVN } from '@/lib/format';
import type { DailyRow, LedgerEntry } from '@/services/fees';

type Workbook = import('exceljs').Workbook;
type Worksheet = import('exceljs').Worksheet;

const MONEY = '#,##0;[Red]-#,##0';

async function newBook(sheet: string, title: string) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Quản lý lớp học';
  const ws = wb.addWorksheet(sheet);
  ws.addRow([title]).font = { bold: true, size: 13 };
  ws.addRow([]);
  return { wb, ws };
}

function header(ws: Worksheet, cols: { header: string; width: number }[]) {
  const row = ws.addRow(cols.map((c) => c.header));
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF167C75' } };
  cols.forEach((c, i) => (ws.getColumn(i + 1).width = c.width));
  ws.views = [{ state: 'frozen', ySplit: row.number }];
}

async function save(wb: Workbook, name: string) {
  const buf = await wb.xlsx.writeBuffer();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function entryLabel(e: LedgerEntry) {
  if (e.kind === 'ADJUSTMENT') return `${ADJUSTMENT_TYPE_LABELS[e.type]}${e.paymentCode ? ` ${e.paymentCode}` : ''}`;
  if (e.status === 'VOIDED') return 'Phiếu thu (đã hủy)';
  if (e.status === 'REVERSED') return 'Phiếu thu (đã đảo, hóa đơn hủy)';
  return 'Phiếu thu';
}

/** Sổ thu: mỗi phiếu thu và mỗi bút toán đảo là một dòng; cột Thu/Chi tách riêng, tổng cuối là thực thu. */
export async function downloadLedgerXlsx(entries: LedgerEntry[], range: { from: string; to: string }, summary: { receipts: number; adjustments: number; net: number }) {
  const { wb, ws } = await newBook('Sổ thu', `SỔ THU từ ${formatDateVN(range.from)} đến ${formatDateVN(range.to)}`);
  header(ws, [
    { header: 'Thời điểm ghi sổ', width: 18 },
    { header: 'Số chứng từ', width: 18 },
    { header: 'Diễn giải', width: 30 },
    { header: 'Học sinh', width: 24 },
    { header: 'Hóa đơn', width: 16 },
    { header: 'Phương thức', width: 13 },
    { header: 'Thu', width: 14 },
    { header: 'Hoàn / đảo', width: 14 },
    { header: 'Người ghi / duyệt', width: 20 },
    { header: 'Lý do', width: 30 },
  ]);
  for (const e of [...entries].reverse()) {
    ws.addRow([
      formatDateTimeVN(e.at),
      e.code,
      entryLabel(e),
      e.studentName,
      e.invoiceCode,
      PAYMENT_METHOD_LABELS[e.method],
      e.kind === 'RECEIPT' ? e.amount : null,
      e.kind === 'ADJUSTMENT' ? e.amount : null,
      e.actor,
      e.kind === 'ADJUSTMENT' ? e.reason : '',
    ]);
  }
  ws.addRow([]);
  const t = ws.addRow(['', '', 'TỔNG', '', '', '', summary.receipts, summary.adjustments, '', '']);
  const n = ws.addRow(['', '', 'THỰC THU', '', '', '', summary.net, null, '', '']);
  t.font = n.font = { bold: true };
  ws.getColumn(7).numFmt = ws.getColumn(8).numFmt = MONEY;
  await save(wb, `so-thu-${range.from}-${range.to}.xlsx`);
}

export async function downloadDailyXlsx(rows: DailyRow[], range: { from: string; to: string }, totals: Omit<DailyRow, 'day' | 'runningNet'>) {
  const { wb, ws } = await newBook('Tổng hợp ngày', `TỔNG HỢP THU THEO NGÀY từ ${formatDateVN(range.from)} đến ${formatDateVN(range.to)}`);
  header(ws, [
    { header: 'Ngày', width: 12 },
    { header: 'Số phiếu thu', width: 12 },
    { header: 'Thu tiền mặt', width: 15 },
    { header: 'Thu chuyển khoản', width: 16 },
    { header: 'Thu khác', width: 12 },
    { header: 'Hoàn / đảo', width: 14 },
    { header: 'Tiền mặt thực thu', width: 17 },
    { header: 'Thực thu', width: 15 },
    { header: 'Lũy kế', width: 15 },
  ]);
  for (const r of rows) ws.addRow([formatDateVN(r.day), r.receiptCount, r.cash, r.bank, r.other, r.adjustments, r.cashNet, r.net, r.runningNet]);
  const t = ws.addRow(['TỔNG', totals.receiptCount, totals.cash, totals.bank, totals.other, totals.adjustments, totals.cashNet, totals.net, null]);
  t.font = { bold: true };
  for (const c of [3, 4, 5, 6, 7, 8, 9]) ws.getColumn(c).numFmt = MONEY;
  await save(wb, `tong-hop-thu-${range.from}-${range.to}.xlsx`);
}
