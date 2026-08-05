import { friendlyError } from './messages';

let apiBase: string | null = null;
let memoryToken: string | null = null;
let memoryRefreshToken: string | null = null;
let tokenLoad: Promise<void> | null = null;
let apiStatusListenerInstalled = false;
let _refreshPromise: Promise<boolean> | null = null;
const REQUEST_TIMEOUT_MS = 15_000;

interface DesktopSecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<boolean>;
  delete(key: string): Promise<boolean>;
}

interface DesktopBridge {
  getApiPort?: () => Promise<number>;
  onApiStatus?: (callback: (event: Record<string, unknown>) => void) => () => void;
  secrets?: DesktopSecretStore;
}

interface FetchOptions extends RequestInit {
  idempotent?: boolean;
}

function getDesktopBridge(): DesktopBridge | undefined {
  return (window as unknown as { desktop?: DesktopBridge }).desktop;
}

async function resolveApiBase(): Promise<string> {
  if (apiBase) return apiBase;
  installApiStatusListener();
  const desktop = getDesktopBridge();
  if (desktop?.getApiPort) {
    const port = await desktop.getApiPort();
    apiBase = `http://127.0.0.1:${port}/api/v2`;
  } else {
    apiBase = String(import.meta.env.VITE_API_BASE_URL ?? '/api/v2');
  }
  return apiBase;
}

export function resetApiBase(): void {
  apiBase = null;
}

function installApiStatusListener(): void {
  const desktop = getDesktopBridge();
  if (!desktop?.onApiStatus || apiStatusListenerInstalled) return;
  apiStatusListenerInstalled = true;
  desktop.onApiStatus((event) => {
    if (String(event.status ?? '') === 'ready' && Number.isFinite(Number(event.port))) {
      resetApiBase();
    }
  });
}

export async function getApiOrigin(): Promise<string> {
  const base = await resolveApiBase();
  return new URL(base, window.location.href).origin;
}

function desktopSecretStore(): DesktopSecretStore | null {
  return getDesktopBridge()?.secrets ?? null;
}

class ClientError extends Error {
  constructor(message: string, readonly code = 'REQUEST_FAILED', readonly traceId?: string) {
    super(message);
  }
}

function loadTokens(): Promise<void> {
  if (tokenLoad) return tokenLoad;
  tokenLoad = (async () => {
    const store = desktopSecretStore();
    if (store) {
      try {
        memoryToken = (await store.get('v2.token')) ?? null;
        memoryRefreshToken = (await store.get('v2.refreshToken')) ?? null;
      } catch {
        // safeStorage 不可用/读取失败：仅保持内存会话，不落 localStorage
        memoryToken = null;
        memoryRefreshToken = null;
        console.warn('desktop secret store unavailable; session will not persist across restarts');
      }
    } else {
      // 无桌面桥（纯浏览器 dev 模式）：仅保持内存会话
      memoryToken = null;
      memoryRefreshToken = null;
    }
  })();
  return tokenLoad;
}

async function token(): Promise<string | null> {
  await loadTokens();
  return memoryToken;
}

async function refreshToken(): Promise<string | null> {
  await loadTokens();
  return memoryRefreshToken;
}

export async function setTokens(accessToken: string, newRefreshToken: string): Promise<void> {
  memoryToken = accessToken;
  memoryRefreshToken = newRefreshToken;
  const store = desktopSecretStore();
  if (store) {
    let stored = false;
    let storedRefresh = false;
    try {
      stored = await store.set('v2.token', accessToken);
      storedRefresh = await store.set('v2.refreshToken', newRefreshToken);
    } catch {
      stored = false;
      storedRefresh = false;
    }
    if (!stored || !storedRefresh) {
      console.warn('desktop secret store unavailable; session will not persist across restarts');
    }
  }
}

async function clearSession(): Promise<void> {
  memoryToken = null;
  memoryRefreshToken = null;
  const store = desktopSecretStore();
  if (store) {
    try {
      await store.delete('v2.token');
      await store.delete('v2.refreshToken');
    } catch {
      // 仅保持内存清理，不写 localStorage
    }
  }
}

