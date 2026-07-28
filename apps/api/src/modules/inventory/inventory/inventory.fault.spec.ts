import { InventoryService } from './inventory.service';
import { ClinicContextService } from '../../../common/services/clinic-context.service';
import { IdempotencyService } from '../../../common/services/idempotency.service';
import { EventBusService } from '../../../common/events/event-bus.service';
import { InventoryRepository } from './repositories/inventory.repository';
import { FaultInjector, createDbBusyFault, createDbLockedFault, createRandomFailureFault } from '../../../common/test-helpers/fault-injection';
import { FaultyMockDbService } from '../../../common/test-helpers/mock-db-factory';
import { MockDbRow } from '../../../db/__mocks__/db-service.mock';

function createMockClinicContext(): ClinicContextService {
  return {
    getClinicId: () => 'test-clinic-001',
    getUserId: () => 'test-user',
    getRole: () => 'DOCTOR',
    run: <T>(_ctx: unknown, fn: () => T) => fn(),
    isInitialized: () => true,
  } as unknown as ClinicContextService;
}

function createMockIdempotency(db: FaultyMockDbService): IdempotencyService {
  return {
    executeInTransaction: <T>(_options: unknown, handler: (db: unknown) => T) =>
      db.transaction((txDb: unknown) => handler(txDb)),
    execute: async <T>(_options: unknown, handler: () => Promise<T> | T) => handler(),
  } as unknown as IdempotencyService;
}

function createMockEventBus(): jest.Mocked<EventBusService> {
  return {
    emit: jest.fn(),
    on: jest.fn(),
    onAll: jest.fn(),
  } as unknown as jest.Mocked<EventBusService>;
}

