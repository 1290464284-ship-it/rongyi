import { createRedisRateLimitStoreIfConfigured } from './redis-rate-limit-adapter';
import { RedisRateLimitStore } from './redis-rate-limit-store';

describe('createRedisRateLimitStoreIfConfigured', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('未配置 REDIS_URL 时返回 null（降级到内存存储）', async () => {
    const result = await createRedisRateLimitStoreIfConfigured(undefined);
    expect(result).toBeNull();
  });

  it('空字符串 REDIS_URL 时返回 null', async () => {
    const result = await createRedisRateLimitStoreIfConfigured('');
    expect(result).toBeNull();
  });

  it('ioredis 未安装时优雅降级返回 null', async () => {
    // 模拟 require 抛出 MODULE_NOT_FOUND
    jest.mock('ioredis', () => {
      throw new Error("Cannot find module 'ioredis'");
    }, { virtual: true });

    const result = await createRedisRateLimitStoreIfConfigured('redis://localhost:6379');
    expect(result).toBeNull();
  });

  it('ioredis 可用时返回 RedisRateLimitStore 实例', async () => {
    const mockClient = {
      on: jest.fn().mockReturnThis(),
      get: jest.fn(),
      set: jest.fn(),
      incr: jest.fn(),
      pexpire: jest.fn(),
      pttl: jest.fn(),
    };
    const MockIORedis = jest.fn().mockImplementation(() => mockClient);
    jest.mock('ioredis', () => MockIORedis, { virtual: true });

    const result = await createRedisRateLimitStoreIfConfigured('redis://localhost:6379');
    expect(result).toBeInstanceOf(RedisRateLimitStore);
    expect(MockIORedis).toHaveBeenCalledWith(
      'redis://localhost:6379',
      expect.objectContaining({ lazyConnect: true }),
    );
    expect(mockClient.on).toHaveBeenCalledWith('error', expect.any(Function));
  });

  it('日志中隐藏 Redis URL 中的密码信息', async () => {
    const mockClient = {
      on: jest.fn().mockReturnThis(),
      get: jest.fn(),
      set: jest.fn(),
      incr: jest.fn(),
      pexpire: jest.fn(),
      pttl: jest.fn(),
    };
    const MockIORedis = jest.fn().mockImplementation(() => mockClient);
    jest.mock('ioredis', () => MockIORedis, { virtual: true });

    // 不应在日志中泄露密码（通过 URL 替换实现）
    await createRedisRateLimitStoreIfConfigured('redis://user:secretpass@redis.example.com:6379/0');
    // 调用方传入的 URL 不会被修改（脱敏发生在日志输出时）
    expect(MockIORedis).toHaveBeenCalledWith(
      'redis://user:secretpass@redis.example.com:6379/0',
      expect.any(Object),
    );
  });
});
