import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { SqliteRateLimitStore } from './rate-limit-store';

describe('SqliteRateLimitStore', () => {
  it('shares windows between store instances backed by the same database', () => {
    const db = new Database(':memory:');
    const first = new SqliteRateLimitStore(db);
    const second = new SqliteRateLimitStore(db);
    const now = Date.now();
    first.set('k', { count: 1, resetAt: now + 60_000 });
    expect(second.get('k')).toEqual({ count: 1, resetAt: now + 60_000 });
    second.set('k', { count: 2, resetAt: now + 60_000 });
    expect(first.get('k')?.count).toBe(2);
    db.close();
  });

  it('deletes and prunes expired windows', () => {
    const db = new Database(':memory:');
    const store = new SqliteRateLimitStore(db);
    store.set('expired', { count: 5, resetAt: Date.now() - 1000 });
    store.set('fresh', { count: 1, resetAt: Date.now() + 60_000 });
    store.pruneIfStale(Date.now());
    expect(store.get('expired')).toBeUndefined();
    expect(store.get('fresh')).toBeDefined();
    store.delete('fresh');
    expect(store.get('fresh')).toBeUndefined();
    db.close();
  });
});
