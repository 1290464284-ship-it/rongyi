import { Logger } from '@nestjs/common';
import { RedisClientLike, RedisRateLimitStore } from './redis-rate-limit-store';
import { RateLimitStore } from './rate-limit-store.interface';

const logger = new Logger('RedisRateLimitAdapter');

/**
 * 懒加载 Redis 限流存储适配器。
 * 仅当设置了 REDIS_URL 时才动态加载 ioredis；若未安装 ioredis 则回退到内存存储。
 * 这样避免了对 ioredis 的硬依赖，同时为多实例部署提供启用路径。
 */
export async function createRedisRateLimitStoreIfConfigured(
  redisUrl?: string,
): Promise<RateLimitStore | null> {
  if (!redisUrl) {
    return null;
  }

  try {
    // 动态加载 ioredis，避免未安装时启动失败
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const IORedis = require('ioredis');
    const client: RedisClientLike = new IORedis(redisUrl, {
      // 连接失败时不抛出未捕获异常，回退到内存存储
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: true,
      retryStrategy: (times: number) => (times > 3 ? null : Math.min(times * 200, 2000)),
    });

    // 监听错误避免进程崩溃
    (client as unknown as { on: (event: string, handler: (...args: unknown[]) => void) => void }).on(
      'error',
      (...args: unknown[]) => {
        const err = args[0] as Error;
        logger.warn(`Redis 限流存储连接错误，已降级到内存存储: ${err.message}`);
      },
    );

    logger.log(`已启用 Redis 限流存储（多实例共享）: ${redisUrl.replace(/\/\/.*@/, '//***@')}`);
    return new RedisRateLimitStore(client);
  } catch (err) {
    logger.warn(
      `ioredis 未安装或加载失败（${(err as Error).message}），使用内存限流存储。多实例部署请执行: pnpm add ioredis`,
    );
    return null;
  }
}
