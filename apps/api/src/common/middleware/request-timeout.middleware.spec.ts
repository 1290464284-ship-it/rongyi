import { RequestTimeoutMiddleware } from './request-timeout.middleware';
import { Request, Response, NextFunction } from 'express';

type MockResponse = Response & {
  _events: Record<string, ((...args: unknown[]) => void)[]>;
  _endMock: jest.Mock;
  status: jest.Mock;
  json: jest.Mock;
  setHeader: jest.Mock;
  headersSent: boolean;
};

function createMockReq(overrides: Partial<Request> = {}): Request {
  return {
    path: '/api/test',
    method: 'GET',
    destroy: jest.fn(),
    ...overrides,
  } as unknown as Request;
}

function createMockRes(): MockResponse {
  const events: Record<string, ((...args: unknown[]) => void)[]> = {};
  let headersSent = false;
  const res = {
    setHeader: jest.fn(),
    statusCode: 200,
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockImplementation(() => {
      headersSent = true;
      return res;
    }),
    end: jest.fn().mockImplementation((..._args: unknown[]) => {
      if ('finish' in events) {
        events['finish'].forEach((fn) => fn());
      }
      return res;
    }),
    on: jest.fn().mockImplementation((event: string, fn: (...args: unknown[]) => void) => {
      if (!Object.hasOwn(events, event)) {
        events[event] = [];
      }
      events[event].push(fn);
    }),
    _events: events,
    _endMock: jest.fn(),
    get headersSent() {
      return headersSent;
    },
  } as unknown as MockResponse;
  return res;
}

function createMockNext(): NextFunction {
  return jest.fn();
}

function triggerEvent(res: MockResponse, event: string) {
  if (Object.hasOwn(res._events, event)) {
    res._events[event].forEach((fn) => fn());
  }
}

describe('RequestTimeoutMiddleware', () => {
  let middleware: RequestTimeoutMiddleware;

  beforeEach(() => {
    jest.useFakeTimers();
    middleware = new RequestTimeoutMiddleware();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('默认超时（30秒）', () => {
    it('普通请求使用默认 30 秒超时', () => {
      const req = createMockReq({ path: '/api/test' });
      const res = createMockRes();
      const next = createMockNext();

      middleware.use(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('超时后返回 408 错误', () => {
      const req = createMockReq({ path: '/api/test' });
      const res = createMockRes();
      const next = createMockNext();

      middleware.use(req, res, next);

      jest.advanceTimersByTime(30000);

      expect(res.status).toHaveBeenCalledWith(408);
      expect(res.json).toHaveBeenCalledWith({
        statusCode: 408,
        message: '请求超时，请稍后重试',
        error: 'Request Timeout',
      });
      expect(req.destroy).toHaveBeenCalled();
    });

    it('未超时时正常响应', () => {
      const req = createMockReq({ path: '/api/test' });
      const res = createMockRes();
      const next = createMockNext();

      middleware.use(req, res, next);

      jest.advanceTimersByTime(29000);

      expect(res.status).not.toHaveBeenCalledWith(408);
    });
  });

  describe('长耗时请求超时（120秒）', () => {
    it.each([
      ['/api/backup'],
      ['/api/backup/full'],
      ['/api/restore'],
      ['/api/restore/from-file'],
      ['/api/reports'],
      ['/api/reports/monthly'],
      ['/api/export'],
      ['/api/export/patients'],
    ])('路径 %s 使用 120 秒超时', (path) => {
      const req = createMockReq({ path });
      const res = createMockRes();
      const next = createMockNext();

      middleware.use(req, res, next);

      jest.advanceTimersByTime(30000);
      expect(res.status).not.toHaveBeenCalledWith(408);

      jest.advanceTimersByTime(90000);
      expect(res.status).toHaveBeenCalledWith(408);
    });

    it('路径包含长耗时路径关键字时使用长超时', () => {
      const req = createMockReq({ path: '/some/api/backup/here' });
      const res = createMockRes();
      const next = createMockNext();

      middleware.use(req, res, next);

      jest.advanceTimersByTime(30000);
      expect(res.status).not.toHaveBeenCalledWith(408);
    });
  });

  describe('响应完成清理', () => {
    it('res.end 被调用时清理超时', () => {
      const req = createMockReq({ path: '/api/test' });
      const res = createMockRes();
      const next = createMockNext();

      middleware.use(req, res, next);

      (res.end as jest.Mock)();

      jest.advanceTimersByTime(30000);
      expect(res.status).not.toHaveBeenCalledWith(408);
    });

    it('finish 事件触发时清理超时', () => {
      const req = createMockReq({ path: '/api/test' });
      const res = createMockRes();
      const next = createMockNext();

      middleware.use(req, res, next);

      triggerEvent(res, 'finish');

      jest.advanceTimersByTime(30000);
      expect(res.status).not.toHaveBeenCalledWith(408);
    });

    it('close 事件触发时清理超时', () => {
      const req = createMockReq({ path: '/api/test' });
      const res = createMockRes();
      const next = createMockNext();

      middleware.use(req, res, next);

      triggerEvent(res, 'close');

      jest.advanceTimersByTime(30000);
      expect(res.status).not.toHaveBeenCalledWith(408);
    });

    it('res.end 被重写但仍然调用原始 end', () => {
      const req = createMockReq({ path: '/api/test' });
      const res = createMockRes();
      const next = createMockNext();
      const originalEnd = res.end;

      middleware.use(req, res, next);

      expect(res.end).not.toBe(originalEnd);

      (res.end as jest.Mock)('body');
      expect(res.status).not.toHaveBeenCalledWith(408);
    });
  });

  describe('超时边界情况', () => {
    it('headers 已发送时不再发送响应', () => {
      const req = createMockReq({ path: '/api/test' });
      const res = createMockRes();
      const next = createMockNext();

      middleware.use(req, res, next);

      res.status(200).json({ data: 'test' });

      jest.advanceTimersByTime(30000);

      expect(req.destroy).toHaveBeenCalled();
    });

    it('多次触发 finish/close 事件不会重复清理', () => {
      const req = createMockReq({ path: '/api/test' });
      const res = createMockRes();
      const next = createMockNext();

      middleware.use(req, res, next);

      triggerEvent(res, 'finish');
      triggerEvent(res, 'finish');
      triggerEvent(res, 'close');

      jest.advanceTimersByTime(30000);
      expect(res.status).not.toHaveBeenCalledWith(408);
    });

    it('超时后再调用 end 不会重复处理', () => {
      const req = createMockReq({ path: '/api/test' });
      const res = createMockRes();
      const next = createMockNext();

      middleware.use(req, res, next);

      jest.advanceTimersByTime(30000);
      expect(res.status).toHaveBeenCalledWith(408);

      const jsonCallCount = (res.json as jest.Mock).mock.calls.length;

      (res.end as jest.Mock)();
      expect((res.json as jest.Mock).mock.calls.length).toBe(jsonCallCount);
    });
  });
});
