import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../infrastructure/errors';

interface Window {
  count: number;
  resetAt: number;
}

export interface RateLimitOptions {
  windowMs: number;
  max: number;
}

/**
 * In-memory sliding rate limiter.
 *
 * Suitable for a single desktop process. A distributed deployment should swap
 * this for a Redis-backed limiter without changing middleware contracts.
 */
export function createRateLimit({ windowMs, max }: RateLimitOptions) {
  const windows = new Map<string, Window>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = `${req.ip ?? 'unknown'}:${req.method}:${req.path}`;
    const now = Date.now();
    const current = windows.get(key);
    if (!current || current.resetAt <= now) {
      windows.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }
    current.count += 1;
    if (current.count > max) {
      res.setHeader('retry-after', String(Math.ceil((current.resetAt - now) / 1000)));
      next(new AppError('RATE_LIMITED', 'Too many requests', 429));
      return;
    }
    windows.set(key, current);
    next();
  };
}

