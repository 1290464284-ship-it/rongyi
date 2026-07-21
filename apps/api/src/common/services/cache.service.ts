import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const MAX_CACHE_SIZE = 1000;
const EVICT_BATCH_SIZE = 50;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  private store = new Map<string, CacheEntry<unknown>>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  onModuleInit() {
    this.cleanupTimer = setInterval(() => this.cleanupExpired(), CLEANUP_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key) as CacheEntry<T> | undefined;
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set<T>(key: string, value: T, ttlMs: number = 5 * 60 * 1000): void {
    if (this.store.size >= MAX_CACHE_SIZE && !this.store.has(key)) {
      this.evictOldest(EVICT_BATCH_SIZE);
    }
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
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
    const value = await factory();
    this.set(key, value, ttlMs);
    return value;
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
    const entries: { key: string; expiresAt: number }[] = [];
    for (const [key, entry] of this.store.entries()) {
      entries.push({ key, expiresAt: entry.expiresAt });
    }
    entries.sort((a, b) => a.expiresAt - b.expiresAt);
    const toRemove = entries.slice(0, Math.min(count, entries.length));
    for (const entry of toRemove) {
      this.store.delete(entry.key);
    }
  }
}
