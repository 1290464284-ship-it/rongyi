import { fetchWithRetry } from './api-utils';

let apiBase: string | null = null;
let memoryToken: string | null = null;
let memoryRefreshToken: string | null = null;
let tokenLoad: Promise<void> | null = null;
let apiStatusListenerInstalled = false;
let _refreshPromise: Promise<boolean> | null = null;
let sessionExpiredCallbacks: Array<() => void> = [];
let sessionExpiredNotified = false;
let apiReadyCallbacks: Array<() => void> = [];

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

function getDesktopBridge(): DesktopBridge | undefined {
  return (window as unknown as { desktop?: DesktopBridge }).desktop;
}

export async function resolveApiBase(): Promise<string> {
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

export function notifySessionExpired(): void {
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

export function installApiStatusListener(): void {
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

export async function token(): Promise<string | null> {
  await loadTokens();
  return memoryToken;
}

export async function refreshToken(): Promise<string | null> {
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

export async function clearSession(): Promise<void> {
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

export async function refreshAccessToken(): Promise<boolean> {
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
