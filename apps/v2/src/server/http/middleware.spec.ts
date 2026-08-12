import { describe, expect, it } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { AuthService } from '../application/services';
import { AppError, ValidationError } from '../infrastructure/errors';
import { authMiddleware, errorMiddleware, roleMiddleware, traceMiddleware, traceparentTraceId } from './middleware';

function fakeResponse(): Response {
  const res = { statusCode: 200, setHeader: () => {}, status: () => res, json: () => res } as unknown as Response;
  return res;
}

function jsonCapturingResponse(): { res: Response; body: () => Record<string, unknown> | undefined } {
  const captured: { body?: Record<string, unknown> } = {};
  const res = {
    status: () => res,
    json: (body: unknown) => {
      captured.body = body as Record<string, unknown>;
      return res;
    },
  } as unknown as Response;
  return { res, body: () => captured.body };
}

function runErrorMiddleware(error: unknown): Record<string, unknown> | undefined {
  const req = { traceId: 'trace-1' } as unknown as Request;
  const { res, body } = jsonCapturingResponse();
  errorMiddleware(error, req, res, () => {});
  return body();
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

  it('falls back to a W3C traceparent when no x-request-id is present', () => {
    const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';
    const header = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
    expect(traceparentTraceId(header)).toBe(traceId);
    const req = { header: (name: string) => (name === 'traceparent' ? header : undefined), traceId: '' } as unknown as Request;
    traceMiddleware(req, fakeResponse(), () => {});
    expect(req.traceId).toBe(traceId);
  });

  it('rejects malformed traceparent headers', () => {
    expect(traceparentTraceId('00-123-456-01')).toBeUndefined();
    expect(traceparentTraceId(undefined)).toBeUndefined();
  });

  it('does not expose details for 5xx errors', () => {
    const body = runErrorMiddleware(new AppError('INTERNAL', 'boom', 500, { secret: 'x' }));
    expect(body).toMatchObject({ code: 'INTERNAL', message: 'Internal server error' });
    expect(body).not.toHaveProperty('details');
  });

  it('exposes details for whitelisted validation errors', () => {
    const body = runErrorMiddleware(new ValidationError('bad input', { field: 'name', reason: 'required' }));
    expect(body).toMatchObject({ code: 'VALIDATION_ERROR', message: 'bad input' });
    expect(body?.details).toEqual({ field: 'name', reason: 'required' });
  });

  it('does not expose details for non-whitelisted 4xx codes', () => {
    const body = runErrorMiddleware(new AppError('FORBIDDEN', 'nope', 403, { secret: 'x' }));
    expect(body).toMatchObject({ code: 'FORBIDDEN', message: 'nope' });
    expect(body).not.toHaveProperty('details');
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
      isClinicAccessible: () => true,
      effectivePermissions: () => [],
    } as unknown as AuthService;
    const req = {
      header: () => 'Bearer signed-token',
      context: undefined,
    } as unknown as Request;
    await authMiddleware(authService)(req, fakeResponse(), () => {});
    expect(req.context?.clinicId).toBe('clinic-multi');
    expect(req.context?.role).toBe('ADMIN');
  });

  it('rejects tokens whose clinic membership is no longer valid', async () => {
    const authService = {
      verifyToken: () => ({
        sub: 'user-removed',
        clinicId: 'clinic-gone',
        role: 'ADMIN',
        tokenVersion: 0,
      }),
      getUserById: async () => ({
        id: 'user-removed',
        clinicId: 'clinic-gone',
        currentClinicId: 'clinic-gone',
        active: true,
        lockedUntil: null,
        tokenVersion: 0,
        role: 'ADMIN',
      }),
      isClinicAccessible: () => false,
      effectivePermissions: () => [],
    } as unknown as AuthService;
    const req = {
      header: () => 'Bearer signed-token',
      context: undefined,
    } as unknown as Request;
    let error: unknown;
    await authMiddleware(authService)(req, fakeResponse(), (err) => { error = err; });
    expect(error).toMatchObject({ code: 'FORBIDDEN', status: 403 });
  });
});
