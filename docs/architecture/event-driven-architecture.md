# Event-Driven Architecture Proposal

**Target audience**: Backend engineers, tech lead
**Estimated effort**: 2–3 weeks (1–2 engineers)
**Status**: Proposal — not yet started

---

## 1. Current State: Direct Service Calls

### 1.1 Coupling pattern

Currently, all cross-module operations are direct function calls within the same service:

```
ChargeService.createCharge()
  → inserts Charge + ChargeItem
  → (inline) inserts AuditLog
  → (caller) calls InventoryService.deductStock()
  → (caller) calls MemberCardService.updateBalance()
  → (caller) calls StatsService.invalidateCache()
```

This creates tight coupling:
- `ChargeService` must know about inventory deduction logic
- Adding a new side effect (e.g., send WeChat notification) requires modifying `ChargeService`
- Testing requires mocking all downstream services
- Transaction scope is unclear — does inventory deduction happen inside or outside the charge transaction?

### 1.2 Current service call graph (simplified)

```
ChargeService
  ├── BaseService.create()          (direct)
  ├── AuditLog                      (direct insert)
  ├── InventoryService              (called by charge-payment.service.ts)
  ├── MemberCardService             (called by charge-payment.service.ts)
  └── DebtService                   (called by charge-payment.service.ts)

PatientsService
  ├── BaseService.create()          (direct)
  ├── MemberCardService             (called by patients.service.ts)
  └── FollowUpService               (called by patients.service.ts)

AppointmentsService
  ├── BaseService.create()          (direct)
  └── RegistrationService           (called by appointments.service.ts)

PurchaseOrdersService
  ├── BaseService.update()          (direct)
  └── InventoryService              (called by purchase-orders.service.ts)
```

---

## 2. Target State: Event Bus for Decoupling

### 2.1 Core concept

Instead of Service A calling Service B directly, Service A emits an event. Service B subscribes to that event and reacts independently.

```
Before:
  ChargeService.createCharge() → InventoryService.deductStock()

After:
  ChargeService.createCharge() → emit('charge.paid', data)
                                    ├── InventoryService.onChargePaid()
                                    ├── MemberCardService.onChargePaid()
                                    ├── StatsService.onChargePaid()
                                    └── WechatService.onChargePaid()  (new!)
```

### 2.2 Benefits

1. **Loose coupling**: `ChargeService` doesn't know or care who reacts to `charge.paid`
2. **Easy extensibility**: Adding a new handler (e.g., SMS notification) requires zero changes to `ChargeService`
3. **Testability**: Test `ChargeService` without mocking downstream services
4. **Audit trail**: Events serve as an implicit audit log
5. **Future cloud sync**: Events become the sync mechanism (emit locally, push to cloud)

---

## 3. Event Catalog

### 3.1 Domain events

| Event | Trigger | Current callers | New subscribers |
|-------|---------|----------------|-----------------|
| `charge.created` | New charge created | AuditLog (inline) | AuditLog, StatsService cache |
| `charge.paid` | Payment received | InventoryService, MemberCardService, DebtService, StatsService | Same + WechatService, FollowUpService |
| `charge.refunded` | Refund processed | MemberCardService, StatsService | Same + WechatService |
| `charge.cancelled` | Charge cancelled | DebtService, StatsService | Same |
| `patient.created` | New patient registered | AuditLog (inline) | AuditLog, WechatService (welcome msg), FollowUpService |
| `patient.updated` | Patient info changed | AuditLog (inline) | AuditLog |
| `appointment.created` | Appointment booked | RegistrationService | RegistrationService, WechatService |
| `appointment.completed` | Appointment finished | StatsService | StatsService, FollowUpService |
| `appointment.cancelled` | Appointment cancelled | StatsService | StatsService, WechatService |
| `visit.completed` | Visit ended | StatsService | StatsService, FollowUpService |
| `stock.low` | Inventory below minStock | (none — currently manual check) | WechatService (alert), PurchaseOrderService (suggestion) |
| `stock.deducted` | Inventory consumed | (none — inline in charge) | StatsService cache |
| `member.recharge` | Card recharge | MemberCardService | WechatService, StatsService |
| `member.consume` | Card consumption | MemberCardService | WechatService, StatsService |
| `treatment.completed` | Treatment done | (none) | StatsService, FollowUpService, WechatService |

### 3.2 Event payload structure

```typescript
interface DomainEvent<T = Record<string, unknown>> {
  id: string;              // UUID
  type: string;            // e.g., 'charge.paid'
  timestamp: string;       // ISO 8601
  clinicId: string;        // multi-clinic isolation
  userId?: string;         // who triggered it
  correlationId?: string;  // link related events
  payload: T;
  metadata?: Record<string, unknown>;
}
```

