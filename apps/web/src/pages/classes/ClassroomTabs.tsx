import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, Check, FileText, ImagePlus, Loader2, Plus, Send, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { addDays, formatDateVN, vnDate } from '@ecm/shared';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DateInput } from '@/components/ui/date-input';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { FormField } from '@/components/common/form-field';
import { EmptyBlock, ErrorBlock, errorMessage, LoadingBlock } from '@/components/common/page';
import { useAuth } from '@/hooks/use-auth';
import { formatDateTimeVN } from '@/lib/format';
import { compressImage, fileUrl } from '@/lib/image';
import { cn } from '@/lib/utils';
import { classroomApi, classroomKeys, type FileRef, type HomeworkStudentRow } from '@/services/classroom';

const MAX_PHOTOS = 10;

function useCanPost() {
  const { user, can } = useAuth();
  return user?.role === 'TEACHER' || can('classes.write');
}

function PhotoGrid({ photos, className }: { photos: FileRef[]; className?: string }) {
  if (!photos.length) return null;
  return (
    <div className={cn('grid grid-cols-3 gap-1.5 sm:grid-cols-4', className)}>
      {photos.map((p) =>
        p.mimeType === 'application/pdf' ? (
          <a
            key={p.id}
            href={fileUrl(p.id)}
            target="_blank"
            rel="noreferrer"
            className="flex aspect-square flex-col items-center justify-center gap-1 rounded-md border bg-muted p-2 text-center text-xs"
          >
            <FileText className="size-6 text-red-600" />
            <span className="line-clamp-2 break-all">{p.name}</span>
          </a>
        ) : (
          <a key={p.id} href={fileUrl(p.id)} target="_blank" rel="noreferrer" className="block aspect-square overflow-hidden rounded-md bg-muted">
            <img src={fileUrl(p.id)} alt="" loading="lazy" className="size-full object-cover transition-transform hover:scale-105" />
          </a>
        ),
      )}
    </div>
  );
}

/** Ô chọn ảnh: trên điện thoại cho chọn Chụp ảnh hoặc Thư viện; hiện ảnh xem trước, bỏ từng ảnh được. */
function PhotoPicker({
  files,
  onChange,
  max,
  accept = 'image/*',
  label = 'Thêm ảnh',
}: {
  files: File[];
  onChange: (f: File[]) => void;
  max: number;
  accept?: string;
  label?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div>
      <input
        ref={input}
        type="file"
        accept={accept}
        multiple
        hidden
        data-testid="photo-input"
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []);
          const next = [...files, ...picked].slice(0, max);
          if (files.length + picked.length > max) toast.warning(`Tối đa ${max} tệp mỗi lần`);
          onChange(next);
          e.target.value = '';
        }}
      />
      <div className="flex flex-wrap gap-2">
        {files.map((f, i) => (
          <div key={`${f.name}-${i}`} className="relative size-20 overflow-hidden rounded-md border bg-muted">
            {f.type.startsWith('image/') ? (
              <img src={URL.createObjectURL(f)} alt="" className="size-full object-cover" />
            ) : (
              <div className="flex size-full flex-col items-center justify-center p-1 text-center text-[10px]">
                <FileText className="size-5 text-red-600" />
                <span className="line-clamp-2 break-all">{f.name}</span>
              </div>
            )}
            <button
              type="button"
              aria-label="Bỏ tệp này"
              className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white"
              onClick={() => onChange(files.filter((_, j) => j !== i))}
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))}
        {files.length < max && (
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="flex size-20 flex-col items-center justify-center gap-1 rounded-md border border-dashed text-xs text-muted-foreground hover:border-primary hover:text-primary"
          >
            <Camera className="size-5" /> {label}
          </button>
        )}
      </div>
    </div>
  );
}

const compressAll = (files: File[]) => Promise.all(files.map((f) => (f.type.startsWith('image/') ? compressImage(f, 1600) : Promise.resolve(f))));

