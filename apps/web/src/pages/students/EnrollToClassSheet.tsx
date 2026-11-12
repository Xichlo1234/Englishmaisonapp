import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { vnDate, WEEKDAY_LABELS } from '@ecm/shared';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { FormField } from '@/components/common/form-field';
import { errorMessage } from '@/components/common/page';
import { useAuth } from '@/hooks/use-auth';
import { ApiError } from '@/lib/api';
import { classesApi, classKeys } from '@/services/classes';
import { studentKeys, type StudentDetail } from '@/services/students';

/** Xếp học sinh vào một lớp (từ trang học sinh). */
export function EnrollToClassSheet({ student, open, onOpenChange }: { student: StudentDetail; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [classId, setClassId] = useState('');
  const [date, setDate] = useState(vnDate());
  const [override, setOverride] = useState('');
  const [capacityHit, setCapacityHit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const classes = useQuery({ queryKey: classKeys.list({ for: 'enroll' }), queryFn: () => classesApi.list({}).then((r) => r.data), enabled: open });
  const current = new Set(student.enrollments.filter((e) => e.status === 'ACTIVE').map((e) => e.classId));
  const options = (classes.data ?? []).filter((c) => !current.has(c.id));
  const sorted = [...options].sort((a, b) => Number(b.englishLevel === student.englishLevel) - Number(a.englishLevel === student.englishLevel));
  const target = options.find((c) => String(c.id) === classId);
  const mut = useMutation({
    mutationFn: () =>
      classesApi.enroll(Number(classId), { studentIds: [student.id], startDate: date, ...(override.trim() ? { overrideCapacityReason: override.trim() } : {}) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: studentKeys.all });
      qc.invalidateQueries({ queryKey: classKeys.all });
      toast.success('Đã xếp lớp');
      setClassId('');
      setOverride('');
      setCapacityHit(false);
      onOpenChange(false);
    },
    onError: (e) => {
      setError(errorMessage(e));
      if (e instanceof ApiError && e.code === 'CLASS_FULL') setCapacityHit(true);
    },
  });
  return (
    <Sheet open={open} onOpenChange={(o) => (setError(null), onOpenChange(o))}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Xếp lớp cho {student.fullName}</SheetTitle>
          <SheetDescription>Lớp cùng trình độ {student.englishLevel ? `(${student.englishLevel}) ` : ''}được xếp lên đầu.</SheetDescription>
        </SheetHeader>
        {error && <Alert variant="destructive">{error}</Alert>}
        <FormField label="Lớp" htmlFor="en-class" required>
          <NativeSelect id="en-class" value={classId} onChange={(e) => setClassId(e.target.value)}>
            <option value="">— Chọn lớp —</option>
            {sorted.map((c) => (
              <option key={c.id} value={c.id}>
                {c.classCode} – {c.name} ({c.activeStudents}/{c.maxStudents}){c.englishLevel ? ` · ${c.englishLevel}` : ''}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        {target && (
          <div className="rounded-md bg-muted p-3 text-sm">
            <div>Giáo viên: {target.mainTeacherName ?? '—'}</div>
            <div>
              Lịch: {target.schedules.length ? target.schedules.map((s) => `${WEEKDAY_LABELS[s.weekday]} ${s.startTime}–${s.endTime}`).join(', ') : 'Chưa có lịch'}
            </div>
          </div>
        )}
        <FormField label="Ngày vào lớp" htmlFor="en-date" required>
          <Input id="en-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </FormField>
        {capacityHit && user?.role === 'ADMIN' && (
          <FormField label="Lý do vượt sĩ số (chỉ quản trị viên)" htmlFor="en-override">
            <Input id="en-override" value={override} onChange={(e) => setOverride(e.target.value)} />
          </FormField>
        )}
        <SheetFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Hủy
          </Button>
          <Button disabled={!classId || !date || mut.isPending} onClick={() => (setError(null), mut.mutate())}>
            {mut.isPending && <Loader2 className="animate-spin" />} Xếp lớp
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