---

## 4. Implementation: In-Process EventEmitter

### 4.1 EventBus service

```typescript
// common/services/event-bus.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter } from 'events';

export type EventHandler<T = unknown> = (event: DomainEvent<T>) => Promise<void> | void;

@Injectable()
export class EventBusService {
  private readonly emitter = new EventEmitter();
  private readonly logger = new Logger('EventBus');
  private handlers = new Map<string, EventHandler[]>();

  constructor() {
    // Prevent unhandled error crashes
    this.emitter.on('error', (err) => {
      this.logger.error('EventBus error', err);
    });
  }

  async emit<T>(type: string, payload: T, context?: { clinicId: string; userId?: string }) {
    const event: DomainEvent<T> = {
      id: crypto.randomUUID(),
      type,
      timestamp: new Date().toISOString(),
      clinicId: context?.clinicId || '',
      userId: context?.userId,
      payload,
    };

    this.logger.debug(`Event: ${type}`, { eventId: event.id });

    // Emit asynchronously — handlers run in microtask queue
    // Use setImmediate to avoid blocking the caller
    setImmediate(() => {
      this.emitter.emit(type, event);
    });

    return event;
  }

  on<T>(type: string, handler: EventHandler<T>): void {
    this.emitter.on(type, handler);
    const list = this.handlers.get(type) || [];
    list.push(handler as EventHandler);
    this.handlers.set(type, list);
    this.logger.debug(`Handler registered: ${type}`);
  }

  off(type: string, handler: EventHandler): void {
    this.emitter.off(type, handler);
  }

  getRegisteredHandlers(): string[] {
    return Array.from(this.handlers.keys());
  }
}
```

### 4.2 Module registration

```typescript
// app.module.ts
import { EventBusService } from './common/services/event-bus.service';

@Module({
  providers: [
    EventBusService,
    // ... existing providers
  ],
  exports: [EventBusService],
})
export class AppModule {}
```

### 4.3 Emitting events (producer side)

```typescript
// In ChargeService.createCharge()
return this.dbService.transaction(async (db) => {
  // ... existing insert logic ...

  // Emit event after successful transaction
  await this.eventBus.emit('charge.created', {
    chargeId,
    patientId: dto.patientId,
    totalAmount: totalAmountCents,
    items: dto.items,
  }, { clinicId, userId: this.clinicContext.getUserId() });

  return this.getCharge(chargeId);
});
```

```typescript
// In charge-payment.service.ts
async completePayment(chargeId: string, dto: CompletePaymentDto) {
  return this.dbService.transaction(async (db) => {
    // ... existing payment logic ...

    await this.eventBus.emit('charge.paid', {
      chargeId,
      patientId: charge.patientId,
      paidAmount: yuanToCents(dto.amount),
      payMethod: dto.payMethod,
    }, { clinicId, userId });

    return this.getCharge(chargeId);
  });
}
```

### 4.4 Subscribing to events (consumer side)

```typescript
// inventory/inventory.service.ts
@Injectable()
export class InventoryService implements OnModuleInit {
  constructor(
    private eventBus: EventBusService,
    // ... existing deps
  ) {}

  onModuleInit() {
    this.eventBus.on('charge.paid', this.onChargePaid.bind(this));
  }

  private async onChargePaid(event: DomainEvent) {
    const { chargeId, patientId } = event.payload as { chargeId: string; patientId: string };
    const clinicId = event.clinicId;

    // Deduct inventory for charge items that have inventoryItemId
    const items = this.dbService.prepare(
      `SELECT * FROM ChargeItem WHERE chargeId = ? AND inventoryItemId IS NOT NULL`
    ).all(chargeId) as ChargeItemRecord[];

    for (const item of items) {
      await this.deductStock(item.inventoryItemId!, item.consumedQuantity, chargeId, clinicId);
    }
  }
}
```

```typescript
// communication/wechat/wechat.service.ts
@Injectable()
export class WechatService implements OnModuleInit {
  constructor(
    private eventBus: EventBusService,
    // ... existing deps
  ) {}

  onModuleInit() {
    this.eventBus.on('charge.paid', this.onChargePaid.bind(this));
    this.eventBus.on('patient.created', this.onPatientCreated.bind(this));
    this.eventBus.on('stock.low', this.onStockLow.bind(this));
  }

  private async onChargePaid(event: DomainEvent) {
    const { patientId, paidAmount } = event.payload;
    // Send payment confirmation via WeChat
    await this.sendPaymentConfirmation(patientId, paidAmount);
  }

  private async onPatientCreated(event: DomainEvent) {
    const { patientId, name } = event.payload;
    // Send welcome message
    await this.sendWelcomeMessage(patientId, name);
  }

  private async onStockLow(event: DomainEvent) {
    const { itemName, currentStock, minStock } = event.payload;
    // Send alert to admin
    await this.sendStockAlert(event.clinicId, itemName, currentStock, minStock);
  }
}
```

