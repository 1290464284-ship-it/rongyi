/**
 * 领域事件总线
 *
 * 基于 NestJS EventEmitter2 的轻量级封装，为领域事件提供类型化的发布接口。
 * 业务模块通过 EventEmitter2EventBus 发布事件，避免直接依赖具体消费方。
 */
import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DomainEvent } from './domain-events';

@Injectable()
export class EventEmitter2EventBus {
  constructor(private readonly eventEmitter: EventEmitter2) {}

  emit(event: DomainEvent): void {
    this.eventEmitter.emit(event.eventName, event);
  }

  emitAsync(event: DomainEvent): Promise<unknown[]> {
    return this.eventEmitter.emitAsync(event.eventName, event);
  }
}
