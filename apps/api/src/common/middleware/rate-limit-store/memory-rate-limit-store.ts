import { RateLimitStore, RateLimitData } from './rate-limit-store.interface';

interface MemoryStoreEntry {
  timestamps: number[];
}

const MAX_STORE_SIZE = 10000;

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly store = new Map<string, MemoryStoreEntry>();

  async get(key: string): Promise<RateLimitData | null> {
    const entry = this.store.get(key);
    if (!entry || entry.timestamps.length === 0) {
      return null;
    }
    return {
      count: entry.timestamps.length,
      resetTime: entry.timestamps[0],
    };
  }

  async set(key: string, count: number, _resetTime: number): Promise<void> {
    const now = Date.now();
    const timestamps: number[] = [];
    for (let i = 0; i < count; i++) {
      timestamps.push(now);
    }
    this.store.set(key, { timestamps });
    this.evictIfNeeded();
  }

  async increment(key: string, windowMs: number): Promise<RateLimitData> {
    const now = Date.now();
    const entry = this.store.get(key);
    const timestamps = entry?.timestamps ?? [];
    const validTimestamps = timestamps.filter((t) => now - t <= windowMs);
    validTimestamps.push(now);
    this.store.set(key, { timestamps: validTimestamps });
    this.evictIfNeeded();
    return {
      count: validTimestamps.length,
      resetTime: validTimestamps[0] + windowMs,
    };
  }

  clear(): void {
    this.store.clear();
  }

  /**
   * 主动清理所有时间戳均已过期的键（超出最大限流窗口）。
   * 补充 LRU 被动淘汰：低流量下长期驻留的过期键也能被回收。
   */
  cleanupExpired(maxWindowMs: number): number {
    const cutoff = Date.now() - maxWindowMs;
    let removed = 0;
    for (const [key, entry] of this.store) {
      if (entry.timestamps.length === 0 || entry.timestamps[entry.timestamps.length - 1] <= cutoff) {
        this.store.delete(key);
        removed++;
      }
    }
    return removed;
  }

  get size(): number {
    return this.store.size;
  }

  private evictIfNeeded(): void {
    if (this.store.size > MAX_STORE_SIZE) {
      const excess = this.store.size - MAX_STORE_SIZE;
      const keys = Array.from(this.store.keys()).slice(0, excess);
      for (const k of keys) {
        this.store.delete(k);
      }
    }
  }
}
