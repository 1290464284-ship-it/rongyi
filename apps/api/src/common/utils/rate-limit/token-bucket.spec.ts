/* eslint-disable sonarjs/constructor-for-side-effects */
import { TokenBucketLimiter } from './token-bucket';

describe('TokenBucketLimiter', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('构造函数', () => {
    it('正常创建限流器', () => {
      const limiter = new TokenBucketLimiter({
        capacity: 100,
        ratePerSecond: 10,
      });
      expect(limiter).toBeDefined();
      expect(limiter.size).toBe(0);
      limiter.destroy();
    });

    it('capacity 必须大于 0', () => {
      expect(() => {
        new TokenBucketLimiter({ capacity: 0, ratePerSecond: 10 });
      }).toThrow('capacity 必须大于 0');
    });

    it('ratePerSecond 必须大于 0', () => {
      expect(() => {
        new TokenBucketLimiter({ capacity: 100, ratePerSecond: 0 });
      }).toThrow('ratePerSecond 必须大于 0');
    });

    it('负数参数也会抛出错误', () => {
      expect(() => {
        new TokenBucketLimiter({ capacity: -1, ratePerSecond: 10 });
      }).toThrow();
    });
  });

  describe('consume 方法', () => {
    it('初始状态下令牌桶是满的', () => {
      const limiter = new TokenBucketLimiter({
        capacity: 10,
        ratePerSecond: 1,
      });

      const result = limiter.consume('test-key');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(9);
      limiter.destroy();
    });

    it('桶中有足够令牌时允许通过', () => {
      const limiter = new TokenBucketLimiter({
        capacity: 5,
        ratePerSecond: 1,
      });

      for (let i = 0; i < 5; i++) {
        const result = limiter.consume('test-key');
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(4 - i);
      }

      limiter.destroy();
    });

    it('令牌耗尽时拒绝请求', () => {
      const limiter = new TokenBucketLimiter({
        capacity: 3,
        ratePerSecond: 1,
      });

      for (let i = 0; i < 3; i++) {
        limiter.consume('test-key');
      }

      const result = limiter.consume('test-key');
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.resetInMs).toBeGreaterThan(0);

      limiter.destroy();
    });

    it('支持消耗多个令牌', () => {
      const limiter = new TokenBucketLimiter({
        capacity: 10,
        ratePerSecond: 1,
      });

      const result = limiter.consume('test-key', 3);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(7);

      const result2 = limiter.consume('test-key', 8);
      expect(result2.allowed).toBe(false);

      limiter.destroy();
    });

    it('消耗 0 个令牌会抛出错误', () => {
      const limiter = new TokenBucketLimiter({
        capacity: 10,
        ratePerSecond: 1,
      });

      expect(() => limiter.consume('test-key', 0)).toThrow('tokens 必须大于 0');

      limiter.destroy();
    });

    it('不同 key 相互独立', () => {
      const limiter = new TokenBucketLimiter({
        capacity: 2,
        ratePerSecond: 1,
      });

      limiter.consume('key-1');
      limiter.consume('key-1');

      const result1 = limiter.consume('key-1');
      expect(result1.allowed).toBe(false);

      const result2 = limiter.consume('key-2');
      expect(result2.allowed).toBe(true);

      limiter.destroy();
    });
  });

  describe('令牌补充', () => {
    it('一段时间后会补充令牌', () => {
      const limiter = new TokenBucketLimiter({
        capacity: 10,
        ratePerSecond: 2,
      });

      for (let i = 0; i < 10; i++) {
        limiter.consume('test-key');
      }

      const before = limiter.consume('test-key');
      expect(before.allowed).toBe(false);

      jest.advanceTimersByTime(1000);

      const after = limiter.consume('test-key');
      expect(after.allowed).toBe(true);
      expect(after.remaining).toBe(1);

      limiter.destroy();
    });

    it('令牌补充不会超过容量', () => {
      const limiter = new TokenBucketLimiter({
        capacity: 5,
        ratePerSecond: 10,
      });

      limiter.consume('test-key');

      jest.advanceTimersByTime(5000);

      const result = limiter.consume('test-key');
      expect(result.remaining).toBe(4);

      limiter.destroy();
    });

    it('精确计算令牌补充数量', () => {
      const limiter = new TokenBucketLimiter({
        capacity: 100,
        ratePerSecond: 10,
      });

      for (let i = 0; i < 100; i++) {
        limiter.consume('test-key');
      }

      jest.advanceTimersByTime(500);

      const result = limiter.consume('test-key');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4);

      limiter.destroy();
    });
  });

  describe('reset 方法', () => {
    it('reset 可以重置指定 key 的桶', () => {
      const limiter = new TokenBucketLimiter({
        capacity: 5,
        ratePerSecond: 1,
      });

      for (let i = 0; i < 5; i++) {
        limiter.consume('test-key');
      }
      expect(limiter.consume('test-key').allowed).toBe(false);

      limiter.reset('test-key');

      const result = limiter.consume('test-key');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4);

      limiter.destroy();
    });

    it('resetAll 重置所有桶', () => {
      const limiter = new TokenBucketLimiter({
        capacity: 2,
        ratePerSecond: 1,
      });

      limiter.consume('key-1');
      limiter.consume('key-1');
      limiter.consume('key-2');
      limiter.consume('key-2');

      expect(limiter.consume('key-1').allowed).toBe(false);
      expect(limiter.consume('key-2').allowed).toBe(false);

      limiter.resetAll();

      expect(limiter.consume('key-1').allowed).toBe(true);
      expect(limiter.consume('key-2').allowed).toBe(true);

      limiter.destroy();
    });
  });

  describe('size 属性', () => {
    it('返回当前桶的数量', () => {
      const limiter = new TokenBucketLimiter({
        capacity: 10,
        ratePerSecond: 1,
      });

      expect(limiter.size).toBe(0);

      limiter.consume('key-1');
      expect(limiter.size).toBe(1);

      limiter.consume('key-2');
      expect(limiter.size).toBe(2);

      limiter.reset('key-1');
      expect(limiter.size).toBe(1);

      limiter.destroy();
    });
  });

  describe('destroy 方法', () => {
    it('清理所有资源', () => {
      const limiter = new TokenBucketLimiter({
        capacity: 10,
        ratePerSecond: 1,
      });

      limiter.consume('key-1');
      limiter.consume('key-2');

      limiter.destroy();

      expect(limiter.size).toBe(0);
    });

    it('多次 destroy 不会抛出错误', () => {
      const limiter = new TokenBucketLimiter({
        capacity: 10,
        ratePerSecond: 1,
      });

      limiter.destroy();
      expect(() => limiter.destroy()).not.toThrow();
    });
  });

  describe('最大条目限制', () => {
    it('超过最大条目数时会驱逐最旧的条目', () => {
      const limiter = new TokenBucketLimiter({
        capacity: 10,
        ratePerSecond: 1,
        maxEntries: 3,
      });

      limiter.consume('key-1');
      jest.advanceTimersByTime(100);
      limiter.consume('key-2');
      jest.advanceTimersByTime(100);
      limiter.consume('key-3');

      expect(limiter.size).toBe(3);

      jest.advanceTimersByTime(100);
      limiter.consume('key-4');

      expect(limiter.size).toBe(3);

      limiter.destroy();
    });
  });

  describe('resetInMs 计算', () => {
    it('有足够令牌时 resetInMs 为 0', () => {
      const limiter = new TokenBucketLimiter({
        capacity: 10,
        ratePerSecond: 2,
      });

      const result = limiter.consume('test-key');
      expect(result.resetInMs).toBe(0);

      limiter.destroy();
    });

    it('令牌耗尽时计算正确的重置时间', () => {
      const limiter = new TokenBucketLimiter({
        capacity: 5,
        ratePerSecond: 1,
      });

      for (let i = 0; i < 5; i++) {
        limiter.consume('test-key');
      }

      const result = limiter.consume('test-key');
      expect(result.allowed).toBe(false);
      expect(result.resetInMs).toBeGreaterThanOrEqual(1000);
      expect(result.resetInMs).toBeLessThanOrEqual(1100);

      limiter.destroy();
    });
  });

  describe('边界情况', () => {
    it('容量为 1 的限流器', () => {
      const limiter = new TokenBucketLimiter({
        capacity: 1,
        ratePerSecond: 1,
      });

      expect(limiter.consume('test').allowed).toBe(true);
      expect(limiter.consume('test').allowed).toBe(false);

      jest.advanceTimersByTime(1000);
      expect(limiter.consume('test').allowed).toBe(true);

      limiter.destroy();
    });

    it('高速率限流器', () => {
      const limiter = new TokenBucketLimiter({
        capacity: 1000,
        ratePerSecond: 100,
      });

      for (let i = 0; i < 1000; i++) {
        expect(limiter.consume('test').allowed).toBe(true);
      }
      expect(limiter.consume('test').allowed).toBe(false);

      jest.advanceTimersByTime(100);
      expect(limiter.consume('test').allowed).toBe(true);

      limiter.destroy();
    });

    it('低速率限流器', () => {
      const limiter = new TokenBucketLimiter({
        capacity: 2,
        ratePerSecond: 0.1,
      });

      limiter.consume('test');
      limiter.consume('test');
      expect(limiter.consume('test').allowed).toBe(false);

      jest.advanceTimersByTime(5000);
      expect(limiter.consume('test').allowed).toBe(false);

      jest.advanceTimersByTime(5001);
      expect(limiter.consume('test').allowed).toBe(true);

      limiter.destroy();
    });
  });
});
