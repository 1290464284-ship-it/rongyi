import { TraceMiddleware, TRACE_ID_HEADER } from './trace.middleware';
import { Request, Response, NextFunction } from 'express';
import { AppLogger } from '../services/logger.service';

type MockResponse = Response & {
  _events: Record<string, ((...args: unknown[]) => void)[]>;
  statusCode: number;
};

function createMockReq(overrides: Partial<Request> = {}): Request {
  return {
    path: '/api/test',
    method: 'GET',
    originalUrl: '/api/test?foo=bar',
    headers: {},
    ip: '127.0.0.1',
    ...overrides,
  } as unknown as Request;
}

function createMockRes(): MockResponse {
  const events: Record<string, ((...args: unknown[]) => void)[]> = {};
  const res = {
    setHeader: jest.fn(),
    statusCode: 200,
    on: jest.fn().mockImplementation((event: string, fn: (...args: unknown[]) => void) => {
      if (!Object.hasOwn(events, event)) {
        events[event] = [];
      }
      events[event].push(fn);
    }),
    _events: events,
  } as unknown as MockResponse;
  return res;
}

function createMockNext(): NextFunction {
  return jest.fn();
}

function triggerFinish(res: MockResponse) {
  if (res._events['finish']) {
    res._events['finish'].forEach((fn) => fn());
  }
}

describe('TraceMiddleware', () => {
  let middleware: TraceMiddleware;

  beforeEach(() => {
    jest.useFakeTimers();
    middleware = new TraceMiddleware();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('Trace ID 生成', () => {
    it('请求头中没有 trace ID 时生成新的 UUID', () => {
      const req = createMockReq();
      const res = createMockRes();
      const next = createMockNext();

      middleware.use(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.traceId).toBeDefined();
      expect(req.traceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    it('请求头中有有效的 trace ID 时使用该值', () => {
      const existingTraceId = '550e8400-e29b-41d4-a716-446655440000';
      const req = createMockReq({
        headers: {
          [TRACE_ID_HEADER.toLowerCase()]: existingTraceId,
        },
      });
      const res = createMockRes();
      const next = createMockNext();

      middleware.use(req, res, next);

      expect(req.traceId).toBe(existingTraceId);
    });

    it('请求头中 trace ID 无效时生成新的', () => {
      const req = createMockReq({
        headers: {
          [TRACE_ID_HEADER.toLowerCase()]: 'invalid-trace-id',
        },
      });
      const res = createMockRes();
      const next = createMockNext();

      middleware.use(req, res, next);

      expect(req.traceId).not.toBe('invalid-trace-id');
      expect(req.traceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    it('请求头中 trace ID 为空时生成新的', () => {
      const req = createMockReq({
        headers: {
          [TRACE_ID_HEADER.toLowerCase()]: '',
        },
      });
      const res = createMockRes();
      const next = createMockNext();

      middleware.use(req, res, next);

      expect(req.traceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    it('大写的 trace ID 也能识别', () => {
      const existingTraceId = '550E8400-E29B-41D4-A716-446655440000';
      const req = createMockReq({
        headers: {
          [TRACE_ID_HEADER.toLowerCase()]: existingTraceId,
        },
      });
      const res = createMockRes();
      const next = createMockNext();

      middleware.use(req, res, next);

      expect(req.traceId).toBe(existingTraceId);
    });

    it('每个请求生成唯一的 trace ID', () => {
      const res1 = createMockRes();
      const res2 = createMockRes();
      const req1 = createMockReq();
      const req2 = createMockReq();

      middleware.use(req1, res1, createMockNext());
      middleware.use(req2, res2, createMockNext());

      expect(req1.traceId).not.toBe(req2.traceId);
    });
  });

  describe('响应头设置', () => {
    it('响应头中设置 trace ID', () => {
      const req = createMockReq();
      const res = createMockRes();
      const next = createMockNext();

      middleware.use(req, res, next);

      expect(res.setHeader).toHaveBeenCalledWith(TRACE_ID_HEADER, req.traceId);
    });

    it('使用请求传入的 trace ID 设置响应头', () => {
      const existingTraceId = '550e8400-e29b-41d4-a716-446655440000';
      const req = createMockReq({
        headers: {
          [TRACE_ID_HEADER.toLowerCase()]: existingTraceId,
        },
      });
      const res = createMockRes();
      const next = createMockNext();

      middleware.use(req, res, next);

      expect(res.setHeader).toHaveBeenCalledWith(TRACE_ID_HEADER, existingTraceId);
    });
  });

  describe('慢请求日志', () => {
    let warnSpy: jest.SpyInstance;

    beforeEach(() => {
      warnSpy = jest.spyOn(AppLogger.prototype, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    it('快速请求不记录慢请求日志', () => {
      const req = createMockReq({
        method: 'GET',
        originalUrl: '/api/test',
      });
      const res = createMockRes();
      const next = createMockNext();

      middleware.use(req, res, next);

      jest.advanceTimersByTime(500);
      triggerFinish(res);

      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('超过 1 秒的请求记录慢请求日志', () => {
      const req = createMockReq({
        method: 'GET',
        originalUrl: '/api/slow',
      });
      const res = createMockRes();
      const next = createMockNext();

      middleware.use(req, res, next);

      jest.advanceTimersByTime(1001);
      triggerFinish(res);

      expect(warnSpy).toHaveBeenCalled();
      const logMessage = warnSpy.mock.calls[0][0] as string;
      expect(logMessage).toContain('Slow request');
      expect(logMessage).toContain('GET');
      expect(logMessage).toContain('/api/slow');
      expect(logMessage).toContain(req.traceId.slice(0, 8));
    });

    it('慢请求日志包含状态码', () => {
      const req = createMockReq();
      const res = createMockRes();
      res.statusCode = 500;
      const next = createMockNext();

      middleware.use(req, res, next);

      jest.advanceTimersByTime(2000);
      triggerFinish(res);

      expect(warnSpy).toHaveBeenCalled();
      const logMessage = warnSpy.mock.calls[0][0] as string;
      expect(logMessage).toContain('500');
    });

    it('刚好 1 秒的请求不记录慢请求日志', () => {
      const req = createMockReq();
      const res = createMockRes();
      const next = createMockNext();

      middleware.use(req, res, next);

      jest.advanceTimersByTime(1000);
      triggerFinish(res);

      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  describe('TRACE_ID_HEADER 常量', () => {
    it('TRACE_ID_HEADER 为 X-Request-Id', () => {
      expect(TRACE_ID_HEADER).toBe('X-Request-Id');
    });
  });
});
