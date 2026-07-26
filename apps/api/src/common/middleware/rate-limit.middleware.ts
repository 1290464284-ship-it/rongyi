/**
 * 速率限制中间件
 * 支持可插拔的存储后端，默认使用内存存储（MemoryRateLimitStore）。
 * 多实例部署时可传入 RedisRateLimitStore 等共享存储实现。
 */
import { Injectable, NestMiddleware, OnModuleDestroy, HttpException, Logger, Optional } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import * as jwt from 'jsonwebtoken';
import { ConfigService } from '../services/config.service';
import { ONE_MINUTE_MS, FIVE_MINUTES_MS } from '../../config/constants';
import { ROLES } from '../constants/roles';
import { RateLimitStore, MemoryRateLimitStore } from './rate-limit-store';

/** 基于角色的差异化限流配置（每分钟请求数） */
const ROLE_LIMITS: Record<string, number> = {
  [ROLES.BOSS]: 300,
  [ROLES.DOCTOR]: 200,
  [ROLES.RECEPTIONIST]: 150,
  NURSE: 150,
  TECHNICIAN: 150,
};

const DEFAULT_LIMIT = 120;
const LOGIN_LIMIT_PER_IP = 10;
const LOGIN_LIMIT_PER_USER = 5;
const REFRESH_LIMIT = 10;
const WINDOW_MS = ONE_MINUTE_MS;
const LOGIN_WINDOW_MS = FIVE_MINUTES_MS;

@Injectable()
export class RateLimitMiddleware implements NestMiddleware, OnModuleDestroy {
  private readonly store: RateLimitStore;
  private readonly memoryStore?: MemoryRateLimitStore;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private readonly trustProxy: boolean;
  private readonly jwtSecret: string;
  private readonly logger = new Logger(RateLimitMiddleware.name);

  constructor(
    private readonly configService: ConfigService,
    @Optional() store?: RateLimitStore,
  ) {
    this.trustProxy = this.configService.get('TRUST_PROXY') === '1';
    this.jwtSecret = this.configService.JWT_SECRET;
    if (store) {
      this.store = store;
    } else {
      this.memoryStore = new MemoryRateLimitStore();
      this.store = this.memoryStore;
      this.cleanupTimer = setInterval(() => {
        this.cleanupExpiredRecords();
      }, WINDOW_MS);
      this.cleanupTimer.unref();
    }
  }

