import { describe, expect, it, vi } from 'vitest';
import { createRateLimit } from './rate-limit';
import type { NextFunction, Request, Response } from 'express';

function fakeRequest(path = '/login'): Request {
  return {
    ip: '127.0.0.1',
    method: 'POST',
    path,
  } as Request;
}

function fakeResponse(): Response {
  return {
    setHeader: () => {},
  } as unknown as Response;
}

describe('createRateLimit', () => {
  it('allows requests within the limit and blocks the next one', () => {
    const limiter = createRateLimit({ windowMs: 60_000, max: 2 });
    const next: NextFunction = () => {};
    let error: unknown;
    limiter(fakeRequest(), fakeResponse(), next);
    limiter(fakeRequest(), fakeResponse(), next);
    limiter(fakeRequest(), fakeResponse(), (err) => { error = err; });
    expect(error).toMatchObject({ code: 'RATE_LIMITED', status: 429 });
  });

  it('falls back when the request has no ip', () => {
    const limiter = createRateLimit({ windowMs: 60_000, max: 1 });
    const next: NextFunction = vi.fn();
    limiter({ method: 'GET', path: '/no-ip' } as unknown as Request, fakeResponse(), next);
    expect(next).toHaveBeenCalledOnce();
  });
});
