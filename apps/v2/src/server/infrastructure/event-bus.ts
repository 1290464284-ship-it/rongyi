import type { DomainEvent, DomainEventHandler, IEventBus } from '../../domain/contracts';

/**
 * In-process typed event bus.
 *
 * Handlers are intentionally isolated from the transaction that publishes an
 * event. Side effects such as audit logs, alerts, and cache invalidation are
 * added as subscribers instead of being called directly by use cases.
 */
export class EventBus implements IEventBus {
  private readonly handlers = new Map<string, DomainEventHandler[]>();

  async publish(event: DomainEvent): Promise<void> {
    const handlers = this.handlers.get(event.type) ?? [];
    await Promise.allSettled(handlers.map((handler) => handler(event)));
  }

  subscribe(type: string, handler: DomainEventHandler): void {
    const current = this.handlers.get(type) ?? [];
    current.push(handler);
    this.handlers.set(type, current);
  }
}