describe('InventoryService - 故障注入测试', () => {
  let service: InventoryService;
  let db: FaultyMockDbService;
  let faultInjector: FaultInjector;
  let eventBus: jest.Mocked<EventBusService>;

  beforeEach(() => {
    faultInjector = new FaultInjector();
    faultInjector.enable();
    db = new FaultyMockDbService(faultInjector);
    eventBus = createMockEventBus();
    service = new InventoryService(
      db as any,
      createMockClinicContext(),
      createMockIdempotency(db),
      eventBus,
      new InventoryRepository(),
    );
  });

  afterEach(() => {
    faultInjector.reset();
    db.clearFaultRules();
    db.clear();
  });

  function seedInventoryItem(overrides: Record<string, unknown> = {}): MockDbRow {
    const id = overrides.id || 'item-001';
    const item: MockDbRow = {
      id,
      code: 'MED-001',
      name: '丁香油',
      category: '药品',
      unit: '瓶',
      stock: 100,
      minStock: 10,
      price: 15.5,
      clinicId: 'test-clinic-001',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: null,
      ...overrides,
    };
    db.seed('InventoryItem', [item]);
    return item;
  }

  function getInventoryItem(id: string): MockDbRow | undefined {
    return db.getTableData('InventoryItem').find(i => i.id === id);
  }

  function getTransactionCount(): number {
    return db.getTableData('InventoryTransaction').length;
  }

  function getAuditLogCount(): number {
    return db.getTableData('AuditLog').length;
  }

  describe('入库操作 - 数据库故障', () => {
    it('入库时 UPDATE 库存失败，事务应回滚，库存不变', async () => {
      seedInventoryItem();

      faultInjector.setFault('inventory-update-busy', createDbBusyFault());
      db.addFaultRule({
        match: /^UPDATE\s+InventoryItem\b.*SET\s+stock\s*=\s*stock\s*\+\s*\?/i,
        faultName: 'inventory-update-busy',
        method: 'run',
      });

      await expect(service.stockAction({
        itemId: 'item-001',
        type: 'IN',
        quantity: 50,
        unitPrice: 15,
        remark: '采购入库',
      })).rejects.toThrow('库存操作失败');

      const item = getInventoryItem('item-001');
      expect(item).toBeDefined();
      expect(item?.stock).toBe(100);

      expect(getTransactionCount()).toBe(0);
      expect(getAuditLogCount()).toBe(0);
    });

    it('入库时 INSERT 交易记录失败，事务应回滚，库存不变', async () => {
      seedInventoryItem();

      faultInjector.setFault('txn-insert-busy', createDbBusyFault());
      db.addFaultRule({
        match: /^INSERT\s+INTO\s+InventoryTransaction\b/i,
        faultName: 'txn-insert-busy',
        method: 'run',
      });

      await expect(service.stockAction({
        itemId: 'item-001',
        type: 'IN',
        quantity: 50,
        unitPrice: 15,
        remark: '采购入库',
      })).rejects.toThrow('库存操作失败');

      const item = getInventoryItem('item-001');
      expect(item?.stock).toBe(100);
      expect(getTransactionCount()).toBe(0);
    });
  });

  describe('出库操作 - 数据库故障', () => {
    it('出库时 UPDATE 库存失败，事务应回滚，库存不变', async () => {
      seedInventoryItem({ stock: 100 });

      faultInjector.setFault('inventory-out-busy', createDbBusyFault());
      db.addFaultRule({
        match: /^UPDATE\s+InventoryItem\b.*SET\s+stock\s*=\s*stock\s*-\s*\?/i,
        faultName: 'inventory-out-busy',
        method: 'run',
      });

      await expect(service.stockAction({
        itemId: 'item-001',
        type: 'OUT',
        quantity: 30,
        remark: '科室领用',
      })).rejects.toThrow('库存操作失败');

      const item = getInventoryItem('item-001');
      expect(item?.stock).toBe(100);
      expect(getTransactionCount()).toBe(0);
    });

    it('出库时 INSERT AuditLog 失败，事务应回滚', async () => {
      seedInventoryItem({ stock: 100 });

      faultInjector.setFault('auditlog-insert-busy', createDbBusyFault());
      db.addFaultRule({
        match: /^INSERT\s+INTO\s+AuditLog\b/i,
        faultName: 'auditlog-insert-busy',
        method: 'run',
      });

      await expect(service.stockAction({
        itemId: 'item-001',
        type: 'OUT',
        quantity: 30,
        remark: '科室领用',
      })).rejects.toThrow('库存操作失败');

      const item = getInventoryItem('item-001');
      expect(item?.stock).toBe(100);
      expect(getTransactionCount()).toBe(0);
      expect(getAuditLogCount()).toBe(0);
    });
  });

  describe('库存调整 - 并发锁冲突', () => {
    it('调整库存时乐观锁冲突（stock 不匹配），应抛出异常且不修改', async () => {
      seedInventoryItem({ stock: 100 });

      const originalPrepare = db.prepare.bind(db);
      let updateCallCount = 0;

      jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        const stmt = originalPrepare(sql);
        if (/^UPDATE\s+InventoryItem\b.*WHERE\s+id\s*=\s*\?.*stock\s*=\s*\?/i.test(sql)) {
          return {
            get: stmt.get.bind(stmt),
            all: stmt.all.bind(stmt),
            run: (..._params: unknown[]) => {
              updateCallCount++;
              return { changes: 0, lastInsertRowid: '' };
            },
          };
        }
        return stmt;
      });

      await expect(service.stockAction({
        itemId: 'item-001',
        type: 'ADJUST',
        quantity: 95,
        remark: '盘点调整',
      })).rejects.toThrow('并发修改');

      const item = getInventoryItem('item-001');
      expect(item?.stock).toBe(100);
      expect(updateCallCount).toBe(1);
      expect(getTransactionCount()).toBe(0);
    });

    it('数据库锁定故障，调整操作应失败且无部分更新', async () => {
      seedInventoryItem({ stock: 100 });

      faultInjector.setFault('adjust-locked', createDbLockedFault());
      db.addFaultRule({
        match: /^UPDATE\s+InventoryItem\b.*SET\s+stock\s*=\s*\?/i,
        faultName: 'adjust-locked',
        method: 'run',
      });

      await expect(service.stockAction({
        itemId: 'item-001',
        type: 'ADJUST',
        quantity: 95,
        remark: '盘点调整',
      })).rejects.toThrow('库存操作失败');

      const item = getInventoryItem('item-001');
      expect(item?.stock).toBe(100);
      expect(getTransactionCount()).toBe(0);
    });
  });

  describe('查询操作 - 数据库故障', () => {
    it('查询库存项时数据库繁忙，应抛出异常', async () => {
      seedInventoryItem();

      faultInjector.setFault('select-busy', createDbBusyFault());
      db.addFaultRule({
        match: /^SELECT\s+\*\s+FROM\s+InventoryItem\b/i,
        faultName: 'select-busy',
        method: 'get',
      });

      await expect(service.findOne('item-001')).rejects.toThrow('SQLITE_BUSY');
    });

    it('查询低库存时数据库锁定，应抛出异常', async () => {
      seedInventoryItem({ stock: 5, minStock: 10 });

      faultInjector.setFault('low-stock-locked', createDbLockedFault());
      db.addFaultRule({
        match: /stock\s*<=\s*minStock/i,
        faultName: 'low-stock-locked',
        method: 'all',
      });

      await expect(service.findLowStockItems()).rejects.toThrow('SQLITE_LOCKED');
    });
  });

  describe('maxTriggers 限制', () => {
    it('故障最多触发 N 次后自动恢复', async () => {
      seedInventoryItem({ id: 'item-1', stock: 100 });
      seedInventoryItem({ id: 'item-2', stock: 100 });
      seedInventoryItem({ id: 'item-3', stock: 100 });

      faultInjector.setFault('limited-fault', {
        ...createDbBusyFault(),
        maxTriggers: 2,
      });
      db.addFaultRule({
        match: /^UPDATE\s+InventoryItem\b.*SET\s+stock\s*=\s*stock\s*\+\s*\?/i,
        faultName: 'limited-fault',
        method: 'run',
      });

      try {
        await service.stockAction({
          itemId: 'item-1',
          type: 'IN',
          quantity: 10,
        });
      } catch (e) {
        expect(e).toBeDefined();
      }

      try {
        await service.stockAction({
          itemId: 'item-2',
          type: 'IN',
          quantity: 10,
        });
      } catch (e) {
        expect(e).toBeDefined();
      }

      expect(faultInjector.getTriggerCount('limited-fault')).toBe(2);

      const result3 = await service.stockAction({
        itemId: 'item-3',
        type: 'IN',
        quantity: 10,
      });
      expect(result3).toBeDefined();

      expect(faultInjector.getTriggerCount('limited-fault')).toBe(2);
    });
  });

  describe('故障注入可控性', () => {
    it('禁用故障注入后，所有操作恢复正常', async () => {
      seedInventoryItem();

      faultInjector.setFault('temp-fault', createDbBusyFault());
      db.addFaultRule({
        match: /^UPDATE\s+InventoryItem/i,
        faultName: 'temp-fault',
        method: 'run',
      });

      faultInjector.disable();

      const result = await service.stockAction({
        itemId: 'item-001',
        type: 'IN',
        quantity: 50,
        unitPrice: 15,
      });

      expect(result).toBeDefined();
      expect(getTransactionCount()).toBe(1);
    });

    it('清除特定故障后，该操作恢复正常', async () => {
      seedInventoryItem();

      faultInjector.setFault('fault-a', createDbBusyFault());
      faultInjector.setFault('fault-b', createDbLockedFault());
      db.addFaultRule({
        match: /^UPDATE\s+InventoryItem/i,
        faultName: 'fault-a',
        method: 'run',
      });

      faultInjector.clearFault('fault-a');

      const result = await service.stockAction({
        itemId: 'item-001',
        type: 'IN',
        quantity: 50,
      });

      expect(result).toBeDefined();
      expect(faultInjector.getTriggerCount('fault-b')).toBe(0);
    });

    it('clearAll 清除所有故障', async () => {
      seedInventoryItem();

      faultInjector.setFault('fault-1', createDbBusyFault());
      faultInjector.setFault('fault-2', createDbLockedFault());
      db.addFaultRule({
        match: /^UPDATE\s+InventoryItem/i,
        faultName: 'fault-1',
        method: 'run',
      });
      db.addFaultRule({
        match: /^SELECT/i,
        faultName: 'fault-2',
        method: 'get',
      });

      faultInjector.clearAll();

      const result = await service.stockAction({
        itemId: 'item-001',
        type: 'IN',
        quantity: 50,
      });

      expect(result).toBeDefined();
      expect(getTransactionCount()).toBe(1);
    });
  });

  describe('随机失败概率', () => {
    it('概率为 0 时永不失败', async () => {
      for (let i = 0; i < 10; i++) {
        seedInventoryItem({ id: `item-${i}`, stock: 100 });
      }

      faultInjector.setFault('random-0', createRandomFailureFault(0));
      db.addFaultRule({
        match: /^UPDATE\s+InventoryItem/i,
        faultName: 'random-0',
        method: 'run',
      });

      for (let i = 0; i < 10; i++) {
        const result = await service.stockAction({
          itemId: `item-${i}`,
          type: 'IN',
          quantity: 10,
        });
        expect(result).toBeDefined();
      }
    });
  });

  describe('故障后数据一致性', () => {
    it('多次故障后重试，数据应正确更新', async () => {
      seedInventoryItem({ stock: 100 });

      faultInjector.setFault('retry-fault', {
        ...createDbBusyFault(),
        maxTriggers: 2,
      });
      db.addFaultRule({
        match: /^UPDATE\s+InventoryItem\b.*SET\s+stock\s*=\s*stock\s*\+\s*\?/i,
        faultName: 'retry-fault',
        method: 'run',
      });

      try {
        await service.stockAction({
          itemId: 'item-001',
          type: 'IN',
          quantity: 20,
        });
      } catch {
        // 第一次失败
      }

      try {
        await service.stockAction({
          itemId: 'item-001',
          type: 'IN',
          quantity: 20,
        });
      } catch {
        // 第二次失败
      }

      const itemBefore = getInventoryItem('item-001');
      expect(itemBefore?.stock).toBe(100);

      const result = await service.stockAction({
        itemId: 'item-001',
        type: 'IN',
        quantity: 20,
      });

      expect(result).toBeDefined();
      const itemAfter = getInventoryItem('item-001');
      expect(itemAfter?.stock).toBe(120);
      expect(getTransactionCount()).toBe(1);
      expect(getAuditLogCount()).toBe(1);
    });
  });
});
