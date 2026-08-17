import { friendlyError } from './messages';
import type { Page } from './types';
import { ClientError } from './api-errors';
import { cursorPath, fetchWithRetry, pagedPath } from './api-utils';
import {
  clearSession,
  installApiStatusListener,
  notifySessionExpired,
  refreshAccessToken,
  refreshToken,
  resolveApiBase,
  setTokens,
  token,
} from './api-session';

export { onApiReady, onSessionExpired, getApiOrigin, resetApiBase, setTokens } from './api-session';

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
