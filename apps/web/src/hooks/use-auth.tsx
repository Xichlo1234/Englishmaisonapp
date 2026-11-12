import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { LoginResponse, MeResponse, PermissionCode } from '@ecm/shared';
import { api, ApiError, onSessionExpired } from '@/lib/api';

interface AuthContextValue {
  user: MeResponse | null;
  isLoading: boolean;
  can: (...perms: PermissionCode[]) => boolean;
  login: (identifier: string, password: string) => Promise<MeResponse>;
  logout: () => Promise<void>;
  refetchMe: () => Promise<unknown>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
export const ME_KEY = ['me'] as const;

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: ME_KEY,
    queryFn: async () => {
      try {
        return await api<MeResponse>('/me');
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  });

  useEffect(
    () =>
      onSessionExpired(() => {
        qc.setQueryData(ME_KEY, null);
      }),
    [qc],
  );

  const login = useCallback(
    async (identifier: string, password: string) => {
      const res = await api<LoginResponse>('/auth/login', {
        body: { identifier, password, client: 'WEB' },
        noRefresh: true,
      });
      // Xóa dữ liệu của phiên trước nhưng giữ query 'me' (observer đang theo dõi) để UI cập nhật ngay.
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== ME_KEY[0] });
      qc.setQueryData(ME_KEY, res.user);
      return res.user;
    },
    [qc],
  );

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST', noRefresh: true });
    } finally {
      qc.setQueryData(ME_KEY, null);
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== ME_KEY[0] });
    }
  }, [qc]);

  const value = useMemo<AuthContextValue>(() => {
    const user = me.data ?? null;
    return {
      user,
      isLoading: me.isLoading,
      can: (...perms) => !!user && perms.every((p) => user.permissions.includes(p)),
      login,
      logout,
      refetchMe: me.refetch,
    };
  }, [me.data, me.isLoading, me.refetch, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth phải dùng trong AuthProvider');
  return ctx;
}
