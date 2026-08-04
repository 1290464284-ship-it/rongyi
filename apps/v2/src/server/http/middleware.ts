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
    else console.error(JSON.stringify(entry));
  }
  const message = appError.status >= 500 ? 'Internal server error' : appError.message;
  res.status(appError.status).json({
    success: false,
    code: appError.code,
    message,
    traceId: req.traceId,
    details: appError.details,
  });
}

export function authMiddleware(authService: AuthService) {
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
      if (user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now()) {
        throw new AppError('UNAUTHORIZED', 'Account is temporarily locked', 401);
      }
      if (user.tokenVersion !== payload.tokenVersion) {
        throw new AppError('UNAUTHORIZED', 'Token is no longer valid', 401);
      }
      req.context = {
        userId: user.id,
        clinicId: user.clinicId ?? null,
        role: user.role as UserRole,
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
