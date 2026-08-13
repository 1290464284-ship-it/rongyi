import { friendlyError } from './messages';
import type { Page } from './types';

let apiBase: string | null = null;
let memoryToken: string | null = null;
let memoryRefreshToken: string | null = null;
let tokenLoad: Promise<void> | null = null;
let apiStatusListenerInstalled = false;
let _refreshPromise: Promise<boolean> | null = null;
let sessionExpiredCallbacks: Array<() => void> = [];
let sessionExpiredNotified = false;
let apiReadyCallbacks: Array<() => void> = [];
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

/**
 * 注册“会话已失效”全局监听（401 且刷新失败时触发）。
 * 返回取消函数；一次失效只会通知一次，直到建立新会话（setTokens）后才会再次通知。
 */
export function onSessionExpired(callback: () => void): () => void {
  sessionExpiredCallbacks.push(callback);
  return () => {
    sessionExpiredCallbacks = sessionExpiredCallbacks.filter((cb) => cb !== callback);
  };
}

function notifySessionExpired(): void {
  if (sessionExpiredNotified) return;
  sessionExpiredNotified = true;
  for (const callback of [...sessionExpiredCallbacks]) {
    try {
      callback();
    } catch {
      // 监听器异常不得影响 API 请求流程
    }
  }
}

/**
 * 注册「API 就绪」回调（API 子进程重启/首启完成、端口变化后触发）。
 * 返回取消函数。渲染层用它触发 queryClient.invalidateQueries()，
 * 消除「刷新页面时 API 尚未就绪 → 查询失败 → 就绪后不自动恢复」的假失败。
 */
export function onApiReady(callback: () => void): () => void {
  installApiStatusListener();
  apiReadyCallbacks.push(callback);
  return () => {
    apiReadyCallbacks = apiReadyCallbacks.filter((cb) => cb !== callback);
  };
}

function notifyApiReady(): void {
  for (const callback of [...apiReadyCallbacks]) {
    try {
      callback();
    } catch {
      // 回调异常不得影响 API 状态监听
    }
  }
}