---

## 5. Key Use Cases in Detail

### 5.1 Charge Paid → Multiple Side Effects

**Current flow** (tight coupling):
```
charge-payment.service.ts
  → completePayment()
    → db.transaction()
      → update Charge status
      → update ChargeItem
      → (if member card) update MemberCard
      → (if member card) insert MemberCardLog
      → insert AuditLog
    → inventoryService.deductStock()  // separate call after transaction
    → statsService.invalidateCache()  // separate call after transaction
```

**Event-driven flow**:
```
charge-payment.service.ts
  → completePayment()
    → db.transaction()
      → update Charge status
      → update ChargeItem
      → (if member card) update MemberCard + MemberCardLog
    → emit('charge.paid', { chargeId, ... })

EventBus fires:
  → InventoryService.onChargePaid()      // deduct stock
  → MemberCardService.onChargePaid()     // update points (if not done in tx)
  → StatsService.onChargePaid()          // invalidate cache
  → WechatService.onChargePaid()         // send notification
  → AuditLogService.onChargePaid()       // log audit event
```

**Key insight**: The charge transaction remains atomic. Side effects (inventory, notifications) happen asynchronously after the transaction commits. This is correct because:
- Inventory deduction can be retried if it fails
- WeChat notification is best-effort
- Stats cache invalidation is idempotent

### 5.2 Patient Created → Welcome + Follow-up

```
patients.service.ts
  → create()
    → emit('patient.created', { patientId, name, phone, source })

EventBus fires:
  → WechatService.onPatientCreated()
    → Send welcome message with clinic info
  → FollowUpService.onPatientCreated()
    → Auto-schedule 7-day follow-up if source == 'REFERRAL'
  → AuditLogService.onPatientCreated()
    → Log creation event
```

### 5.3 Stock Low → Alert + Purchase Suggestion

```
inventory.service.ts
  → deductStock()
    → update InventoryItem.stock
    → insert InventoryTransaction
    → (if stock < minStock) emit('stock.low', { itemId, currentStock, minStock })

EventBus fires:
  → WechatService.onStockLow()
    → Send alert to clinic admin
  → PurchaseOrderService.onStockLow()
    → Auto-generate purchase order suggestion (optional)
  → StatsService.onStockLow()
    → Update inventory dashboard
```

---

## 6. Error Handling

### 6.1 Handler failure isolation

Event handler failures must NOT affect the emitting service. Use try/catch in each handler:

```typescript
async emit<T>(type: string, payload: T, context?: { clinicId: string; userId?: string }) {
  const event = { id: crypto.randomUUID(), type, timestamp: new Date().toISOString(), ... };

  // Run handlers with error isolation
  const handlers = this.emitter.listeners(type);
  for (const handler of handlers) {
    try {
      await (handler as EventHandler)(event);
    } catch (err) {
      this.logger.error(`Handler failed for ${type}: ${err.message}`, err.stack);
      // Log to dead-letter queue for retry
      await this.deadLetterQueue.add(event, err);
    }
  }
}
```

### 6.2 Dead letter queue

For events that fail all retries, store in a `DeadLetterEvent` table:

```sql
CREATE TABLE IF NOT EXISTS DeadLetterEvent (
  id TEXT PRIMARY KEY,
  eventId TEXT NOT NULL,
  eventType TEXT NOT NULL,
  payload TEXT NOT NULL,  -- JSON
  error TEXT NOT NULL,
  retryCount INTEGER DEFAULT 0,
  maxRetries INTEGER DEFAULT 3,
  nextRetryAt TIMESTAMPTZ,
  clinicId TEXT NOT NULL,
  createdAt TIMESTAMPTZ DEFAULT NOW(),
  resolvedAt TIMESTAMPTZ
);

CREATE INDEX idx_dlq_retry ON DeadLetterEvent(nextRetryAt)
  WHERE resolvedAt IS NULL;
```

### 6.3 Retry strategy

| Attempt | Delay | Action |
|---------|-------|--------|
| 1 | Immediate | Run handler |
| 2 | 1 second | Retry |
| 3 | 5 seconds | Retry |
| 4+ | Dead letter queue | Log for manual review |

---

## 7. Migration Path

### 7.1 Phase 1: In-process EventEmitter (SQLite phase)

**Duration**: 2 weeks

