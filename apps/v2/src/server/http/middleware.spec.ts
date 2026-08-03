import { describe, expect, it } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../infrastructure/errors';
import { errorMiddleware, roleMiddleware, traceMiddleware } from './middleware';

function fakeResponse(): Response {
  const res = { statusCode: 200, setHeader: () => {}, status: () => res, json: () => res } as unknown as Response;
  return res;
}

describe('middleware', () => {
  it('sets trace id and normalizes errors', () => {
    const req = { header: () => 'trace-123', traceId: '' } as unknown as Request;
    traceMiddleware(req, fakeResponse(), () => {});
    expect(req.traceId).toBe('trace-123');
    const statusSpy = { status: () => statusSpy, json: () => statusSpy };
    const res = statusSpy as unknown as Response;
    errorMiddleware(new AppError('TEST', 'msg', 422), req, res, () => {});
  });

  it('enforces roles', () => {
    const allowed = roleMiddleware('BOSS');
    const denied: NextFunction = () => {};
    allowed({ context: { role: 'BOSS' } } as unknown as Request, fakeResponse(), denied);
    let error: unknown;
    allowed({ context: { role: 'RECEPTIONIST' } } as unknown as Request, fakeResponse(), (err) => { error = err; });
    expect(error).toMatchObject({ code: 'FORBIDDEN' });
  });
});

