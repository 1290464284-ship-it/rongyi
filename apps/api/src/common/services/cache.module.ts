import { Global, Module } from '@nestjs/common';
import { CacheService } from './cache.service';

/**
 * P3-3: CacheService 全局单例模块。
 * 此前 SettingsModule 和 StatsModule 各自声明了 CacheService provider，
 * 导致两个独立实例互不可见，跨模块缓存失效无法生效。
 * 改为 @Global 单例后，所有模块共享同一缓存实例。
 */
@Global()
@Module({
  providers: [CacheService],
  exports: [CacheService],
})
export class CacheModule {}
