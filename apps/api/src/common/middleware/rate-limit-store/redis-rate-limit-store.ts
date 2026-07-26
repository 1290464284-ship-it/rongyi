import { RateLimitStore, RateLimitData } from './rate-limit-store.interface';

export interface RedisClientLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { EX?: number; PX?: number }): Promise<string | null>;
  incr(key: string): Promise<number>;
  pexpire(key: string, milliseconds: number): Promise<number>;
  pttl(key: string): Promise<number>;
}

export class RedisRateLimitStore implements RateLimitStore {
  private readonly redis: RedisClientLike;
  private readonly keyPrefix: string;

  constructor(redis: RedisClientLike, options?: { keyPrefix?: string }) {
    this.redis = redis;
    this.keyPrefix = options?.keyPrefix ?? 'rate_limit:';
  }

  private prefixedKey(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  async get(key: string): Promise<RateLimitData | null> {
    const prefixedKey = this.prefixedKey(key);
    const countStr = await this.redis.get(prefixedKey);
    if (countStr === null) {
      return null;
    }
    const count = parseInt(countStr, 10);
    if (isNaN(count)) {
      return null;
    }
    const ttl = await this.redis.pttl(prefixedKey);
    const now = Date.now();
    const resetTime = ttl > 0 ? now + ttl : now;
    return { count, resetTime };
  }

  async set(key: string, count: number, resetTime: number): Promise<void> {
    const prefixedKey = this.prefixedKey(key);
    const now = Date.now();
    const ttlMs = Math.max(1, resetTime - now);
    await this.redis.set(prefixedKey, String(count), { PX: ttlMs });
  }

  async increment(key: string, windowMs: number): Promise<RateLimitData> {
    const prefixedKey = this.prefixedKey(key);
    const count = await this.redis.incr(prefixedKey);
    if (count === 1) {
      await this.redis.pexpire(prefixedKey, windowMs);
    }
    const ttl = await this.redis.pttl(prefixedKey);
    const now = Date.now();
    const resetTime = now + (ttl > 0 ? ttl : windowMs);
    return { count, resetTime };
  }
}
