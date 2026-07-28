import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api } from '@/lib/api/api';
import { triggerErrorBoundary } from '@/components/ErrorBoundary';
import {
  errorLogger,
  initErrorHandler,
  cleanupErrorHandler,
} from '@/lib/error-logger';

vi.mock('@/lib/api/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('@/components/ErrorBoundary', () => ({
  triggerErrorBoundary: vi.fn(),
}));

const mockedApi = vi.mocked(api);
const mockedTrigger = vi.mocked(triggerErrorBoundary);

describe('errorLogger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    mockedApi.post.mockResolvedValue({ data: {} });
  });

  afterEach(async () => {
    // 清空模块级日志队列与定时器，避免用例间串扰
    mockedApi.post.mockResolvedValue({ data: {} });
    await errorLogger.flush();
    cleanupErrorHandler();
    vi.useRealTimers();
  });

  it('error 记录日志并在定时窗口后批量上报', async () => {
    errorLogger.error('接口异常', new Error('boom'), 'patients');

    const logs = errorLogger.getLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ level: 'error', message: '接口异常', context: 'patients' });
    expect(logs[0].stack).toContain('boom');

    await vi.advanceTimersByTimeAsync(5000);
    expect(mockedApi.post).toHaveBeenCalledWith('/operation-logs/batch', {
      logs: [expect.objectContaining({ message: '接口异常' })],
    });
    expect(errorLogger.getLogs()).toHaveLength(0);
  });

  it('warn / info 记录对应级别日志', () => {
    errorLogger.warn('库存偏低', 'inventory');
    errorLogger.info('页面加载');

    const logs = errorLogger.getLogs();
    expect(logs[0]).toMatchObject({ level: 'info', message: '页面加载' });
    expect(logs[1]).toMatchObject({ level: 'warning', message: '库存偏低', context: 'inventory' });
  });

  it('flush 立即上报并清空队列', async () => {
    errorLogger.error('立即上报');
    await errorLogger.flush();

    expect(mockedApi.post).toHaveBeenCalledTimes(1);
    expect(errorLogger.getLogs()).toHaveLength(0);
  });

  it('上报失败时日志放回队列，下次重试成功后清空', async () => {
    mockedApi.post.mockRejectedValueOnce(new Error('network down'));
    errorLogger.error('待重试');

    await errorLogger.flush();
    expect(errorLogger.getLogs()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(5000);
    expect(mockedApi.post).toHaveBeenCalledTimes(2);
    expect(errorLogger.getLogs()).toHaveLength(0);
  });

  it('日志队列超过上限时丢弃最旧的日志', () => {
    for (let i = 0; i < 101; i++) {
      errorLogger.error(`msg-${i}`);
    }

    const logs = errorLogger.getLogs();
    expect(logs).toHaveLength(100);
    expect(logs[0].message).toBe('msg-100');
    expect(logs[99].message).toBe('msg-1');
  });

  it('initErrorHandler 捕获全局错误并触发 ErrorBoundary，cleanup 后停止捕获', () => {
    initErrorHandler();
    // 重复 init 不应重复注册监听器
    initErrorHandler();

    window.dispatchEvent(new ErrorEvent('error', { message: 'boom', error: new Error('boom') }));
    expect(errorLogger.getLogs()).toHaveLength(1);
    expect(errorLogger.getLogs()[0]).toMatchObject({ message: 'boom', context: 'window.error' });
    expect(mockedTrigger).toHaveBeenCalledTimes(1);

    const rejection = Object.assign(new Event('unhandledrejection'), { reason: 'oops' });
    window.dispatchEvent(rejection);
    expect(errorLogger.getLogs()[0]).toMatchObject({
      message: 'Unhandled Promise rejection',
      context: 'unhandledrejection',
    });
    expect(mockedTrigger).toHaveBeenCalledTimes(2);

    cleanupErrorHandler();
    window.dispatchEvent(new ErrorEvent('error', { message: 'after cleanup' }));
    expect(errorLogger.getLogs()).toHaveLength(2);
    expect(mockedTrigger).toHaveBeenCalledTimes(2);
  });
});
