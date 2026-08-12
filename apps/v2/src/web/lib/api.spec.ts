// @vitest-environment jsdom

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

  it('sends a W3C traceparent header on API requests', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: 'ok' }), { status: 200 }),
    );
    await apiRequest<string>('/ping');
    const call = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const request = new Request(new URL(String(call[0]), 'http://127.0.0.1:5180/'), call[1]);
    expect(request.headers.get('traceparent')).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
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

  it('defaults to /api/v2 when no desktop bridge or env is present', async () => {
    const targetEnv = (globalThis as unknown as { import: { meta: { env: Record<string, string> } } }).import.meta.env;
    delete targetEnv.VITE_API_BASE_URL;
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: 'ok' }), { status: 200 }),
    );
    await apiRequest<string>('/default');
    const call = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(call[0])).toBe('/api/v2/default');
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
    vi.stubGlobal('location', new URL('http://127.0.0.1:5180/'));
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
    vi.unstubAllGlobals();
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
    const auth = String(
      new Request(new URL(String(fetchCall[0]), 'http://127.0.0.1:5180/'), fetchCall[1]).headers.get('Authorization') ?? '',
    );
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
    const auth = String(
      new Request(new URL(String(fetchCall[0]), 'http://127.0.0.1:5180/'), fetchCall[1]).headers.get('Authorization') ?? '',
    );
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
    const auth = String(
      new Request(new URL(String(fetchCall[0]), 'http://127.0.0.1:5180/'), fetchCall[1]).headers.get('Authorization') ?? '',
    );
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
    const auth = String(
      new Request(new URL(String(lastCall[0]), 'http://127.0.0.1:5180/'), lastCall[1]).headers.get('Authorization') ?? '',
    );
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

  it('setTokens warns when the secret store returns false', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const secrets = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(false),
      delete: vi.fn().mockResolvedValue(true),
    };
    (globalThis.window as unknown as { desktop: { secrets: typeof secrets } }).desktop = { secrets };
    await setTokens('mem-token', 'mem-refresh');
    expect(secrets.set).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
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
    vi.stubGlobal('location', new URL('http://127.0.0.1:5180/'));
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
    vi.unstubAllGlobals();
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
    const auth = String(
      new Request(new URL(String(replayed.url), 'http://127.0.0.1:5180/'), replayed.init).headers.get('Authorization') ?? '',
    );
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
    vi.stubGlobal('location', new URL('http://127.0.0.1:5180/'));
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
    vi.unstubAllGlobals();
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

  it('unsubscribes a session expired listener', async () => {
    await apiRequest<string>('/auth/login', { method: 'POST' }).catch(() => {});
    await setTokens('expired', 'refresh-alive');
    mockFetch401();
    const callback = vi.fn();
    const unsubscribe = onSessionExpired(callback);
    unsubscribe();
    await apiRequest<string>('/patients').catch(() => {});
    expect(callback).not.toHaveBeenCalled();
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
    expect(friendlyError('Operation is already in progress; use a new requestId or wait for the current operation to finish'))
      .toBe('操作正在进行中，请勿重复提交');
  });

  it('模式匹配错误消息', () => {
    expect(friendlyError('Failed to fetch')).toBe('无法连接本地服务，请检查应用是否正常运行');
    expect(friendlyError('Failed to fetch xyz')).toBe('无法连接本地服务，请检查应用是否正常运行');
    expect(friendlyError('fetchAllPages exceeded the page cap; refusing to continue')).toBe('分页数据量异常，已停止继续加载');
    expect(friendlyError('Request failed (500)')).toBe('请求失败，请稍后重试');
    expect(friendlyError('Forbidden resource: backups')).toBe('无权访问该资源');
    expect(friendlyError('Unknown filter field: bad')).toBe('筛选条件无效');
    expect(friendlyError('Search query must be at most 200 characters')).toBe('搜索关键词不能超过 200 个字符');
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

describe('api helper functions', () => {
  const originalWindow = globalThis.window;
  const originalLocalStorage = (globalThis as unknown as { localStorage?: Storage }).localStorage;
  const originalFetch = globalThis.fetch;

  let mod: typeof import('./api');
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    const { storage } = makeMockStorage();
    vi.stubGlobal('location', new URL('http://127.0.0.1:5180/'));
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: storage });
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      writable: true,
      value: {
        location: globalThis.location,
        localStorage: storage,
        desktop: { getApiPort: vi.fn().mockResolvedValue(9999) },
      },
    });
    delete (globalThis as unknown as { import?: { meta?: Record<string, unknown> } }).import;
    (globalThis as unknown as { import: { meta: { env: Record<string, unknown> } } }).import = {
      meta: { env: {} },
    };
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    mod = await import('./api');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: originalWindow });
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: originalLocalStorage });
    globalThis.fetch = originalFetch;
  });

  it('fetchAllPages aggregates every page', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ success: true, data: { items: [{ id: 'a' }, { id: 'b' }], total: 2, page: 1, pageSize: 100 } }),
        { status: 200 },
      ),
    );
    const rows = await mod.fetchAllPages('/resources/patients');
    expect(rows).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(String(fetchMock.mock.calls[0][0])).toBe('http://127.0.0.1:9999/api/v2/resources/patients?page=1&pageSize=100');
  });

  it('fetchAllPages stops at the page cap instead of looping forever', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response(
        JSON.stringify({
          success: true,
          data: { items: [{ id: 'x' }], total: 999999, page: 1, pageSize: 100 },
        }),
        { status: 200 },
      )),
    );
    await expect(mod.fetchAllPages('/resources/patients')).rejects.toThrow('page cap');
    expect(fetchMock.mock.calls.length).toBe(1000);
  });

  it('downloadCsv downloads a blob', async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:csv');
    fetchMock.mockResolvedValueOnce(new Response('a,b\n1,2', { status: 200 }));
    await mod.downloadCsv('patients');
    expect(String(fetchMock.mock.calls[0][0])).toContain('/resources/patients/export');
    expect(createSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
    createSpy.mockRestore();
  });

  it('getSignedFileUrl returns an absolute signed URL', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ success: true, data: { url: '/api/v2/files/x.png?exp=1&sig=s' } }),
        { status: 200 },
      ),
    );
    const url = await mod.getSignedFileUrl('/api/v2/files/x.png');
    expect(url).toBe('http://127.0.0.1:9999/api/v2/files/x.png?exp=1&sig=s');
  });

  it('uploadFile posts the raw file', async () => {
    const file = new File(['png'], 'x.png', { type: 'image/png' });
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ success: true, data: { id: 'f1', filename: 'x.png', url: '/api/v2/files/x.png?exp=1&sig=s' } }),
        { status: 201 },
      ),
    );
    const result = await mod.uploadFile(file);
    expect(result.id).toBe('f1');
    const call = fetchMock.mock.calls[0];
    expect(String(call[0])).toBe('http://127.0.0.1:9999/api/v2/files');
    expect((call[1] as RequestInit).body).toBe(file);
  });

  it('logout clears the session even when the remote call fails', async () => {
    await mod.setTokens('tok', 'refresh');
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    await expect(mod.logout()).resolves.toBeUndefined();
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, data: 'ok' }), { status: 200 }),
    );
    await mod.apiRequest('/after-logout');
    const call = fetchMock.mock.calls[0];
    const auth = String(new Request(call[0], call[1]).headers.get('Authorization') ?? '');
    expect(auth).toBe('');
  });

  it('switchClinic swaps the access token and keeps the refresh token', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, data: 'ok' }), { status: 200 }),
    );
    await mod.apiRequest('/warmup');
    await mod.setTokens('old-token', 'keep-refresh');
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ success: true, data: { token: 'clinic-token', clinicId: 'clinic-b' } }),
        { status: 200 },
      ),
    );
    await mod.switchClinic('clinic-b');
    const call = fetchMock.mock.calls[1];
    const request = new Request(call[0], call[1]);
    expect(String(request.url)).toContain('/auth/switch-clinic');
    expect(await request.json()).toEqual({ clinicId: 'clinic-b' });
    expect(String(request.headers.get('Authorization'))).toBe('Bearer old-token');

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, data: 'ok' }), { status: 200 }),
    );
    await mod.apiRequest('/after-switch');
    const replay = new Request(fetchMock.mock.calls[2][0], fetchMock.mock.calls[2][1]);
    expect(String(replay.headers.get('Authorization'))).toBe('Bearer clinic-token');
  });

  it('fetchPrintHtml returns the response text', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>print</html>', { status: 200 }));
    const html = await mod.fetchPrintHtml('/print/visit', { visitId: 'v1' });
    expect(html).toBe('<html>print</html>');
    const call = fetchMock.mock.calls[0];
    const request = new Request(call[0], call[1]);
    expect(String(request.url)).toContain('/print/visit');
    expect(await request.json()).toEqual({ visitId: 'v1' });
  });

  it('downloadCsvPath downloads with the provided filename', async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:path');
    fetchMock.mockResolvedValueOnce(new Response('x', { status: 200 }));
    await mod.downloadCsvPath('/reports/monthly', '月报.csv');
    expect(String(fetchMock.mock.calls[0][0])).toContain('/reports/monthly');
    expect(clickSpy).toHaveBeenCalled();
    expect(createSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
    createSpy.mockRestore();
  });

  it('retries idempotent GET requests once after a transient failure', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: 'ok' }), { status: 200 }));
    await expect(mod.apiRequest('/retry-get')).resolves.toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry non-idempotent requests', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    await expect(mod.apiRequest('/retry-post', { method: 'POST' })).rejects.toThrow('操作失败，请稍后重试');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('exposes server code and trace id on errors', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: false,
          code: 'BUSY',
          message: 'Operation is already in progress',
          traceId: 't1',
        }),
        { status: 409 },
      ),
    );
    try {
      await mod.apiRequest('/busy');
      throw new Error('expected rejection');
    } catch (error) {
      const clientError = error as { message: string; code?: string; traceId?: string };
      expect(clientError.message).toBe('操作正在进行中，请勿重复提交');
      expect(clientError.code).toBe('BUSY');
      expect(clientError.traceId).toBe('t1');
    }
  });

  it('throws a friendly error when the response body is not JSON', async () => {
    fetchMock.mockResolvedValueOnce(new Response('oops', { status: 500 }));
    await expect(mod.apiRequest('/broken')).rejects.toThrow('请求失败，请稍后重试');
  });

  it('retries signed file requests after a 401 refresh', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: 'ok' }), { status: 200 }));
    await mod.apiRequest('/warmup');
    await mod.setTokens('expired', 'refresh-alive');
    let signedCalls = 0;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/refresh')) {
        return new Response(
          JSON.stringify({ success: true, data: { token: 'new', refreshToken: 'ref2' } }),
          { status: 200 },
        );
      }
      if (url.endsWith('/sign')) {
        signedCalls += 1;
        if (signedCalls === 1) {
          return new Response(
            JSON.stringify({ success: false, message: 'Invalid or expired token' }),
            { status: 401 },
          );
        }
        return new Response(
          JSON.stringify({ success: true, data: { url: '/api/v2/files/x.png?exp=1&sig=s' } }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ success: true, data: 'ok' }), { status: 200 });
    });
    const url = await mod.getSignedFileUrl('/api/v2/files/x.png');
    expect(url).toBe('http://127.0.0.1:9999/api/v2/files/x.png?exp=1&sig=s');
    expect(signedCalls).toBe(2);
  });

  it('switchClinic throws when the session has no refresh token', async () => {
    await expect(mod.switchClinic('clinic-c')).rejects.toThrow('Session is missing refresh token');
  });

  it('resets the api base when the desktop reports a new ready port', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ success: true, data: 'ok' }), { status: 200 })),
    );
    const statusCallbacks: Array<(event: Record<string, unknown>) => void> = [];
    const getApiPort = vi.fn().mockResolvedValueOnce(1111).mockResolvedValueOnce(2222);
    (globalThis.window as unknown as { desktop: Record<string, unknown> }).desktop = {
      getApiPort,
      onApiStatus: vi.fn((callback: (event: Record<string, unknown>) => void) => {
        statusCallbacks.push(callback);
        return () => {};
      }),
    };
    await mod.apiRequest('/first');
    expect(String(fetchMock.mock.calls[0][0])).toContain('127.0.0.1:1111');
    statusCallbacks[0]?.({ status: 'ready', port: 2222 });
    await mod.apiRequest('/second');
    expect(String(fetchMock.mock.calls[1][0])).toContain('127.0.0.1:2222');
  });

  it('fetchAllPages aggregates multiple pages with an existing query', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const page = Number(url.searchParams.get('page') ?? '1');
      const count = page === 3 ? 50 : 100;
      const items = Array.from({ length: count }, (_, index) => ({ id: `r-${page}-${index + 1}` }));
      return new Response(
        JSON.stringify({ success: true, data: { items, total: 250, page, pageSize: 100 } }),
        { status: 200 },
      );
    });
    const rows = await mod.fetchAllPages('/resources/patients?clinic=1');
    expect(rows).toHaveLength(250);
    expect(rows[0]).toEqual({ id: 'r-1-1' });
    expect(rows[249]).toEqual({ id: 'r-3-50' });
    expect(String(fetchMock.mock.calls[1][0])).toContain('&page=2');
  });

  it('fetchAllPages overrides existing page/pageSize params instead of duplicating them', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.searchParams.getAll('page')).toEqual(['1']);
      expect(url.searchParams.getAll('pageSize')).toEqual(['100']);
      expect(url.searchParams.get('clinic')).toBe('1');
      return new Response(
        JSON.stringify({ success: true, data: { items: [{ id: 'a' }], total: 1, page: 1, pageSize: 100 } }),
        { status: 200 },
      );
    });
    const rows = await mod.fetchAllPages('/resources/patients?page=3&pageSize=50&clinic=1');
    expect(rows).toEqual([{ id: 'a' }]);
    const callUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(callUrl.searchParams.get('page')).toBe('1');
    expect(callUrl.searchParams.get('pageSize')).toBe('100');
    expect(callUrl.searchParams.get('clinic')).toBe('1');
  });

  it('fetchAllPages follows nextCursor when the first page returns one', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const cursor = url.searchParams.get('cursor');
      if (!cursor) {
        return new Response(JSON.stringify({
          success: true,
          data: { items: [{ id: 'r-1' }], total: 3, page: 1, pageSize: 100, nextCursor: 'c-1' },
        }), { status: 200 });
      }
      if (cursor === 'c-1') {
        expect(url.searchParams.get('page')).toBeNull();
        return new Response(JSON.stringify({
          success: true,
          data: { items: [{ id: 'r-2' }], total: 3, page: 1, pageSize: 100, nextCursor: 'c-2' },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        success: true,
        data: { items: [{ id: 'r-3' }], total: 3, page: 1, pageSize: 100 },
      }), { status: 200 });
    });
    const rows = await mod.fetchAllPages('/resources/patients');
    expect(rows).toEqual([{ id: 'r-1' }, { id: 'r-2' }, { id: 'r-3' }]);
    expect(String(fetchMock.mock.calls[1][0])).toContain('cursor=c-1');
    expect(String(fetchMock.mock.calls[2][0])).toContain('cursor=c-2');
  });

  it('fetchAllPages returns early for empty first pages', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ success: true, data: { items: [], total: 0, page: 1, pageSize: 100 } }),
        { status: 200 },
      ),
    );
    await expect(mod.fetchAllPages('/resources/patients')).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('login persists the access token through the secret-free bridge', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: { token: 'login-token', refreshToken: 'login-refresh', user: { id: 'u1', name: 'Alice' } },
        }),
        { status: 200 },
      ),
    );
    const result = await mod.login('alice', 'secret');
    expect(result.user).toMatchObject({ id: 'u1' });
    const loginCall = new Request(fetchMock.mock.calls[0][0], fetchMock.mock.calls[0][1]);
    expect(String(loginCall.url)).toContain('/auth/login');
    expect(await loginCall.json()).toEqual({ username: 'alice', password: 'secret' });

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: 'ok' }), { status: 200 }));
    await mod.apiRequest('/after-login');
    const replay = new Request(fetchMock.mock.calls[1][0], fetchMock.mock.calls[1][1]);
    expect(String(replay.headers.get('Authorization'))).toBe('Bearer login-token');
  });

  it('logout clears the session without a refresh token', async () => {
    await expect(mod.logout()).resolves.toBeUndefined();
  });

  it('downloadCsv and downloadCsvPath surface server failures', async () => {
    fetchMock.mockResolvedValueOnce(new Response('oops', { status: 500 }));
    await expect(mod.downloadCsv('patients')).rejects.toThrow('导出失败，请稍后重试');
    fetchMock.mockResolvedValueOnce(new Response('oops', { status: 500 }));
    await expect(mod.downloadCsvPath('/reports/monthly', 'x.csv')).rejects.toThrow('导出失败，请稍后重试');
  });

  it('fetchPrintHtml surfaces server error messages', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'print template missing' }), { status: 500 }),
    );
    await expect(mod.fetchPrintHtml('/print/visit', { visitId: 'v1' })).rejects.toThrow('操作失败，请稍后重试');
  });

  it('getSignedFileUrl and uploadFile reject invalid responses', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: false, message: '图片链接获取失败' }), { status: 500 }),
    );
    await expect(mod.getSignedFileUrl('/api/v2/files/x.png')).rejects.toThrow('图片链接获取失败');

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ success: false }), { status: 200 }));
    await expect(mod.uploadFile(new File(['x'], 'x.png', { type: 'image/png' }))).rejects.toThrow('文件上传失败，请稍后重试');

    fetchMock.mockResolvedValueOnce(new Response('oops', { status: 500 }));
    await expect(mod.uploadFile(new File(['x'], 'y.png', { type: 'image/png' }))).rejects.toThrow('文件上传失败，请稍后重试');
  });

  it('notifies remaining session listeners when one listener throws', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/warmup')) {
        return new Response(JSON.stringify({ success: true, data: 'ok' }), { status: 200 });
      }
      return new Response(JSON.stringify({ success: false, message: 'Invalid or expired token' }), { status: 401 });
    });
    await mod.apiRequest('/warmup');
    await mod.setTokens('expired', 'refresh-alive');

    const ok = vi.fn();
    const boom = vi.fn(() => {
      throw new Error('listener crashed');
    });
    mod.onSessionExpired(boom);
    mod.onSessionExpired(ok);
    await mod.apiRequest('/patients').catch(() => {});
    expect(ok).toHaveBeenCalledTimes(1);
  });

  it('retries idempotent GETs twice and reports the final failure', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    await expect(mod.apiRequest('/twice-fail')).rejects.toThrow('操作失败，请稍后重试');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('signed file requests surface 401 when refresh cannot recover', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/warmup')) {
        return new Response(JSON.stringify({ success: true, data: 'ok' }), { status: 200 });
      }
      if (url.endsWith('/auth/refresh')) {
        return new Response(JSON.stringify({ success: false, message: 'refresh rejected' }), { status: 401 });
      }
      return new Response(JSON.stringify({ success: false, message: 'Invalid or expired token' }), { status: 401 });
    });
    await mod.apiRequest('/warmup');
    await mod.setTokens('expired', 'refresh-alive');
    await expect(mod.getSignedFileUrl('/api/v2/files/x.png')).rejects.toThrow('登录状态已失效，请重新登录');
  });

  it('fetchAllPages refuses to continue when pages return fewer rows than total', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const page = Number(url.searchParams.get('page') ?? '1');
      const items = page === 1 ? [{ id: 'a' }] : [];
      return new Response(
        JSON.stringify({ success: true, data: { items, total: 250, page, pageSize: 100 } }),
        { status: 200 },
      );
    });
    await expect(mod.fetchAllPages('/resources/patients')).rejects.toThrow('page cap');
  });

  it('logout clears the session even when the secret store delete fails', async () => {
    const secrets = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(true),
      delete: vi.fn().mockRejectedValue(new Error('delete failed')),
    };
    (globalThis.window as unknown as { desktop: Record<string, unknown> }).desktop = {
      getApiPort: vi.fn().mockResolvedValue(9999),
      secrets,
    };
    await mod.setTokens('tok', 'refresh');
    await expect(mod.logout()).resolves.toBeUndefined();
    expect(secrets.delete).toHaveBeenCalledWith('v2.token');
  });

  it('logout calls the remote logout endpoint when a refresh token exists', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: 'ok' }), { status: 200 }));
    await mod.apiRequest('/warmup');
    await mod.setTokens('tok', 'refresh-alive');
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: 'ok' }), { status: 200 }));
    await expect(mod.logout()).resolves.toBeUndefined();
    const logoutCall = fetchMock.mock.calls.find(([input]) => String(input).endsWith('/auth/logout'));
    expect(logoutCall).toBeDefined();
    const request = new Request(logoutCall![0], logoutCall![1]);
    expect(request.method).toBe('POST');
    expect(await request.json()).toEqual({ refreshToken: 'refresh-alive' });
  });

  it('deduplicates concurrent refresh attempts', async () => {
    let refreshCalls = 0;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/warmup')) {
        return new Response(JSON.stringify({ success: true, data: 'ok' }), { status: 200 });
      }
      if (url.endsWith('/auth/refresh')) {
        refreshCalls += 1;
        return new Response(
          JSON.stringify({ success: true, data: { token: 'new-token', refreshToken: 'new-refresh' } }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ success: false, message: 'Invalid or expired token' }), { status: 401 });
    });
    await mod.apiRequest('/warmup');
    await mod.setTokens('expired', 'refresh-alive');
    await Promise.all([
      mod.apiRequest('/one').catch(() => {}),
      mod.apiRequest('/two').catch(() => {}),
    ]);
    expect(refreshCalls).toBe(1);
  });

  it('does not clear the session when refresh fails with a non-401 response', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/warmup')) {
        return new Response(JSON.stringify({ success: true, data: 'ok' }), { status: 200 });
      }
      if (url.endsWith('/auth/refresh')) {
        return new Response(JSON.stringify({ success: false, message: 'refresh temporarily unavailable' }), { status: 500 });
      }
      if (url.endsWith('/after')) {
        return new Response(JSON.stringify({ success: true, data: 'ok' }), { status: 200 });
      }
      return new Response(JSON.stringify({ success: false, message: 'Invalid or expired token' }), { status: 401 });
    });
    await mod.apiRequest('/warmup');
    await mod.setTokens('expired', 'refresh-alive');
    await mod.apiRequest('/patients').catch(() => {});
    await mod.apiRequest('/after');
    const afterCall = fetchMock.mock.calls.find(([input]) => String(input).endsWith('/after'));
    const request = new Request(afterCall![0], afterCall![1]);
    expect(String(request.headers.get('Authorization'))).toBe('Bearer expired');
  });

  it('treats a malformed refresh body as a failed refresh', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/warmup')) {
        return new Response(JSON.stringify({ success: true, data: 'ok' }), { status: 200 });
      }
      if (url.endsWith('/auth/refresh')) {
        return new Response('not json', { status: 200 });
      }
      return new Response(JSON.stringify({ success: false, message: 'Invalid or expired token' }), { status: 401 });
    });
    await mod.apiRequest('/warmup');
    await mod.setTokens('expired', 'refresh-alive');
    const callback = vi.fn();
    mod.onSessionExpired(callback);
    await mod.apiRequest('/patients').catch(() => {});
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('ignores api status events without a ready numeric port', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ success: true, data: 'ok' }), { status: 200 })),
    );
    const statusCallbacks: Array<(event: Record<string, unknown>) => void> = [];
    const getApiPort = vi.fn().mockResolvedValue(1111);
    (globalThis.window as unknown as { desktop: Record<string, unknown> }).desktop = {
      getApiPort,
      onApiStatus: vi.fn((callback: (event: Record<string, unknown>) => void) => {
        statusCallbacks.push(callback);
        return () => {};
      }),
    };
    await mod.apiRequest('/first');
    statusCallbacks[0]?.({ status: 'down', port: 2222 });
    statusCallbacks[0]?.({ status: 'ready', port: 'abc' });
    await mod.apiRequest('/second');
    expect(String(fetchMock.mock.calls[1][0])).toContain('127.0.0.1:1111');
  });

  it('uploads files without a mime type using the octet-stream fallback', async () => {
    const file = new File(['x'], 'x.bin');
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ success: true, data: { id: 'f1', filename: 'x.bin', url: '/api/v2/files/x.bin' } }),
        { status: 201 },
      ),
    );
    const result = await mod.uploadFile(file);
    expect(result.id).toBe('f1');
    const request = new Request(fetchMock.mock.calls[0][0], fetchMock.mock.calls[0][1]);
    expect(String(request.headers.get('content-type'))).toBe('application/octet-stream');
  });

  it('combines a caller signal with the request timeout', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: 'ok' }), { status: 200 }));
    const controller = new AbortController();
    await expect(mod.apiRequest('/with-signal', { signal: controller.signal })).resolves.toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps non-Error fetch failures through the friendly error fallback', async () => {
    fetchMock.mockRejectedValue('network exploded');
    await expect(mod.apiRequest('/string-failure')).rejects.toThrow('操作失败，请稍后重试');
  });
});
