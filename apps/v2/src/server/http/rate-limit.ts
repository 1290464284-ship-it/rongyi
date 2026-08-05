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
const MAX_WINDOWS = 10_000;

  return (req: Request, res: Response, next: NextFunction): void => {
    const routePath = req.route?.path ?? req.path;
    const base = `${req.ip ?? 'unknown'}:${req.method}:${routePath}`;
    const isLogin = req.method === 'POST' && String(req.path).includes('/auth/login');
    const usernamePart = isLogin && req.body && typeof req.body.username === 'string' ? `:${String(req.body.username)}` : '';
    const key = base + usernamePart;
    const now = Date.now();
    /* v8 ignore start -- bounded-window pruning is a performance safeguard. */
    if (windows.size >= MAX_WINDOWS && !windows.has(key)) {
      for (const [candidateKey, candidate] of windows) {
        if (candidate.resetAt <= now) windows.delete(candidateKey);
      }
      if (windows.size >= MAX_WINDOWS) {
        const oldestKey = windows.keys().next().value;
        if (oldestKey !== undefined) windows.delete(oldestKey);
      }
    }
    /* v8 ignore stop */
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

/**
 * IP-only in-memory sliding rate limiter.
 *
 * Key is the client IP alone (no method/path/username dimension), so bursts
 * against any combination of routes share one budget per IP. Each instance
 * keeps its own window map; intended for stacking on top of createRateLimit.
 */
export function createIpRateLimit({ windowMs, max }: RateLimitOptions) {
  const windows = new Map<string, Window>();
  const MAX_WINDOWS = 10_000;

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.ip ?? 'unknown';
    const now = Date.now();
    /* v8 ignore start -- bounded-window pruning is a performance safeguard. */
    if (windows.size >= MAX_WINDOWS && !windows.has(key)) {
      for (const [candidateKey, candidate] of windows) {
        if (candidate.resetAt <= now) windows.delete(candidateKey);
      }
      if (windows.size >= MAX_WINDOWS) {
        const oldestKey = windows.keys().next().value;
        if (oldestKey !== undefined) windows.delete(oldestKey);
      }
    }
    /* v8 ignore stop */
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
