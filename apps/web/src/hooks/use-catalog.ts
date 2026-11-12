import { useQuery } from '@tanstack/react-query';
import { classesApi, classKeys } from '@/services/classes';

/** Danh mục dùng chung cho các form: ca học, phòng, giáo viên đang làm việc. */
export function useShifts() {
  return useQuery({ queryKey: classKeys.shifts, queryFn: () => classesApi.shifts().then((r) => r.data), staleTime: 60_000 });
}
export function useRooms(enabled = true) {
  return useQuery({ queryKey: classKeys.rooms, queryFn: () => classesApi.rooms().then((r) => r.data), staleTime: 60_000, enabled });
}
export function useTeachers(all = false) {
  return useQuery({ queryKey: classKeys.teachers(all), queryFn: () => classesApi.teachers(all).then((r) => r.data), staleTime: 60_000 });
}
