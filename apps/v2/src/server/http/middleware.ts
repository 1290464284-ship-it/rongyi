import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { AppError, asAppError } from '../infrastructure/errors';
import { AuthService } from '../application/services';
import type { AppContext, UserRole } from '../../domain/contracts';
import type { Logger } from '../infrastructure/logger';

declare global {
  namespace Express {
    interface Request {
      traceId: string;
      context?: AppContext;
    }
  }
}

export function traceMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  const traceId = incoming && /^[a-zA-Z0-9-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  req.traceId = traceId;
  res.setHeader('x-request-id', traceId);
  next();
}

const DETAILS_WHITELIST = ['VALIDATION_ERROR'];

export function errorMiddleware(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
  logger?: Logger,
): void {
  const appError = asAppError(error);
  appError.traceId = req.traceId;
  if (appError.status >= 500) {
    const entry = { traceId: req.traceId, error: appError.message, stack: appError.stack };
    if (logger) logger.error('request failed', entry);
    else console.error('[http] request failed', JSON.stringify(entry));
  }
  const message = appError.status >= 500 ? 'Internal server error' : appError.message;
  const body: Record<string, unknown> = {
    success: false,
    code: appError.code,
    message,
    traceId: req.traceId,
  };
  // Only expose details for non-5xx errors whose code is explicitly whitelisted;
  // 5xx responses must never leak internal details (e.g. stack traces).
  if (appError.status < 500 && DETAILS_WHITELIST.includes(appError.code)) {
    body.details = appError.details;
  }
  res.status(appError.status).json(body);
}

export function authMiddleware(authService: AuthService, logger?: Logger) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const header = req.header('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) {
      next(new AppError('UNAUTHORIZED', 'Missing bearer token', 401));
      return;
    }
    try {
      const payload = authService.verifyToken(token);
      const user = await authService.getUserById(payload.sub);
      if (!user.active) throw new AppError('UNAUTHORIZED', 'User is disabled', 401);
      if (user.lockedUntil) {
        const lockedTime = new Date(user.lockedUntil).getTime();
        // B-L3：lockedUntil 无法解析（NaN）时 fail-closed——视为锁定并告警，
        // 避免损坏/篡改的时间戳绕过账户锁。
        if (lockedTime > Date.now() || Number.isNaN(lockedTime)) {
          if (Number.isNaN(lockedTime)) {
            logger?.warn('user lockedUntil is not a valid date; treating account as locked', { userId: user.id });
          }
          throw new AppError('UNAUTHORIZED', 'Account is temporarily locked', 401);
        }
      }
      if (user.tokenVersion !== payload.tokenVersion) {
        throw new AppError('UNAUTHORIZED', 'Token is no longer valid', 401);
      }
      // P2-1：JWT 中的 clinicId 可能是旧的（用户被移出诊所/诊所被删除后 token 未过期），
      // 校验成员关系仍在，否则 403 强制重新登录/切换诊所。
      if (!authService.isClinicAccessible(user.id, payload.clinicId)) {
        throw new AppError('FORBIDDEN', 'Clinic membership is no longer valid', 403);
      }
      req.context = {
        userId: user.id,
        clinicId: payload.clinicId ?? null,
        role: user.role as UserRole,
        permissions: authService.effectivePermissions(user.id, payload.clinicId ?? null, user.role as UserRole),
        traceId: req.traceId,
        now: () => new Date(),
      };
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function roleMiddleware(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.context) {
      next(new AppError('UNAUTHORIZED', 'Missing auth context', 401));
      return;
    }
    if (!roles.includes(req.context.role)) {
      next(new AppError('FORBIDDEN', 'Insufficient permissions', 403));
      return;
    }
    next();
  };
}

export type AsyncRequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<unknown> | unknown;

export function wrapAsync(handler: AsyncRequestHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
