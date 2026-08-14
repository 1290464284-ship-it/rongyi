// InventoryService 模块化 spec：自 services.spec.ts / services-edge.spec.ts
// （聚合文件）迁移而来。迁移约定：聚合文件按模块逐步拆出后删除（迁移前保持聚合）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { InventoryService } from './inventory-service';
import { StocktakeService } from './stocktake';
import type { AppContext } from '../../../domain/contracts';

describe('InventoryService', () => {
  let db: Database.Database;
  let dataDir: string;
  let context: AppContext;

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-inventory-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
    context = {
      userId: 'user-admin-001',
      clinicId: 'clinic-v2-001',
      role: 'BOSS',
      traceId: 'test-trace',
      now: () => new Date(),
    };
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('rejects a stock decrease below zero', async () => {
    const service = new InventoryService(db);
    await expect(
      service.createTransaction({ itemId: 'inventory-demo-001', type: 'OUT', quantity: 10_000 }, context),
    ).rejects.toThrow('Insufficient stock');
  });

  // ---- 边缘分支测试（自 services-edge.spec.ts 聚合文件迁移，相对顺序保留）----

  it('covers inventory transaction and stock branches', async () => {
    const service = new InventoryService(db);
    await expect(service.createTransaction({ itemId: 'x', type: 'BAD' as 'OUT', quantity: 1 }, context))
      .rejects.toThrow('IN, OUT, or ADJUST');
    await expect(service.createTransaction({ itemId: 'x', type: 'IN', quantity: 0 }, context))
      .rejects.toThrow('non-zero');
    await expect(service.createTransaction({ itemId: 'x', type: 'OUT', quantity: -1 }, context))
      .rejects.toThrow('must be positive');
    await expect(service.createTransaction({ itemId: 'missing-item', type: 'OUT', quantity: 1 }, context)).rejects.toThrow('Inventory item not found');
    const insertNow = new Date().toISOString();
    db.prepare(
      `INSERT INTO InventoryItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, category, unit, stock, minStock, price
       ) VALUES (?, ?, ?, ?, NULL, 'EDGE-ITEM', 'Edge Item', 'MAT', 'box', 10, 1, 100)`,
    ).run('inventory-edge', context.clinicId, insertNow, insertNow);
    await expect(service.createTransaction({ itemId: 'inventory-edge', type: 'OUT', quantity: 20 }, context)).rejects.toThrow('Insufficient stock');
    const input = await service.createTransaction({ itemId: 'inventory-edge', type: 'IN', quantity: 5 }, context);
    expect(input.afterStock).toBe(15);
    await service.createTransaction({ itemId: 'inventory-edge', type: 'ADJUST', quantity: -2 }, context);
    db.prepare(
      `INSERT INTO InventoryItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, category, unit, stock, minStock, price
       ) VALUES (?, ?, ?, ?, NULL, 'LOW-EDGE', 'Low Edge', 'MAT', 'box', 1, 5, 100)`,
    ).run('inventory-low-edge', context.clinicId, insertNow, insertNow);
    db.prepare(
      `INSERT INTO InventoryItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, category, unit, stock, minStock, price
       ) VALUES (?, ?, ?, ?, NULL, NULL, NULL, 'SEARCHCAT', 'box', 1, 0, 100)`,
    ).run('inventory-null-label', context.clinicId, insertNow, insertNow);
    expect(service.lowStock(context).items).toBeInstanceOf(Array);
  });

  it('rejects inventory transactions above the allowed quantity bound', async () => {
    const service = new InventoryService(db);
    await expect(service.createTransaction({ itemId: 'inventory-demo-001', type: 'IN', quantity: 1_000_000_001 }, context))
      .rejects.toThrow('exceeds the allowed upper bound');
  });

  it('throws NotFoundError when an item vanishes between adjust and re-read', async () => {
    const service = new InventoryService(db);
    const insertNow = new Date().toISOString();
    db.prepare(
      `INSERT INTO InventoryItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, category, unit, stock, minStock, price
       ) VALUES (?, ?, ?, ?, NULL, 'VANISH-ITEM', 'Vanishing Item', 'MAT', 'box', 10, 1, 100)`,
    ).run('inventory-vanish', context.clinicId, insertNow, insertNow);
    const originalPrepare = db.prepare.bind(db);
    let selectCalls = 0;
    vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      if (sql.includes('SELECT') && sql.includes('FROM InventoryItem')) {
        selectCalls += 1;
        if (selectCalls === 2) {
          return { get: () => undefined } as never;
        }
      }
      return originalPrepare(sql);
    });
    try {
      await expect(service.createTransaction({ itemId: 'inventory-vanish', type: 'IN', quantity: 1 }, context))
        .rejects.toThrow('Inventory item not found');
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('lists low-stock items with a null clinic scope', () => {
    const service = new InventoryService(db);
    expect(service.lowStock({ ...context, clinicId: null }).items).toBeInstanceOf(Array);
  });

  it('blocks stock transactions for items under a locked stocktake and releases after completion', async () => {
    const stocktakes = new StocktakeService(db);
    const guarded = new InventoryService(db, undefined, undefined, (itemId, clinicId) => stocktakes.assertNotLocked(itemId, clinicId));
    const insertNow = new Date().toISOString();
    db.prepare(
      `INSERT INTO InventoryItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, category, unit, stock, minStock, price
       ) VALUES (?, ?, ?, ?, NULL, 'LOCK-ITEM', 'Locked Item', 'MAT', 'box', 10, 1, 100)`,
    ).run('inventory-lock-guard', context.clinicId, insertNow, insertNow);
    const stocktake = stocktakes.start({ number: 'ST-GUARD-1' }, context);
    // 盘点 IN_PROGRESS 即冻结，避免完成时覆盖盘点期间发生的库存变动
    await expect(guarded.createTransaction({ itemId: 'inventory-lock-guard', type: 'IN', quantity: 1 }, context))
      .rejects.toThrow('库存盘点进行中');
    stocktakes.lock(String(stocktake.id), context);
    await expect(guarded.createTransaction({ itemId: 'inventory-lock-guard', type: 'OUT', quantity: 1 }, context))
      .rejects.toThrow('库存盘点进行中');
    // 未带守卫的服务不受影响（路由层守卫由调用方注入）
    const unguarded = new InventoryService(db);
    await unguarded.createTransaction({ itemId: 'inventory-lock-guard', type: 'OUT', quantity: 1 }, context);
    // 完成盘点后放行
    stocktakes.complete(String(stocktake.id), context);
    const after = await guarded.createTransaction({ itemId: 'inventory-lock-guard', type: 'OUT', quantity: 1 }, context);
    expect(after.afterStock).toBe(8);
  });
});