1. Create `EventBusService` (as shown above)
2. Register in `AppModule`
3. Convert 3 key events first:
   - `charge.paid` (most complex, most side effects)
   - `patient.created` (simplest, good proof of concept)
   - `stock.low` (currently doesn't exist — new capability)
4. Add event handlers in each consuming service
5. Add unit tests for event emission and handling
6. Verify no regression in existing E2E tests

### 7.2 Phase 2: Redis pub/sub (Cloud phase)

**Duration**: 1 week (after cloud infrastructure is ready)

When deploying to cloud with multiple API instances, replace in-process EventEmitter with Redis pub/sub:

```typescript
// common/services/event-bus-redis.service.ts
import { Injectable } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisEventBusService {
  private publisher: Redis;
  private subscriber: Redis;

  constructor() {
    this.publisher = new Redis(process.env.REDIS_URL);
    this.subscriber = new Redis(process.env.REDIS_URL);
  }

  async emit<T>(type: string, payload: T, context?: { clinicId: string }) {
    const event = { id: crypto.randomUUID(), type, timestamp: new Date().toISOString(), ...context, payload };

    // Publish to Redis channel
    await this.publisher.publish(`events:${type}`, JSON.stringify(event));

    // Also publish to clinic-specific channel for filtered subscriptions
    if (context?.clinicId) {
      await this.publisher.publish(`events:${context.clinicId}:${type}`, JSON.stringify(event));
    }
  }

  on<T>(type: string, handler: EventHandler<T>): void {
    this.subscriber.subscribe(`events:${type}`);
    this.subscriber.on('message', (channel, message) => {
      if (channel === `events:${type}`) {
        handler(JSON.parse(message) as DomainEvent<T>);
      }
    });
  }
}
```

### 7.3 Phase 3: Event sourcing (optional, future)

If audit requirements grow, consider event sourcing:
- Every state change is stored as an immutable event
- Current state is derived by replaying events
- Enables full audit trail and time-travel debugging

This is a larger undertaking (6+ weeks) and should only be pursued if the business requires complete event history.

---

## 8. Effort Estimate

| Phase | Duration | Dependencies |
|-------|----------|-------------|
| Phase 1: In-process EventEmitter | 2 weeks | None |
| Phase 2: Redis pub/sub (cloud) | 1 week | Cloud infra ready |
| Phase 3: Event sourcing (optional) | 6+ weeks | Phase 2 |
| **Total (Phase 1 + 2)** | **3 weeks** | — |

### 8.1 Team allocation

- **Phase 1** (2 weeks): 1 engineer
  - Week 1: EventBusService + charge.paid event + 3 handlers
  - Week 2: patient.created + stock.low events + remaining handlers + tests
- **Phase 2** (1 week): 1 engineer
  - Replace EventEmitter with Redis adapter
  - Add dead letter queue
  - Integration testing

---

## 9. Testing Strategy

### 9.1 Unit tests

```typescript
describe('EventBusService', () => {
  it('should emit event and call handler', async () => {
    const bus = new EventBusService();
    const handler = jest.fn();
    bus.on('test.event', handler);

    await bus.emit('test.event', { data: 'hello' });

    // Wait for setImmediate
    await new Promise(resolve => setImmediate(resolve));
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      type: 'test.event',
      payload: { data: 'hello' },
    }));
  });

  it('should isolate handler failures', async () => {
    const bus = new EventBusService();
    const failHandler = jest.fn().mockRejectedValue(new Error('fail'));
    const successHandler = jest.fn();

    bus.on('test.event', failHandler);
    bus.on('test.event', successHandler);

    await bus.emit('test.event', {});
    await new Promise(resolve => setImmediate(resolve));

    expect(failHandler).toHaveBeenCalled();
    expect(successHandler).toHaveBeenCalled();
  });
});
```

### 9.2 Integration tests

```typescript
describe('ChargeService + EventHandlers', () => {
  it('should emit charge.paid and trigger inventory deduction', async () => {
    const eventSpy = jest.spyOn(eventBus, 'emit');

    await chargeService.createCharge(dto);

    expect(eventSpy).toHaveBeenCalledWith('charge.paid',
      expect.objectContaining({ chargeId: expect.any(String) }),
      expect.objectContaining({ clinicId: expect.any(String) })
    );
  });
});
```

---

## 10. Summary

| Aspect | Current | After Phase 1 | After Phase 2 |
|--------|---------|---------------|---------------|
| Coupling | Tight (direct calls) | Loose (event-driven) | Loose + distributed |
| Extensibility | Modify producer | Add subscriber | Add subscriber |
| Error isolation | None | Handler-level | Handler + DLQ |
| Multi-instance | N/A | Limited (in-process) | Full (Redis pub/sub) |
| Audit trail | Manual AuditLog inserts | Events + AuditLog | Events + DLQ |
| Effort | — | 2 weeks | +1 week |
