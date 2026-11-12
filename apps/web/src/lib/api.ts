/**
 * Client gọi API cùng origin. Web dùng cookie HttpOnly (trình duyệt tự gửi) + header CSRF.
 * Khi access token hết hạn (401), tự làm mới phiên MỘT lần (dùng chung giữa các request) rồi gửi lại.
 */
export const API_BASE = '/api/v1';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
  /** Lỗi kiểm tra dữ liệu theo trường: { path, message }[] */
  get fieldErrors(): { path: string; message: string }[] {
    return Array.isArray(this.details) ? (this.details as { path: string; message: string }[]) : [];
  }
}

function readCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]!) : null;
}

type Query = Record<string, string | number | boolean | null | undefined>;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  form?: FormData;
  query?: Query;
  signal?: AbortSignal;
  /** Không tự làm mới phiên khi 401 (dùng cho các API xác thực). */
  noRefresh?: boolean;
}

let refreshing: Promise<boolean> | null = null;
const sessionListeners = new Set<() => void>();
export const onSessionExpired = (fn: () => void) => {
  sessionListeners.add(fn);
  return () => {
    sessionListeners.delete(fn);
  };
};

async function ensureCsrf(): Promise<string | null> {
  let token = readCookie('ecm_csrf');
  if (!token) {
    await fetch(`${API_BASE}/auth/csrf`, { credentials: 'same-origin' });
    token = readCookie('ecm_csrf');
  }
  return token;
}

async function refreshSession(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const res = await fetch(`${API_BASE}/auth/refresh`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'X-CSRF-Token': (await ensureCsrf()) ?? '' },
        });
        return res.ok;
      } catch {
        return false;
      } finally {
        setTimeout(() => (refreshing = null), 0);
      }
    })();
  }
  return refreshing;
}

function buildUrl(path: string, query?: Query) {
  const url = new URL(API_BASE + path, window.location.origin);
  if (query)
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  return url.pathname + url.search;
}

export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const method = opts.method ?? (opts.body !== undefined || opts.form ? 'POST' : 'GET');
  const send = async () => {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET') headers['X-CSRF-Token'] = (await ensureCsrf()) ?? '';
    return fetch(buildUrl(path, opts.query), {
      method,
      headers,
      credentials: 'same-origin',
      body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
      signal: opts.signal,
    });
  };

  let res: Response;
  try {
    res = await send();
    if (res.status === 401 && !opts.noRefresh) {
      if (await refreshSession()) res = await send();
      else sessionListeners.forEach((fn) => fn());
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'NETWORK_ERROR', 'Không kết nối được máy chủ. Kiểm tra mạng và thử lại.');
  }

  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const err = (data as { error?: { code: string; message: string; details?: unknown } } | null)?.error;
    throw new ApiError(res.status, err?.code ?? 'HTTP_' + res.status, err?.message ?? 'Lỗi không xác định', err?.details);
  }
  return data as T;
}

function safeJson(t: string): unknown {
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

export const fileUrl = (fileId: number) => `${API_BASE}/files/${fileId}/content`;
