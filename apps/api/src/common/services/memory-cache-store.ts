/**
 * 内存缓存存储
 *
 * 基于 Map 的 LRU 风格缓存实现，适用于单实例部署。
 * 从原 CacheService 提取的存储逻辑，保持完全相同的行为。
 */
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ICacheStore } from './cache-store.interface';
import { DEFAULT_CACHE_TTL_MS, ONE_MINUTE_MS } from '../../config/constants';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  accessedAt: number;
}

const MAX_CACHE_SIZE = 1000;
const EVICT_BATCH_SIZE = 50;
const CLEANUP_INTERVAL_MS = 5 * ONE_MINUTE_MS;

@Injectable()
export class MemoryCacheStore implements ICacheStore, OnModuleInit, OnModuleDestroy {
  private store = new Map<string, CacheEntry<unknown>>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  onModuleInit() {
    this.cleanupTimer = setInterval(() => this.cleanupExpired(), CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  get size(): number {
    return this.store.size;
  }

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key) as CacheEntry<T> | undefined;
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
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
