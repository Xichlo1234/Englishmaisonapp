import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { vnDate } from '@ecm/shared';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { FormField } from '@/components/common/form-field';
import { ErrorBlock, errorMessage, LoadingBlock, PageHeader } from '@/components/common/page';
import { useTeachers } from '@/hooks/use-catalog';
import { usePublicSettings } from '@/hooks/use-settings';
import { ApiError } from '@/lib/api';
import { classesApi, classKeys, type ClassDetail } from '@/services/classes';
import { emptyScheduleRow, ScheduleRowsEditor, toScheduleInput, type ScheduleRow } from './ScheduleRowsEditor';

export function ClassFormPage() {
  const { id } = useParams();
  const editId = id ? Number(id) : null;
  const detail = useQuery({ queryKey: classKeys.detail(editId ?? 0), queryFn: () => classesApi.detail(editId!), enabled: !!editId });
  if (editId && detail.isLoading) return <LoadingBlock />;
  if (editId && detail.isError) return <ErrorBlock error={detail.error} onRetry={() => detail.refetch()} />;
  return <ClassForm cls={detail.data} key={detail.data?.version ?? 'new'} />;
}

function ClassForm({ cls }: { cls?: ClassDetail }) {
  const isEdit = !!cls;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const teachers = useTeachers();
  const settings = usePublicSettings();
  const [classCode, setClassCode] = useState(cls?.classCode ?? '');
  const [name, setName] = useState(cls?.name ?? '');
  const [level, setLevel] = useState(cls?.englishLevel ?? '');
  const [teacherId, setTeacherId] = useState<number | ''>(cls?.mainTeacherId ?? '');
  const [maxStudents, setMaxStudents] = useState(String(cls?.maxStudents ?? 15));
  const [startDate, setStartDate] = useState(cls?.startDate ?? vnDate());
  const [endDate, setEndDate] = useState(cls?.endDate ?? '');
  const [notes, setNotes] = useState(cls?.notes ?? '');
  const [rows, setRows] = useState<ScheduleRow[]>([emptyScheduleRow()]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  function validate() {
    const e: Record<string, string> = {};
    if (!isEdit && !/^[A-Za-z0-9._-]{2,30}$/.test(classCode.trim())) e.classCode = 'Mã lớp 2–30 ký tự: chữ không dấu, số, . _ -';
    if (name.trim().length < 2) e.name = 'Nhập tên lớp';
    if (!teacherId) e.teacherId = 'Chọn giáo viên chính';
    const max = Number(maxStudents);
    if (!Number.isInteger(max) || max < 1 || max > 100) e.maxStudents = 'Sĩ số từ 1 đến 100';
    if (!startDate) e.startDate = 'Chọn ngày bắt đầu';
    if (endDate && endDate < startDate) e.endDate = 'Ngày kết thúc phải sau ngày bắt đầu';
    setErrors(e);
    return !Object.keys(e).length;
  }

  const save = useMutation({
    mutationFn: async () => {
      const base = {
        name: name.trim(),
        englishLevel: level || null,
        mainTeacherId: Number(teacherId),
        maxStudents: Number(maxStudents),
        startDate,
        endDate: endDate || null,
        notes: notes.trim() || null,
      };
      if (isEdit) {
        await classesApi.update(cls.id, { ...base, version: cls.version });
        return cls.id;
      }
      const res = await classesApi.create({ ...base, classCode: classCode.trim(), schedules: rows.filter((r) => r.shiftId).map(toScheduleInput) });
      return res.id;
    },
    onSuccess: (cid) => {
      qc.invalidateQueries({ queryKey: classKeys.all });
      qc.invalidateQueries({ queryKey: ['calendar'] });
      toast.success(isEdit ? 'Đã lưu lớp học' : 'Đã tạo lớp. Kiểm tra lại rồi bấm "Mở lớp" để sinh buổi học.');
      navigate(`/lop-hoc/${cid}`, { replace: true });
    },
    onError: (e) => setServerError(e instanceof ApiError && e.code === 'VERSION_CONFLICT' ? 'Lớp vừa được người khác cập nhật, hãy tải lại trang.' : errorMessage(e)),
  });

  const levels = settings.data?.english_levels ?? [];
  return (
    <form
      className="max-w-4xl"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setServerError(null);
        if (validate()) save.mutate();
      }}
    >
      <PageHeader
        title={isEdit ? `Sửa lớp ${cls.classCode}` : 'Tạo lớp học'}
        actions={
          <Button variant="ghost" asChild>
            <Link to={isEdit ? `/lop-hoc/${cls.id}` : '/lop-hoc'}>
              <ArrowLeft /> Quay lại
            </Link>
          </Button>
        }
      />
      {serverError && (
        <Alert variant="destructive" className="mb-4">
          {serverError}
        </Alert>
      )}
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Thông tin lớp</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <FormField label="Mã lớp" htmlFor="code" required error={errors.classCode} hint={isEdit ? 'Không đổi được mã lớp' : 'VD: MOV-2611-A'}>
              <Input id="code" value={classCode} disabled={isEdit} onChange={(e) => setClassCode(e.target.value.toUpperCase())} />
            </FormField>
            <FormField label="Tên lớp" htmlFor="name" required error={errors.name}>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
            </FormField>
            <FormField label="Trình độ" htmlFor="level">
              <NativeSelect id="level" value={level} onChange={(e) => setLevel(e.target.value)}>
                <option value="">—</option>
                {levels.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField label="Giáo viên chính" htmlFor="teacher" required error={errors.teacherId}>
              <NativeSelect id="teacher" value={teacherId} onChange={(e) => setTeacherId(e.target.value ? Number(e.target.value) : '')}>
                <option value="">— Chọn giáo viên —</option>
                {(teachers.data ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.fullName}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField label="Sĩ số tối đa" htmlFor="max" required error={errors.maxStudents}>
              <Input id="max" type="number" min={1} max={100} value={maxStudents} onChange={(e) => setMaxStudents(e.target.value)} />
            </FormField>
            <div />
            <FormField label="Ngày bắt đầu" htmlFor="start" required error={errors.startDate}>
              <Input id="start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </FormField>
            <FormField label="Ngày kết thúc (dự kiến)" htmlFor="end" error={errors.endDate}>
              <Input id="end" type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} />
            </FormField>
            <FormField label="Ghi chú" htmlFor="notes" className="sm:col-span-2">
              <Textarea id="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </FormField>
          </CardContent>
        </Card>

        {!isEdit && (
          <Card>
            <CardHeader>
              <CardTitle>Lịch học hằng tuần</CardTitle>
              <p className="text-sm text-muted-foreground">Mỗi dòng là một buổi trong tuần. Có thể bổ sung sau ở trang chi tiết lớp.</p>
            </CardHeader>
            <CardContent>
              <ScheduleRowsEditor rows={rows} onChange={setRows} mainTeacherId={teacherId} effectiveFrom={startDate} effectiveTo={endDate || null} />
            </CardContent>
          </Card>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => navigate(-1)}>
            Hủy
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending && <Loader2 className="animate-spin" />} {isEdit ? 'Lưu thay đổi' : 'Tạo lớp'}
          </Button>
        </div>
      </div>
    </form>
  );
}
