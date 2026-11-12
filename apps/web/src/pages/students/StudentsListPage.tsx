import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { AlertTriangle, ChevronLeft, ChevronRight, Download, Loader2, Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { STUDENT_STATUSES, STUDENT_STATUS_LABELS } from '@ecm/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyBlock, ErrorBlock, errorMessage, PageHeader } from '@/components/common/page';
import { useAuth } from '@/hooks/use-auth';
import { useDebounced } from '@/hooks/use-debounce';
import { usePublicSettings } from '@/hooks/use-settings';
import { formatDateVN, STUDENT_STATUS_VARIANT } from '@/lib/format';
import { studentKeys, studentsApi, type StudentFilters } from '@/services/students';
import { downloadStudentsXlsx } from './exportStudents';

const PAGE_SIZE = 20;

export function StudentsListPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const settings = usePublicSettings();
  const [params, setParams] = useSearchParams();
  const [qInput, setQInput] = useState(params.get('q') ?? '');
  const q = useDebounced(qInput.trim(), 300);
  const [exporting, setExporting] = useState(false);

  const filters: StudentFilters = {
    q: q || undefined,
    status: params.get('status') || undefined,
    level: params.get('level') || undefined,
    needsAttention: params.get('attention') || undefined,
    sort: params.get('sort') || 'name',
    page: Number(params.get('page') || 1),
    pageSize: PAGE_SIZE,
  };
  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };

  const query = useQuery({
    queryKey: studentKeys.list(filters),
    queryFn: () => studentsApi.list(filters),
    placeholderData: keepPreviousData,
  });

  const total = query.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  async function onExport() {
    setExporting(true);
    try {
      const { data } = await studentsApi.export(filters);
      if (!data.length) return toast.info('Không có học sinh nào theo bộ lọc hiện tại');
      await downloadStudentsXlsx(data);
      toast.success(`Đã xuất ${data.length} học sinh`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Học sinh"
        description={query.data ? `${total} học sinh` : undefined}
        actions={
          <>
            <Button variant="outline" onClick={onExport} disabled={exporting}>
              {exporting ? <Loader2 className="animate-spin" /> : <Download />} Xuất Excel
            </Button>
            {can('students.write') && (
              <Button asChild>
                <Link to="/hoc-sinh/moi">
                  <Plus /> Thêm học sinh
                </Link>
              </Button>
            )}
          </>
        }
      />

      <Card className="mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[1fr_180px_160px_180px]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={qInput}
            onChange={(e) => {
              setQInput(e.target.value);
              if (params.get('page')) setFilter('page', '');
            }}
            placeholder="Tìm theo tên, mã HS, SĐT phụ huynh…"
            className="pl-8"
            aria-label="Tìm kiếm"
          />
        </div>
        <NativeSelect value={filters.status ?? ''} onChange={(e) => setFilter('status', e.target.value)} aria-label="Trạng thái">
          <option value="">Tất cả (trừ lưu trữ)</option>
          {STUDENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STUDENT_STATUS_LABELS[s]}
            </option>
          ))}
          <option value="ALL">Tất cả kể cả lưu trữ</option>
        </NativeSelect>
        <NativeSelect value={filters.level ?? ''} onChange={(e) => setFilter('level', e.target.value)} aria-label="Trình độ">
          <option value="">Mọi trình độ</option>
          {(settings.data?.english_levels ?? []).map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect value={filters.sort} onChange={(e) => setFilter('sort', e.target.value)} aria-label="Sắp xếp">
          <option value="name">Sắp xếp: Tên A→Z</option>
          <option value="code">Sắp xếp: Mã HS</option>
          <option value="startDate">Sắp xếp: Mới nhập học</option>
          <option value="recent">Sắp xếp: Mới thêm</option>
        </NativeSelect>
      </Card>

      {query.isError ? (
        <ErrorBlock error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Mã</TableHead>
                <TableHead>Họ và tên</TableHead>
                <TableHead>Ngày sinh</TableHead>
                <TableHead>Lớp hiện tại</TableHead>
                <TableHead>Phụ huynh</TableHead>
                <TableHead>Trình độ</TableHead>
                <TableHead>Trạng thái</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.isLoading &&
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={7}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  </TableRow>
                ))}
              {query.data?.data.map((s) => (
                <TableRow key={s.id} className="cursor-pointer" onClick={() => navigate(`/hoc-sinh/${s.id}`)}>
                  <TableCell className="font-mono text-xs text-muted-foreground">{s.studentCode}</TableCell>
                  <TableCell>
                    <Link to={`/hoc-sinh/${s.id}`} className="font-medium hover:text-primary" onClick={(e) => e.stopPropagation()}>
                      {s.fullName}
                    </Link>
                    {s.needsAttention && (
                      <AlertTriangle className="ml-1.5 inline size-3.5 text-warning" aria-label="Cần theo dõi" />
                    )}
                  </TableCell>
                  <TableCell>{formatDateVN(s.dateOfBirth)}</TableCell>
                  <TableCell>
                    {s.currentClasses.length ? (
                      s.currentClasses.map((c) => (
                        <Badge key={c.id} variant="outline" className="mr-1">
                          {c.code}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-xs text-muted-foreground">Chưa xếp lớp</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {s.primaryGuardian && (
                      <div className="leading-tight">
                        <div>{s.primaryGuardian.name}</div>
                        <div className="text-xs text-muted-foreground">{s.primaryGuardian.phone}</div>
                      </div>
                    )}
                  </TableCell>
                  <TableCell>{s.englishLevel}</TableCell>
                  <TableCell>
                    <Badge variant={STUDENT_STATUS_VARIANT[s.status]}>{STUDENT_STATUS_LABELS[s.status]}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {query.data && query.data.data.length === 0 && (
            <EmptyBlock
              title={filters.q || filters.status || filters.level ? 'Không tìm thấy học sinh phù hợp' : 'Chưa có học sinh'}
              description={filters.q ? 'Thử tìm bằng tên không dấu hoặc số điện thoại phụ huynh.' : undefined}
              action={
                !filters.q && can('students.write') ? (
                  <Button asChild>
                    <Link to="/hoc-sinh/moi">
                      <Plus /> Thêm học sinh đầu tiên
                    </Link>
                  </Button>
                ) : undefined
              }
            />
          )}
          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between border-t px-4 py-3 text-sm">
              <span className="text-muted-foreground">
                Trang {filters.page}/{pages}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={filters.page! <= 1} onClick={() => setFilter('page', String(filters.page! - 1))}>
                  <ChevronLeft /> Trước
                </Button>
                <Button variant="outline" size="sm" disabled={filters.page! >= pages} onClick={() => setFilter('page', String(filters.page! + 1))}>
                  Sau <ChevronRight />
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
