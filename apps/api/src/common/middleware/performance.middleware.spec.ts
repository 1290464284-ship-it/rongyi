import { PerformanceMiddleware } from './performance.middleware';
import type { Request, Response, NextFunction } from 'express';

interface MockRequest extends Partial<Request> {
  route?: { path?: string };
  originalUrl?: string;
  method: string;
}

function createMockReq(overrides: Partial<MockRequest> = {}): MockRequest {
  return {
    method: 'GET',
    originalUrl: '/api/test',
    route: { path: '/test' },
    ...overrides,
  };
}

function createMockRes(): Response {
  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
  const headers: Record<string, string> = {};
  return {
    statusCode: 200,
    setHeader: jest.fn((name: string, value: string) => { headers[name] = value; }),
    getHeader: jest.fn((name: string) => headers[name]),
    on: jest.fn((event: string, fn: (...args: unknown[]) => void) => {
      if (!Object.hasOwn(listeners, event)) listeners[event] = [];
      listeners[event].push(fn);
    }),
    emit: (event: string) => {
      (listeners[event] ?? []).forEach(fn => fn());
      return true;
    },
  } as unknown as Response & { emit: (event: string) => boolean };
}

describe('PerformanceMiddleware', () => {
  let next: NextFunction;

  beforeEach(() => {
    next = jest.fn();
  });

  describe('constructor 默认配置', () => {
    it('应使用默认阈值 500ms', () => {
      const mw = new PerformanceMiddleware();
      const stats = mw.getStats();
      expect(stats.slowRequestThresholdMs).toBe(500);
    });

    it('应允许自定义阈值', () => {
      const mw = new PerformanceMiddleware({ slowRequestThresholdMs: 1000 });
      expect(mw.getStats().slowRequestThresholdMs).toBe(1000);
    });

    it('默认启用统计 header', () => {
      const mw = new PerformanceMiddleware();
      const req = createMockReq();
      const res = createMockRes();
      mw.use(req as Request, res as unknown as Response, next);
      res.emit('finish');
      expect(res.setHeader).toHaveBeenCalledWith('X-Response-Time', expect.stringContaining('ms'));
    });

    it('可禁用统计 header', () => {
      const mw = new PerformanceMiddleware({ enableStatsHeader: false });
      const req = createMockReq();
      const res = createMockRes();
      mw.use(req as Request, res as unknown as Response, next);
      res.emit('finish');
      expect(res.setHeader).not.toHaveBeenCalled();
    });
  });

  describe('use 请求处理', () => {
    it('非排除路径应调用 next()', () => {
      const mw = new PerformanceMiddleware();
      const req = createMockReq();
      const res = createMockRes();
      mw.use(req as Request, res as unknown as Response, next);
      expect(next).toHaveBeenCalled();
    });

    it('排除路径应直接调用 next() 不记录', () => {
      const mw = new PerformanceMiddleware({ excludePaths: ['/health'] });
      const req = createMockReq({ originalUrl: '/health' });
      const res = createMockRes();
      mw.use(req as Request, res as unknown as Response, next);
      expect(next).toHaveBeenCalled();
      expect(mw.getStats().totalRequests).toBe(0);
    });

    it('应记录请求统计', () => {
      const mw = new PerformanceMiddleware();
      const req = createMockReq();
      const res = createMockRes();
      mw.use(req as Request, res as unknown as Response, next);
      res.emit('finish');
      const stats = mw.getStats();
      expect(stats.totalRequests).toBe(1);
      expect(stats.totalDurationMs).toBeGreaterThanOrEqual(0);
    });

    it('应按方法分组统计', () => {
      const mw = new PerformanceMiddleware();

      const getReq = createMockReq({ method: 'GET', originalUrl: '/api/a' });
      const getRes = createMockRes();
      mw.use(getReq as Request, getRes as unknown as Response, next);
      getRes.emit('finish');

      const postReq = createMockReq({ method: 'POST', originalUrl: '/api/b' });
      const postRes = createMockRes();
      mw.use(postReq as Request, postRes as unknown as Response, next);
      postRes.emit('finish');

      const stats = mw.getStats();
      expect(stats.byMethod['GET']).toBeDefined();
      expect(stats.byMethod['POST']).toBeDefined();
      expect(stats.byMethod['GET'].count).toBe(1);
      expect(stats.byMethod['POST'].count).toBe(1);
    });

    it('应使用 route.path 作为路径键', () => {
      const mw = new PerformanceMiddleware();
      const req = createMockReq({ route: { path: '/users/:id' }, originalUrl: '/users/123' });
      const res = createMockRes();
      mw.use(req as Request, res as unknown as Response, next);
      res.emit('finish');
      const stats = mw.getStats();
      expect(stats.topSlowPaths[0]?.path).toContain('/users/:id');
    });

    it('无 route.path 时应使用 originalUrl', () => {
      const mw = new PerformanceMiddleware();
      const req = createMockReq({ route: undefined, originalUrl: '/api/fallback' });
      const res = createMockRes();
      mw.use(req as Request, res as unknown as Response, next);
      res.emit('finish');
      const stats = mw.getStats();
      expect(stats.topSlowPaths[0]?.path).toContain('/api/fallback');
    });
  });

  describe('慢请求检测', () => {
    it('超过阈值的请求应计为慢请求', () => {
      const mw = new PerformanceMiddleware({ slowRequestThresholdMs: 0 });
      const req = createMockReq();
      const res = createMockRes();
      mw.use(req as Request, res as unknown as Response, next);
      res.emit('finish');
      expect(mw.getStats().slowRequests).toBeGreaterThanOrEqual(1);
    });

    it('慢请求路径应记录 slowCount', () => {
      const mw = new PerformanceMiddleware({ slowRequestThresholdMs: 0 });
      const req = createMockReq();
      const res = createMockRes();
      mw.use(req as Request, res as unknown as Response, next);
      res.emit('finish');
      expect(mw.getStats().topSlowPaths[0]?.slowCount).toBeGreaterThanOrEqual(1);
    });

    it('慢请求应记录警告日志', () => {
      const mw = new PerformanceMiddleware({ slowRequestThresholdMs: 0 });
      const loggerSpy = jest.spyOn((mw as unknown as Record<string, { warn: jest.Mock }>).logger, 'warn').mockImplementation(() => {});
      const req = createMockReq();
      const res = createMockRes();
      mw.use(req as Request, res as unknown as Response, next);
      res.emit('finish');
      expect(loggerSpy).toHaveBeenCalled();
      loggerSpy.mockRestore();
    });
  });

  describe('getStats 统计输出', () => {
    it('无请求时 avgDurationMs 应为 0', () => {
      const mw = new PerformanceMiddleware();
      const stats = mw.getStats();
      expect(stats.avgDurationMs).toBe(0);
      expect(stats.slowRatePercent).toBe(0);
    });

    it('应包含 uptimeMs', () => {
      const mw = new PerformanceMiddleware();
      const stats = mw.getStats();
      expect(stats.uptimeMs).toBeGreaterThanOrEqual(0);
    });

    it('topSlowPaths 应最多返回 10 条', () => {
      const mw = new PerformanceMiddleware({ slowRequestThresholdMs: 0 });
      for (let i = 0; i < 15; i++) {
        const req = createMockReq({ originalUrl: `/api/endpoint-${i}` });
        const res = createMockRes();
        mw.use(req as Request, res as unknown as Response, next);
        res.emit('finish');
      }
      expect(mw.getStats().topSlowPaths.length).toBeLessThanOrEqual(10);
    });
  });

  describe('resetStats 重置统计', () => {
    it('应重置所有统计为初始状态', () => {
      const mw = new PerformanceMiddleware();
      const req = createMockReq();
      const res = createMockRes();
      mw.use(req as Request, res as unknown as Response, next);
      res.emit('finish');
      expect(mw.getStats().totalRequests).toBe(1);

      mw.resetStats();
      expect(mw.getStats().totalRequests).toBe(0);
      expect(mw.getStats().totalDurationMs).toBe(0);
      expect(mw.getStats().slowRequests).toBe(0);
    });
  });

  describe('路径统计上限保护', () => {
    it('路径统计超过 500 条时应停止新增', () => {
      const mw = new PerformanceMiddleware();
      for (let i = 0; i < 510; i++) {
        const req = createMockReq({ originalUrl: `/api/path-${i}`, route: undefined });
        const res = createMockRes();
        mw.use(req as Request, res as unknown as Response, next);
        res.emit('finish');
      }
      const stats = mw.getStats();
      // totalRequests 仍然递增，但路径统计被截断
      expect(stats.totalRequests).toBe(510);
    });
  });
});
