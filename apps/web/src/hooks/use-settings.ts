import { useQuery } from '@tanstack/react-query';
import type { GradeBand } from '@ecm/shared';
import { api } from '@/lib/api';

export interface PublicSettings {
  center_name?: string;
  center_address?: string | null;
  center_phone?: string | null;
  english_levels?: string[];
  grade_bands?: GradeBand[];
}

export function usePublicSettings() {
  return useQuery({
    queryKey: ['settings', 'public'],
    queryFn: () => api<PublicSettings>('/settings/public'),
    staleTime: 10 * 60_000,
  });
}
