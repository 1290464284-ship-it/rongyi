import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRateLimit } from './rate-limit';
import type { NextFunction, Request, Response } from 'express';

function fakeRequest(path = '/login', ip = '127.0.0.1', method = 'POST'): Request {
  return { ip, method, path } as Request;
}

function fakeResponse(): { res: Response; headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  const res = {
    setHeader: (name: string, value: string) => {
      headers[name.toLowerCase()] = value;
    },
  } as unknown as Response;
  return { res, headers };
}

describe('createRateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows requests within the limit and blocks the next one', () => {
    const limiter = createRateLimit({ windowMs: 60_000, max: 2 });
    const next: NextFunction = () => {};
    let error: unknown;
    limiter(fakeRequest(), fakeResponse().res, next);
    limiter(fakeRequest(), fakeResponse().res, next);
    limiter(fakeRequest(), fakeResponse().res, (err) => { error = err; });
    expect(error).toMatchObject({ code: 'RATE_LIMITED', status: 429 });
  });

  it('falls back when the request has no ip', () => {
    const limiter = createRateLimit({ windowMs: 60_000, max: 1 });
    const next: NextFunction = vi.fn();
    limiter({ method: 'GET', path: '/no-ip' } as unknown as Request, fakeResponse().res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('N 次请求后第 N+1 次返回 429 并设置 retry-after header', () => {
    const N = 3;
    const windowMs = 60_000;
    const limiter = createRateLimit({ windowMs, max: N });
    const next = vi.fn();
    let lastHeaders: Record<string, string> = {};
    let rateLimitError: unknown;
    const sharedPath = '/resource/same';

    for (let i = 0; i < N; i += 1) {
      const { res, headers } = fakeResponse();
      limiter(fakeRequest(sharedPath), res, next);
      lastHeaders = headers;
    }
    expect(next).toHaveBeenCalledTimes(N);
    expect(lastHeaders['retry-after']).toBeUndefined();

    next.mockClear();
    const { res: failRes, headers: failHeaders } = fakeResponse();
    const failNext: NextFunction = (err) => {
      if (err) rateLimitError = err;
    };
    limiter(fakeRequest(sharedPath), failRes, failNext);

    expect(next).not.toHaveBeenCalled();
    expect(rateLimitError).toMatchObject({ code: 'RATE_LIMITED', status: 429 });
    expect(failHeaders['retry-after']).toBeDefined();
    const retrySeconds = Number(failHeaders['retry-after']);
    expect(Number.isInteger(retrySeconds)).toBe(true);
    expect(retrySeconds).toBeGreaterThan(0);
    expect(retrySeconds).toBeLessThanOrEqual(Math.ceil(windowMs / 1000));
  });

  it('窗口重置后可以再次请求', () => {
    const windowMs = 10_000;
    const limiter = createRateLimit({ windowMs, max: 1 });
    let error: unknown;
    const firstNext = vi.fn();
    limiter(fakeRequest('/reset'), fakeResponse().res, firstNext);
    expect(firstNext).toHaveBeenCalledOnce();
    limiter(fakeRequest('/reset'), fakeResponse().res, (err) => { error = err; });
    expect(error).toMatchObject({ status: 429 });

    error = undefined;
    vi.advanceTimersByTime(windowMs + 1);
    const afterNext = vi.fn();
    limiter(fakeRequest('/reset'), fakeResponse().res, afterNext);
    expect(afterNext).toHaveBeenCalledOnce();
    expect(error).toBeUndefined();
  });

  it('不同路径各自独立计数', () => {
    const limiter = createRateLimit({ windowMs: 60_000, max: 1 });
    const next = vi.fn();
    limiter(fakeRequest('/a'), fakeResponse().res, next);
    limiter(fakeRequest('/b'), fakeResponse().res, next);
    expect(next).toHaveBeenCalledTimes(2);
    let errorA: unknown;
    limiter(fakeRequest('/a'), fakeResponse().res, (err) => { errorA = err; });
    expect(errorA).toMatchObject({ status: 429 });
    let errorB: unknown;
    limiter(fakeRequest('/b'), fakeResponse().res, (err) => { errorB = err; });
    expect(errorB).toMatchObject({ status: 429 });
  });
});
