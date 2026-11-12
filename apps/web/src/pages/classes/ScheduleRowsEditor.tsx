import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Plus, Trash2 } from 'lucide-react';
import { WEEKDAY_LABELS } from '@ecm/shared';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { useDebounced } from '@/hooks/use-debounce';
import { useRooms, useShifts, useTeachers } from '@/hooks/use-catalog';
import { classesApi, type ScheduleConflict } from '@/services/classes';

export interface ScheduleRow {
  weekday: number;
  shiftId: number | '';
  teacherId: number | '';
  roomId: number | '';
}

export const emptyScheduleRow = (): ScheduleRow => ({ weekday: 2, shiftId: '', teacherId: '', roomId: '' });

export function toScheduleInput(r: ScheduleRow) {
  return {
    weekday: r.weekday,
    shiftId: Number(r.shiftId),
    teacherId: r.teacherId ? Number(r.teacherId) : null,
    roomId: r.roomId ? Number(r.roomId) : null,
  };
}

/** Bảng nhập lịch lặp hằng tuần + kiểm tra trùng giáo viên/phòng ngay khi chọn. */
export function ScheduleRowsEditor({
  rows,
  onChange,
  mainTeacherId,
  effectiveFrom,
  effectiveTo,
  classId,
  allowMultiple = true,
}: {
  rows: ScheduleRow[];
  onChange: (rows: ScheduleRow[]) => void;
  mainTeacherId: number | '';
  effectiveFrom: string;
  effectiveTo?: string | null;
  classId?: number;
  allowMultiple?: boolean;
}) {
  const shifts = useShifts();
  const teachers = useTeachers();
  const rooms = useRooms();
  const set = (i: number, patch: Partial<ScheduleRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const complete = rows.filter((r) => r.shiftId);
  const key = useDebounced(JSON.stringify({ complete, mainTeacherId, effectiveFrom, effectiveTo }), 400);
  const [check, setCheck] = useState<{ loading: boolean; conflicts: ScheduleConflict[] | null; error?: string }>({ loading: false, conflicts: null });
  useEffect(() => {
    const p = JSON.parse(key) as { complete: ScheduleRow[]; mainTeacherId: number | ''; effectiveFrom: string; effectiveTo?: string | null };
    if (!p.complete.length || !p.mainTeacherId || !p.effectiveFrom) {
      setCheck({ loading: false, conflicts: null });
      return;
    }
    let cancelled = false;
    setCheck((c) => ({ ...c, loading: true }));
    classesApi
      .checkConflicts({
        classId,
        teacherId: Number(p.mainTeacherId),
        effectiveFrom: p.effectiveFrom,
        effectiveTo: p.effectiveTo || null,
        schedules: p.complete.map(toScheduleInput),
      })
      .then((r) => !cancelled && setCheck({ loading: false, conflicts: r.conflicts }))
      .catch((e: Error) => !cancelled && setCheck({ loading: false, conflicts: null, error: e.message }));
    return () => {
      cancelled = true;
    };
  }, [key, classId]);

  const activeShifts = (shifts.data ?? []).filter((s) => s.isActive);
  const activeRooms = (rooms.data ?? []).filter((r) => r.isActive);

  return (
    <div className="flex flex-col gap-3">
      {rows.map((r, i) => (
        <div key={i} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[130px_1fr_1fr_140px_auto]">
          <NativeSelect value={r.weekday} onChange={(e) => set(i, { weekday: Number(e.target.value) })} aria-label="Thứ">
            {[1, 2, 3, 4, 5, 6, 7].map((w) => (
              <option key={w} value={w}>
                {WEEKDAY_LABELS[w]}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect value={r.shiftId} onChange={(e) => set(i, { shiftId: e.target.value ? Number(e.target.value) : '' })} aria-label="Ca học">
            <option value="">— Chọn ca —</option>
            {activeShifts.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.startTime}–{s.endTime})
              </option>
            ))}
          </NativeSelect>
          <NativeSelect value={r.teacherId} onChange={(e) => set(i, { teacherId: e.target.value ? Number(e.target.value) : '' })} aria-label="Giáo viên dạy">
            <option value="">Giáo viên chính của lớp</option>
            {(teachers.data ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.fullName}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect value={r.roomId} onChange={(e) => set(i, { roomId: e.target.value ? Number(e.target.value) : '' })} aria-label="Phòng">
            <option value="">Không gán phòng</option>
            {activeRooms.map((room) => (
              <option key={room.id} value={room.id}>
                {room.name}
              </option>
            ))}
          </NativeSelect>
          {allowMultiple && (
            <Button type="button" variant="ghost" size="icon" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label="Bỏ lịch này">
              <Trash2 className="text-destructive" />
            </Button>
          )}
        </div>
      ))}
      {allowMultiple && rows.length < 14 && (
        <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => onChange([...rows, emptyScheduleRow()])}>
          <Plus /> Thêm buổi trong tuần
        </Button>
      )}
      {check.loading && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Đang kiểm tra trùng lịch…
        </p>
      )}
      {!check.loading && check.conflicts && check.conflicts.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle />
          <ul className="list-disc pl-4">
            {check.conflicts.map((c, i) => (
              <li key={i}>{c.detail}</li>
            ))}
          </ul>
        </Alert>
      )}
      {!check.loading && check.conflicts && check.conflicts.length === 0 && (
        <p className="flex items-center gap-2 text-sm text-success">
          <CheckCircle2 className="size-4" /> Không trùng lịch giáo viên/phòng
        </p>
      )}
    </div>
  );
}