async function refreshAccessToken(): Promise<boolean> {
  if (_refreshPromise) return _refreshPromise;
  _refreshPromise = (async () => {
    try {
      const refresh = await refreshToken();
      if (!refresh) return false;
      const base = await resolveApiBase();
      try {
        const response = await fetchWithRetry(`${base}/auth/refresh`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ refreshToken: refresh }),
          idempotent: true,
        });
        const body = await response.json().catch(() => null) as {
          success?: boolean;
          data?: { token?: string; refreshToken?: string };
        } | null;
        if (!response.ok || !body?.success || !body.data?.token || !body.data.refreshToken) {
          if (response.status === 401) await clearSession();
          return false;
        }
        await setTokens(body.data.token, body.data.refreshToken);
        return true;
      } catch {
        return false;
      }
    } finally {
      _refreshPromise = null;
    }
  })();
  return _refreshPromise;
}

async function fetchAuthenticated(
  input: RequestInfo | URL,
  init: RequestInit = {},
  retry = true,
): Promise<Response> {
  const headers = new Headers(init.headers);
  const auth = await token();
  if (auth) headers.set('Authorization', `Bearer ${auth}`);
  const response = await fetchWithRetry(input, { ...init, headers });
  if (response.status === 401 && retry) {
    const refreshed = await refreshAccessToken();
    if (refreshed) return fetchAuthenticated(input, init, false);
  }
  return response;
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit & { _retry?: boolean } = {},
): Promise<T> {
  installApiStatusListener();
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  const auth = await token();
  if (auth) headers.set('Authorization', `Bearer ${auth}`);

  const base = await resolveApiBase();
  const response = await fetchWithRetry(`${base}${path}`, { ...options, headers });
  if (response.status === 401 && !options._retry && path !== '/auth/login' && path !== '/auth/refresh') {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      return apiRequest<T>(path, { ...options, _retry: true });
    }
  }
  const body = await response.json().catch(() => null) as { success?: boolean; data?: T; code?: string; message?: string; traceId?: string } | null;
  if (!response.ok || body?.success === false || body === null) {
    throw new ClientError(friendlyError(body?.message ?? `Request failed (${response.status})`), body?.code, body?.traceId);
  }
  return body.data as T;
}

export async function login(username: string, password: string): Promise<{ token: string; user: Record<string, unknown> }> {
  const result = await apiRequest<{ token: string; refreshToken: string; user: Record<string, unknown> }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  await setTokens(result.token, result.refreshToken);
  return result;
}

export async function logout(): Promise<void> {
  const refresh = await refreshToken();
  if (refresh) {
    try {
      await apiRequest('/auth/logout', {
        method: 'POST',
        body: JSON.stringify({ refreshToken: refresh }),
      });
    } catch {
      // Local session is still cleared when the remote logout is unavailable.
    }
  }
  await clearSession();
}

export async function switchClinic(clinicId: string): Promise<void> {
  const currentRefresh = await refreshToken();
  if (!currentRefresh) throw new Error('Session is missing refresh token');
  const result = await apiRequest<{ token: string; clinicId: string }>('/auth/switch-clinic', {
    method: 'POST',
    body: JSON.stringify({ clinicId }),
  });
  await setTokens(result.token, currentRefresh);
}

export async function downloadCsv(resource: string): Promise<void> {
  const base = await resolveApiBase();
  const response = await fetchAuthenticated(`${base}/resources/${encodeURIComponent(resource)}/export`);
  if (!response.ok) throw new ClientError(friendlyError('CSV export failed'));
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${resource}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function downloadCsvPath(path: string, filename: string): Promise<void> {
  const base = await resolveApiBase();
  const response = await fetchAuthenticated(`${base}${path}`);
  if (!response.ok) throw new ClientError(friendlyError('CSV export failed'));
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function uploadFile(file: File): Promise<{ id: string; filename: string; url: string }> {
  const base = await resolveApiBase();
  const response = await fetchAuthenticated(`${base}/files`, {
    method: 'POST',
    headers: {
      'x-file-name': file.name,
      'content-type': file.type || 'application/octet-stream',
    },
    body: file,
  });
  const body = await response.json().catch(() => null) as { success?: boolean; data?: { id: string; filename: string; url: string }; message?: string } | null;
  if (!response.ok || !body?.success || !body.data) {
    throw new ClientError(friendlyError(body?.message ?? 'File upload failed'));
  }
  return body.data;
}

async function fetchWithRetry(input: RequestInfo | URL, init: FetchOptions = {}): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase();
  const isIdempotent = method === 'GET' || method === 'HEAD' || init.idempotent === true;
  let lastError: unknown;
  for (let attempt = 0; attempt < (isIdempotent ? 2 : 1); attempt += 1) {
    try {
      return await fetch(input, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (error) {
      lastError = error;
      if (isIdempotent && attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        continue;
      }
      throw new ClientError(friendlyError(error instanceof Error ? error.message : String(error)));
    }
  }
  throw lastError;
}
