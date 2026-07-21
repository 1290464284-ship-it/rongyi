import { Injectable, NestMiddleware, OnModuleDestroy, HttpException, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import * as jwt from 'jsonwebtoken';

/** 基于角色的差异化限流配置（每分钟请求数） */
const ROLE_LIMITS: Record<string, number> = {
  BOSS: 300,
  DOCTOR: 200,
  RECEPTIONIST: 150,
  NURSE: 150,
  TECHNICIAN: 150,
};

const DEFAULT_LIMIT = 120;
const LOGIN_LIMIT = 10;
const REFRESH_LIMIT = 10;
const WINDOW_MS = 60 * 1000;
const MAX_STORE_SIZE = 10000; // 防止内存泄漏：最多跟踪 10000 个不同的 key

@Injectable()
export class RateLimitMiddleware implements NestMiddleware, OnModuleDestroy {
  private readonly store = new Map<string, number[]>();
  private cleanupTimer: NodeJS.Timeout | null = null;
  private readonly trustProxy = process.env.TRUST_PROXY === '1';
  private readonly logger = new Logger('RateLimit');

  constructor() {
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredRecords();
    }, WINDOW_MS);
    this.cleanupTimer.unref();
  }

  private cleanupExpiredRecords() {
    const now = Date.now();
    for (const [key, timestamps] of this.store.entries()) {
      const valid = timestamps.filter((t) => now - t <= WINDOW_MS);
      if (valid.length === 0) {
        this.store.delete(key);
      } else {
        this.store.set(key, valid);
      }
    }
    // 如果仍然超过上限，强制清除最旧的条目
    if (this.store.size > MAX_STORE_SIZE) {
      const excess = this.store.size - MAX_STORE_SIZE;
      const keys = Array.from(this.store.keys()).slice(0, excess);
      for (const key of keys) {
        this.store.delete(key);
      }
    }
  }

  private getClientIp(req: Request): string {
    if (this.trustProxy) {
      const xForwardedFor = req.headers['x-forwarded-for'];
      if (xForwardedFor) {
        const ips = Array.isArray(xForwardedFor) ? xForwardedFor[0] : xForwardedFor;
        const clientIp = ips.split(',')[0].trim();
        if (clientIp && clientIp !== '') {
          return clientIp;
        }
      }

      const xRealIp = req.headers['x-real-ip'];
      if (xRealIp) {
        const ip = Array.isArray(xRealIp) ? xRealIp[0] : xRealIp;
        if (ip && ip !== '') {
          return ip;
        }
      }
    }

    return req.ip || req.socket.remoteAddress || 'unknown';
  }

  /** 从 Authorization header 中提取用户角色（验证 JWT 签名） */
  private extractRole(req: Request): string | null {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) return null;

      const token = authHeader.slice(7);
      const secret = process.env.JWT_SECRET;
      if (!secret || secret.length < 16) {
        this.logger.error('JWT_SECRET 未正确配置，无法验证用户角色，使用匿名限流');
        return null;
      }
      const payload = jwt.verify(token, secret) as { role?: string };
      return payload?.role ?? null;
    } catch {
      return null;
    }
  }

  use(req: Request, res: Response, next: NextFunction) {
    const ip = this.getClientIp(req);
    const isLogin = req.path === '/api/auth/login' || req.path === '/auth/login';
    const isRefresh = req.path === '/api/auth/refresh' || req.path === '/auth/refresh';

    let maxRequests: number;
    let key: string;

    if (isLogin) {
      maxRequests = LOGIN_LIMIT;
      key = `rate_limit:${ip}:login`;
    } else if (isRefresh) {
      maxRequests = REFRESH_LIMIT;
      key = `rate_limit:${ip}:refresh`;
    } else {
      const role = this.extractRole(req);
      maxRequests = role ? (ROLE_LIMITS[role] ?? DEFAULT_LIMIT) : DEFAULT_LIMIT;
      key = `rate_limit:${ip}:${role ?? 'anonymous'}`;
    }

    const now = Date.now();
    const timestamps = this.store.get(key) ?? [];
    const validTimestamps = timestamps.filter((t) => now - t <= WINDOW_MS);

    if (validTimestamps.length >= maxRequests) {
      const oldest = validTimestamps[0];
      const retryAfterMs = WINDOW_MS - (now - oldest);
      res.setHeader('Retry-After', Math.ceil(retryAfterMs / 1000));
      throw new HttpException('请求过于频繁，请稍后再试', 429);
    }

    validTimestamps.push(now);
    this.store.set(key, validTimestamps);
    next();
  }

  onModuleDestroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.store.clear();
  }
}