  private cleanupExpiredRecords() {
    // 主动清理超出最大限流窗口（登录窗口最长）的过期键，配合 LRU 被动淘汰防止内存缓慢增长
    this.memoryStore?.cleanupExpired(Math.max(WINDOW_MS, LOGIN_WINDOW_MS));
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

  /** 从 Authorization header 或 JWT cookie 中提取用户角色（验证 JWT 签名） */
  private extractRole(req: Request): string | null {
    try {
      if (!this.jwtSecret || this.jwtSecret.length < 16) {
        this.logger.error('JWT_SECRET 未正确配置，无法验证用户角色，使用匿名限流');
        return null;
      }

      // Try Authorization header first
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        const payload = jwt.verify(token, this.jwtSecret) as { role?: string };
        return payload?.role ?? null;
      }

      // Fallback: try JWT cookie (access_token)
      const cookieHeader = req.headers.cookie;
      if (cookieHeader) {
        const match = cookieHeader.match(/(?:^|;\s*)access_token=([^;]+)/);
        if (match) {
          const token = match[1];
          const payload = jwt.verify(token, this.jwtSecret) as { role?: string };
          return payload?.role ?? null;
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  private async checkRateLimit(
    key: string,
    maxRequests: number,
    windowMs: number,
  ): Promise<{ allowed: boolean; remaining: number; resetTime: number; retryAfter: number }> {
    const now = Date.now();
    const result = await this.store.increment(key, windowMs);
    const remaining = Math.max(0, maxRequests - result.count);
    const resetTime = result.resetTime;
    const retryAfter = Math.ceil((resetTime - now) / 1000);

    if (result.count > maxRequests) {
      return { allowed: false, remaining: 0, resetTime, retryAfter };
    }

    return { allowed: true, remaining, resetTime, retryAfter };
  }

  private extractLoginIdentifier(req: Request): string | null {
    try {
      if (req.body && typeof req.body === 'object' && 'username' in req.body) {
        const username = (req.body as { username?: string }).username;
        if (username && typeof username === 'string') {
          return username.trim().toLowerCase();
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  async use(req: Request, res: Response, next: NextFunction) {
    try {
      const ip = this.getClientIp(req);
      const isLogin = req.path === '/api/auth/login' || req.path === '/auth/login';
      const isRefresh = req.path === '/api/auth/refresh' || req.path === '/auth/refresh';

      if (isLogin) {
        const ipKey = `rate_limit:${ip}:login`;
        const ipResult = await this.checkRateLimit(ipKey, LOGIN_LIMIT_PER_IP, LOGIN_WINDOW_MS);

        res.setHeader('X-RateLimit-Limit', LOGIN_LIMIT_PER_IP);
        res.setHeader('X-RateLimit-Remaining', ipResult.remaining);
        res.setHeader('X-RateLimit-Reset', Math.floor(ipResult.resetTime / 1000));

        if (!ipResult.allowed) {
          res.setHeader('Retry-After', ipResult.retryAfter);
          this.logger.warn(`Rate limit exceeded for IP=${ip} path=${req.path} key=${ipKey} limit=${LOGIN_LIMIT_PER_IP}`);
          throw new HttpException('请求过于频繁，请稍后再试', 429);
        }

        const loginId = this.extractLoginIdentifier(req);
        if (loginId) {
          const userKey = `rate_limit:login:${loginId}`;
          const userResult = await this.checkRateLimit(userKey, LOGIN_LIMIT_PER_USER, LOGIN_WINDOW_MS);

          if (!userResult.allowed) {
            res.setHeader('Retry-After', userResult.retryAfter);
            this.logger.warn(`Login rate limit exceeded for user=${loginId} IP=${ip}`);
            throw new HttpException('登录尝试次数过多，请稍后再试', 429);
          }
        }

        return next();
      }

      if (isRefresh) {
        const key = `rate_limit:${ip}:refresh`;
        const result = await this.checkRateLimit(key, REFRESH_LIMIT, WINDOW_MS);

        res.setHeader('X-RateLimit-Limit', REFRESH_LIMIT);
        res.setHeader('X-RateLimit-Remaining', result.remaining);
        res.setHeader('X-RateLimit-Reset', Math.floor(result.resetTime / 1000));

        if (!result.allowed) {
          res.setHeader('Retry-After', result.retryAfter);
          this.logger.warn(`Rate limit exceeded for IP=${ip} path=${req.path} key=${key} limit=${REFRESH_LIMIT}`);
          throw new HttpException('请求过于频繁，请稍后再试', 429);
        }

        return next();
      }

      const role = this.extractRole(req);
      const maxRequests = role ? (ROLE_LIMITS[role] ?? DEFAULT_LIMIT) : DEFAULT_LIMIT;
      const key = `rate_limit:${ip}:${role ?? 'anonymous'}`;
      const result = await this.checkRateLimit(key, maxRequests, WINDOW_MS);

      res.setHeader('X-RateLimit-Limit', maxRequests);
      res.setHeader('X-RateLimit-Remaining', result.remaining);
      res.setHeader('X-RateLimit-Reset', Math.floor(result.resetTime / 1000));

      if (!result.allowed) {
        res.setHeader('Retry-After', result.retryAfter);
        this.logger.warn(`Rate limit exceeded for IP=${ip} path=${req.path} key=${key} limit=${maxRequests}`);
        throw new HttpException('请求过于频繁，请稍后再试', 429);
      }

      next();
    } catch (error) {
      next(error);
    }
  }

  onModuleDestroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    if (this.memoryStore) {
      this.memoryStore.clear();
    }
  }
}
