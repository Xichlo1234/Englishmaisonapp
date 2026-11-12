import { formatDateVN, STUDENT_STATUS_LABELS } from '@ecm/shared';
import type { StudentExportRow } from '@/services/students';
import { GENDER_LABELS } from '@/lib/format';

/** Tạo file Excel ở trình duyệt (không tốn CPU của Worker). */
export async function downloadStudentsXlsx(rows: StudentExportRow[]) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Quản lý lớp học';
  const ws = wb.addWorksheet('Học sinh', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'Mã HS', key: 'code', width: 10 },
    { header: 'Họ và tên', key: 'name', width: 26 },
    { header: 'Ngày sinh', key: 'dob', width: 12 },
    { header: 'Giới tính', key: 'gender', width: 9 },
    { header: 'Trường', key: 'school', width: 22 },
    { header: 'Lớp ở trường', key: 'grade', width: 11 },
    { header: 'Địa chỉ', key: 'address', width: 30 },
    { header: 'Trình độ', key: 'level', width: 11 },
    { header: 'Lớp tại trung tâm', key: 'classes', width: 20 },
    { header: 'Phụ huynh', key: 'guardian', width: 22 },
    { header: 'SĐT phụ huynh', key: 'phone', width: 14 },
    { header: 'Ngày bắt đầu', key: 'start', width: 12 },
    { header: 'Trạng thái', key: 'status', width: 12 },
  ];
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
  for (const r of rows) {
    ws.addRow({
      code: r.studentCode,
      name: r.fullName,
      dob: formatDateVN(r.dateOfBirth),
      gender: r.gender ? GENDER_LABELS[r.gender] : '',
      school: r.schoolName ?? '',
      grade: r.schoolGrade ?? '',
      address: r.address ?? '',
      level: r.englishLevel ?? '',
      classes: r.currentClasses.map((c) => c.code).join(', '),
      guardian: r.primaryGuardian?.name ?? '',
      phone: r.primaryGuardian?.phone ?? '',
      start: formatDateVN(r.startDate),
      status: STUDENT_STATUS_LABELS[r.status],
    });
  }
  // SĐT dạng text để giữ số 0 đầu
  ws.getColumn('phone').numFmt = '@';
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const d = new Date();
  a.download = `hoc-sinh-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.xlsx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
