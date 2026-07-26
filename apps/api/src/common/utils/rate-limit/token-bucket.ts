/**
 * 令牌桶限流算法实现
 *
 * 令牌桶算法原理：
 * - 系统以恒定速率向桶中放入令牌
 * - 每来一个请求，尝试从桶中取出一个令牌
 * - 如果桶中有令牌，则请求通过；否则请求被拒绝
 * - 桶有最大容量，超过容量的令牌会被丢弃
 *
 * 相比滑动窗口算法，令牌桶的优势：
 * - 支持突发流量（桶内有足够令牌时可一次性处理）
 * - 内存占用更稳定（每个 key 只存少量状态）
 * - 计算更高效（无需维护时间戳列表）
 */

export interface TokenBucketConsumeResult {
  /** 是否允许通过 */
  allowed: boolean;
  /** 剩余令牌数 */
  remaining: number;
  /** 重置到满容量所需毫秒数 */
  resetInMs: number;
}

interface BucketState {
  /** 当前令牌数 */
  tokens: number;
  /** 上次补充令牌的时间戳（毫秒） */
  lastRefill: number;
}

export interface TokenBucketOptions {
  /** 桶的最大令牌数（容量） */
  capacity: number;
  /** 每秒填充的令牌数 */
  ratePerSecond: number;
  /** 最大存储条目数，防止内存泄漏（默认 10000） */
  maxEntries?: number;
  /** 清理过期条目的间隔（毫秒，默认 60000） */
  cleanupIntervalMs?: number;
}

/**
 * 令牌桶限流器
 *
 * 支持每个 key 独立的令牌桶，适用于按 IP、用户 ID、诊所 ID 等多维度限流。
 * 自动清理长时间未访问的桶，防止内存泄漏。
 */
export class TokenBucketLimiter {
  private readonly buckets = new Map<string, BucketState>();
  private readonly capacity: number;
  private readonly ratePerSecond: number;
  private readonly maxEntries: number;
  private readonly cleanupIntervalMs: number;
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(options: TokenBucketOptions) {
    if (options.capacity <= 0) {
      throw new Error('capacity 必须大于 0');
    }
    if (options.ratePerSecond <= 0) {
      throw new Error('ratePerSecond 必须大于 0');
    }

    this.capacity = options.capacity;
    this.ratePerSecond = options.ratePerSecond;
    this.maxEntries = options.maxEntries ?? 10000;
    this.cleanupIntervalMs = options.cleanupIntervalMs ?? 60_000;

    this.startCleanupTimer();
  }

  /**
   * 尝试消耗指定数量的令牌
   *
   * @param key - 限流键（如 IP、用户 ID、诊所 ID 等）
   * @param tokens - 消耗的令牌数（默认 1）
   * @returns 限流结果
   */
  consume(key: string, tokens: number = 1): TokenBucketConsumeResult {
    if (tokens <= 0) {
      throw new Error('tokens 必须大于 0');
    }

    const now = Date.now();
    const bucket = this.getOrCreateBucket(key, now);

    if (bucket.tokens >= tokens) {
      bucket.tokens -= tokens;
      bucket.lastRefill = now;

      const resetInMs = this.calculateResetTime(bucket.tokens);
      return {
        allowed: true,
        remaining: Math.floor(bucket.tokens),
        resetInMs,
      };
    }

    const resetInMs = this.calculateResetTime(bucket.tokens, tokens);
    return {
      allowed: false,
      remaining: Math.floor(bucket.tokens),
      resetInMs,
    };
  }

  /**
   * 重置指定 key 的令牌桶
   */
  reset(key: string): void {
    this.buckets.delete(key);
  }

  /**
   * 重置所有令牌桶
   */
  resetAll(): void {
    this.buckets.clear();
  }

  /**
   * 获取当前桶的大小（用于监控）
   */
  get size(): number {
    return this.buckets.size;
  }

  /**
   * 销毁限流器，清理定时器
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.buckets.clear();
  }

  private getOrCreateBucket(key: string, now: number): BucketState {
    let bucket = this.buckets.get(key);

    if (!bucket) {
      if (this.buckets.size >= this.maxEntries) {
        this.evictOldest();
      }

      bucket = {
        tokens: this.capacity,
        lastRefill: now,
      };
      this.buckets.set(key, bucket);
    } else {
      this.refillBucket(bucket, now);
    }

    return bucket;
  }

  private refillBucket(bucket: BucketState, now: number): void {
    const elapsedMs = now - bucket.lastRefill;
    if (elapsedMs <= 0) {
      return;
    }

    const tokensToAdd = (elapsedMs / 1000) * this.ratePerSecond;
    bucket.tokens = Math.min(this.capacity, bucket.tokens + tokensToAdd);
    bucket.lastRefill = now;
  }

  private calculateResetTime(currentTokens: number, neededTokens: number = 1): number {
    const deficit = Math.max(0, neededTokens - currentTokens);
    if (deficit <= 0) {
      return 0;
    }
    return Math.ceil((deficit / this.ratePerSecond) * 1000);
  }

  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpired();
    }, this.cleanupIntervalMs);
    this.cleanupTimer.unref();
  }

  private cleanupExpired(): void {
    const now = Date.now();
    const expiredThreshold = this.cleanupIntervalMs * 2;

    for (const [key, bucket] of this.buckets.entries()) {
      if (now - bucket.lastRefill > expiredThreshold && bucket.tokens >= this.capacity) {
        this.buckets.delete(key);
      }
    }
  }

  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, bucket] of this.buckets.entries()) {
      if (bucket.lastRefill < oldestTime) {
        oldestTime = bucket.lastRefill;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.buckets.delete(oldestKey);
    }
  }
}
