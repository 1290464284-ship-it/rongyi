/**
 * 事件模块
 *
 * 统一导出领域事件 + 事件模块注册。
 * 其他模块通过 import EventsModule 获得 EventEmitter2 注入能力。
 */
import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { CacheInvalidationListener } from './cache-invalidation.listener';

export * from './domain-events';

@Module({
  imports: [
    EventEmitterModule.forRoot({
      wildcard: false,
      delimiter: '.',
      newListener: false,
      removeListener: false,
      maxListeners: 20,
      verboseMemoryLeak: true,
    }),
  ],
  providers: [CacheInvalidationListener],
  exports: [EventEmitterModule],
})
export class EventsModule {}
