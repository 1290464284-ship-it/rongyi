import { Injectable, CanActivate, ExecutionContext, HttpException, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { TokenBucketLimiter } from '../utils/rate-limit/token-bucket';
import { RATE_LIMIT_KEY, RateLimitOptions } from '../decorators/rate-limit.decorator';
import { ConfigService } from '../services/config.service';

/**
 * 细粒度限流守卫
 *
 * 通过 @RateLimit() 装饰器配置控制器或方法级别的限流策略。
 * 支持按 IP、用户 ID、诊所 ID 等多种粒度限流。
 *
 * 使用令牌桶算法，支持突发流量。
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);
  private readonly limiters = new Map<string, TokenBucketLimiter>();
  private readonly trustProxy: boolean;
  private readonly whitelist: Set<string>;

  constructor(
    private readonly reflector: Reflector,
    private readonly configService: ConfigService,
  ) {
    this.trustProxy = this.configService.get('TRUST_PROXY') === '1';
    this.whitelist = this.parseWhitelist();
  }

  canActivate(context: ExecutionContext): boolean {
    const options = this.reflector.getAllAndOverride<RateLimitOptions | undefined>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!options) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    const ip = this.getClientIp(request);

    if (this.whitelist.has(ip)) {
      return true;
    }

    const key = this.generateKey(options, request, ip);
    const limiter = this.getOrCreateLimiter(key, options);
    const tokens = options.tokensPerRequest ?? 1;
    const result = limiter.consume(key, tokens);

    response.setHeader('X-RateLimit-Limit', options.capacity);
    response.setHeader('X-RateLimit-Remaining', result.remaining);
    response.setHeader('X-RateLimit-Reset', Math.floor((Date.now() + result.resetInMs) / 1000));

    if (!result.allowed) {
      response.setHeader('Retry-After', Math.ceil(result.resetInMs / 1000));
      this.logger.warn(
        `Rate limit exceeded: key=${key} granularity=${options.granularity ?? 'ip'} capacity=${options.capacity} rate=${options.ratePerSecond}/s`,
      );
      throw new HttpException('请求过于频繁，请稍后再试', 429);
    }

    return true;
  }

  private getOrCreateLimiter(key: string, options: RateLimitOptions): TokenBucketLimiter {
    const limiterKey = `${options.capacity}:${options.ratePerSecond}:${options.granularity ?? 'ip'}`;
    let limiter = this.limiters.get(limiterKey);

    if (!limiter) {
      limiter = new TokenBucketLimiter({
        capacity: options.capacity,
        ratePerSecond: options.ratePerSecond,
        maxEntries: 10000,
      });
      this.limiters.set(limiterKey, limiter);
    }

    return limiter;
  }

  private generateKey(options: RateLimitOptions, request: Request, ip: string): string {
    const granularity = options.granularity ?? 'ip';

    switch (granularity) {
      case 'ip':
        return `rl:ip:${ip}`;

      case 'user': {
        const user = (request as unknown as { user?: { id?: string } }).user;
        const userId = user?.id ?? 'anonymous';
        return `rl:user:${userId}`;
      }

      case 'clinic': {
        const user = (request as unknown as { user?: { clinicId?: string } }).user;
        const clinicId = user?.clinicId ?? 'unknown';
        return `rl:clinic:${clinicId}`;
      }

      case 'custom':
        if (options.keyGenerator) {
          return `rl:custom:${options.keyGenerator(request)}`;
        }
        return `rl:ip:${ip}`;

      default:
        return `rl:ip:${ip}`;
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

  private parseWhitelist(): Set<string> {
    const whitelistStr = this.configService.get('RATE_LIMIT_WHITELIST');
    if (!whitelistStr) {
      return new Set();
    }
    return new Set(
      whitelistStr
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }

  /**
   * 清理所有限流器（用于测试或销毁）
   */
  resetAll(): void {
    for (const limiter of this.limiters.values()) {
      limiter.destroy();
    }
    this.limiters.clear();
  }
}
