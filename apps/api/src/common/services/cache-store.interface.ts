/**
 * 缓存存储接口
 *
 * 定义缓存存储的抽象接口，支持不同实现（内存 / Redis 等）。
 * CacheService 通过注入 ICacheStore 实现与具体存储的解耦。
 *
 * 切换存储只需修改 provider 绑定，业务代码零修改。
 */

export interface ICacheStore {
  /** 获取缓存值，不存在或已过期返回 undefined */
  get<T>(key: string): T | undefined;

  /** 设置缓存值，ttlMs 为过期时间（毫秒） */
  set<T>(key: string, value: T, ttlMs?: number): void;

  /** 删除指定 key */
  del(key: string): void;

  /** 删除匹配前缀的所有 key */
  delPattern(pattern: string): void;

  /** 清空所有缓存 */
  clear(): void;

  /** 获取当前缓存条目数 */
  readonly size: number;
}
