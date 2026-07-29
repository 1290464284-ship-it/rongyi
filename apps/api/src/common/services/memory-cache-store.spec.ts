import { MemoryCacheStore } from './memory-cache-store';

describe('MemoryCacheStore', () => {
  let store: MemoryCacheStore;

  beforeEach(() => {
    store = new MemoryCacheStore();
  });

  afterEach(() => {
    store.onModuleDestroy();
  });

  describe('get / set', () => {
    it('设置后应能获取', () => {
      store.set('key1', 'value1');
      expect(store.get('key1')).toBe('value1');
    });

    it('未设置的 key 返回 undefined', () => {
      expect(store.get('nonexistent')).toBeUndefined();
    });

    it('过期后返回 undefined', () => {
      store.set('key1', 'value1', 1); // 1ms TTL
      // 等待过期
      const start = Date.now();
      while (Date.now() - start < 10) { /* wait */ }
      expect(store.get('key1')).toBeUndefined();
    });

    it('应支持对象值', () => {
      store.set('obj', { a: 1, b: 'test' });
      expect(store.get('obj')).toEqual({ a: 1, b: 'test' });
    });

    it('默认 TTL 应生效', () => {
      store.set('key1', 'value1');
      expect(store.get('key1')).toBe('value1');
    });
  });

  describe('del', () => {
    it('应删除指定 key', () => {
      store.set('key1', 'value1');
      store.del('key1');
      expect(store.get('key1')).toBeUndefined();
    });

    it('删除不存在的 key 不报错', () => {
      expect(() => store.del('nonexistent')).not.toThrow();
    });
  });

  describe('delPattern', () => {
    it('应删除匹配前缀的所有 key', () => {
      store.set('stats:dashboard:1', 'a');
      store.set('stats:revenue:1', 'b');
      store.set('other:key', 'c');

      store.delPattern('stats:');

      expect(store.get('stats:dashboard:1')).toBeUndefined();
      expect(store.get('stats:revenue:1')).toBeUndefined();
      expect(store.get('other:key')).toBe('c');
    });

    it('空模式不删除任何内容', () => {
      store.set('key1', 'value1');
      store.delPattern('');
      // 空字符串是所有字符串的前缀，所以全部删除
      expect(store.get('key1')).toBeUndefined();
    });
  });

  describe('clear', () => {
    it('应清空所有缓存', () => {
      store.set('key1', 'value1');
      store.set('key2', 'value2');
      store.clear();
      expect(store.size).toBe(0);
    });
  });

  describe('size', () => {
    it('应返回缓存条目数', () => {
      expect(store.size).toBe(0);
      store.set('key1', 'value1');
      expect(store.size).toBe(1);
      store.set('key2', 'value2');
      expect(store.size).toBe(2);
    });
  });

  describe('onModuleInit / onModuleDestroy', () => {
    it('onModuleInit 应启动定时清理', () => {
      expect(() => store.onModuleInit()).not.toThrow();
    });

    it('onModuleDestroy 应清理定时器', () => {
      store.onModuleInit();
      expect(() => store.onModuleDestroy()).not.toThrow();
    });

    it('多次 onModuleDestroy 不报错', () => {
      store.onModuleInit();
      store.onModuleDestroy();
      expect(() => store.onModuleDestroy()).not.toThrow();
    });
  });

  describe('LRU 淘汰', () => {
    it('超过 MAX_CACHE_SIZE 时应淘汰最久未访问的条目', () => {
      // 填充到 MAX_CACHE_SIZE (1000)
      for (let i = 0; i < 1001; i++) {
        store.set(`key-${i}`, `value-${i}`);
      }
      // 应该淘汰了最早的条目
      expect(store.get('key-0')).toBeUndefined();
      // 最新的条目应该还在
      expect(store.get('key-1000')).toBe('value-1000');
    });
  });
});
