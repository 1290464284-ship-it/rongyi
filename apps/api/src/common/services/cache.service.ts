import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DEFAULT_CACHE_TTL_MS, ONE_MINUTE_MS } from '../../config/constants';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  accessedAt: number;
}

interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  size: number;
  maxSize: number;
}

const MAX_CACHE_SIZE = 1000;
const EVICT_BATCH_SIZE = 50;
const CLEANUP_INTERVAL_MS = 5 * ONE_MINUTE_MS;

@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  private store = new Map<string, CacheEntry<unknown>>();
  // P2 修复：缓存击穿保护 —— 跟踪进行中的 factory 调用，避免并发请求重复执行
  private pending = new Map<string, Promise<unknown>>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private hits = 0;
  private misses = 0;

  onModuleInit() {
    this.cleanupTimer = setInterval(() => this.cleanupExpired(), CLEANUP_INTERVAL_MS);
    // P1 修复：unref 防止定时器阻止 Node.js 进程正常退出
    this.cleanupTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key) as CacheEntry<T> | undefined;
    if (!entry) {
      this.misses++;
      return undefined;
    }
    if (entry.expiresAt < Date.now()) {
      this.store.delete(key);
      this.misses++;
      return undefined;
    }
    this.hits++;
    entry.accessedAt = Date.now();
    return entry.value;
  }

  set<T>(key: string, value: T, ttlMs: number = DEFAULT_CACHE_TTL_MS): void {
    if (this.store.size >= MAX_CACHE_SIZE && !this.store.has(key)) {
      this.evictOldest(EVICT_BATCH_SIZE);
    }
    const now = Date.now();
    this.store.set(key, {
      value,
      expiresAt: now + ttlMs,
      accessedAt: now,
    });
  }

  del(key: string): void {
    this.store.delete(key);
  }

  delPattern(pattern: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(pattern)) {
        this.store.delete(key);
      }
    }
  }

  clear(): void {
    this.store.clear();
  }

  async getOrSet<T>(
    key: string,
    factory: () => Promise<T> | T,
    ttlMs?: number,
  ): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== undefined) return cached;
    // P2 修复：缓存击穿保护 —— 若已有相同 key 的 factory 在执行中，复用其 Promise
    const pendingPromise = this.pending.get(key) as Promise<T> | undefined;
    if (pendingPromise) return pendingPromise;
    const promise = (async () => {
      try {
        const value = await factory();
        this.set(key, value, ttlMs);
        return value;
      } finally {
        this.pending.delete(key);
      }
    })();
    this.pending.set(key, promise);
    return promise;
  }

  getStats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
      size: this.store.size,
      maxSize: MAX_CACHE_SIZE,
    };
  }

  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
  }

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (entry.expiresAt < now) {
        this.store.delete(key);
      }
    }
  }

  private evictOldest(count: number): void {
    const now = Date.now();
    const entries = Array.from(this.store.entries())
      .filter(([, entry]) => entry.expiresAt >= now)
      .sort((a, b) => a[1].accessedAt - b[1].accessedAt);

    for (let i = 0; i < count && i < entries.length; i++) {
      this.store.delete(entries[i][0]);
    }
  }
}
