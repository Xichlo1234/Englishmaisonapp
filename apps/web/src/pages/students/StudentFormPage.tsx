import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useFieldArray, useForm, useWatch, type UseFormReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { AlertTriangle, ArrowLeft, Link2, Loader2, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { isoDate, normalizePhone, RELATIONSHIPS, RELATIONSHIP_LABELS, vnDate } from '@ecm/shared';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { FormField } from '@/components/common/form-field';
import { ErrorBlock, errorMessage, LoadingBlock, PageHeader } from '@/components/common/page';
import { useDebounced } from '@/hooks/use-debounce';
import { usePublicSettings } from '@/hooks/use-settings';
import { ApiError } from '@/lib/api';
import { formatDateVN } from '@/lib/format';
import { studentKeys, studentsApi, type StudentDetail } from '@/services/students';

const optionalDate = z.union([z.literal(''), isoDate]);

export const guardianFormSchema = z
  .object({
    mode: z.enum(['new', 'existing']),
    guardianId: z.number().optional(),
    existingLabel: z.string().optional(),
    fullName: z.string().trim(),
    phone: z.string().trim(),
    email: z.string().trim(),
    relationship: z.enum(RELATIONSHIPS),
    isPrimary: z.boolean(),
  })
  .superRefine((g, ctx) => {
    if (g.mode === 'existing') {
      if (!g.guardianId) ctx.addIssue({ code: 'custom', path: ['phone'], message: 'Chọn phụ huynh' });
      return;
    }
    if (g.fullName.length < 2) ctx.addIssue({ code: 'custom', path: ['fullName'], message: 'Nhập tên phụ huynh' });
    if (!normalizePhone(g.phone)) ctx.addIssue({ code: 'custom', path: ['phone'], message: 'Số điện thoại không hợp lệ' });
    if (g.email && !z.email().safeParse(g.email).success)
      ctx.addIssue({ code: 'custom', path: ['email'], message: 'Email không hợp lệ' });
  });
export type GuardianFormValues = z.infer<typeof guardianFormSchema>;

const formSchema = z
  .object({
    fullName: z.string().trim().min(2, 'Họ tên tối thiểu 2 ký tự').max(100),
    dateOfBirth: optionalDate,
    gender: z.enum(['', 'MALE', 'FEMALE', 'OTHER']),
    address: z.string().max(300),
    schoolName: z.string().max(150),
    schoolGrade: z.string().max(30),
    startDate: isoDate,
    englishLevel: z.string().max(50),
    needsAttention: z.boolean(),
    attentionNote: z.string().max(500),
    notes: z.string().max(2000),
    guardians: z.array(guardianFormSchema),
  })
  .refine((v) => !v.dateOfBirth || v.dateOfBirth < v.startDate, {
    message: 'Ngày sinh phải trước ngày bắt đầu học',
    path: ['dateOfBirth'],
  });
type FormValues = z.infer<typeof formSchema>;

export const emptyGuardian = (isPrimary: boolean): GuardianFormValues => ({
  mode: 'new',
  fullName: '',
  phone: '',
  email: '',
  relationship: 'MOTHER',
  isPrimary,
});

export function toGuardianPayload(g: GuardianFormValues) {
  return g.mode === 'existing'
    ? { guardianId: g.guardianId, relationship: g.relationship, isPrimary: g.isPrimary }
    : {
        guardian: { fullName: g.fullName, phone: g.phone, email: g.email || null },
        relationship: g.relationship,
        isPrimary: g.isPrimary,
      };
}

const nullIfEmpty = (s: string) => (s.trim() ? s.trim() : null);

function toProfilePayload(v: FormValues) {
  return {
    fullName: v.fullName,
    dateOfBirth: v.dateOfBirth || null,
    gender: v.gender || null,
    address: nullIfEmpty(v.address),
    schoolName: nullIfEmpty(v.schoolName),
    schoolGrade: nullIfEmpty(v.schoolGrade),
    startDate: v.startDate,
    englishLevel: nullIfEmpty(v.englishLevel),
    needsAttention: v.needsAttention,
    attentionNote: nullIfEmpty(v.attentionNote),
    notes: nullIfEmpty(v.notes),
  };
}

function defaultsFrom(s?: StudentDetail): FormValues {
  return {
    fullName: s?.fullName ?? '',
    dateOfBirth: s?.dateOfBirth ?? '',
    gender: s?.gender ?? '',
    address: s?.address ?? '',
    schoolName: s?.schoolName ?? '',
    schoolGrade: s?.schoolGrade ?? '',
    startDate: s?.startDate ?? vnDate(),
    englishLevel: s?.englishLevel ?? '',
    needsAttention: s?.needsAttention ?? false,
    attentionNote: s?.attentionNote ?? '',
    notes: s?.notes ?? '',
    guardians: s ? [] : [emptyGuardian(true)],
  };
}

export function StudentFormPage() {
  const { id } = useParams();
  const editId = id ? Number(id) : null;
  const detail = useQuery({
    queryKey: studentKeys.detail(editId ?? 0),
    queryFn: () => studentsApi.detail(editId!),
    enabled: !!editId,
  });
  if (editId && detail.isLoading) return <LoadingBlock />;
  if (editId && detail.isError) return <ErrorBlock error={detail.error} onRetry={() => detail.refetch()} />;
  return <StudentForm student={detail.data} key={detail.data?.version ?? 'new'} />;
}

function StudentForm({ student }: { student?: StudentDetail }) {
  const isEdit = !!student;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const settings = usePublicSettings();
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<FormValues>({ resolver: zodResolver(formSchema), defaultValues: defaultsFrom(student) });
  const guardians = useFieldArray({ control: form.control, name: 'guardians' });
  const e = form.formState.errors;

  // Cảnh báo trùng (không chặn)
  const [fullName, dob, firstPhone] = useWatch({
    control: form.control,
    name: ['fullName', 'dateOfBirth', 'guardians.0.phone'],
  });
  const dupKey = useDebounced({ fullName, dob, phone: firstPhone }, 500);
  const duplicates = useQuery({
    queryKey: ['students', 'dups', dupKey, student?.id],
    queryFn: () =>
      studentsApi.duplicates({
        fullName: dupKey.fullName || undefined,
        dateOfBirth: dupKey.dob || undefined,
        phone: normalizePhone(dupKey.phone ?? '') ?? undefined,
        excludeId: student?.id,
      }),
    enabled: (!!dupKey.fullName && !!dupKey.dob) || !!normalizePhone(dupKey.phone ?? ''),
  });

  const save = useMutation({
    mutationFn: async (v: FormValues) => {
      if (isEdit) {
        await studentsApi.update(student.id, { ...toProfilePayload(v), version: student.version });
        return student.id;
      }
      const res = await studentsApi.create({ ...toProfilePayload(v), guardians: v.guardians.map(toGuardianPayload) });
      return res.id;
    },
    onSuccess: (sid) => {
      qc.invalidateQueries({ queryKey: studentKeys.all });
      toast.success(isEdit ? 'Đã lưu thay đổi' : 'Đã thêm học sinh');
      navigate(`/hoc-sinh/${sid}`, { replace: true });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'VERSION_CONFLICT') {
        setServerError('Hồ sơ vừa được người khác cập nhật. Tải lại trang để xem dữ liệu mới nhất trước khi sửa.');
        return;
      }
      if (err instanceof ApiError && err.fieldErrors.length) {
        setServerError(err.fieldErrors.map((f) => f.message).join('. '));
        return;
      }
      setServerError(errorMessage(err));
    },
  });

  const onSubmit = form.handleSubmit((v) => {
    setServerError(null);
    if (!isEdit && v.guardians.length === 0) {
      setServerError('Cần ít nhất một phụ huynh');
      return;
    }
    save.mutate(v);
  });

  const levels = settings.data?.english_levels ?? [];
  const backTo = isEdit ? `/hoc-sinh/${student.id}` : '/hoc-sinh';

  return (
    <form onSubmit={onSubmit} noValidate className="max-w-4xl">
      <PageHeader
        title={isEdit ? `Sửa hồ sơ: ${student.fullName}` : 'Thêm học sinh'}
        description={isEdit ? student.studentCode : 'Mã học sinh được tạo tự động sau khi lưu'}
        actions={
          <Button variant="ghost" asChild>
            <Link to={backTo}>
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
      {!!duplicates.data?.data.length && (
        <Alert variant="warning" className="mb-4">
          <AlertTriangle />
          <div>
            <p className="font-medium">Có thể trùng với học sinh đã có:</p>
            <ul className="mt-1 list-disc pl-4">
              {duplicates.data.data.map((d) => (
                <li key={d.id}>
                  <Link to={`/hoc-sinh/${d.id}`} target="_blank" className="underline">
                    {d.studentCode} – {d.fullName}
                  </Link>
                  {d.dateOfBirth && `, sinh ${formatDateVN(d.dateOfBirth)}`}
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs">Vẫn có thể lưu nếu đây là học sinh khác (ví dụ anh/chị/em cùng phụ huynh).</p>
          </div>
        </Alert>
      )}

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Thông tin cá nhân</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <FormField label="Họ và tên" htmlFor="fullName" required error={e.fullName?.message} className="sm:col-span-2">
              <Input id="fullName" {...form.register('fullName')} aria-invalid={!!e.fullName} autoFocus={!isEdit} />
            </FormField>
            <FormField label="Ngày sinh" htmlFor="dob" error={e.dateOfBirth?.message}>
              <Input id="dob" type="date" {...form.register('dateOfBirth')} aria-invalid={!!e.dateOfBirth} />
            </FormField>
            <FormField label="Giới tính" htmlFor="gender">
              <NativeSelect id="gender" {...form.register('gender')}>
                <option value="">—</option>
                <option value="MALE">Nam</option>
                <option value="FEMALE">Nữ</option>
                <option value="OTHER">Khác</option>
              </NativeSelect>
            </FormField>
            <FormField label="Địa chỉ" htmlFor="address" className="sm:col-span-2">
              <Input id="address" {...form.register('address')} />
            </FormField>
            <FormField label="Trường đang học" htmlFor="school">
              <Input id="school" {...form.register('schoolName')} />
            </FormField>
            <FormField label="Lớp ở trường" htmlFor="grade">
              <Input id="grade" placeholder="VD: 5A" {...form.register('schoolGrade')} />
            </FormField>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Thông tin học tập</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <FormField label="Ngày bắt đầu học" htmlFor="start" required error={e.startDate?.message}>
              <Input id="start" type="date" {...form.register('startDate')} aria-invalid={!!e.startDate} />
            </FormField>
            <FormField label="Trình độ tiếng Anh" htmlFor="level" hint="Danh mục cấu hình trong Cài đặt">
              <NativeSelect id="level" {...form.register('englishLevel')}>
                <option value="">—</option>
                {levels.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
                {student?.englishLevel && !levels.includes(student.englishLevel) && (
                  <option value={student.englishLevel}>{student.englishLevel}</option>
                )}
              </NativeSelect>
            </FormField>
            <div className="flex items-center gap-2 sm:col-span-2">
              <Checkbox
                id="attention"
                checked={form.watch('needsAttention')}
                onCheckedChange={(c) => form.setValue('needsAttention', c === true, { shouldDirty: true })}
              />
              <label htmlFor="attention" className="text-sm">
                Học sinh cần theo dõi đặc biệt
              </label>
            </div>
            {form.watch('needsAttention') && (
              <FormField label="Lý do cần theo dõi" htmlFor="attNote" className="sm:col-span-2">
                <Input id="attNote" {...form.register('attentionNote')} />
              </FormField>
            )}
            <FormField label="Ghi chú nội bộ" htmlFor="notes" hint="Phụ huynh không nhìn thấy ghi chú này" className="sm:col-span-2">
              <Textarea id="notes" rows={3} {...form.register('notes')} />
            </FormField>
            {!isEdit && (
              <p className="text-xs text-muted-foreground sm:col-span-2">
                Xếp lớp và ca học được thực hiện ở module Lớp học sau khi lưu hồ sơ.
              </p>
            )}
          </CardContent>
        </Card>

        {!isEdit && (
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Phụ huynh</CardTitle>
              {guardians.fields.length < 3 && (
                <Button type="button" variant="outline" size="sm" onClick={() => guardians.append(emptyGuardian(false))}>
                  <Plus /> Thêm phụ huynh
                </Button>
              )}
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {guardians.fields.map((f, i) => (
                <GuardianFields
                  key={f.id}
                  form={form as unknown as UseFormReturn<{ guardians: GuardianFormValues[] }>}
                  index={i}
                  onRemove={guardians.fields.length > 1 ? () => guardians.remove(i) : undefined}
                  onPrimary={() => guardians.fields.forEach((_, j) => form.setValue(`guardians.${j}.isPrimary`, j === i))}
                />
              ))}
              {e.guardians?.message && <p className="text-xs text-destructive">{e.guardians.message}</p>}
            </CardContent>
          </Card>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => navigate(backTo)}>
            Hủy
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending && <Loader2 className="animate-spin" />} {isEdit ? 'Lưu thay đổi' : 'Lưu học sinh'}
          </Button>
        </div>
      </div>
    </form>
  );
}

/** Nhóm trường phụ huynh: nhập SĐT → gợi ý phụ huynh đã có (anh/chị/em cùng gia đình). */
export function GuardianFields({
  form,
  index,
  onRemove,
  onPrimary,
}: {
  form: UseFormReturn<{ guardians: GuardianFormValues[] }>;
  index: number;
  onRemove?: () => void;
  onPrimary?: () => void;
}) {
  const base = `guardians.${index}` as const;
  const g = useWatch({ control: form.control, name: base });
  const err = form.formState.errors.guardians?.[index];
  const phone = normalizePhone(g?.phone ?? '');
  const lookup = useQuery({
    queryKey: ['guardians', 'phone', phone],
    queryFn: () => studentsApi.findGuardians(phone!),
    enabled: !!phone && g?.mode === 'new',
    staleTime: 30_000,
  });
  const match = lookup.data?.data[0];

  useEffect(() => {
    // giữ đúng kiểu dữ liệu khi chuyển chế độ
    if (g?.mode === 'existing' && !g.guardianId) form.setValue(`${base}.mode`, 'new');
  }, [g?.mode, g?.guardianId, base, form]);

  if (!g) return null;
  return (
    <div className="rounded-lg border p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-medium">Phụ huynh {index + 1}</span>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" checked={g.isPrimary} onChange={() => onPrimary?.()} className="accent-primary" />
            Liên hệ chính
          </label>
          {onRemove && (
            <Button type="button" variant="ghost" size="icon" onClick={onRemove} aria-label="Bỏ phụ huynh này">
              <Trash2 className="text-destructive" />
            </Button>
          )}
        </div>
      </div>

      {g.mode === 'existing' ? (
        <div className="flex items-center justify-between rounded-md bg-accent px-3 py-2 text-sm">
          <span>
            <Link2 className="mr-1.5 inline size-4" />
            {g.existingLabel}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              form.setValue(`${base}.mode`, 'new');
              form.setValue(`${base}.guardianId`, undefined);
            }}
          >
            <X /> Nhập phụ huynh khác
          </Button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Số điện thoại" htmlFor={`${base}.phone`} required error={err?.phone?.message}>
            <Input id={`${base}.phone`} inputMode="tel" {...form.register(`${base}.phone`)} aria-invalid={!!err?.phone} />
          </FormField>
          <FormField label="Họ tên phụ huynh" htmlFor={`${base}.fullName`} required error={err?.fullName?.message}>
            <Input id={`${base}.fullName`} {...form.register(`${base}.fullName`)} aria-invalid={!!err?.fullName} />
          </FormField>
          {match && (
            <Alert variant="info" className="sm:col-span-2">
              <div className="flex flex-1 flex-wrap items-center justify-between gap-2">
                <span>
                  SĐT này đã có phụ huynh <b>{match.fullName}</b>
                  {match.children && ` (con: ${match.children})`}.
                </span>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    form.setValue(`${base}.mode`, 'existing');
                    form.setValue(`${base}.guardianId`, match.id);
                    form.setValue(`${base}.existingLabel`, `${match.fullName} – ${match.phone}`);
                  }}
                >
                  Dùng phụ huynh này
                </Button>
              </div>
            </Alert>
          )}
          <FormField label="Email" htmlFor={`${base}.email`} error={err?.email?.message}>
            <Input id={`${base}.email`} type="email" {...form.register(`${base}.email`)} />
          </FormField>
        </div>
      )}
      <div className="mt-3 max-w-56">
        <FormField label="Quan hệ" htmlFor={`${base}.rel`}>
          <NativeSelect id={`${base}.rel`} {...form.register(`${base}.relationship`)}>
            {RELATIONSHIPS.map((r) => (
              <option key={r} value={r}>
                {RELATIONSHIP_LABELS[r]}
              </option>
            ))}
          </NativeSelect>
        </FormField>
      </div>
    </div>
  );
}
