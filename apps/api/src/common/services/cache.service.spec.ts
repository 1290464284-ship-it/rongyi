import { CacheService } from './cache.service';
import { DEFAULT_CACHE_TTL_MS, ONE_MINUTE_MS } from '../../config/constants';

describe('CacheService', () => {
  let service: CacheService;
  let setIntervalSpy: jest.SpyInstance;
  let clearIntervalSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));

    setIntervalSpy = jest.spyOn(globalThis, 'setInterval');
    clearIntervalSpy = jest.spyOn(globalThis, 'clearInterval');

    service = new CacheService();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('get / set', () => {
    it('应能存储和获取缓存值', () => {
      service.set('key1', 'value1');
      expect(service.get<string>('key1')).toBe('value1');
    });

    it('未命中时应返回 undefined', () => {
      expect(service.get<string>('nonexistent')).toBeUndefined();
    });

    it('命中时应增加 hits 计数', () => {
      service.set('key1', 'value1');
      service.get('key1');
      const stats = service.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(0);
    });

    it('未命中时应增加 misses 计数', () => {
      service.get('nonexistent');
      const stats = service.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(1);
    });

    it('覆盖已有 key 时应更新值', () => {
      service.set('key1', 'old');
      // eslint-disable-next-line sonarjs/no-element-overwrite -- 故意测试覆盖场景
      service.set('key1', 'new');
      expect(service.get<string>('key1')).toBe('new');
    });

    it('应支持不同类型的值', () => {
      service.set('num', 42);
      service.set('obj', { a: 1, b: 2 });
      service.set('arr', [1, 2, 3]);

      expect(service.get<number>('num')).toBe(42);
      expect(service.get<{ a: number; b: number }>('obj')).toEqual({ a: 1, b: 2 });
      expect(service.get<number[]>('arr')).toEqual([1, 2, 3]);
    });

    it('未设置 TTL 时应使用默认 TTL', () => {
      service.set('key1', 'value1');
      expect(service.get<string>('key1')).toBe('value1');

      jest.advanceTimersByTime(DEFAULT_CACHE_TTL_MS + 1);

      expect(service.get<string>('key1')).toBeUndefined();
    });

    it('自定义 TTL 应正确生效', () => {
      const customTtl = 1000;
      service.set('key1', 'value1', customTtl);
      expect(service.get<string>('key1')).toBe('value1');

      jest.advanceTimersByTime(customTtl + 1);

      expect(service.get<string>('key1')).toBeUndefined();
    });
  });

  describe('TTL 过期', () => {
    it('过期后 get 应返回 undefined', () => {
      service.set('key1', 'value1', 5000);

      jest.advanceTimersByTime(6000);

      expect(service.get<string>('key1')).toBeUndefined();
    });

    it('过期后条目应从 store 中删除', () => {
      service.set('key1', 'value1', 5000);
      expect(service.getStats().size).toBe(1);

      jest.advanceTimersByTime(6000);
      service.get('key1');

      expect(service.getStats().size).toBe(0);
    });

    it('过期访问应计为 miss', () => {
      service.set('key1', 'value1', 5000);

      jest.advanceTimersByTime(6000);
      service.get('key1');

      const stats = service.getStats();
      expect(stats.misses).toBe(1);
      expect(stats.hits).toBe(0);
    });

    it('恰好在过期时间点应仍可访问', () => {
      service.set('key1', 'value1', 5000);

      jest.advanceTimersByTime(4999);

      expect(service.get<string>('key1')).toBe('value1');
    });

    it('过期时间等于当前时间时不应视为未过期', () => {
      service.set('key1', 'value1', 5000);

      jest.advanceTimersByTime(5000);

      expect(service.get<string>('key1')).toBe('value1');
    });

    it('过期时间刚过1毫秒时应视为过期', () => {
      service.set('key1', 'value1', 5000);

      jest.advanceTimersByTime(5001);

      expect(service.get<string>('key1')).toBeUndefined();
    });
  });

  describe('del', () => {
    it('应删除指定 key 的缓存', () => {
      service.set('key1', 'value1');
      service.del('key1');
      expect(service.get<string>('key1')).toBeUndefined();
    });

    it('删除不存在的 key 不应报错', () => {
      expect(() => service.del('nonexistent')).not.toThrow();
    });

    it('删除后 size 应减少', () => {
      service.set('key1', 'value1');
      service.set('key2', 'value2');
      expect(service.getStats().size).toBe(2);

      service.del('key1');
      expect(service.getStats().size).toBe(1);
    });
  });

  describe('delPattern', () => {
    it('应删除匹配前缀的所有 key', () => {
      service.set('user:1', 'a');
      service.set('user:2', 'b');
      service.set('post:1', 'c');

      service.delPattern('user:');

      expect(service.get<string>('user:1')).toBeUndefined();
      expect(service.get<string>('user:2')).toBeUndefined();
      expect(service.get<string>('post:1')).toBe('c');
    });

    it('无匹配时不应删除任何内容', () => {
      service.set('key1', 'value1');
      service.delPattern('nonexistent:');
      expect(service.getStats().size).toBe(1);
    });

    it('空 pattern 应删除所有 key', () => {
      service.set('a', 1);
      service.set('b', 2);
      service.set('c', 3);

      service.delPattern('');

      expect(service.getStats().size).toBe(0);
    });

    it('应支持多级前缀', () => {
      service.set('api:v1:users', 1);
      service.set('api:v1:posts', 2);
      service.set('api:v2:users', 3);

      service.delPattern('api:v1:');

      expect(service.get<string>('api:v1:users')).toBeUndefined();
      expect(service.get<string>('api:v1:posts')).toBeUndefined();
      expect(service.get<number>('api:v2:users')).toBe(3);
    });
  });

  describe('clear', () => {
    it('应清空所有缓存', () => {
      service.set('key1', 'value1');
      service.set('key2', 'value2');
      service.set('key3', 'value3');

      service.clear();

      expect(service.getStats().size).toBe(0);
      expect(service.get<string>('key1')).toBeUndefined();
    });

    it('清空后不影响统计计数', () => {
      service.set('key1', 'value1');
      service.get('key1');

      service.clear();

      const stats = service.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(0);
      expect(stats.size).toBe(0);
    });

    it('空缓存调用 clear 不应报错', () => {
      expect(() => service.clear()).not.toThrow();
    });
  });

  describe('getOrSet', () => {
    it('缓存未命中时应调用 factory 并缓存结果', async () => {
      const factory = jest.fn().mockResolvedValue('factory-value');

      const result = await service.getOrSet('key1', factory);

      expect(factory).toHaveBeenCalledTimes(1);
      expect(result).toBe('factory-value');
      expect(service.get<string>('key1')).toBe('factory-value');
    });

    it('缓存已命中时不应调用 factory', async () => {
      service.set('key1', 'cached-value');
      const factory = jest.fn();

      const result = await service.getOrSet('key1', factory);

      expect(factory).not.toHaveBeenCalled();
      expect(result).toBe('cached-value');
    });

    it('应支持同步 factory', async () => {
      const factory = jest.fn().mockReturnValue('sync-value');

      const result = await service.getOrSet('key1', factory);

      expect(result).toBe('sync-value');
      expect(service.get<string>('key1')).toBe('sync-value');
    });

    it('应支持自定义 TTL', async () => {
      const factory = jest.fn().mockResolvedValue('value');
      const customTtl = 1000;

      await service.getOrSet('key1', factory, customTtl);
      expect(service.get<string>('key1')).toBe('value');

      jest.advanceTimersByTime(customTtl + 1);

      expect(service.get<string>('key1')).toBeUndefined();
    });

    it('factory 抛出异常时不应缓存', async () => {
      const factory = jest.fn().mockRejectedValue(new Error('factory error'));

      await expect(service.getOrSet('key1', factory)).rejects.toThrow('factory error');
      expect(service.get<string>('key1')).toBeUndefined();
    });

    it('第二次调用应使用缓存值', async () => {
      const factory = jest.fn().mockResolvedValue('value');

      const result1 = await service.getOrSet('key1', factory);
      const result2 = await service.getOrSet('key1', factory);

      expect(factory).toHaveBeenCalledTimes(1);
      expect(result1).toBe('value');
      expect(result2).toBe('value');
    });
  });

  describe('getStats', () => {
    it('初始状态统计应全部为 0', () => {
      const stats = service.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.hitRate).toBe(0);
      expect(stats.size).toBe(0);
      expect(stats.maxSize).toBe(1000);
    });

    it('应正确计算命中率', () => {
      service.set('key1', 1);
      service.set('key2', 2);

      service.get('key1');
      service.get('key2');
      service.get('nonexistent');

      const stats = service.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBeCloseTo(2 / 3);
      expect(stats.size).toBe(2);
    });

    it('无访问时命中率应为 0', () => {
      const stats = service.getStats();
      expect(stats.hitRate).toBe(0);
    });

    it('size 应反映当前缓存条目数', () => {
      service.set('key1', 1);
      expect(service.getStats().size).toBe(1);

      service.set('key2', 2);
      expect(service.getStats().size).toBe(2);

      service.del('key1');
      expect(service.getStats().size).toBe(1);
    });
  });

  describe('resetStats', () => {
    it('应重置 hits 和 misses 计数', () => {
      service.set('key1', 1);
      service.get('key1');
      service.get('nonexistent');

      expect(service.getStats().hits).toBe(1);
      expect(service.getStats().misses).toBe(1);

      service.resetStats();

      const stats = service.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.hitRate).toBe(0);
    });

    it('重置后不影响缓存内容', () => {
      service.set('key1', 'value1');
      service.resetStats();

      expect(service.get<string>('key1')).toBe('value1');
      expect(service.getStats().size).toBe(1);
    });

    it('重置后再次访问应重新计数', () => {
      service.set('key1', 1);
      service.get('key1');
      service.resetStats();

      service.get('key1');
      service.get('nonexistent');

      const stats = service.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
    });
  });

  describe('缓存淘汰', () => {
    const MAX_CACHE_SIZE = 1000;
    const EVICT_BATCH_SIZE = 50;

    it('超出 MAX_CACHE_SIZE 时应淘汰最久未访问的条目', () => {
      for (let i = 0; i < MAX_CACHE_SIZE; i++) {
        service.set(`key-${i}`, `value-${i}`);
      }

      expect(service.getStats().size).toBe(MAX_CACHE_SIZE);

      jest.advanceTimersByTime(1000);

      for (let i = MAX_CACHE_SIZE - 10; i < MAX_CACHE_SIZE; i++) {
        service.get(`key-${i}`);
      }

      jest.advanceTimersByTime(1000);

      service.set('new-key', 'new-value');

      expect(service.getStats().size).toBe(MAX_CACHE_SIZE - EVICT_BATCH_SIZE + 1);

      for (let i = MAX_CACHE_SIZE - 10; i < MAX_CACHE_SIZE; i++) {
        expect(service.get<string>(`key-${i}`)).toBe(`value-${i}`);
      }

      for (let i = 0; i < EVICT_BATCH_SIZE - 1; i++) {
        expect(service.get<string>(`key-${i}`)).toBeUndefined();
      }
    });

    it('访问条目应更新 accessedAt，避免被淘汰', () => {
      for (let i = 0; i < MAX_CACHE_SIZE; i++) {
        service.set(`key-${i}`, `value-${i}`);
      }

      jest.advanceTimersByTime(1000);
      service.get('key-999');

      jest.advanceTimersByTime(1000);

      service.set('new-key', 'new-value');

      expect(service.get<string>('key-999')).toBe('value-999');
      expect(service.get<string>('key-0')).toBeUndefined();
    });

    it('更新已有 key 不应触发淘汰', () => {
      for (let i = 0; i < MAX_CACHE_SIZE; i++) {
        service.set(`key-${i}`, `value-${i}`);
      }

      service.set('key-0', 'updated-value');

      expect(service.getStats().size).toBe(MAX_CACHE_SIZE);
      expect(service.get<string>('key-0')).toBe('updated-value');
    });

    it('淘汰时应跳过已过期的条目', () => {
      for (let i = 0; i < MAX_CACHE_SIZE; i++) {
        const ttl = i < EVICT_BATCH_SIZE ? 1000 : DEFAULT_CACHE_TTL_MS;
        service.set(`key-${i}`, `value-${i}`, ttl);
      }

      jest.advanceTimersByTime(2000);

      service.set('new-key', 'new-value');

      expect(service.get<string>('new-key')).toBe('new-value');
      expect(service.getStats().size).toBe(MAX_CACHE_SIZE - EVICT_BATCH_SIZE + 1);
    });
  });

  describe('onModuleInit / onModuleDestroy', () => {
    it('onModuleInit 应启动定时清理', () => {
      service.onModuleInit();

      expect(setIntervalSpy).toHaveBeenCalledWith(
        expect.any(Function),
        5 * ONE_MINUTE_MS,
      );
    });

    it('onModuleDestroy 应停止定时清理', () => {
      service.onModuleInit();
      const timerId = (service as any).cleanupTimer;

      service.onModuleDestroy();

      expect(clearIntervalSpy).toHaveBeenCalledWith(timerId);
      expect((service as any).cleanupTimer).toBeNull();
    });

    it('onModuleDestroy 在未初始化时不应报错', () => {
      expect(() => service.onModuleDestroy()).not.toThrow();
    });

    it('多次调用 onModuleInit 应替换定时器', () => {
      service.onModuleInit();
      const firstTimer = (service as any).cleanupTimer;

      service.onModuleInit();
      const secondTimer = (service as any).cleanupTimer;

      expect(firstTimer).not.toBe(secondTimer);
    });
  });

  describe('定期清理过期', () => {
    it('cleanupExpired 应清除所有过期条目', () => {
      service.set('key1', 'value1', 1000);
      service.set('key2', 'value2', 2000);
      service.set('key3', 'value3', 3000);

      jest.advanceTimersByTime(2500);

      (service as any).cleanupExpired();

      expect(service.getStats().size).toBe(1);
      expect(service.get<string>('key1')).toBeUndefined();
      expect(service.get<string>('key2')).toBeUndefined();
      expect(service.get<string>('key3')).toBe('value3');
    });

    it('定时器触发时应自动清理过期条目', () => {
      service.onModuleInit();

      service.set('key1', 'value1', 1000);
      service.set('key2', 'value2', DEFAULT_CACHE_TTL_MS);

      jest.advanceTimersByTime(5 * ONE_MINUTE_MS);

      expect(service.getStats().size).toBe(1);
      expect(service.get<string>('key1')).toBeUndefined();
      expect(service.get<string>('key2')).toBe('value2');
    });

    it('无过期条目时清理不应删除任何内容', () => {
      service.set('key1', 'value1');
      service.set('key2', 'value2');

      (service as any).cleanupExpired();

      expect(service.getStats().size).toBe(2);
    });

    it('所有条目都过期时应清空缓存', () => {
      service.set('key1', 'value1', 1000);
      service.set('key2', 'value2', 2000);

      jest.advanceTimersByTime(3000);

      (service as any).cleanupExpired();

      expect(service.getStats().size).toBe(0);
    });
  });
});
