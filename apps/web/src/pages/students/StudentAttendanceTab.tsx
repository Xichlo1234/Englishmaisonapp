import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { formatDateVN, isoWeekday, WEEKDAY_LABELS } from '@ecm/shared';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyBlock, ErrorBlock, LoadingBlock } from '@/components/common/page';
import { cn } from '@/lib/utils';
import { attendanceApi, attendanceKeys, STATUS_STYLE } from '@/services/attendance';

/** Chuyên cần 90 ngày gần nhất của học sinh. */
export function StudentAttendanceTab({ studentId }: { studentId: number }) {
  const q = useQuery({ queryKey: attendanceKeys.student(studentId), queryFn: () => attendanceApi.student(studentId) });
  if (q.isLoading) return <LoadingBlock />;
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => q.refetch()} />;
  const { stats, records, from, to } = q.data!;
  const tiles = [
    { label: 'Số buổi đã học', value: stats.total, tone: 'bg-accent text-accent-foreground' },
    { label: 'Có mặt', value: stats.present, tone: STATUS_STYLE.PRESENT.cell },
    { label: 'Đi muộn', value: stats.late, tone: STATUS_STYLE.LATE.cell },
    { label: 'Vắng', value: stats.absent, tone: STATUS_STYLE.UNEXCUSED.cell },
    { label: 'Tỷ lệ chuyên cần', value: stats.rate === null ? '—' : `${stats.rate}%`, tone: stats.rate !== null && stats.rate < 80 ? 'bg-danger-soft text-red-700' : 'bg-success-soft text-green-800' },
  ];
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Từ {formatDateVN(from)} đến {formatDateVN(to)} · Tỷ lệ chuyên cần = (Có mặt + Đi muộn) / Số buổi đã điểm danh
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {tiles.map((t) => (
          <div key={t.label} className={cn('rounded-lg px-4 py-3', t.tone)}>
            <div className="text-xs">{t.label}</div>
            <div className="text-2xl font-semibold">{t.value}</div>
          </div>
        ))}
      </div>
      <Card className="overflow-hidden p-0">
        {records.length === 0 ? (
          <EmptyBlock title="Chưa có dữ liệu điểm danh" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ngày</TableHead>
                <TableHead>Lớp</TableHead>
                <TableHead>Trạng thái</TableHead>
                <TableHead>Ghi chú</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map((r) => (
                <TableRow key={r.lessonId}>
                  <TableCell className="whitespace-nowrap">
                    <Link to={`/diem-danh/${r.lessonId}`} className="hover:text-primary">
                      {WEEKDAY_LABELS[isoWeekday(r.lessonDate)]}, {formatDateVN(r.lessonDate)} {r.startTime}
                    </Link>
                  </TableCell>
                  <TableCell>{r.classCode}</TableCell>
                  <TableCell>
                    <span className={cn('rounded px-2 py-0.5 text-xs font-medium', STATUS_STYLE[r.status].cell)}>
                      {STATUS_STYLE[r.status].label}
                      {r.status === 'LATE' && r.lateMinutes ? ` ${r.lateMinutes} phút` : ''}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{r.note}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
