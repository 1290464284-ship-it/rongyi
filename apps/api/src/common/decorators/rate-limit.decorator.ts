import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_KEY = 'rate_limit';

/**
 * 限流粒度
 * - ip: 按 IP 限流
 * - user: 按用户 ID 限流（需认证）
 * - clinic: 按诊所 ID 限流（需多租户）
 * - custom: 自定义 key 生成策略（需配合 keyGenerator 使用）
 */
export type RateLimitGranularity = 'ip' | 'user' | 'clinic' | 'custom';

export interface RateLimitOptions {
  /** 令牌桶容量（最大突发请求数） */
  capacity: number;
  /** 每秒填充速率 */
  ratePerSecond: number;
  /** 限流粒度，默认 ip */
  granularity?: RateLimitGranularity;
  /** 自定义 key 生成函数（当 granularity 为 custom 时使用） */
  keyGenerator?: (request: unknown) => string;
  /** 每个请求消耗的令牌数，默认 1 */
  tokensPerRequest?: number;
}

/**
 * 限流装饰器
 *
 * 用于控制器类或方法上，配置自定义限流策略。
 * 方法级配置会覆盖控制器级配置。
 *
 * @example
 * ```typescript
 * @RateLimit({ capacity: 100, ratePerSecond: 10 })
 * @Controller('users')
 * export class UsersController {
 *   @RateLimit({ capacity: 10, ratePerSecond: 1 })
 *   @Post('login')
 *   login() { ... }
 * }
 * ```
 */
export const RateLimit = (options: RateLimitOptions) =>
  SetMetadata(RATE_LIMIT_KEY, options);
