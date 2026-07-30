import { MetricsInterceptor } from './metrics.interceptor';
import { MetricsService } from '../../modules/system/metrics/metrics.service';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable, of, throwError } from 'rxjs';

describe('MetricsInterceptor 指标拦截器', () => {
  let interceptor: MetricsInterceptor;
  let metricsService: {
    incrementActiveRequests: jest.Mock;
    decrementActiveRequests: jest.Mock;
    incrementRequest: jest.Mock;
    observeRequestDuration: jest.Mock;
  };

  function buildContext(overrides: { method?: string; url?: string; routePath?: string; statusCode?: number } = {}): ExecutionContext {
    const { method = 'GET', url = '/api/test', routePath, statusCode = 200 } = overrides;
    const req = { method, url, originalUrl: url, route: { path: routePath } };
    const res = { statusCode };
    return {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => res,
      }),
    } as unknown as ExecutionContext;
  }

  function buildHandler(observable: Observable<unknown>): CallHandler {
    return { handle: () => observable } as unknown as CallHandler;
  }

  beforeEach(() => {
    metricsService = {
      incrementActiveRequests: jest.fn(),
      decrementActiveRequests: jest.fn(),
      incrementRequest: jest.fn(),
      observeRequestDuration: jest.fn(),
    };
    interceptor = new MetricsInterceptor(metricsService as unknown as MetricsService);
  });

  describe('intercept - 成功路径', () => {
    it('应增加活跃请求数', (done) => {
      const ctx = buildContext();
      const handler = buildHandler(of({ data: 'ok' }));
      interceptor.intercept(ctx, handler).subscribe({
        next: () => {
          expect(metricsService.incrementActiveRequests).toHaveBeenCalledTimes(1);
          done();
        },
      });
    });

    it('完成后应记录指标并减少活跃请求', (done) => {
      const ctx = buildContext({ method: 'POST', routePath: '/api/patients' });
      const handler = buildHandler(of({ id: '1' }));
      interceptor.intercept(ctx, handler).subscribe({
        complete: () => {
          expect(metricsService.incrementRequest).toHaveBeenCalledWith('POST', '/api/patients', 200);
          expect(metricsService.observeRequestDuration).toHaveBeenCalledWith('POST', '/api/patients', expect.any(Number));
          expect(metricsService.decrementActiveRequests).toHaveBeenCalledTimes(1);
          done();
        },
      });
    });

    it('无 route.path 时应回退到 originalUrl', (done) => {
      const ctx = buildContext({ routePath: undefined, url: '/api/fallback' });
      const handler = buildHandler(of(null));
      interceptor.intercept(ctx, handler).subscribe({
        complete: () => {
          expect(metricsService.incrementRequest).toHaveBeenCalledWith('GET', '/api/fallback', 200);
          done();
        },
      });
    });
  });

  describe('intercept - 错误路径', () => {
    it('Observable 报错时也应记录指标', (done) => {
      const ctx = buildContext({ method: 'PUT', routePath: '/api/fail' });
      const handler = buildHandler(throwError(() => new Error('boom')));
      interceptor.intercept(ctx, handler).subscribe({
        error: () => {
          expect(metricsService.incrementRequest).toHaveBeenCalledWith('PUT', '/api/fail', 200);
          expect(metricsService.decrementActiveRequests).toHaveBeenCalledTimes(1);
          done();
        },
      });
    });
  });

  describe('recordMetrics', () => {
    it('durationMs 应为正数', (done) => {
      const ctx = buildContext();
      const handler = buildHandler(of('ok'));
      interceptor.intercept(ctx, handler).subscribe({
        complete: () => {
          const durationMs = metricsService.observeRequestDuration.mock.calls[0][2];
          expect(durationMs).toBeGreaterThanOrEqual(0);
          done();
        },
      });
    });
  });
});
