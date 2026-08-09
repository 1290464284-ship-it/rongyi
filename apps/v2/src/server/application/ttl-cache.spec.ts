import { describe, expect, it, vi } from 'vitest';
import { TtlCache } from './ttl-cache';

describe('TtlCache', () => {
  it('caches within TTL and recomputes after expiry', () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const cache = new TtlCache(1000);
      expect(cache.get('key', () => (calls += 1))).toBe(1);
      expect(cache.get('key', () => (calls += 1))).toBe(1);
      vi.advanceTimersByTime(1001);
      expect(cache.get('key', () => (calls += 1))).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('evicts the oldest entry when over the max size', () => {
    const cache = new TtlCache(1000, 2);
    expect(cache.get('a', () => 'a')).toBe('a');
    expect(cache.get('b', () => 'b')).toBe('b');
    expect(cache.get('c', () => 'c')).toBe('c');

    expect(cache.get('b', () => 'B')).toBe('b');
    expect(cache.get('c', () => 'C')).toBe('c');
    expect(cache.get('a', () => 'A')).toBe('A');
  });
});
