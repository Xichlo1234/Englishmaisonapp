import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Plus, Search, Users } from 'lucide-react';
import { formatDateVN, WEEKDAY_LABELS } from '@ecm/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { EmptyBlock, ErrorBlock, LoadingBlock, PageHeader } from '@/components/common/page';
import { useAuth } from '@/hooks/use-auth';
import { useTeachers } from '@/hooks/use-catalog';
import { useDebounced } from '@/hooks/use-debounce';
import { cn } from '@/lib/utils';
import { CLASS_STATUS_LABELS, CLASS_STATUS_VARIANT, classesApi, classKeys } from '@/services/classes';

export function ClassesListPage() {
  const { can, user } = useAuth();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [teacherId, setTeacherId] = useState('');
  const dq = useDebounced(q.trim(), 300);
  const teachers = useTeachers();
  const filters = { q: dq || undefined, status: status || undefined, teacherId: teacherId ? Number(teacherId) : undefined };
  const list = useQuery({ queryKey: classKeys.list(filters), queryFn: () => classesApi.list(filters).then((r) => r.data) });

  return (
    <div>
      <PageHeader
        title="Lớp học"
        description={list.data ? `${list.data.length} lớp` : undefined}
        actions={
          can('classes.write') && (
            <Button asChild>
              <Link to="/lop-hoc/moi">
                <Plus /> Tạo lớp
              </Link>
            </Button>
          )
        }
      />
      <Card className="mb-4 grid gap-3 p-4 sm:grid-cols-[1fr_180px_220px]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm theo mã hoặc tên lớp…" className="pl-8" aria-label="Tìm lớp" />
        </div>
        <NativeSelect value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Trạng thái lớp">
          <option value="">Đang mở & chuẩn bị</option>
          <option value="OPEN">Đang mở</option>
          <option value="PLANNED">Chuẩn bị</option>
          <option value="CLOSED">Đã đóng</option>
          <option value="ALL">Tất cả</option>
        </NativeSelect>
        {user?.role !== 'TEACHER' && (
          <NativeSelect value={teacherId} onChange={(e) => setTeacherId(e.target.value)} aria-label="Giáo viên">
            <option value="">Mọi giáo viên</option>
            {(teachers.data ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.fullName}
              </option>
            ))}
          </NativeSelect>
        )}
      </Card>

      {list.isLoading ? (
        <LoadingBlock />
      ) : list.isError ? (
        <ErrorBlock error={list.error} onRetry={() => list.refetch()} />
      ) : !list.data!.length ? (
        <EmptyBlock
          title="Chưa có lớp học"
          description={can('classes.write') ? 'Tạo lớp, gắn giáo viên và lịch học, sau đó mở lớp để sinh các buổi học.' : undefined}
          action={
            can('classes.write') ? (
              <Button asChild>
                <Link to="/lop-hoc/moi">
                  <Plus /> Tạo lớp đầu tiên
                </Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.data!.map((c) => {
            const pct = Math.min(100, Math.round((c.activeStudents / c.maxStudents) * 100));
            return (
              <Link key={c.id} to={`/lop-hoc/${c.id}`} className="group">
                <Card className="h-full transition-shadow group-hover:shadow-md">
                  <CardContent className="flex h-full flex-col gap-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-mono text-xs text-muted-foreground">{c.classCode}</div>
                        <div className="truncate font-semibold group-hover:text-primary">{c.name}</div>
                      </div>
                      <Badge variant={CLASS_STATUS_VARIANT[c.status]}>{CLASS_STATUS_LABELS[c.status]}</Badge>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {c.mainTeacherName ?? 'Chưa có giáo viên'}
                      {c.englishLevel && ` · ${c.englishLevel}`}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {c.schedules.length ? (
                        c.schedules.map((s, i) => (
                          <Badge key={i} variant="outline">
                            {WEEKDAY_LABELS[s.weekday]} {s.startTime}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-xs text-yellow-700">Chưa có lịch học</span>
                      )}
                    </div>
                    <div className="mt-auto">
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1">
                          <Users className="size-3.5" /> {c.activeStudents}/{c.maxStudents} học sinh
                        </span>
                        <span className="text-muted-foreground">từ {formatDateVN(c.startDate)}</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                        <div className={cn('h-full rounded-full', pct >= 100 ? 'bg-destructive' : pct >= 80 ? 'bg-warning' : 'bg-success')} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
