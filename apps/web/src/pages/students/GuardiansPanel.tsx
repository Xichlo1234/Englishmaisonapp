import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { BellOff, Loader2, Phone, Plus, Star, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { RELATIONSHIP_LABELS } from '@ecm/shared';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { errorMessage } from '@/components/common/page';
import { studentKeys, studentsApi, type StudentDetail } from '@/services/students';
import { emptyGuardian, GuardianFields, guardianFormSchema, toGuardianPayload } from './StudentFormPage';

export function GuardiansPanel({ student }: { student: StudentDetail }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: studentKeys.detail(student.id) });

  const setPrimary = useMutation({
    mutationFn: (gid: number) => studentsApi.updateGuardian(student.id, gid, { isPrimary: true }),
    onSuccess: () => {
      refresh();
      toast.success('Đã đổi liên hệ chính');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const toggleNotify = useMutation({
    mutationFn: (g: { id: number; value: boolean }) => studentsApi.updateGuardian(student.id, g.id, { receiveNotifications: g.value }),
    onSuccess: refresh,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const unlink = useMutation({
    mutationFn: (gid: number) => studentsApi.unlinkGuardian(student.id, gid),
    onSuccess: () => {
      refresh();
      toast.success('Đã bỏ liên kết phụ huynh');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="flex flex-col gap-3">
      {student.guardians.map((g) => (
        <div key={g.id} className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 font-medium">
              {g.fullName}
              <Badge variant="muted">{RELATIONSHIP_LABELS[g.relationship]}</Badge>
              {g.isPrimary && <Badge>Liên hệ chính</Badge>}
              {!g.receiveNotifications && (
                <Badge variant="warning">
                  <BellOff className="size-3" /> Tắt thông báo
                </Badge>
              )}
            </div>
            <div className="mt-1 flex items-center gap-3 text-sm text-muted-foreground">
              <a href={`tel:${g.phone}`} className="flex items-center gap-1 hover:text-primary">
                <Phone className="size-3.5" /> {g.phone}
              </a>
              {g.email && <span>{g.email}</span>}
              {g.hasAccount && <span className="text-success">Đã có tài khoản</span>}
            </div>
          </div>
          {student.canEdit && (
            <div className="flex flex-wrap gap-2">
              {!g.isPrimary && (
                <Button variant="outline" size="sm" disabled={setPrimary.isPending} onClick={() => setPrimary.mutate(g.id)}>
                  <Star /> Đặt liên hệ chính
                </Button>
              )}
              <Button variant="outline" size="sm" disabled={toggleNotify.isPending} onClick={() => toggleNotify.mutate({ id: g.id, value: !g.receiveNotifications })}>
                {g.receiveNotifications ? 'Tắt thông báo' : 'Bật thông báo'}
              </Button>
              {student.guardians.length > 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={unlink.isPending}
                  onClick={() => {
                    if (window.confirm(`Bỏ liên kết phụ huynh ${g.fullName} khỏi học sinh này?`)) unlink.mutate(g.id);
                  }}
                >
                  <Trash2 className="text-destructive" /> Bỏ liên kết
                </Button>
              )}
            </div>
          )}
        </div>
      ))}
      {student.canEdit && student.guardians.length < 3 && (
        <Button variant="outline" className="self-start" onClick={() => setAdding(true)}>
          <Plus /> Thêm phụ huynh
        </Button>
      )}
      <AddGuardianSheet student={student} open={adding} onOpenChange={setAdding} onDone={refresh} />
    </div>
  );
}

const addSchema = z.object({ guardians: z.array(guardianFormSchema).length(1) });

function AddGuardianSheet({
  student,
  open,
  onOpenChange,
  onDone,
}: {
  student: StudentDetail;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}) {
  const form = useForm<z.infer<typeof addSchema>>({
    resolver: zodResolver(addSchema),
    defaultValues: { guardians: [emptyGuardian(false)] },
  });
  const [error, setError] = useState<string | null>(null);
  const mut = useMutation({
    mutationFn: (v: z.infer<typeof addSchema>) => studentsApi.linkGuardian(student.id, toGuardianPayload(v.guardians[0]!)),
    onSuccess: () => {
      toast.success('Đã thêm phụ huynh');
      form.reset({ guardians: [emptyGuardian(false)] });
      onDone();
      onOpenChange(false);
    },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Thêm phụ huynh</SheetTitle>
          <SheetDescription>Cho học sinh {student.fullName}</SheetDescription>
        </SheetHeader>
        <form
          className="flex flex-1 flex-col gap-4"
          noValidate
          onSubmit={form.handleSubmit((v) => {
            setError(null);
            mut.mutate(v);
          })}
        >
          {error && <Alert variant="destructive">{error}</Alert>}
          <GuardianFields form={form} index={0} onPrimary={() => form.setValue('guardians.0.isPrimary', !form.getValues('guardians.0.isPrimary'))} />
          <SheetFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Hủy
            </Button>
            <Button type="submit" disabled={mut.isPending}>
              {mut.isPending && <Loader2 className="animate-spin" />} Lưu
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
