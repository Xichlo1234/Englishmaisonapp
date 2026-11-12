import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Camera, Loader2, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { STUDENT_STATUS_LABELS, STUDENT_TRANSITIONS } from '@ecm/shared';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyBlock, ErrorBlock, errorMessage, LoadingBlock } from '@/components/common/page';
import { useAuth } from '@/hooks/use-auth';
import { fileUrl } from '@/lib/api';
import { ageFrom, formatDateTimeVN, formatDateVN, GENDER_LABELS, STUDENT_STATUS_VARIANT } from '@/lib/format';
import { studentKeys, studentsApi, type StudentDetail, type TimelineEntry } from '@/services/students';
import { GuardiansPanel } from './GuardiansPanel';
import { EnrollToClassSheet } from './EnrollToClassSheet';
import { TransferSheet } from '@/pages/classes/dialogs';
import { StatusActionDialog, type StatusAction } from './StatusActionDialog';

const ACTION_LABELS: Record<StatusAction, string> = {
  pause: 'Tạm nghỉ',
  drop: 'Nghỉ học',
  reactivate: 'Quay lại học',
  archive: 'Lưu trữ hồ sơ',
  restore: 'Khôi phục hồ sơ',
};

const END_REASON_LABELS: Record<string, string> = {
  TRANSFER: 'Chuyển lớp',
  PAUSE: 'Tạm nghỉ',
  DROP: 'Nghỉ học',
  CLASS_CLOSED: 'Lớp đóng',
  COMPLETED: 'Hoàn thành',
};

export function StudentDetailPage() {
  const id = Number(useParams().id);
  const q = useQuery({ queryKey: studentKeys.detail(id), queryFn: () => studentsApi.detail(id), enabled: Number.isInteger(id) });
  if (q.isLoading) return <LoadingBlock />;
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return null;
  return <StudentDetailView s={q.data} />;
}

