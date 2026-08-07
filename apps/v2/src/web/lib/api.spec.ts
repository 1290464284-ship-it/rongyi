import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function makeMockStorage(initial: Record<string, string> = {}) {
  const storage: Record<string, string> = { ...initial };
  return {
    mock: storage,
    storage: {
      getItem: (k: string) => (k in storage ? storage[k] : null),
      setItem: (k: string, v: string) => { storage[k] = v; },
      removeItem: (k: string) => { delete storage[k]; },
      clear: () => { for (const k of Object.keys(storage)) delete storage[k]; },
      key: () => null,
      length: 0,
    } as Storage,
  };
}

describe('api baseUrl 解析', () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const originalLocalStorage = (globalThis as unknown as { localStorage?: Storage }).localStorage;

  let apiRequest: typeof import('./api').apiRequest;
  let resetApiBase: typeof import('./api').resetApiBase;
  let getApiOrigin: typeof import('./api').getApiOrigin;
  let _friendlyError: typeof import('./messages').friendlyError;

  beforeEach(async () => {
    vi.resetModules();
    const { mock, storage } = makeMockStorage();
    vi.stubGlobal('location', new URL('http://127.0.0.1:5180/'));
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: storage });
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      writable: true,
      value: { location: globalThis.location, localStorage: storage },
    });
    delete (globalThis.window as unknown as { desktop?: unknown }).desktop;
    delete (globalThis as unknown as { import?: { meta?: Record<string, unknown> } }).import;
    (globalThis as unknown as { import: { meta: { env: Record<string, unknown> } } }).import = {
      meta: { env: {} },
    };
    const mod = await import('./api');
    const msgMod = await import('./messages');
    apiRequest = mod.apiRequest;
    resetApiBase = mod.resetApiBase;
    getApiOrigin = mod.getApiOrigin;
    _friendlyError = msgMod.friendlyError;
    resetApiBase();
    void mock;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: originalWindow });
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: originalLocalStorage });
    globalThis.fetch = originalFetch;
  });

  it('优先使用 desktop.getApiPort 返回的端口作为 baseUrl', async () => {
    const getApiPort = vi.fn().mockResolvedValue(9999);
    (globalThis.window as unknown as { desktop: { getApiPort: typeof getApiPort } }).desktop = { getApiPort };
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: 'ok' }), { status: 200 }),
    );
    globalThis.localStorage.removeItem('v2.token');
    await apiRequest<string>('/ping');
    expect(getApiPort).toHaveBeenCalledOnce();
    const call = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(call[0])).toBe('http://127.0.0.1:9999/api/v2/ping');
  });

  it('无 desktop 时 fallback 到 VITE_API_BASE_URL 或 /api/v2', async () => {
    const targetEnv = (globalThis as unknown as { import: { meta: { env: Record<string, string> } } }).import.meta.env;
    targetEnv.VITE_API_BASE_URL = 'http://fallback.example:8888/api/v2';
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: 'ok' }), { status: 200 }),
    );
    await apiRequest<string>('/fallback');
    const call = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(call[0])).toBe('http://fallback.example:8888/api/v2/fallback');
  });

  it('getApiOrigin 基于 baseUrl 返回 origin', async () => {
    const getApiPort = vi.fn().mockResolvedValue(7777);
    (globalThis.window as unknown as { desktop: { getApiPort: typeof getApiPort } }).desktop = { getApiPort };
    const origin = await getApiOrigin();
    expect(origin).toBe('http://127.0.0.1:7777');
  });
});

