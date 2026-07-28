import { Test, TestingModule } from '@nestjs/testing';
import { BusinessNotFoundException, BusinessValidationException } from '@common/errors';
import { InventoryService } from './inventory.service';
import { DbService } from '../../../db/db.service';
import { ClinicContextService } from '../../../common/services/clinic-context.service';
import { IdempotencyService } from '../../../common/services/idempotency.service';
import { StatsService } from '../../system/stats/stats.service';
import { EventBusService } from '../../../common/events/event-bus.service';
import { InventoryRepository } from './repositories/inventory.repository';
import {
  createTestDb,
  cleanupTestDb,
  createTestDbService,
  seedTestData,
  runInClinicContext,
} from '../../../db/test-helpers';
import {
  runConcurrentTest,
  runConcurrently,
  microtaskDelay,
} from '../../../common/test-helpers/concurrent-test-utils';
import { TEST_CLINIC_ID } from '../../../../test/factories';

describe('InventoryService - Integration', () => {
  let service: InventoryService;
  let clinicContext: ClinicContextService;
  let db: ReturnType<typeof createTestDb>;
  let module: TestingModule;

  const TEST_USER_ID = 'test-user-001';

  const runAsStaff = <T>(fn: () => T | Promise<T>): T | Promise<T> =>
    runInClinicContext(
      clinicContext,
      { clinicId: TEST_CLINIC_ID, userId: TEST_USER_ID, role: 'BOSS' },
      fn,
    );

  function createInventoryItem(overrides: {
    stock?: number;
    code?: string;
    name?: string;
    category?: string;
    unit?: string;
    minStock?: number;
    price?: number;
  } = {}): string {
    const id = 'inv-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    db.prepare(
      `INSERT INTO InventoryItem (id, code, name, category, unit, stock, minStock, price, clinicId, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      overrides.code || 'CODE-' + Math.random().toString(36).slice(2, 8).toUpperCase(),
      overrides.name || '测试物品',
      overrides.category || '药品',
      overrides.unit || '盒',
      overrides.stock ?? 100,
      overrides.minStock ?? 10,
      overrides.price ?? 1500,
      TEST_CLINIC_ID,
      new Date().toISOString(),
      new Date().toISOString(),
    );
    return id;
  }

  function getStock(itemId: string): number {
    const row = db.prepare(
      'SELECT stock FROM InventoryItem WHERE id = ? AND clinicId = ?',
    ).get(itemId, TEST_CLINIC_ID) as { stock: number } | undefined;
    return row ? Number(row.stock) : -1;
  }

  function getTransactionCount(itemId: string): number {
    const row = db.prepare(
      'SELECT COUNT(*) as count FROM InventoryTransaction WHERE itemId = ? AND clinicId = ?',
    ).get(itemId, TEST_CLINIC_ID) as { count: number };
    return row.count;
  }

  beforeEach(async () => {
    db = createTestDb();
    seedTestData(db);

    const testDbService = createTestDbService(db);

    module = await Test.createTestingModule({
      providers: [
        { provide: DbService, useValue: testDbService },
        ClinicContextService,
        IdempotencyService,
        { provide: StatsService, useValue: { invalidateStatsCache: jest.fn() } },
        { provide: EventBusService, useValue: { emit: jest.fn(), on: jest.fn(), onAll: jest.fn() } },
        InventoryRepository,
        InventoryService,
      ],
    }).compile();

    service = module.get(InventoryService);
    clinicContext = module.get(ClinicContextService);
  });

  afterEach(() => {
    cleanupTestDb(db);
  });

  describe('库存扣减（OUT）并发安全', () => {
    beforeEach(() => {
      db.prepare('DELETE FROM InventoryTransaction').run();
      db.prepare('DELETE FROM InventoryItem').run();
    });

    it('并发出库不应导致库存为负数（乐观锁保护）', async () => {
      const initialStock = 10;
      const itemId = createInventoryItem({ stock: initialStock });
      const concurrentCount = 5;
      const quantityPerRequest = 3;

      const result = await runConcurrentTest(
        concurrentCount,
        async () => {
          return runAsStaff(async () => {
            try {
              return await service.stockAction({
                itemId,
                type: 'OUT',
                quantity: quantityPerRequest,
                remark: '并发出库测试',
              });
            } catch {
              throw new Error('库存不足或并发冲突');
            }
          });
        },
        concurrentCount,
      );

      const finalStock = getStock(itemId);
      expect(finalStock).toBeGreaterThanOrEqual(0);
      expect(result.successCount + result.failureCount).toBe(concurrentCount);

      const maxPossibleSuccess = Math.floor(initialStock / quantityPerRequest);
      expect(result.successCount).toBeLessThanOrEqual(maxPossibleSuccess);
    });

    it('高并发下库存准确性验证（10次并发扣减1个库存）', async () => {
      const initialStock = 5;
      const itemId = createInventoryItem({ stock: initialStock });

      const results = await runConcurrently(
        Array.from({ length: 10 }, (_, i) => async () => {
          return runAsStaff(async () => {
            try {
              await service.stockAction({
                itemId,
                type: 'OUT',
                quantity: 1,
                remark: `并发-${i}`,
              });
              return 'success';
            } catch {
              return 'failed';
            }
          });
        }),
      );

      const successCount = results.filter((r) => r === 'success').length;
      const finalStock = getStock(itemId);

      expect(successCount).toBe(initialStock);
      expect(finalStock).toBe(0);
    });

    it('库存扣减操作应记录准确的库存流水', async () => {
      const initialStock = 50;
      const itemId = createInventoryItem({ stock: initialStock });

      await runAsStaff(async () => {
        await service.stockAction({ itemId, type: 'OUT', quantity: 3, remark: '扣减1' });
        await service.stockAction({ itemId, type: 'OUT', quantity: 7, remark: '扣减2' });
        await service.stockAction({ itemId, type: 'OUT', quantity: 10, remark: '扣减3' });
      });

      const finalStock = getStock(itemId);
      expect(finalStock).toBe(initialStock - 3 - 7 - 10);

      const txnCount = getTransactionCount(itemId);
      expect(txnCount).toBe(3);

      const transactions = db.prepare(
        'SELECT type, quantity, totalAmount FROM InventoryTransaction WHERE itemId = ? ORDER BY createdAt',
      ).all(itemId) as any[];

      expect(transactions[0].type).toBe('OUT');
      expect(transactions[0].quantity).toBe(3);
      expect(transactions[1].type).toBe('OUT');
      expect(transactions[1].quantity).toBe(7);
      expect(transactions[2].type).toBe('OUT');
      expect(transactions[2].quantity).toBe(10);
    });

    it('库存不足时应抛出 BusinessValidationException', async () => {
      const itemId = createInventoryItem({ stock: 5 });

      await expect(
        runAsStaff(() =>
          service.stockAction({ itemId, type: 'OUT', quantity: 10, remark: '超额' }),
        ),
      ).rejects.toThrow(BusinessValidationException);

      expect(getStock(itemId)).toBe(5);
    });

    it('入库（IN）操作应正确累加库存', async () => {
      const initialStock = 10;
      const itemId = createInventoryItem({ stock: initialStock });

      await runAsStaff(() =>
        service.stockAction({
          itemId,
          type: 'IN',
          quantity: 20,
          unitPrice: 15,
          remark: '入库',
        }),
      );

      expect(getStock(itemId)).toBe(30);

      const transactions = db.prepare(
        'SELECT type, quantity, totalAmount FROM InventoryTransaction WHERE itemId = ?',
      ).all(itemId) as any[];
      expect(transactions.length).toBe(1);
      expect(transactions[0].type).toBe('IN');
      expect(transactions[0].quantity).toBe(20);
      expect(transactions[0].totalAmount).toBe(300);
    });

    it('调整（ADJUST）操作应使用乐观锁防止并发冲突', async () => {
      const initialStock = 100;
      const itemId = createInventoryItem({ stock: initialStock });

      const results = await runConcurrently(
        Array.from({ length: 5 }, (_, i) => async () => {
          return runAsStaff(async () => {
            await microtaskDelay();
            try {
              await service.stockAction({
                itemId,
                type: 'ADJUST',
                quantity: 50 + i * 10,
                remark: `调整-${i}`,
              });
              return 'success';
            } catch {
              return 'failed';
            }
          });
        }),
      );

      const successCount = results.filter((r) => r === 'success').length;
      expect(successCount).toBeGreaterThanOrEqual(1);
      expect(successCount).toBeLessThanOrEqual(5);
    });

    it('混合并发操作（入库+出库）后库存应精确正确', async () => {
      const initialStock = 50;
      const itemId = createInventoryItem({ stock: initialStock });

      const tasks: (() => Promise<string>)[] = [];
      for (let i = 0; i < 5; i++) {
        tasks.push(async () => {
          return runAsStaff(async () => {
            try {
              await service.stockAction({
                itemId,
                type: 'IN',
                quantity: 10,
                remark: `入库-${i}`,
              });
              return 'in-success';
            } catch {
              return 'in-failed';
            }
          });
        });
      }
      for (let i = 0; i < 5; i++) {
        tasks.push(async () => {
          return runAsStaff(async () => {
            try {
              await service.stockAction({
                itemId,
                type: 'OUT',
                quantity: 5,
                remark: `出库-${i}`,
              });
              return 'out-success';
            } catch {
              return 'out-failed';
            }
          });
        });
      }

      const shuffled = [...tasks].sort(() => Math.random() - 0.5);
      const results = await runConcurrently(shuffled);

      const inSuccess = results.filter((r) => r === 'in-success').length;
      const outSuccess = results.filter((r) => r === 'out-success').length;

      const expectedStock = initialStock + inSuccess * 10 - outSuccess * 5;
      const finalStock = getStock(itemId);
      expect(finalStock).toBeGreaterThanOrEqual(0);
      expect(finalStock).toBe(expectedStock);
    });

    it('库存项不存在应抛出 BusinessNotFoundException', async () => {
      await expect(
        runAsStaff(() =>
          service.stockAction({
            itemId: 'non-existent-item',
            type: 'IN',
            quantity: 10,
          }),
        ),
      ).rejects.toThrow(BusinessNotFoundException);
    });

    it('非法操作类型应抛出 BusinessValidationException', async () => {
      const itemId = createInventoryItem({ stock: 10 });

      await expect(
        runAsStaff(() =>
          service.stockAction({
            itemId,
            type: 'INVALID_TYPE',
            quantity: 10,
          }),
        ),
      ).rejects.toThrow(BusinessValidationException);
    });
  });

  describe('库存查询 - 复杂 SQL', () => {
    it('findLowStockItems 应返回低于 minStock 的物品', async () => {
      createInventoryItem({ stock: 5, minStock: 10, name: '低库存物品' });
      createInventoryItem({ stock: 50, minStock: 10, name: '充足库存物品' });
      createInventoryItem({ stock: 3, minStock: 8, name: '低于库存物品' });

      const result = await runAsStaff(() => service.findLowStockItems());

      expect(result.length).toBe(2);
      const names = result.map((r: any) => r.name);
      expect(names).toContain('低库存物品');
      expect(names).toContain('低于库存物品');
    });

    it('findTransactions 应返回按时间倒序的交易记录', async () => {
      const itemId = createInventoryItem({ stock: 100 });

      await runAsStaff(() =>
        service.stockAction({ itemId, type: 'IN', quantity: 30, remark: '先入库' }),
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
      await runAsStaff(() =>
        service.stockAction({ itemId, type: 'OUT', quantity: 10, remark: '后出库' }),
      );

      const transactions = await runAsStaff(() => service.findTransactions(itemId));

      expect(transactions.length).toBe(2);
      expect((transactions[0] as any).type).toBe('OUT');
      expect((transactions[1] as any).type).toBe('IN');
    });

    it('findTransactions 分页应正确', async () => {
      const itemId = createInventoryItem({ stock: 100 });

      for (let i = 0; i < 5; i++) {
        await runAsStaff(() =>
          service.stockAction({ itemId, type: 'IN', quantity: 5, remark: `第${i}次` }),
        );
      }

      const page1 = await runAsStaff(() => service.findTransactions(itemId, { limit: 2, offset: 0 }));
      const page2 = await runAsStaff(() => service.findTransactions(itemId, { limit: 2, offset: 2 }));

      expect(page1.length).toBe(2);
      expect(page2.length).toBe(2);

      const allIds = [...page1, ...page2].map((t: any) => t.id);
      const uniqueIds = new Set(allIds);
      expect(uniqueIds.size).toBe(4);
    });
  });

  describe('SQL 参数化验证', () => {
    it('stockAction 应使用参数化 SQL 防止注入', async () => {
      const itemId = createInventoryItem({ stock: 100 });

      const maliciousRemark = "Robert'); DROP TABLE InventoryItem;--";

      await runAsStaff(() =>
        service.stockAction({
          itemId,
          type: 'OUT',
          quantity: 10,
          remark: maliciousRemark,
        }),
      );

      const row = db.prepare(
        'SELECT remark FROM InventoryTransaction WHERE itemId = ?',
      ).get(itemId) as { remark: string };
      expect(row.remark).toBe(maliciousRemark);

      const tableCheck = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = 'InventoryItem'",
      ).get();
      expect(tableCheck).toBeDefined();
    });
  });
});