function StudentDetailView({ s }: { s: StudentDetail }) {
  const { can, user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [action, setAction] = useState<StatusAction | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const [transfer, setTransfer] = useState<{ id: number; studentName: string; classId: number; classCode: string; startDate: string } | null>(null);
  const isFullScope = user?.role === 'ADMIN' || user?.role === 'OWNER';
  const available = (Object.keys(STUDENT_TRANSITIONS) as StatusAction[]).filter((a) =>
    (STUDENT_TRANSITIONS[a] as readonly string[]).includes(s.status),
  );

  const del = useMutation({
    mutationFn: () => studentsApi.remove(s.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: studentKeys.all });
      toast.success('Đã xóa hồ sơ');
      navigate('/hoc-sinh', { replace: true });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="max-w-5xl">
      <Button variant="ghost" size="sm" className="mb-3 -ml-2" asChild>
        <Link to="/hoc-sinh">
          <ArrowLeft /> Danh sách học sinh
        </Link>
      </Button>

      <Card className="mb-6">
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <StudentPhoto s={s} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold">{s.fullName}</h1>
              <Badge variant={STUDENT_STATUS_VARIANT[s.status]}>{STUDENT_STATUS_LABELS[s.status]}</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              <span className="font-mono">{s.studentCode}</span>
              {s.dateOfBirth && ` · ${formatDateVN(s.dateOfBirth)} (${ageFrom(s.dateOfBirth)} tuổi)`}
              {s.englishLevel && ` · ${s.englishLevel}`}
            </p>
            {s.status === 'PAUSED' && s.pauseUntil && (
              <p className="mt-1 text-sm text-yellow-700">Dự kiến quay lại: {formatDateVN(s.pauseUntil)}</p>
            )}
          </div>
          {s.canEdit && (
            <div className="flex gap-2">
              <Button variant="outline" asChild>
                <Link to={`/hoc-sinh/${s.id}/sua`}>
                  <Pencil /> Sửa hồ sơ
                </Link>
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" aria-label="Thao tác khác">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {available.map((a) => (
                    <DropdownMenuItem key={a} onSelect={() => setAction(a)}>
                      {ACTION_LABELS[a]}
                    </DropdownMenuItem>
                  ))}
                  {can('students.delete') && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onSelect={() => {
                          if (window.confirm('Xóa vĩnh viễn hồ sơ này? Chỉ thực hiện được với hồ sơ tạo nhầm, chưa có lịch sử học tập/tài chính.'))
                            del.mutate();
                        }}
                      >
                        <Trash2 /> Xóa hồ sơ tạo nhầm
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </CardContent>
      </Card>

      {s.needsAttention && (
        <Alert variant="warning" className="mb-4">
          <AlertTriangle />
          <span>
            <b>Cần theo dõi đặc biệt.</b> {s.attentionNote}
          </span>
        </Alert>
      )}

      <Tabs defaultValue="info">
        <TabsList>
          <TabsTrigger value="info">Thông tin</TabsTrigger>
          <TabsTrigger value="guardians">Phụ huynh ({s.guardians.length})</TabsTrigger>
          <TabsTrigger value="classes">Lớp học</TabsTrigger>
          {isFullScope && <TabsTrigger value="timeline">Nhật ký</TabsTrigger>}
        </TabsList>

        <TabsContent value="info">
          <Card>
            <CardContent>
              <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
                <Info label="Giới tính" value={s.gender ? GENDER_LABELS[s.gender] : null} />
                <Info label="Ngày bắt đầu học" value={formatDateVN(s.startDate)} />
                <Info label="Trường đang học" value={s.schoolName} />
                <Info label="Lớp ở trường" value={s.schoolGrade} />
                <Info label="Địa chỉ" value={s.address} wide />
                {s.notes !== null && <Info label="Ghi chú nội bộ" value={s.notes} wide />}
                <Info label="Cập nhật lần cuối" value={formatDateTimeVN(s.updatedAt)} />
              </dl>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="guardians">
          <GuardiansPanel student={s} />
        </TabsContent>

        <TabsContent value="classes">
          <Card>
            <CardContent>
              {can('enrollments.write') && s.status === 'ACTIVE' && (
                <div className="mb-4 flex justify-end">
                  <Button size="sm" onClick={() => setEnrolling(true)}>
                    Xếp lớp
                  </Button>
                </div>
              )}
              {s.enrollments.length === 0 ? (
                <EmptyBlock title="Chưa xếp lớp" description="Học sinh chưa được xếp vào lớp nào." />
              ) : (
                <ol className="relative flex flex-col gap-4 border-l pl-5">
                  {s.enrollments.map((e) => (
                    <li key={e.id}>
                      <span
                        className={`absolute -left-[5px] mt-1.5 size-2.5 rounded-full ${e.status === 'ACTIVE' ? 'bg-success' : 'bg-slate-300'}`}
                      />
                      <div className="flex flex-wrap items-center gap-2 font-medium">
                        <Link to={`/lop-hoc/${e.classId}`} className="hover:text-primary">
                          {e.classCode} – {e.className}
                        </Link>
                        {e.status === 'ACTIVE' && <Badge variant="success">Đang học</Badge>}
                        {e.status === 'ACTIVE' && can('enrollments.write') && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setTransfer({ id: e.id, studentName: s.fullName, classId: e.classId, classCode: e.classCode, startDate: e.startDate })}
                          >
                            Chuyển lớp/ca
                          </Button>
                        )}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {formatDateVN(e.startDate)} → {e.endDate ? formatDateVN(e.endDate) : 'nay'}
                        {e.endReason && ` · ${END_REASON_LABELS[e.endReason] ?? e.endReason}`}
                        {e.note && ` · ${e.note}`}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {isFullScope && (
          <TabsContent value="timeline">
            <Timeline studentId={s.id} />
          </TabsContent>
        )}
      </Tabs>

      <StatusActionDialog student={s} action={action} onClose={() => setAction(null)} />
      <EnrollToClassSheet student={s} open={enrolling} onOpenChange={setEnrolling} />
      <TransferSheet enrollment={transfer} onOpenChange={(o) => !o && setTransfer(null)} />
    </div>
  );
}

function Info({ label, value, wide }: { label: string; value: string | null | undefined; wide?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-2' : undefined}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-wrap">{value || '—'}</dd>
    </div>
  );
}

/** Nén ảnh ở trình duyệt về tối đa 1280px, JPEG — giảm dung lượng R2. */
async function compressImage(file: File, max = 1280): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Không xử lý được ảnh'))), 'image/jpeg', 0.85));
}

function StudentPhoto({ s }: { s: StudentDetail }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const upload = useMutation({
    mutationFn: async (f: File) => studentsApi.uploadPhoto(s.id, await compressImage(f)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: studentKeys.all });
      toast.success('Đã cập nhật ảnh');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const initials = s.fullName
    .split(' ')
    .slice(-2)
    .map((w) => w[0])
    .join('');
  return (
    <div className="relative size-20 shrink-0">
      {s.photoFileId ? (
        <img src={fileUrl(s.photoFileId)} alt={`Ảnh ${s.fullName}`} className="size-20 rounded-full border object-cover" />
      ) : (
        <div className="grid size-20 place-items-center rounded-full bg-accent text-xl font-semibold text-accent-foreground">{initials}</div>
      )}
      {s.canEdit && (
        <>
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={upload.isPending}
            className="absolute -bottom-1 -right-1 grid size-8 place-items-center rounded-full border bg-background shadow-sm hover:bg-accent"
            aria-label="Đổi ảnh"
          >
            {upload.isPending ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
          </button>
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload.mutate(f);
              e.target.value = '';
            }}
          />
        </>
      )}
    </div>
  );
}

const TIMELINE_LABELS: Record<string, string> = {
  'student.create': 'Tạo hồ sơ',
  'student.update': 'Sửa hồ sơ',
  'student.pause': 'Tạm nghỉ',
  'student.drop': 'Nghỉ học',
  'student.reactivate': 'Quay lại học',
  'student.archive': 'Lưu trữ hồ sơ',
  'student.restore': 'Khôi phục hồ sơ',
  'student.photo_upload': 'Cập nhật ảnh',
  'student.guardian_link': 'Thêm phụ huynh',
  'student.guardian_update': 'Sửa thông tin phụ huynh',
  'student.guardian_unlink': 'Bỏ liên kết phụ huynh',
};

const FIELD_LABELS: Record<string, string> = {
  fullName: 'Họ tên',
  dateOfBirth: 'Ngày sinh',
  gender: 'Giới tính',
  address: 'Địa chỉ',
  schoolName: 'Trường',
  schoolGrade: 'Lớp ở trường',
  startDate: 'Ngày bắt đầu',
  englishLevel: 'Trình độ',
  needsAttention: 'Cần theo dõi',
  attentionNote: 'Lý do theo dõi',
  notes: 'Ghi chú',
};

function describe(e: TimelineEntry): string | null {
  if (e.action === 'student.update' && e.after && typeof e.after === 'object') {
    return Object.entries(e.after as Record<string, { from: unknown; to: unknown }>)
      .map(([k, v]) => `${FIELD_LABELS[k] ?? k}: ${String(v.from ?? '—')} → ${String(v.to ?? '—')}`)
      .join('; ');
  }
  return e.reason;
}

function Timeline({ studentId }: { studentId: number }) {
  const q = useQuery({ queryKey: studentKeys.timeline(studentId), queryFn: () => studentsApi.timeline(studentId) });
  if (q.isLoading) return <LoadingBlock />;
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => q.refetch()} />;
  return (
    <Card>
      <CardContent>
        <ul className="flex flex-col divide-y text-sm">
          {q.data!.data.map((e) => (
            <li key={e.id} className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:gap-4">
              <span className="w-36 shrink-0 text-muted-foreground">{formatDateTimeVN(e.createdAt)}</span>
              <span className="flex-1">
                <b>{TIMELINE_LABELS[e.action] ?? e.action}</b>
                {e.actorName && <span className="text-muted-foreground"> · {e.actorName}</span>}
                {describe(e) && <div className="text-muted-foreground">{describe(e)}</div>}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