describe('token 会话：desktop secrets 优先，无桥时仅内存（不落 localStorage）', () => {
  const originalWindow = globalThis.window;
  const originalLocalStorage = (globalThis as unknown as { localStorage?: Storage }).localStorage;

  let apiRequest: typeof import('./api').apiRequest;
  let resetApiBase: typeof import('./api').resetApiBase;
  let setTokens: typeof import('./api').setTokens;
  let storageRef: Record<string, string> = {};

  beforeEach(async () => {
    vi.resetModules();
    storageRef = {};
    const { mock, storage } = makeMockStorage({
      'v2.token': '',
      'v2.refreshToken': '',
    });
    storageRef = mock;
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: storage });
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      writable: true,
      value: { localStorage: storage },
    });
    delete (globalThis.window as unknown as { desktop?: unknown }).desktop;
    delete (globalThis as unknown as { import?: { meta?: Record<string, unknown> } }).import;
    (globalThis as unknown as { import: { meta: { env: Record<string, unknown> } } }).import = {
      meta: { env: {} },
    };
    const mod = await import('./api');
    apiRequest = mod.apiRequest;
    resetApiBase = mod.resetApiBase;
    setTokens = mod.setTokens;
    resetApiBase();
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: originalWindow });
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: originalLocalStorage });
  });

  it('存在 desktop secrets 时读取 desktop', async () => {
    const store = new Map<string, string>();
    store.set('v2.token', 'desktop-token');
    store.set('v2.refreshToken', 'desktop-refresh');
    const secrets = {
      get: vi.fn().mockImplementation(async (k: string) => store.get(k) ?? null),
      set: vi.fn().mockResolvedValue(true),
      delete: vi.fn().mockResolvedValue(true),
    };
    (globalThis.window as unknown as { desktop: { secrets: typeof secrets } }).desktop = { secrets };

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: 'ok' }), { status: 200 }),
    );
    const w1 = globalThis.window as unknown as Record<string, unknown>;
    const d1 = w1.desktop as Record<string, unknown> | undefined;
    if (d1 && 'getApiPort' in d1) delete d1.getApiPort;

    await apiRequest<string>('/auth-ping');
    const fetchCall = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const auth = String(new Request(fetchCall[0], fetchCall[1]).headers.get('Authorization') ?? '');
    expect(auth).toBe('Bearer desktop-token');
    expect(secrets.get).toHaveBeenCalledWith('v2.token');
    expect(secrets.get).toHaveBeenCalledWith('v2.refreshToken');
  });

  it('secrets.get 抛错时仅保持内存会话，不读 localStorage', async () => {
    const secrets = {
      get: vi.fn().mockRejectedValue(new Error('secure enclave unavailable')),
      set: vi.fn().mockResolvedValue(true),
      delete: vi.fn().mockResolvedValue(true),
    };
    (globalThis.window as unknown as { desktop: { secrets: typeof secrets } }).desktop = { secrets };
    storageRef['v2.token'] = 'local-token';
    storageRef['v2.refreshToken'] = 'local-refresh';

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: 'ok' }), { status: 200 }),
    );
    const w2 = globalThis.window as unknown as Record<string, unknown>;
    const d2 = w2.desktop as Record<string, unknown> | undefined;
    if (d2 && 'getApiPort' in d2) delete d2.getApiPort;

    await apiRequest<string>('/auth-ping');
    const fetchCall = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const auth = String(new Request(fetchCall[0], fetchCall[1]).headers.get('Authorization') ?? '');
    expect(auth).toBe('');
    expect(storageRef['v2.token']).toBe('local-token');
    expect(storageRef['v2.refreshToken']).toBe('local-refresh');
  });

  it('无 desktop 桥时不从 localStorage 恢复会话', async () => {
    storageRef['v2.token'] = 'only-local';
    delete (globalThis.window as unknown as { desktop?: unknown }).desktop;

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: 'ok' }), { status: 200 }),
    );

    await apiRequest<string>('/auth-ping');
    const fetchCall = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const auth = String(new Request(fetchCall[0], fetchCall[1]).headers.get('Authorization') ?? '');
    expect(auth).toBe('');
  });

  it('setTokens 在 store 不可用时仅保持内存不写 localStorage', async () => {
    delete (globalThis.window as unknown as { desktop?: unknown }).desktop;
    delete storageRef['v2.token'];
    delete storageRef['v2.refreshToken'];

    globalThis.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ success: true, data: 'ok' }), { status: 200 })),
    );
    // 先触发 loadTokens（无 desktop → 内存为空），模拟真实登录流程的调用顺序
    await apiRequest<string>('/warmup');
    await setTokens('mem-token', 'mem-refresh');

    expect(storageRef['v2.token']).toBeUndefined();
    expect(storageRef['v2.refreshToken']).toBeUndefined();

    await apiRequest<string>('/auth-ping');
    const calls = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const lastCall = calls[calls.length - 1];
    const auth = String(new Request(lastCall[0], lastCall[1]).headers.get('Authorization') ?? '');
    expect(auth).toBe('Bearer mem-token');
  });

  it('setTokens 在 store.set 失败时不写 localStorage', async () => {
    const secrets = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockRejectedValue(new Error('write failed')),
      delete: vi.fn().mockResolvedValue(true),
    };
    (globalThis.window as unknown as { desktop: { secrets: typeof secrets } }).desktop = { secrets };
    delete storageRef['v2.token'];
    delete storageRef['v2.refreshToken'];

    await setTokens('mem-token', 'mem-refresh');

    // store.set 首次调用即失败时，第二个 key 的 set 不再执行（生产逻辑），且不写 localStorage
    expect(secrets.set).toHaveBeenCalledTimes(1);
    expect(secrets.set).toHaveBeenCalledWith('v2.token', 'mem-token');
    expect(storageRef['v2.token']).toBeUndefined();
    expect(storageRef['v2.refreshToken']).toBeUndefined();
  });
});

