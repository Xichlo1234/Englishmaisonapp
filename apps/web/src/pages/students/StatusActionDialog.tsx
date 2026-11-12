import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { vnDate } from '@ecm/shared';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { DateInput } from '@/components/ui/date-input';
import { Textarea } from '@/components/ui/textarea';
import { FormField } from '@/components/common/form-field';
import { errorMessage } from '@/components/common/page';
import { studentKeys, studentsApi, type StudentDetail } from '@/services/students';

export type StatusAction = 'pause' | 'drop' | 'reactivate' | 'archive' | 'restore';

const META: Record<StatusAction, { title: string; desc: string; confirm: string; date?: boolean; until?: boolean; reason: 'required' | 'optional' | 'none'; destructive?: boolean }> = {
  pause: {
    title: 'Tạm nghỉ',
    desc: 'Học sinh sẽ được rút khỏi các lớp đang học kể từ ngày tạm nghỉ. Điểm danh, điểm và học phí cũ được giữ nguyên.',
    confirm: 'Xác nhận tạm nghỉ',
    date: true,
    until: true,
    reason: 'required',
  },
  drop: {
    title: 'Nghỉ học',
    desc: 'Học sinh sẽ được rút khỏi các lớp đang học kể từ ngày nghỉ. Lịch sử học tập và tài chính được giữ nguyên.',
    confirm: 'Xác nhận nghỉ học',
    date: true,
    reason: 'required',
    destructive: true,
  },
  reactivate: {
    title: 'Quay lại học',
    desc: 'Chuyển học sinh về trạng thái "Đang học". Sau đó cần xếp lớp lại cho học sinh.',
    confirm: 'Quay lại học',
    reason: 'optional',
  },
  archive: {
    title: 'Lưu trữ hồ sơ',
    desc: 'Hồ sơ sẽ bị ẩn khỏi danh sách (không xóa). Có thể khôi phục bất cứ lúc nào.',
    confirm: 'Lưu trữ',
    reason: 'required',
    destructive: true,
  },
  restore: {
    title: 'Khôi phục hồ sơ',
    desc: 'Hồ sơ được hiển thị lại với trạng thái "Nghỉ học" (hoặc "Hoàn thành" nếu trước đó đã hoàn thành).',
    confirm: 'Khôi phục',
    reason: 'none',
  },
};

export function StatusActionDialog({ student, action, onClose }: { student: StudentDetail; action: StatusAction | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [date, setDate] = useState(vnDate());
  const [until, setUntil] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const m = action ? META[action] : null;

  const mut = useMutation({
    mutationFn: () =>
      studentsApi.action(student.id, action!, {
        version: student.version,
        ...(m?.date ? { effectiveDate: date } : {}),
        ...(m?.until && until ? { until } : {}),
        ...(m?.reason !== 'none' && reason.trim() ? { reason: reason.trim() } : {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: studentKeys.all });
      toast.success('Đã cập nhật trạng thái');
      close();
    },
    onError: (e) => setError(errorMessage(e)),
  });

  function close() {
    setError(null);
    setReason('');
    setUntil('');
    setDate(vnDate());
    onClose();
  }

  if (!m) return null;
  const reasonInvalid = m.reason === 'required' && reason.trim().length < 3;
  return (
    <Dialog open={!!action} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {m.title}: {student.fullName}
          </DialogTitle>
          <DialogDescription>{m.desc}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {error && <Alert variant="destructive">{error}</Alert>}
          {m.date && (
            <FormField label="Ngày hiệu lực" htmlFor="eff" required>
              <DateInput id="eff" value={date} onChange={setDate} />
            </FormField>
          )}
          {m.until && (
            <FormField label="Dự kiến quay lại" htmlFor="until">
              <DateInput id="until" min={date} value={until} onChange={setUntil} />
            </FormField>
          )}
          {m.reason !== 'none' && (
            <FormField label="Lý do" htmlFor="reason" required={m.reason === 'required'}>
              <Textarea id="reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
            </FormField>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Hủy
          </Button>
          <Button
            variant={m.destructive ? 'destructive' : 'default'}
            disabled={mut.isPending || reasonInvalid || (m.date && !date)}
            onClick={() => mut.mutate()}
          >
            {mut.isPending && <Loader2 className="animate-spin" />} {m.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
