let apiBase: string | null = null;

async function resolveApiBase(): Promise<string> {
  if (apiBase) return apiBase;
  const desktop = (window as unknown as { desktop?: { getApiPort?: () => Promise<number> } }).desktop;
  if (desktop?.getApiPort) {
    const port = await desktop.getApiPort();
    apiBase = `http://127.0.0.1:${port}/api/v2`;
  } else {
    apiBase = String(import.meta.env.VITE_API_BASE_URL ?? '/api/v2');
  }
  return apiBase;
}

export interface ApiError {
  success: false;
  code: string;
  message: string;
  traceId?: string;
}

export class ClientError extends Error {
  constructor(message: string, readonly code = 'REQUEST_FAILED', readonly traceId?: string) {
    super(message);
  }
}

function token(): string | null {
  return localStorage.getItem('v2.token');
}

function refreshToken(): string | null {
  return localStorage.getItem('v2.refreshToken');
}

function clearSession(): void {
  localStorage.removeItem('v2.token');
  localStorage.removeItem('v2.refreshToken');
}

async function refreshAccessToken(): Promise<boolean> {
  const refresh = refreshToken();
  if (!refresh) return false;
  const base = await resolveApiBase();
  try {
    const response = await fetch(`${base}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: refresh }),
    });
    const body = await response.json().catch(() => null) as {
      success?: boolean;
      data?: { token?: string; refreshToken?: string };
    } | null;
    if (!response.ok || !body?.success || !body.data?.token || !body.data.refreshToken) {
      clearSession();
      return false;
    }
    localStorage.setItem('v2.token', body.data.token);
    localStorage.setItem('v2.refreshToken', body.data.refreshToken);
    return true;
  } catch {
    clearSession();
    return false;
  }
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit & { _retry?: boolean } = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  const auth = token();
  if (auth) headers.set('Authorization', `Bearer ${auth}`);

  const base = await resolveApiBase();
  let response = await fetch(`${base}${path}`, { ...options, headers });
  if (response.status === 401 && !options._retry && path !== '/auth/login' && path !== '/auth/refresh') {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      return apiRequest<T>(path, { ...options, _retry: true });
    }
  }
  const body = await response.json().catch(() => null) as { success?: boolean; data?: T; code?: string; message?: string; traceId?: string } | null;
  if (!response.ok || body?.success === false || body === null) {
    throw new ClientError(body?.message ?? `Request failed (${response.status})`, body?.code, body?.traceId);
  }
  return body.data as T;
}

export async function login(username: string, password: string): Promise<{ token: string; user: Record<string, unknown> }> {
  const result = await apiRequest<{ token: string; refreshToken: string; user: Record<string, unknown> }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  localStorage.setItem('v2.token', result.token);
  localStorage.setItem('v2.refreshToken', result.refreshToken);
  return result;
}

export function logout(): void {
  const refresh = refreshToken();
  if (refresh) {
    void apiRequest('/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: refresh }),
    }).catch(() => undefined);
  }
  clearSession();
}
