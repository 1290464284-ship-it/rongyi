import { TraceIdInterceptor } from './trace-id.interceptor';
import { of, throwError } from 'rxjs';
import { TRACE_ID_HEADER } from '../middleware/trace.middleware';

function createMockContext(opts?: {
  traceIdHeader?: string;
  user?: { id?: string; userId?: string };
  method?: string;
  url?: string;
}) {
  const request = {
    headers: { 'x-request-id': opts?.traceIdHeader } as Record<string, string | undefined>,
    user: opts?.user,
    method: opts?.method ?? 'GET',
    url: opts?.url ?? '/api/test',
  };
  const response = {
    setHeader: jest.fn(),
    statusCode: 200,
  };
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
    _request: request,
    _response: response,
  } as any;
}

function createMockCallHandler(value: unknown = 'ok') {
  return {
    handle: () => of(value),
  } as any;
}

function createMockCallHandlerError(error: Error) {
  return {
    handle: () => throwError(() => error),
  } as any;
}

describe('TraceIdInterceptor', () => {
  let interceptor: TraceIdInterceptor;

  beforeEach(() => {
    interceptor = new TraceIdInterceptor();
  });

  it('无 X-Request-Id 时应生成新 traceId', (done) => {
    const ctx = createMockContext();
    const next = createMockCallHandler('result');

    interceptor.intercept(ctx, next).subscribe({
      next: (val) => {
        expect(val).toBe('result');
        expect(ctx._response.setHeader).toHaveBeenCalledWith(TRACE_ID_HEADER, expect.any(String));
        done();
      },
    });
  });

  it('有有效 UUID 的 X-Request-Id 时应复用', (done) => {
    const validUuid = '12345678-1234-1234-1234-123456789abc';
    const ctx = createMockContext({ traceIdHeader: validUuid });
    const next = createMockCallHandler('result');

    interceptor.intercept(ctx, next).subscribe({
      next: () => {
        expect(ctx._response.setHeader).toHaveBeenCalledWith(TRACE_ID_HEADER, validUuid);
        done();
      },
    });
  });

  it('有无效 UUID 的 X-Request-Id 时应生成新 traceId', (done) => {
    const ctx = createMockContext({ traceIdHeader: 'not-a-uuid' });
    const next = createMockCallHandler();

    interceptor.intercept(ctx, next).subscribe({
      next: () => {
        const setHeaderCall = ctx._response.setHeader.mock.calls[0];
        expect(setHeaderCall[1]).not.toBe('not-a-uuid');
        done();
      },
    });
  });

  it('应从 request.user.id 提取 userId', (done) => {
    const ctx = createMockContext({ user: { id: 'user-123' } });
    const next = createMockCallHandler();

    interceptor.intercept(ctx, next).subscribe({
      next: () => {
        done();
      },
    });
  });

  it('应从 request.user.userId 提取 userId（回退）', (done) => {
    const ctx = createMockContext({ user: { userId: 'user-456' } });
    const next = createMockCallHandler();

    interceptor.intercept(ctx, next).subscribe({
      next: () => {
        done();
      },
    });
  });

  it('错误时应记录错误日志', (done) => {
    const ctx = createMockContext();
    const next = createMockCallHandlerError(new Error('test error'));

    interceptor.intercept(ctx, next).subscribe({
      error: () => {
        done();
      },
    });
  });
});