describe('401 refresh 触发', () => {
  const originalWindow = globalThis.window;
  const originalLocalStorage = (globalThis as unknown as { localStorage?: Storage }).localStorage;

  let apiRequest: typeof import('./api').apiRequest;
  let resetApiBase: typeof import('./api').resetApiBase;
  let setTokens: typeof import('./api').setTokens;
  let storageRef: Record<string, string> = {};
  let fetchCalls: Array<{ url: string; init: RequestInit }> = [];

  beforeEach(async () => {
    vi.resetModules();
    storageRef = { 'v2.token': 'expired', 'v2.refreshToken': 'refresh-alive' };
    fetchCalls = [];
    const { mock, storage } = makeMockStorage(storageRef);
    storageRef = mock;
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: storage });
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      writable: true,
      value: { localStorage: storage },
    });
    delete (globalThis.window as unknown as { desktop?: unknown }).desktop;
    delete (globalThis as unknown as { import?: { meta?: Record<string, unknown> } }).import;
    (globalThis as unknown as { import: { meta: { env: Record<string, unknown> } } }).import = {
      meta: { env: {} },
    };
    const mod = await import('./api');
    apiRequest = mod.apiRequest;
    resetApiBase = mod.resetApiBase;
    setTokens = mod.setTokens;
    resetApiBase();

    globalThis.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      fetchCalls.push({ url, init: init ?? {} });
      if (url.endsWith('/auth/refresh')) {
        return new Response(
          JSON.stringify({
            success: true,
            data: { token: 'new-token', refreshToken: 'new-refresh' },
          }),
          { status: 200 },
        );
      }
      const isFirstFail = fetchCalls.filter((c) => c.url === url).length === 1;
      if (isFirstFail) {
        return new Response(
          JSON.stringify({ success: false, code: 'INVALID_TOKEN', message: 'Invalid or expired token' }),
          { status: 401 },
        );
      }
      return new Response(JSON.stringify({ success: true, data: 'refreshed-data' }), { status: 200 });
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: originalWindow });
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: originalLocalStorage });
  });

  it('非登录接口 401 时自动调用 refresh 并重放请求', async () => {
    // 新语义：无桌面桥时令牌仅在内存中；先触发 loadTokens（空会话）再注入内存会话，模拟真实登录顺序
    await apiRequest<string>('/auth/login', { method: 'POST' }).catch(() => {});
    await setTokens('expired', 'refresh-alive');
    const data = await apiRequest<string>('/patients');
    expect(data).toBe('refreshed-data');
    const refreshReq = fetchCalls.find((c) => c.url.endsWith('/auth/refresh'));
    expect(refreshReq).toBeDefined();
    expect(refreshReq!.init.method).toBe('POST');
    const body = JSON.parse(String(refreshReq!.init.body ?? '{}')) as { refreshToken?: string };
    expect(body.refreshToken).toBe('refresh-alive');
    // 新语义：setTokens 不写 localStorage，预置值保持原样
    expect(storageRef['v2.token']).toBe('expired');
    expect(storageRef['v2.refreshToken']).toBe('refresh-alive');
    const patientCalls = fetchCalls.filter((c) => c.url.endsWith('/patients'));
    expect(patientCalls.length).toBe(2);
    const replayed = patientCalls[patientCalls.length - 1];
    const auth = String(new Request(replayed.url, replayed.init).headers.get('Authorization') ?? '');
    expect(auth).toBe('Bearer new-token');
  });

  it('/auth/login 与 /auth/refresh 遇到 401 不触发 refresh', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      fetchCalls.push({ url, init: {} });
      return new Response(
        JSON.stringify({ success: false, message: 'Invalid username or password' }),
        { status: 401 },
      );
    });
    await expect(apiRequest<string>('/auth/login', { method: 'POST' })).rejects.toThrow();
    const refreshHits = fetchCalls.filter((c) => c.url.endsWith('/auth/refresh'));
    expect(refreshHits.length).toBe(0);
  });
});

