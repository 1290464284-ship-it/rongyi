import { MemoryRateLimitStore } from './memory-rate-limit-store';
import { RedisRateLimitStore, RedisClientLike } from './redis-rate-limit-store';

describe('MemoryRateLimitStore', () => {
  let store: MemoryRateLimitStore;

  beforeEach(() => {
    jest.useFakeTimers();
    store = new MemoryRateLimitStore();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('get', () => {
    it('不存在的 key 返回 null', async () => {
      const result = await store.get('nonexistent');
      expect(result).toBeNull();
    });

    it('存在的 key 返回 count 和 resetTime', async () => {
      await store.increment('test-key', 60000);
      const result = await store.get('test-key');
      expect(result).not.toBeNull();
      expect(result?.count).toBe(1);
      expect(typeof result?.resetTime).toBe('number');
    });
  });

  describe('set', () => {
    it('可以设置指定的 count 和 resetTime', async () => {
      const futureTime = Date.now() + 30000;
      await store.set('test-key', 5, futureTime);
      const result = await store.get('test-key');
      expect(result?.count).toBe(5);
    });
  });

  describe('increment', () => {
    it('第一次调用返回 count=1', async () => {
      const result = await store.increment('test-key', 60000);
      expect(result.count).toBe(1);
    });

    it('多次调用累加 count', async () => {
      await store.increment('test-key', 60000);
      await store.increment('test-key', 60000);
      const result = await store.increment('test-key', 60000);
      expect(result.count).toBe(3);
    });

    it('窗口过期后重新计数', async () => {
      const windowMs = 60000;
      await store.increment('test-key', windowMs);
      await store.increment('test-key', windowMs);

      jest.advanceTimersByTime(windowMs + 1000);

      const result = await store.increment('test-key', windowMs);
      expect(result.count).toBe(1);
    });

    it('不同的 key 独立计数', async () => {
      await store.increment('key1', 60000);
      await store.increment('key1', 60000);
      await store.increment('key2', 60000);

      const result1 = await store.get('key1');
      const result2 = await store.get('key2');

      expect(result1?.count).toBe(2);
      expect(result2?.count).toBe(1);
    });
  });

  describe('clear', () => {
    it('清空所有数据', async () => {
      await store.increment('key1', 60000);
      await store.increment('key2', 60000);

      store.clear();

      expect(await store.get('key1')).toBeNull();
      expect(await store.get('key2')).toBeNull();
    });
  });

  describe('size', () => {
    it('返回存储的条目数量', async () => {
      expect(store.size).toBe(0);
      await store.increment('key1', 60000);
      expect(store.size).toBe(1);
      await store.increment('key2', 60000);
      expect(store.size).toBe(2);
    });
  });

  describe('cleanupExpired', () => {
    it('清理所有时间戳均已过期的键并返回清理数量', async () => {
      const windowMs = 60000;
      await store.increment('expired-key', windowMs);

      jest.advanceTimersByTime(windowMs + 1000);
      await store.increment('active-key', windowMs);

      const removed = store.cleanupExpired(windowMs);

      expect(removed).toBe(1);
      expect(await store.get('expired-key')).toBeNull();
      expect(await store.get('active-key')).not.toBeNull();
    });

    it('未过期的键不会被清理', async () => {
      await store.increment('key1', 60000);
      await store.increment('key2', 60000);

      jest.advanceTimersByTime(30000);

      const removed = store.cleanupExpired(60000);

      expect(removed).toBe(0);
      expect(store.size).toBe(2);
    });

    it('空 store 调用返回 0', () => {
      expect(store.cleanupExpired(60000)).toBe(0);
    });
  });
});

describe('RedisRateLimitStore', () => {
  let mockRedis: jest.Mocked<RedisClientLike>;
  let store: RedisRateLimitStore;

  beforeEach(() => {
    mockRedis = {
      get: jest.fn(),
      set: jest.fn(),
      incr: jest.fn(),
      pexpire: jest.fn(),
      pttl: jest.fn(),
    };
    store = new RedisRateLimitStore(mockRedis);
  });

  describe('get', () => {
    it('key 不存在时返回 null', async () => {
      mockRedis.get.mockResolvedValue(null);
      const result = await store.get('test-key');
      expect(result).toBeNull();
      expect(mockRedis.get).toHaveBeenCalledWith('rate_limit:test-key');
    });

    it('key 存在时返回 count 和 resetTime', async () => {
      mockRedis.get.mockResolvedValue('5');
      mockRedis.pttl.mockResolvedValue(30000);
      const result = await store.get('test-key');
      expect(result?.count).toBe(5);
      expect(typeof result?.resetTime).toBe('number');
    });

    it('使用自定义 keyPrefix', async () => {
      const customStore = new RedisRateLimitStore(mockRedis, { keyPrefix: 'custom:' });
      mockRedis.get.mockResolvedValue(null);
      await customStore.get('test-key');
      expect(mockRedis.get).toHaveBeenCalledWith('custom:test-key');
    });
  });

  describe('set', () => {
    it('设置值并设置过期时间', async () => {
      mockRedis.set.mockResolvedValue('OK');
      const resetTime = Date.now() + 60000;
      await store.set('test-key', 10, resetTime);
      expect(mockRedis.set).toHaveBeenCalledWith(
        'rate_limit:test-key',
        '10',
        expect.objectContaining({ PX: expect.any(Number) }),
      );
    });
  });

  describe('increment', () => {
    it('第一次调用时设置过期时间', async () => {
      mockRedis.incr.mockResolvedValue(1);
      mockRedis.pexpire.mockResolvedValue(1);
      mockRedis.pttl.mockResolvedValue(60000);
      const result = await store.increment('test-key', 60000);
      expect(result.count).toBe(1);
      expect(mockRedis.incr).toHaveBeenCalledWith('rate_limit:test-key');
      expect(mockRedis.pexpire).toHaveBeenCalledWith('rate_limit:test-key', 60000);
    });

    it('后续调用不重复设置过期时间', async () => {
      mockRedis.incr.mockResolvedValue(5);
      mockRedis.pttl.mockResolvedValue(30000);
      const result = await store.increment('test-key', 60000);
      expect(result.count).toBe(5);
      expect(mockRedis.pexpire).not.toHaveBeenCalled();
    });
  });
});
