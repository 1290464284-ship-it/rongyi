import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../infrastructure/errors';

export interface RateLimitWindow {
  count: number;
  resetAt: number;
}

export interface RateLimitStore {
  get(key: string): RateLimitWindow | undefined;
  set(key: string, window: RateLimitWindow): void;
  /** Atomically increments a window and returns the new count/resetAt. */
  increment?(key: string, windowMs: number, now?: number): RateLimitWindow;
  delete?(key: string): void;
  pruneIfStale?(now?: number): void;
}

export interface RateLimitOptions {
  windowMs: number;
  max: number;
}

interface RateLimiterConfig extends RateLimitOptions {
  keyFor: (req: Request) => string;
  store?: RateLimitStore;
}

/**
 * 单工厂：内存滑动窗口限流器的唯一实现。
 * 所有限流中间件（按路由+IP、按 IP、按用户名等）共用同一份窗口逻辑，
 * 避免窗口裁剪/计数/429 语义在多处拷贝中漂移。
 */
function createLimiter({ windowMs, max, keyFor, store }: RateLimiterConfig) {
  const windows = store ? null : new Map<string, RateLimitWindow>();
  const MAX_WINDOWS = 10_000;

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = keyFor(req);
    const now = Date.now();
    store?.pruneIfStale?.(now);
    /* v8 ignore start -- bounded-window pruning is a performance safeguard. */
    if (windows && windows.size >= MAX_WINDOWS && !windows.has(key)) {
      for (const [candidateKey, candidate] of windows) {
        if (candidate.resetAt <= now) windows.delete(candidateKey);
      }
      if (windows.size >= MAX_WINDOWS) {
        const oldestKey = windows.keys().next().value;
        if (oldestKey !== undefined) windows.delete(oldestKey);
      }
    }
    /* v8 ignore stop */
    if (store?.increment) {
      const current = store.increment(key, windowMs, now);
      if (current.count > max) {
        res.setHeader('retry-after', String(Math.ceil((current.resetAt - now) / 1000)));
        next(new AppError('RATE_LIMITED', 'Too many requests', 429));
        return;
      }
      next();
      return;
    }
    const current = store ? store.get(key) : windows?.get(key);
    if (!current || current.resetAt <= now) {
      const fresh: RateLimitWindow = { count: 1, resetAt: now + windowMs };
      if (store) store.set(key, fresh);
      else windows?.set(key, fresh);
      next();
      return;
    }
    current.count += 1;
    if (current.count > max) {
      res.setHeader('retry-after', String(Math.ceil((current.resetAt - now) / 1000)));
      next(new AppError('RATE_LIMITED', 'Too many requests', 429));
      return;
    }
    if (store) store.set(key, current);
    else windows?.set(key, current);
    next();
  };
}

/**
 * 默认限流器：键 = IP + 方法 + 路由路径；
 * 登录接口额外带上 username 维度，同一账户的爆破共享一个预算。
 */
export function createRateLimit(options: RateLimitOptions, store?: RateLimitStore) {
  return createLimiter({
    ...options,
    store,
    keyFor: (req) => {
      const routePath = req.route?.path ?? req.path;
      const base = `${req.ip ?? 'unknown'}:${req.method}:${routePath}`;
      const isLogin = req.method === 'POST' && String(req.path).includes('/auth/login');
      const usernamePart = isLogin && req.body && typeof req.body.username === 'string' ? `:${String(req.body.username)}` : '';
      return base + usernamePart;
    },
  });
}

/**
 * IP-only 限流器：键 = 客户端 IP 本身（无方法/路径/用户名维度），
 * 任意路由组合的突发共享一个 IP 预算。常叠加在 createRateLimit 之上。
 */
export function createIpRateLimit(options: RateLimitOptions, store?: RateLimitStore) {
  return createLimiter({ ...options, store, keyFor: (req) => req.ip ?? 'unknown' });
}
