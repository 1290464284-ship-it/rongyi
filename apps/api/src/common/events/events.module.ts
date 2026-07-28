/**
 * 事件模块
 *
 * 统一导出领域事件 + 事件模块注册。
 * 其他模块通过 import EventsModule 获得 EventEmitter2 注入能力。
 */
import { Global, Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { CacheInvalidationListener } from './cache-invalidation.listener';
import { EventEmitter2EventBus } from './event-bus';
import { EventBusService } from './event-bus.service';

export * from './domain-events';
export * from './event-bus';
export * from './event-bus.service';

@Global()
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
  providers: [CacheInvalidationListener, EventEmitter2EventBus, EventBusService],
  exports: [EventEmitterModule, EventEmitter2EventBus, EventBusService],
})
export class EventsModule {}
