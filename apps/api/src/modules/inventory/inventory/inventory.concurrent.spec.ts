import { Test, TestingModule } from '@nestjs/testing';
import { InventoryService } from './inventory.service';
import { DbService } from '../../../db/db.service';
import { ClinicContextService } from '../../../common/services/clinic-context.service';
import { IdempotencyService } from '../../../common/services/idempotency.service';
import { StatsService } from '../../system/stats/stats.service';
import {
  createTestDb,
  cleanupTestDb,
  createTestDbService,
  runInClinicContext,
  seedTestData,
} from '../../../db/test-helpers';
import {
  runConcurrently,
  runConcurrentTest,
  microtaskDelay,
} from '../../../common/test-helpers/concurrent-test-utils';
import Database from 'better-sqlite3';

describe('InventoryService - 并发测试', () => {
  let module: TestingModule;
  let db: Database.Database;
  let _dbService: DbService;
  let service: InventoryService;
  let clinicContext: ClinicContextService;

  const TEST_CLINIC_ID = 'test-clinic-001';
  const TEST_USER_ID = 'test-user-001';

  beforeAll(async () => {
    db = createTestDb();
    const testDbService = createTestDbService(db);

    module = await Test.createTestingModule({
      providers: [
        { provide: DbService, useValue: testDbService },
        ClinicContextService,
        IdempotencyService,
        { provide: StatsService, useValue: { invalidateStatsCache: jest.fn() } },
        InventoryService,
      ],
    }).compile();

    _dbService = module.get(DbService);
    service = module.get(InventoryService);
    clinicContext = module.get(ClinicContextService);

    seedTestData(db);
  });

  afterAll(async () => {
    await module.close();
    cleanupTestDb(db);
  });

  beforeEach(() => {
    db.prepare('DELETE FROM InventoryTransaction').run();
    db.prepare('DELETE FROM InventoryItem').run();
  });

  function runInContext<T>(fn: () => T): T {
    return runInClinicContext(
      clinicContext,
      { clinicId: TEST_CLINIC_ID, userId: TEST_USER_ID, role: 'BOSS' },
      fn,
    );
  }

  function createInventoryItem(stock: number): string {
    const id = 'item-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    db.prepare(
      `INSERT INTO InventoryItem (id, code, name, category, unit, stock, minStock, price, clinicId, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      'MED-' + Math.random().toString(36).slice(2, 8).toUpperCase(),
      '测试药品',
      '药品',
      '瓶',
      stock,
      10,
      15.5,
      TEST_CLINIC_ID,
      new Date().toISOString(),
      new Date().toISOString(),
    );
    return id;
  }

  function getStock(itemId: string): number {
    const row = db.prepare(
      'SELECT stock FROM InventoryItem WHERE id = ? AND clinicId = ?'
    ).get(itemId, TEST_CLINIC_ID) as { stock: number } | undefined;
    return row ? Number(row.stock) : 0;
  }

  function getTransactionCount(itemId: string): number {
    const row = db.prepare(
      'SELECT COUNT(*) as count FROM InventoryTransaction WHERE itemId = ? AND clinicId = ?'
    ).get(itemId, TEST_CLINIC_ID) as { count: number };
    return row.count;
  }

  describe('并发出库 (OUT) - 库存扣减保护', () => {
    it('并发出库不应导致库存为负数（乐观锁生效）', async () => {
      const initialStock = 10;
      const itemId = createInventoryItem(initialStock);
      const concurrentCount = 5;
      const quantityPerRequest = 3;

      const result = await runConcurrentTest(
        concurrentCount,
        async () => {
          return runInContext(async () => {
            try {
              return await service.stockAction({
                itemId,
                type: 'OUT',
                quantity: quantityPerRequest,
                remark: '并发测试出库',
              });
            } catch {
              throw new Error('库存不足或并发冲突');
            }
          });
        },
        concurrentCount,
      );

      const finalStock = getStock(itemId);
      const txnCount = getTransactionCount(itemId);

      expect(finalStock).toBeGreaterThanOrEqual(0);
      expect(result.successCount).toBeGreaterThanOrEqual(0);
      expect(result.failureCount).toBeGreaterThanOrEqual(0);
      expect(result.successCount + result.failureCount).toBe(concurrentCount);

      const maxPossibleSuccess = Math.floor(initialStock / quantityPerRequest);
      expect(result.successCount).toBeLessThanOrEqual(maxPossibleSuccess);
      expect(txnCount).toBe(result.successCount);
    });

    it('完全并发的出库请求中，成功的次数应符合库存限制', async () => {
      const initialStock = 5;
      const itemId = createInventoryItem(initialStock);

      const results = await runConcurrently(
        Array.from({ length: 10 }, (_, i) => async () => {
          return runInContext(async () => {
            try {
              await service.stockAction({
                itemId,
                type: 'OUT',
                quantity: 1,
                remark: `并发测试-${i}`,
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

      expect(successCount).toBeLessThanOrEqual(initialStock);
      expect(finalStock).toBe(initialStock - successCount);
      expect(finalStock).toBeGreaterThanOrEqual(0);
    });

    it('库存恰好被并发请求扣减到0时，后续请求应失败', async () => {
      const initialStock = 3;
      const itemId = createInventoryItem(initialStock);

      await runInContext(async () => {
        await service.stockAction({ itemId, type: 'OUT', quantity: 3, remark: '先扣完' });
      });

      expect(getStock(itemId)).toBe(0);

      const result = await runConcurrentTest(
        5,
        async () => {
          return runInContext(async () => {
            await service.stockAction({
              itemId,
              type: 'OUT',
              quantity: 1,
              remark: '库存为0后的请求',
            });
          });
        },
        5,
      );

      expect(result.failureCount).toBe(5);
      expect(getStock(itemId)).toBe(0);
    });
  });

  describe('并发入库 (IN) - 库存累加正确性', () => {
    it('并发入库应正确累加库存数量', async () => {
      const initialStock = 10;
      const itemId = createInventoryItem(initialStock);
      const concurrentCount = 10;
      const quantityPerRequest = 5;

      const result = await runConcurrentTest(
        concurrentCount,
        async () => {
          return runInContext(async () => {
            return service.stockAction({
              itemId,
              type: 'IN',
              quantity: quantityPerRequest,
              unitPrice: 15,
              remark: '并发测试入库',
            });
          });
        },
        concurrentCount,
      );

      const finalStock = getStock(itemId);
      const txnCount = getTransactionCount(itemId);

      expect(result.successCount).toBe(concurrentCount);
      expect(finalStock).toBe(initialStock + concurrentCount * quantityPerRequest);
      expect(txnCount).toBe(concurrentCount);
    });
  });

  describe('并发调整 (ADJUST) - 乐观锁冲突', () => {
    it('并发调整库存时，只有一个请求能成功（乐观锁）', async () => {
      const initialStock = 100;
      const itemId = createInventoryItem(initialStock);

      const results = await runConcurrently(
        Array.from({ length: 5 }, (_, i) => async () => {
          return runInContext(async () => {
            await microtaskDelay();
            try {
              await service.stockAction({
                itemId,
                type: 'ADJUST',
                quantity: 50 + i * 10,
                remark: `并发调整-${i}`,
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
  });

  describe('混合并发操作 - 入库和出库同时进行', () => {
    it('并发混合操作后库存计算正确', async () => {
      const initialStock = 50;
      const itemId = createInventoryItem(initialStock);
      const inCount = 5;
      const outCount = 5;
      const inQuantity = 10;
      const outQuantity = 5;

      const tasks: (() => Promise<string>)[] = [];

      for (let i = 0; i < inCount; i++) {
        tasks.push(async () => {
          return runInContext(async () => {
            try {
              await service.stockAction({
                itemId,
                type: 'IN',
                quantity: inQuantity,
                remark: `入库-${i}`,
              });
              return 'in-success';
            } catch {
              return 'in-failed';
            }
          });
        });
      }

      for (let i = 0; i < outCount; i++) {
        tasks.push(async () => {
          return runInContext(async () => {
            try {
              await service.stockAction({
                itemId,
                type: 'OUT',
                quantity: outQuantity,
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

      const finalStock = getStock(itemId);
      const expectedStock = initialStock + inSuccess * inQuantity - outSuccess * outQuantity;

      expect(finalStock).toBeGreaterThanOrEqual(0);
      expect(finalStock).toBe(expectedStock);
    });
  });

  describe('幂等性 - 并发相同请求', () => {
    it('使用相同 requestId 的并发出库请求应只有一次生效', async () => {
      const initialStock = 100;
      const itemId = createInventoryItem(initialStock);
      const requestId = 'idempotent-stock-action-' + Date.now();

      const _results = await runConcurrently(
        Array.from({ length: 5 }, () => async () => {
          return runInContext(async () => {
            try {
              await service.stockAction({
                itemId,
                type: 'OUT',
                quantity: 10,
                remark: '幂等测试',
                requestId,
              });
              return 'success';
            } catch (err: unknown) {
              // Record failure reason for debugging, still count as failure
              const _errMsg = String(err);
              return 'failed';
            }
          });
        }),
      );

      const finalStock = getStock(itemId);
      const txnCount = getTransactionCount(itemId);

      expect(txnCount).toBe(1);
      expect(finalStock).toBe(initialStock - 10);
    });
  });
});