// ───────────── Nhật ký lớp ─────────────

export function ClassFeedTab({ classId }: { classId: number }) {
  const canPost = useCanPost();
  const qc = useQueryClient();
  const posts = useQuery({ queryKey: classroomKeys.posts(classId), queryFn: () => classroomApi.posts(classId).then((r) => r.data) });
  const noPhoto = useQuery({
    queryKey: classroomKeys.noPhoto(classId),
    queryFn: () => classroomApi.noPhotoStudents(classId).then((r) => r.data),
    enabled: canPost,
  });
  const [content, setContent] = useState('');
  const [postDate, setPostDate] = useState(vnDate());
  const [photos, setPhotos] = useState<File[]>([]);
  const create = useMutation({
    mutationFn: async () => classroomApi.createPost(classId, content.trim(), postDate, await compressAll(photos)),
    onSuccess: () => {
      setContent('');
      setPhotos([]);
      setPostDate(vnDate());
      qc.invalidateQueries({ queryKey: classroomKeys.posts(classId) });
      toast.success('Đã đăng nhật ký lớp');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: number) => classroomApi.deletePost(id),
    onSuccess: () => (qc.invalidateQueries({ queryKey: classroomKeys.posts(classId) }), toast.success('Đã xóa bài')),
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      {canPost && (
        <Card>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end gap-3">
              <FormField label="Ngày" htmlFor="post-date" className="w-40">
                <DateInput id="post-date" value={postDate} onChange={setPostDate} />
              </FormField>
              <p className="pb-2 text-xs text-muted-foreground">Phụ huynh của lớp xem trên ứng dụng điện thoại.</p>
            </div>
            <Textarea
              aria-label="Nội dung buổi học"
              rows={3}
              placeholder="Hôm nay lớp học gì, các con hoạt động thế nào…"
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
            {!!noPhoto.data?.length && (
              <Alert variant="warning">
                <span>
                  Không đăng ảnh có mặt các bạn: <b>{noPhoto.data.map((s) => s.fullName).join(', ')}</b> (gia đình không đồng ý).
                </span>
              </Alert>
            )}
            <PhotoPicker files={photos} onChange={setPhotos} max={MAX_PHOTOS} />
            <Button className="self-end" disabled={!content.trim() || create.isPending} onClick={() => create.mutate()}>
              {create.isPending ? <Loader2 className="animate-spin" /> : <Send />} Đăng
            </Button>
          </CardContent>
        </Card>
      )}

      {posts.isLoading ? (
        <LoadingBlock />
      ) : posts.isError ? (
        <ErrorBlock error={posts.error} onRetry={() => posts.refetch()} />
      ) : !posts.data?.length ? (
        <EmptyBlock title="Chưa có nhật ký" description="Đăng ảnh và nội dung buổi học để phụ huynh nắm được tình hình của con." />
      ) : (
        posts.data.map((p) => (
          <Card key={p.id} data-testid="class-post">
            <CardContent className="flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium">{formatDateVN(p.postDate)}</div>
                  <div className="text-xs text-muted-foreground">
                    {p.author} · {formatDateTimeVN(p.createdAt)}
                  </div>
                </div>
                {p.canDelete && (
                  <Button variant="ghost" size="icon" aria-label="Xóa bài" onClick={() => window.confirm('Xóa bài nhật ký này?') && remove.mutate(p.id)}>
                    <Trash2 className="text-destructive" />
                  </Button>
                )}
              </div>
              <p className="whitespace-pre-wrap text-sm">{p.content}</p>
              <PhotoGrid photos={p.photos} />
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}

// ───────────── Bài tập ─────────────

export function HomeworkTab({ classId }: { classId: number }) {
  const canPost = useCanPost();
  const list = useQuery({ queryKey: classroomKeys.homework(classId), queryFn: () => classroomApi.homework(classId).then((r) => r.data) });
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const today = vnDate();
  return (
    <div className="flex max-w-3xl flex-col gap-3">
      {canPost && (
        <Button className="self-start" onClick={() => setCreating(true)}>
          <Plus /> Giao bài tập
        </Button>
      )}
      {list.isLoading ? (
        <LoadingBlock />
      ) : list.isError ? (
        <ErrorBlock error={list.error} onRetry={() => list.refetch()} />
      ) : !list.data?.length ? (
        <EmptyBlock title="Chưa có bài tập" description="Giao bài kèm ảnh/PDF đề bài; phụ huynh chụp bài làm nộp qua ứng dụng." />
      ) : (
        list.data.map((h) => (
          <button key={h.id} type="button" onClick={() => setOpenId(h.id)} className="rounded-lg border bg-card p-4 text-left hover:border-primary">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{h.title}</span>
              <Badge variant={h.dueDate < today ? 'muted' : 'default'}>Hạn {formatDateVN(h.dueDate)}</Badge>
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              Giao {formatDateVN(h.assignedDate)} · {h.author} · đã nộp {h.submitted}/{h.roster} · đã làm {h.done}/{h.roster}
            </div>
          </button>
        ))
      )}
      <HomeworkCreateSheet classId={classId} open={creating} onClose={() => setCreating(false)} />
      <HomeworkDetailSheet id={openId} classId={classId} onClose={() => setOpenId(null)} />
    </div>
  );
}

function HomeworkCreateSheet({ classId, open, onClose }: { classId: number; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState(addDays(vnDate(), 2));
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const close = () => (setTitle(''), setDescription(''), setFiles([]), setError(null), setDueDate(addDays(vnDate(), 2)), onClose());
  const save = useMutation({
    mutationFn: async () => classroomApi.createHomework(classId, { title: title.trim(), description: description.trim(), dueDate }, await compressAll(files)),
    onSuccess: () => (qc.invalidateQueries({ queryKey: classroomKeys.homework(classId) }), toast.success('Đã giao bài tập'), close()),
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Sheet open={open} onOpenChange={(o) => !o && close()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Giao bài tập</SheetTitle>
          <SheetDescription>Phụ huynh nhận thông báo và nộp ảnh bài làm qua ứng dụng.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-1 flex-col gap-4">
          {error && <Alert variant="destructive">{error}</Alert>}
          <FormField label="Tên bài tập" htmlFor="hw-title" required>
            <Input id="hw-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="VD: Workbook trang 12–13" />
          </FormField>
          <FormField label="Hướng dẫn" htmlFor="hw-desc">
            <Textarea id="hw-desc" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
          </FormField>
          <FormField label="Hạn nộp" htmlFor="hw-due" required className="w-44">
            <DateInput id="hw-due" value={dueDate} onChange={setDueDate} />
          </FormField>
          <FormField label="Đề bài (ảnh hoặc PDF, tối đa 5)" htmlFor="hw-files">
            <PhotoPicker files={files} onChange={setFiles} max={5} accept="image/*,application/pdf" label="Thêm tệp" />
          </FormField>
        </div>
        <SheetFooter>
          <Button variant="outline" onClick={close}>
            Hủy
          </Button>
          <Button disabled={title.trim().length < 2 || !dueDate || save.isPending} onClick={() => (setError(null), save.mutate())}>
            {save.isPending ? <Loader2 className="animate-spin" /> : <ImagePlus />} Giao bài
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function HomeworkDetailSheet({ id, classId, onClose }: { id: number | null; classId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const d = useQuery({ queryKey: classroomKeys.homeworkDetail(id ?? 0), queryFn: () => classroomApi.homeworkDetail(id!), enabled: !!id });
  const refresh = () => (
    qc.invalidateQueries({ queryKey: classroomKeys.homeworkDetail(id ?? 0) }),
    qc.invalidateQueries({ queryKey: classroomKeys.homework(classId) })
  );
  const remove = useMutation({
    mutationFn: () => classroomApi.deleteHomework(id!),
    onSuccess: () => (qc.invalidateQueries({ queryKey: classroomKeys.homework(classId) }), toast.success('Đã xóa bài tập'), onClose()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const h = d.data;
  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{h?.title ?? 'Bài tập'}</SheetTitle>
          {h && (
            <SheetDescription>
              Giao {formatDateVN(h.assignedDate)} · hạn {formatDateVN(h.dueDate)} · {h.author}
            </SheetDescription>
          )}
        </SheetHeader>
        {d.isLoading ? (
          <LoadingBlock />
        ) : d.isError ? (
          <ErrorBlock error={d.error} onRetry={() => d.refetch()} />
        ) : (
          h && (
            <div className="flex flex-1 flex-col gap-4 overflow-y-auto">
              {h.description && <p className="whitespace-pre-wrap text-sm">{h.description}</p>}
              <PhotoGrid photos={h.attachments} />
              <h3 className="font-medium">
                Học sinh ({h.students.filter((s) => s.submittedAt).length}/{h.students.length} đã nộp)
              </h3>
              <div className="flex flex-col gap-2">
                {h.students.map((s) => (
                  <SubmissionRow key={s.studentId} homeworkId={h.id} dueDate={h.dueDate} s={s} onSaved={refresh} />
                ))}
              </div>
              {h.canDelete && (
                <Button variant="ghost" className="self-start text-destructive" onClick={() => window.confirm('Xóa bài tập này?') && remove.mutate()}>
                  <Trash2 /> Xóa bài tập
                </Button>
              )}
            </div>
          )
        )}
      </SheetContent>
    </Sheet>
  );
}

function SubmissionRow({ homeworkId, dueDate, s, onSaved }: { homeworkId: number; dueDate: string; s: HomeworkStudentRow; onSaved: () => void }) {
  const [comment, setComment] = useState(s.teacherComment ?? '');
  const review = useMutation({
    mutationFn: (result: 'DONE' | 'NOT_DONE') => classroomApi.review(homeworkId, { studentId: s.studentId, result, comment: comment.trim() || null }),
    onSuccess: () => (onSaved(), toast.success(`Đã chấm ${s.fullName}`)),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const late = s.submittedAt && s.submittedAt.slice(0, 10) > dueDate;
  return (
    <div className="rounded-lg border p-3" data-testid="submission-row">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{s.fullName}</span>
        <div className="flex items-center gap-1.5">
          {s.submittedAt ? (
            <Badge variant={late ? 'warning' : 'success'}>
              {late ? 'Nộp muộn' : 'Đã nộp'} {formatDateTimeVN(s.submittedAt)}
            </Badge>
          ) : (
            <Badge variant="muted">Chưa nộp online</Badge>
          )}
          {s.result && <Badge variant={s.result === 'DONE' ? 'success' : 'danger'}>{s.result === 'DONE' ? 'Đã làm' : 'Chưa làm'}</Badge>}
        </div>
      </div>
      {s.note && (
        <p className="mt-1 text-sm text-muted-foreground">
          “{s.note}”{s.submittedBy && ` — ${s.submittedBy}`}
        </p>
      )}
      <PhotoGrid photos={s.photos} className="mt-2" />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Input
          aria-label={`Nhận xét cho ${s.fullName}`}
          className="h-8 min-w-48 flex-1"
          placeholder="Nhận xét (không bắt buộc)"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
        <Button size="sm" variant={s.result === 'DONE' ? 'default' : 'outline'} disabled={review.isPending} onClick={() => review.mutate('DONE')}>
          <Check /> Đã làm
        </Button>
        <Button size="sm" variant={s.result === 'NOT_DONE' ? 'destructive' : 'outline'} disabled={review.isPending} onClick={() => review.mutate('NOT_DONE')}>
          <X /> Chưa làm
        </Button>
      </div>
    </div>
  );
}
