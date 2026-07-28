import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';

const { toastErrorMock, logoutMock } = vi.hoisted(() => ({
  toastErrorMock: vi.fn(),
  logoutMock: vi.fn(),
}));

vi.mock('@/lib/utils/toast-service', () => ({
  toastService: { error: toastErrorMock, success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock('@/lib/store/auth-store', () => ({
  useAuthStore: { getState: () => ({ logout: logoutMock }) },
}));

// 缩短重试延迟，避免测试真实等待指数退避
vi.mock('@/config/constants', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  API_RETRY_DELAY_MS: 1,
  LOGOUT_REDIRECT_DELAY_MS: 0,
}));

import { api, createAbortController, resetRefreshFailedFlag } from '@/lib/api/api';

type AdapterFn = (config: InternalAxiosRequestConfig) => Promise<AxiosResponse>;
type RefreshAwareConfig = InternalAxiosRequestConfig & { _isRefreshRetry?: boolean };

const ok = (config: InternalAxiosRequestConfig, data: unknown, status = 200): AxiosResponse => ({
  data,
  status,
  statusText: 'OK',
  headers: {},
  config,
});

const httpError = (config: InternalAxiosRequestConfig, status: number, data?: unknown) =>
  new AxiosError('Request failed', undefined, config, null, {
    data,
    status,
    statusText: '',
    headers: {},
    config,
  } as AxiosResponse);

let adapter: ReturnType<typeof vi.fn<AdapterFn>>;

const refreshCallCount = () =>
  adapter.mock.calls.filter(([config]) => config.url === '/auth/refresh').length;

describe('api 核心封装', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRefreshFailedFlag();
    adapter = vi.fn<AdapterFn>();
    api.defaults.adapter = adapter as never;
  });

  it('成功请求直接返回响应', async () => {
    adapter.mockImplementation(async (config) => ok(config, { hello: 1 }));

    const res = await api.get('/ping');
    expect(res.data).toEqual({ hello: 1 });
    expect(adapter).toHaveBeenCalledTimes(1);
  });

  it('GET 遇 502 自动重试后成功且不弹 toast', async () => {
    adapter
      .mockImplementationOnce(async (config) => {
        throw httpError(config, 502);
      })
      .mockImplementationOnce(async (config) => ok(config, 'recovered'));

    const res = await api.get('/list');
    expect(res.data).toBe('recovered');
    expect(adapter).toHaveBeenCalledTimes(2);
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it('GET 持续 502 时重试耗尽后 reject 并 toast 服务端消息', async () => {
    adapter.mockImplementation(async (config) => {
      throw httpError(config, 502, { message: 'Bad Gateway' });
    });

    await expect(api.get('/list')).rejects.toBeInstanceOf(AxiosError);
    // API_MAX_RETRIES = 1：首次 + 1 次重试
    expect(adapter).toHaveBeenCalledTimes(2);
    expect(toastErrorMock).toHaveBeenCalledWith('Bad Gateway');
  });

  it('写操作（POST）遇 500 不重试并 toast 服务器错误', async () => {
    adapter.mockImplementation(async (config) => {
      throw httpError(config, 500);
    });

    await expect(api.post('/save', {})).rejects.toBeInstanceOf(AxiosError);
    expect(adapter).toHaveBeenCalledTimes(1);
    expect(toastErrorMock).toHaveBeenCalledWith('服务器内部错误，请稍后重试');
  });

  it('400 错误将 message 数组用分号拼接', async () => {
    adapter.mockImplementation(async (config) => {
      throw httpError(config, 400, { message: ['姓名必填', '手机号格式错误'] });
    });

    await expect(api.get('/patients')).rejects.toBeInstanceOf(AxiosError);
    expect(adapter).toHaveBeenCalledTimes(1);
    expect(toastErrorMock).toHaveBeenCalledWith('姓名必填；手机号格式错误');
  });

  it('skipErrorToast 时不弹错误 toast', async () => {
    adapter.mockImplementation(async (config) => {
      throw httpError(config, 404);
    });

    await expect(
      api.get('/missing', { skipErrorToast: true } as never),
    ).rejects.toBeInstanceOf(AxiosError);
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it('超时错误（无响应体）提示检查网络', async () => {
    adapter.mockImplementation(async (config) => {
      throw new AxiosError('timeout of 30000ms exceeded', 'ECONNABORTED', config);
    });

    await expect(api.post('/slow', {})).rejects.toBeInstanceOf(AxiosError);
    expect(toastErrorMock).toHaveBeenCalledWith('请求超时，请检查网络连接');
  });

  it('401 时刷新 token 成功后重放原请求', async () => {
    adapter.mockImplementation(async (config) => {
      if (config.url === '/auth/refresh') return ok(config, { ok: true });
      if (!(config as RefreshAwareConfig)._isRefreshRetry) throw httpError(config, 401);
      return ok(config, 'fresh');
    });

    const res = await api.get('/protected');
    expect(res.data).toBe('fresh');
    expect(refreshCallCount()).toBe(1);
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it('刷新失败后进入短路状态，后续 401 不再触发刷新，reset 后恢复', async () => {
    adapter.mockImplementation(async (config) => {
      if (config.url === '/auth/refresh') {
        throw new AxiosError('Network Error', 'ERR_NETWORK', config);
      }
      throw httpError(config, 401);
    });

    await expect(api.get('/protected')).rejects.toBeInstanceOf(AxiosError);
    expect(refreshCallCount()).toBe(1);

    // 短路：不再请求 /auth/refresh
    await expect(api.get('/protected-again')).rejects.toBeInstanceOf(AxiosError);
    expect(refreshCallCount()).toBe(1);

    // 重新登录后重置标志，刷新机制恢复
    resetRefreshFailedFlag();
    await expect(api.get('/protected-third')).rejects.toBeInstanceOf(AxiosError);
    expect(refreshCallCount()).toBe(2);
  });

  it('createAbortController 返回可取消的 signal', () => {
    const { signal, abort } = createAbortController();
    expect(signal.aborted).toBe(false);
    abort();
    expect(signal.aborted).toBe(true);
  });
});
