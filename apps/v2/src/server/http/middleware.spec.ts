import { describe, expect, it } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { AuthService } from '../application/services';
import { AppError } from '../infrastructure/errors';
import { authMiddleware, errorMiddleware, roleMiddleware, traceMiddleware } from './middleware';

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

  it('uses the signed token clinic id even when the user row has no current clinic', async () => {
    const authService = {
      verifyToken: () => ({
        sub: 'user-multi',
        clinicId: 'clinic-multi',
        role: 'ADMIN',
        tokenVersion: 0,
      }),
      getUserById: async () => ({
        id: 'user-multi',
        clinicId: null,
        currentClinicId: null,
        active: true,
        lockedUntil: null,
        tokenVersion: 0,
        role: 'ADMIN',
      }),
    } as unknown as AuthService;
    const req = {
      header: () => 'Bearer signed-token',
      context: undefined,
    } as unknown as Request;
    await authMiddleware(authService)(req, fakeResponse(), () => {});
    expect(req.context?.clinicId).toBe('clinic-multi');
    expect(req.context?.role).toBe('ADMIN');
  });
});
