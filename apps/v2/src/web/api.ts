let apiBase: string | null = null;
let memoryToken: string | null = null;
let memoryRefreshToken: string | null = null;
let tokenLoad: Promise<void> | null = null;

interface DesktopSecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<boolean>;
  delete(key: string): Promise<boolean>;
}

interface DesktopBridge {
  getApiPort?: () => Promise<number>;
  secrets?: DesktopSecretStore;
}

async function resolveApiBase(): Promise<string> {
  if (apiBase) return apiBase;
  const desktop = (window as unknown as { desktop?: DesktopBridge }).desktop;
  if (desktop?.getApiPort) {
    const port = await desktop.getApiPort();
    apiBase = `http://127.0.0.1:${port}/api/v2`;
  } else {
    apiBase = String(import.meta.env.VITE_API_BASE_URL ?? '/api/v2');
  }
  return apiBase;
}

function desktopSecretStore(): DesktopSecretStore | null {
  return (window as unknown as { desktop?: DesktopBridge }).desktop?.secrets ?? null;
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
        memoryToken = (await store.get('v2.token')) ?? localStorage.getItem('v2.token');
        memoryRefreshToken = (await store.get('v2.refreshToken')) ?? localStorage.getItem('v2.refreshToken');
      } catch {
        memoryToken = localStorage.getItem('v2.token');
        memoryRefreshToken = localStorage.getItem('v2.refreshToken');
      }
    } else {
      memoryToken = localStorage.getItem('v2.token');
      memoryRefreshToken = localStorage.getItem('v2.refreshToken');
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

async function setTokens(accessToken: string, newRefreshToken: string): Promise<void> {
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
    if (stored && storedRefresh) {
      localStorage.removeItem('v2.token');
      localStorage.removeItem('v2.refreshToken');
      return;
    }
  }
  localStorage.setItem('v2.token', accessToken);
  localStorage.setItem('v2.refreshToken', newRefreshToken);
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
      // Fall through and still clear the in-memory/local fallback session.
    }
  }
  localStorage.removeItem('v2.token');
  localStorage.removeItem('v2.refreshToken');
}

async function refreshAccessToken(): Promise<boolean> {
  const refresh = await refreshToken();
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
      await clearSession();
      return false;
    }
    await setTokens(body.data.token, body.data.refreshToken);
    return true;
  } catch {
    await clearSession();
    return false;
  }
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit & { _retry?: boolean } = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  const auth = await token();
  if (auth) headers.set('Authorization', `Bearer ${auth}`);

  const base = await resolveApiBase();
  const response = await fetch(`${base}${path}`, { ...options, headers });
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
  const auth = await token();
  const response = await fetch(`${base}/resources/${encodeURIComponent(resource)}/export`, {
    headers: auth ? { Authorization: `Bearer ${auth}` } : {},
  });
  if (!response.ok) throw new Error('CSV export failed');
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
  const auth = await token();
  const response = await fetch(`${base}${path}`, {
    headers: auth ? { Authorization: `Bearer ${auth}` } : {},
  });
  if (!response.ok) throw new Error('CSV export failed');
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