describe('session expired 全局通知', () => {
  const originalWindow = globalThis.window;
  const originalLocalStorage = (globalThis as unknown as { localStorage?: Storage }).localStorage;

  let apiRequest: typeof import('./api').apiRequest;
  let resetApiBase: typeof import('./api').resetApiBase;
  let setTokens: typeof import('./api').setTokens;
  let onSessionExpired: typeof import('./api').onSessionExpired;
  let storageRef: Record<string, string> = {};
  let fetchCalls: Array<{ url: string }> = [];

  function mockFetch401() {
    globalThis.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      fetchCalls.push({ url });
      return new Response(
        JSON.stringify({ success: false, code: 'INVALID_TOKEN', message: 'Invalid or expired token' }),
        { status: 401 },
      );
    });
  }

  beforeEach(async () => {
    vi.resetModules();
    storageRef = { 'v2.token': 'expired', 'v2.refreshToken': 'refresh-alive' };
    fetchCalls = [];
    const { mock, storage } = makeMockStorage(storageRef);
    storageRef = mock;
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: storage });
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      writable: true,
      value: { localStorage: storage },
    });
    delete (globalThis.window as unknown as { desktop?: unknown }).desktop;
    delete (globalThis as unknown as { import?: { meta?: Record<string, unknown> } }).import;
    (globalThis as unknown as { import: { meta: { env: Record<string, unknown> } } }).import = {
      meta: { env: {} },
    };
    const mod = await import('./api');
    apiRequest = mod.apiRequest;
    resetApiBase = mod.resetApiBase;
    setTokens = mod.setTokens;
    onSessionExpired = mod.onSessionExpired;
    resetApiBase();
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: originalWindow });
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: originalLocalStorage });
  });

  it('401 且 refresh 失败时通知一次（去重）', async () => {
    // 先触发 loadTokens（空会话）再注入内存会话，模拟真实登录顺序
    await apiRequest<string>('/auth/login', { method: 'POST' }).catch(() => {});
    await setTokens('expired', 'refresh-alive');
    mockFetch401();

    const callback = vi.fn();
    const unsubscribe = onSessionExpired(callback);
    await apiRequest<string>('/patients').catch(() => {});
    await apiRequest<string>('/patients').catch(() => {});
    expect(callback).toHaveBeenCalledTimes(1);
    expect(fetchCalls.filter((c) => c.url.endsWith('/auth/refresh')).length).toBeGreaterThanOrEqual(1);
    unsubscribe();
  });

  it('重新登录（setTokens）后可再次通知', async () => {
    await apiRequest<string>('/auth/login', { method: 'POST' }).catch(() => {});
    await setTokens('expired', 'refresh-alive');
    mockFetch401();

    const callback = vi.fn();
    const unsubscribe = onSessionExpired(callback);
    await apiRequest<string>('/patients').catch(() => {});
    expect(callback).toHaveBeenCalledTimes(1);
    await setTokens('new-token', 'new-refresh');
    await apiRequest<string>('/patients').catch(() => {});
    expect(callback).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('/auth/login 的 401 不触发会话失效通知', async () => {
    mockFetch401();
    const callback = vi.fn();
    const unsubscribe = onSessionExpired(callback);
    await expect(apiRequest<string>('/auth/login', { method: 'POST' })).rejects.toThrow();
    expect(callback).not.toHaveBeenCalled();
    expect(fetchCalls.filter((c) => c.url.endsWith('/auth/refresh')).length).toBe(0);
    unsubscribe();
  });
});

describe('friendlyError 映射', () => {
  let friendlyError: typeof import('./messages').friendlyError;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('./messages');
    friendlyError = mod.friendlyError;
  });

  it('常见英文错误映射到中文', () => {
    expect(friendlyError('Appointment not found')).toBe('预约不存在');
    expect(friendlyError('Invalid username or password')).toBe('用户名或密码错误');
    expect(friendlyError('Invalid or expired token')).toBe('登录状态已失效，请重新登录');
    expect(friendlyError('Refresh token has expired')).toBe('登录状态已过期，请重新登录');
    expect(friendlyError('Forbidden resource')).toBe('无权访问该资源');
    expect(friendlyError('Backup file not found')).toBe('备份文件不存在');
    expect(friendlyError('Patient not found')).toBe('患者不存在');
    expect(friendlyError('Doctor not found')).toBe('医生不存在');
    expect(friendlyError('Charge not found')).toBe('收费单不存在');
    expect(friendlyError('User not found')).toBe('用户不存在');
  });

  it('模式匹配错误消息', () => {
    expect(friendlyError('Failed to fetch')).toBe('无法连接本地服务，请检查应用是否正常运行');
    expect(friendlyError('Failed to fetch xyz')).toBe('无法连接本地服务，请检查应用是否正常运行');
    expect(friendlyError('Request failed (500)')).toBe('请求失败，请稍后重试');
    expect(friendlyError('Forbidden resource: backups')).toBe('无权访问该资源');
    expect(friendlyError('Unknown filter field: bad')).toBe('筛选条件无效');
    expect(friendlyError('The operation was aborted due to timeout')).toBe('请求超时，请重试');
    expect(friendlyError('Something timed out')).toBe('请求超时，请重试');
    expect(friendlyError('Create is not supported for this resource')).toBe('该资源不支持新建');
    expect(friendlyError('Update is not supported for this resource')).toBe('该资源不支持编辑');
    expect(friendlyError('RandomName not found')).toBe('RandomName不存在');
  });

  it('未命中映射的英文错误返回通用兜底文案（M5）', () => {
    expect(friendlyError('a completely unexpected message')).toBe('操作失败，请稍后重试');
  });
});