function installApiStatusListener(): void {
  const desktop = getDesktopBridge();
  if (!desktop?.onApiStatus || apiStatusListenerInstalled) return;
  apiStatusListenerInstalled = true;
  desktop.onApiStatus((event) => {
    if (String(event.status ?? '') === 'ready' && Number.isFinite(Number(event.port))) {
      resetApiBase();
      notifyApiReady();
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
  constructor(message: string, readonly code = 'REQUEST_FAILED', readonly traceId?: string, readonly status?: number) {
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
  // 新会话建立后允许再次触发会话失效通知
  sessionExpiredNotified = false;
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
          if (response.status === 401) {
            await clearSession();
            // 刷新令牌已被服务端判失效：全局通知 UI 登出
            notifySessionExpired();
          }
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
    // 刷新失败且原请求为 401：会话确实已失效，全局通知 UI 登出（与 apiRequest 一致）。
    notifySessionExpired();
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
    // 刷新失败且原请求为 401：会话确实已失效，全局通知 UI 登出
    notifySessionExpired();
  }
  const body = await response.json().catch(() => null) as { success?: boolean; data?: T; code?: string; message?: string; traceId?: string } | null;
  if (!response.ok || body?.success === false || body === null) {
    throw new ClientError(friendlyError(body?.message ?? `Request failed (${response.status})`), body?.code, body?.traceId, response.status);
  }
  return body.data as T;
}

/**
 * 分页聚合拉取：先取第一页，再按 8 个并发分批拉取剩余页（每页 100 条）。
 * path 不应携带 page/pageSize 参数；超过页数上限时显式失败，避免死循环。
 */
export async function fetchAllPages<T>(path: string): Promise<T[]> {
  const pageSize = 100;
  const MAX_PAGES = 1000;
  const CONCURRENCY = 8;
  const first = await apiRequest<Page<T>>(pagedPath(path, 1, pageSize));
  const items: T[] = [...first.items];
  // keyset 游标优先：服务端返回 nextCursor 时按 id 游标逐页拉取，避免深分页 offset 扫描。
  if (first.nextCursor !== undefined) {
    let cursor: string | undefined = first.nextCursor;
    let pagesFetched = 1;
    while (pagesFetched < MAX_PAGES) {
      if (cursor === undefined) break;
      const next: Page<T> = await apiRequest<Page<T>>(cursorPath(path, cursor, pageSize));
      items.push(...next.items);
      cursor = next.nextCursor;
      pagesFetched += 1;
    }
    if (cursor !== undefined) {
      throw new Error('fetchAllPages exceeded the page cap; refusing to continue');
    }
    return items;
  }
  if (first.items.length === 0 || items.length >= first.total) return items;

  const totalPages = Math.min(MAX_PAGES, Math.ceil(first.total / pageSize));
  const pages: number[] = [];
  for (let page = 2; page <= totalPages; page += 1) pages.push(page);
  for (let offset = 0; offset < pages.length; offset += CONCURRENCY) {
    const batch = pages.slice(offset, offset + CONCURRENCY);
    const results = await Promise.all(
      batch.map((page) => apiRequest<Page<T>>(pagedPath(path, page, pageSize))),
    );
    for (const data of results) items.push(...data.items);
  }
  if (first.total > MAX_PAGES * pageSize || items.length < first.total) {
    throw new Error('fetchAllPages exceeded the page cap; refusing to continue');
  }
  return items;
}

function pagedPath(path: string, page: number, pageSize: number): string {
  const [base, query = ''] = path.split('?', 2);
  const params = new URLSearchParams(query);
  params.set('page', String(page));
  params.set('pageSize', String(pageSize));
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

function cursorPath(path: string, cursor: string, pageSize: number): string {
  const [base, query = ''] = path.split('?', 2);
  const params = new URLSearchParams(query);
  params.set('pageSize', String(pageSize));
  params.set('cursor', cursor);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
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

export async function downloadCsv(resource: string, search = ''): Promise<void> {
  const base = await resolveApiBase();
  const query = search ? `?search=${encodeURIComponent(search)}` : '';
  const response = await fetchAuthenticated(`${base}/resources/${encodeURIComponent(resource)}/export${query}`);
  if (!response.ok) throw new ClientError(friendlyError('CSV export failed'));
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${resource}.csv`;
  anchor.click();
  // 延迟释放 blob URL，避免下载尚未开始时即被回收
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
  // 延迟释放 blob URL，避免下载尚未开始时即被回收
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function fetchPrintHtml(path: string, body: Record<string, unknown>): Promise<string> {
  const base = await resolveApiBase();
  const response = await fetchAuthenticated(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errorBody = await response.json().catch(() => null) as { message?: string } | null;
    throw new ClientError(friendlyError(errorBody?.message ?? `打印请求失败 (${response.status})`));
  }
  return response.text();
}

/**
 * S-L8：为受保护文件换取短期签名 URL（/files/:name/sign 需 Bearer）。
 * `<img>` 无法携带 Authorization 头，必须先用带会话的请求换取签名 URL 再渲染。
 * 返回完整 URL（含 origin），签名 5 分钟内有效。
 */
export async function getSignedFileUrl(path: string): Promise<string> {
  const base = await resolveApiBase();
  const response = await fetchAuthenticated(`${base}${path}/sign`);
  const body = await response.json().catch(() => null) as { success?: boolean; data?: { url?: string }; message?: string } | null;
  if (!response.ok || !body?.success || !body.data?.url) {
    throw new ClientError(friendlyError(body?.message ?? '获取图片链接失败'));
  }
  const origin = new URL(base, window.location.href).origin;
  return `${origin}${body.data.url}`;
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
  const traceparent = createTraceparent();
  let lastError: unknown;
  for (let attempt = 0; attempt < (isIdempotent ? 2 : 1); attempt += 1) {
    try {
      const headers = new Headers(init.headers);
      if (traceparent && !headers.has('traceparent')) headers.set('traceparent', traceparent);
      const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
      const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
      return await fetch(input, { ...init, headers, signal });
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

function createTraceparent(): string | undefined {
  const cryptoObj = globalThis.crypto;
  if (!cryptoObj?.getRandomValues) return undefined;
  const bytes = cryptoObj.getRandomValues(new Uint8Array(24));
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `00-${hex.slice(0, 32)}-${hex.slice(32, 48)}-01`;
}
