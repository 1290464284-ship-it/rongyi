/**
 * 事件总线（基于 RxJS Subject + EventEmitter2 双发）
 *
 * 提供类型化的发布-订阅接口，解耦领域事件的发布方与消费方。
 * 同时向 RxJS Subject 和 NestJS EventEmitter2 发射事件：
 *   - RxJS Subject：供本进程内通过 `eventBus.on(...).subscribe(...)` 的同步订阅者消费
 *     （如 StatsService 的统计缓存失效）
 *   - EventEmitter2：供使用 `@OnEvent` 装饰器的监听器消费
 *     （如 CacheInvalidationListener 的患者/搜索/预约/字典缓存失效）
 *
 * 双发保证两类订阅者都能收到事件，且任一订阅者抛错不影响另一类。
 */
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Subject, Observable, filter } from 'rxjs';
import { DomainEvent } from './domain-events';

/**
 * 事件总线（基于 RxJS Subject + EventEmitter2 双发）
 *
 * 提供类型化的发布-订阅接口，解耦领域事件的发布方与消费方。
 * 同时向 RxJS Subject 和 EventEmitter2 发射事件：
 *   - RxJS Subject：供本进程内通过 `eventBus.on(...).subscribe(...)` 的同步订阅者消费
 *     （如 StatsService 的统计缓存失效）
 *   - EventEmitter2：供使用 `@OnEvent` 装饰器的监听器消费
 *     （如 CacheInvalidationListener 的患者/搜索/预约/字典缓存失效）
 *
 * 双发保证两类订阅者都能收到事件，且任一订阅者抛错不影响另一类。
 *
 * P1 修复：实现 OnModuleDestroy 接口，在模块销毁时调用 Subject.complete()
 * 防止订阅者泄漏。NestJS 在热重载/应用关闭时会触发 onModuleDestroy，
 * 若不 complete Subject，所有通过 eventBus.on(...).subscribe(...) 创建的
 * 订阅将保持活跃状态，导致内存泄漏和潜在的幽灵回调。
 */
@Injectable()
export class EventBusService implements OnModuleDestroy {
  private readonly logger = new Logger(EventBusService.name);
  private readonly bus = new Subject<DomainEvent>();

  constructor(private readonly eventEmitter: EventEmitter2) {}

  /**
   * 模块销毁时清理 RxJS Subject
   * EventEmitter2 由 NestJS EventEmitter2 模块自行管理生命周期，无需手动清理
   */
  onModuleDestroy(): void {
    this.logger.log('EventBusService 销毁，完成 RxJS Subject 以释放订阅者');
    this.bus.complete();
  }

  /**
   * 发布一个领域事件
   *
   * 先发 RxJS Subject（同步执行本地订阅者），再发 EventEmitter2（执行 @OnEvent 监听器）。
   * 任一阶段抛错都被捕获并记录，不影响另一阶段或主流程。
   */
  emit(event: DomainEvent): void {
    // 1. RxJS Subject：本地同步订阅者
    try {
      this.bus.next(event);
    } catch (err: unknown) {
      this.logger.error(
        `RxJS 订阅者执行失败 (event: ${event.eventName})`,
        err instanceof Error ? err.stack : String(err),
      );
    }

    // 2. EventEmitter2：@OnEvent 监听器
    try {
      this.eventEmitter.emit(event.eventName, event);
    } catch (err: unknown) {
      this.logger.error(
        `EventEmitter2 监听器执行失败 (event: ${event.eventName})`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  /**
   * 订阅指定类型的事件
   */
  on<T extends DomainEvent>(eventName: string): Observable<T> {
    return this.bus.pipe(
      filter((event): event is T => event.eventName === eventName),
    );
  }

  /**
   * 订阅所有事件（主要用于调试或审计）
   */
  onAll(): Observable<DomainEvent> {
    return this.bus.asObservable();
  }
}
