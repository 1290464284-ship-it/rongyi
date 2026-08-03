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
  res.status(appError.status).json({
    success: false,
    code: appError.code,
    message: appError.message,
    traceId: req.traceId,
    details: appError.details,
  });
}

export function authMiddleware(authService: AuthService) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.header('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) {
      next(new AppError('UNAUTHORIZED', 'Missing bearer token', 401));
      return;
    }
    try {
      const payload = authService.verifyToken(token);
      req.context = {
        userId: payload.sub,
        clinicId: payload.clinicId,
        role: payload.role as UserRole,
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
