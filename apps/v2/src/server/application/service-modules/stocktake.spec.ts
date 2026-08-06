import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { ConflictError, NotFoundError, ValidationError } from '../../infrastructure/errors';
import type { AppContext } from '../../../domain/contracts';
import { StocktakeService } from './stocktake';

describe('StocktakeService', () => {
  let db: Database.Database;
  let dataDir: string;
  let service: StocktakeService;
  let context: AppContext;
  const now = '2026-08-05T10:00:00.000Z';

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-stocktake-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
    service = new StocktakeService(db);
    context = {
      userId: 'user-admin-001',
      clinicId: 'clinic-v2-001',
      role: 'BOSS',
      traceId: 'test',
      now: () => new Date(now),
    };
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  // 每个用例从干净状态出发：清空盘点相关表与流水（库存流水仅盘点用例写入）。
  beforeEach(() => {
    db.prepare('DELETE FROM StocktakeItem').run();
    db.prepare('DELETE FROM Stocktake').run();
    db.prepare('DELETE FROM InventoryTransaction').run();
  });

  function insertItem(id: string, code: string, name: string, stock: number, clinicId = 'clinic-v2-001'): void {
    db.prepare(
      `INSERT INTO InventoryItem (id, clinicId, createdAt, updatedAt, deletedAt, code, name, category, unit, stock, minStock, price)
       VALUES (?, ?, ?, ?, NULL, ?, ?, 'CONSUMABLE', 'box', ?, 0, 1000)`,
    ).run(id, clinicId, now, now, code, name, stock);
  }

  it('start：生成盘点单与全部物品明细快照（systemStock=当前库存），重复单号与进行中互斥', () => {
    insertItem('stock-item-a', 'ST-A', '物品A', 100);
    insertItem('stock-item-b', 'ST-B', '物品B', 7);

    const result = service.start({ number: 'PD-2026-001', note: '月度盘点' }, context);
    expect(result).toMatchObject({ number: 'PD-2026-001', status: 'IN_PROGRESS', itemCount: 3 }); // 种子 1 件 + 新造 2 件

    const stocktake = db.prepare('SELECT * FROM Stocktake WHERE id = ?').get(String(result.id)) as Record<string, unknown>;
    expect(stocktake.status).toBe('IN_PROGRESS');
    expect(stocktake.startedById).toBe('user-admin-001');
    expect(stocktake.startedAt).toBe(now);
    expect(stocktake.note).toBe('月度盘点');

    const items = db.prepare(
      `SELECT si.itemId, si.systemStock, si.countedStock, si.difference, i.name
       FROM StocktakeItem si JOIN InventoryItem i ON i.id = si.itemId
       WHERE si.stocktakeId = ? ORDER BY si.itemId`,
    ).all(String(result.id)) as Array<{ itemId: string; systemStock: number; countedStock: number | null; difference: number; name: string }>;
    expect(items).toHaveLength(3);
    const byName = Object.fromEntries(items.map((row) => [row.name, row]));
    expect(byName['Dental Material'].systemStock).toBe(100);
    expect(byName['物品A'].systemStock).toBe(100);
    expect(byName['物品B'].systemStock).toBe(7);
    for (const row of items) {
      expect(row.countedStock).toBeNull();
      expect(row.difference).toBe(0);
    }

    // 同单号重复开始 → ConflictError
    expect(() => service.start({ number: 'PD-2026-001' }, context)).toThrow(ConflictError);
    // 已有 IN_PROGRESS 再开始 → ConflictError
    expect(() => service.start({ number: 'PD-2026-002' }, context)).toThrow(ConflictError);
  });

  it('start：单号为空 → ValidationError，且不生成任何盘点单', () => {
    expect(() => service.start({ number: '   ' }, context)).toThrow(ValidationError);
    expect(db.prepare('SELECT COUNT(*) AS c FROM Stocktake').get()).toEqual({ c: 0 });
  });

  it('recordCount：差异 = 实盘 - 系统库存；非法数量 ValidationError；非 IN_PROGRESS 录入 ConflictError', () => {
    insertItem('stock-item-c', 'ST-C', '物品C', 10);
    const { id } = service.start({ number: 'PD-2026-003' }, context);

    expect(() => service.recordCount(String(id), 'stock-item-c', -1, context)).toThrow(ValidationError);
    expect(() => service.recordCount(String(id), 'stock-item-c', 5.5, context)).toThrow(ValidationError);
    expect(() => service.recordCount(String(id), 'stock-item-c', '5' as unknown as number, context)).toThrow(ValidationError);

    const recorded = service.recordCount(String(id), 'stock-item-c', 13, context);
    expect(recorded).toMatchObject({ systemStock: 10, countedStock: 13, difference: 3 });
    const row = db.prepare('SELECT countedStock, difference FROM StocktakeItem WHERE stocktakeId = ? AND itemId = ?')
      .get(String(id), 'stock-item-c') as { countedStock: number; difference: number };
    expect(row).toEqual({ countedStock: 13, difference: 3 });

    service.lock(String(id), context);
    expect(() => service.recordCount(String(id), 'stock-item-c', 9, context)).toThrow(ConflictError);
  });

  it('lock→complete：差异写回库存并生成 ADJUST 流水，盘点单置 COMPLETED', () => {
    insertItem('stock-item-d', 'ST-D', '物品D', 10);
    insertItem('stock-item-e', 'ST-E', '物品E', 8);
    const { id } = service.start({ number: 'PD-2026-004' }, context);

    service.recordCount(String(id), 'stock-item-d', 15, context); // +5
    service.recordCount(String(id), 'stock-item-e', 5, context); // -3

    const locked = service.lock(String(id), context);
    expect(locked).toEqual({ id, status: 'LOCKED' });

    const completed = service.complete(String(id), context);
    expect(completed).toMatchObject({ id, status: 'COMPLETED', adjustedCount: 2 });
    const completedItems = completed.items as Array<Record<string, unknown>>;
    expect(completedItems).toHaveLength(2);
    expect(completedItems.find((row) => row.itemId === 'stock-item-d')).toMatchObject({
      name: '物品D', systemStock: 10, countedStock: 15, difference: 5,
    });
    expect(completedItems.find((row) => row.itemId === 'stock-item-e')).toMatchObject({
      name: '物品E', systemStock: 8, countedStock: 5, difference: -3,
    });

    const stocktake = db.prepare('SELECT status, completedById, completedAt FROM Stocktake WHERE id = ?').get(String(id)) as Record<string, unknown>;
    expect(stocktake).toEqual({ status: 'COMPLETED', completedById: 'user-admin-001', completedAt: now });

    const d = db.prepare('SELECT stock FROM InventoryItem WHERE id = ?').get('stock-item-d') as { stock: number };
    const e = db.prepare('SELECT stock FROM InventoryItem WHERE id = ?').get('stock-item-e') as { stock: number };
    expect(d.stock).toBe(15);
    expect(e.stock).toBe(5);

    const txs = db.prepare(
      'SELECT itemId, type, quantity, beforeStock, afterStock, operatorId, remark FROM InventoryTransaction ORDER BY itemId',
    ).all() as Array<Record<string, unknown>>;
    expect(txs).toHaveLength(2);
    expect(txs[0]).toEqual({
      itemId: 'stock-item-d', type: 'ADJUST', quantity: 5, beforeStock: 10, afterStock: 15,
      operatorId: 'user-admin-001', remark: '盘点差异调整',
    });
    expect(txs[1]).toEqual({
      itemId: 'stock-item-e', type: 'ADJUST', quantity: -3, beforeStock: 8, afterStock: 5,
      operatorId: 'user-admin-001', remark: '盘点差异调整',
    });
  });

  it('complete：仅 LOCKED 可完成；无差异时库存不变且无流水', () => {
    insertItem('stock-item-f', 'ST-F', '物品F', 4);
    const { id } = service.start({ number: 'PD-2026-005' }, context);
    expect(() => service.complete(String(id), context)).toThrow(ConflictError); // IN_PROGRESS 直接完成

    service.lock(String(id), context);
    const completed = service.complete(String(id), context);
    expect(completed).toMatchObject({ adjustedCount: 0, items: [] });
    expect((db.prepare('SELECT stock FROM InventoryItem WHERE id = ?').get('stock-item-f') as { stock: number }).stock).toBe(4);
    expect((db.prepare('SELECT COUNT(*) AS c FROM InventoryTransaction').get() as { c: number }).c).toBe(0);
    // 重复完成 → ConflictError
    expect(() => service.complete(String(id), context)).toThrow(ConflictError);
  });

  it('cancel：IN_PROGRESS 与 LOCKED 均可取消，COMPLETED 不能取消', () => {
    insertItem('stock-item-g', 'ST-G', '物品G', 2);
    const first = service.start({ number: 'PD-2026-006' }, context);
    expect(service.cancel(String(first.id), context)).toEqual({ id: first.id, status: 'CANCELLED' });

    const second = service.start({ number: 'PD-2026-007' }, context);
    service.lock(String(second.id), context);
    expect(service.cancel(String(second.id), context)).toEqual({ id: second.id, status: 'CANCELLED' });
    const cancelled = db.prepare('SELECT status FROM Stocktake WHERE id = ?').get(String(second.id)) as { status: string };
    expect(cancelled.status).toBe('CANCELLED');

    const third = service.start({ number: 'PD-2026-008' }, context);
    service.lock(String(third.id), context);
    service.complete(String(third.id), context);
    expect(() => service.cancel(String(third.id), context)).toThrow(ConflictError);
  });

  it('assertNotLocked / lockedItemIds：锁定期间拦截，完成或取消后放行', () => {
    insertItem('stock-item-h', 'ST-H', '物品H', 6);
    insertItem('stock-item-i', 'ST-I', '物品I', 6);
    const { id } = service.start({ number: 'PD-2026-009' }, context);

    service.assertNotLocked('stock-item-h', context.clinicId); // 未锁定不抛

    service.lock(String(id), context);
    // 盘点单快照覆盖该租户全部在库物品，锁定后全部进入锁定集合
    const allItemIds = (db.prepare(
      'SELECT id FROM InventoryItem WHERE deletedAt IS NULL AND clinicId = ?',
    ).all('clinic-v2-001') as Array<{ id: string }>).map((row) => row.id).sort();
    expect(service.lockedItemIds(context.clinicId).sort()).toEqual(allItemIds);
    expect(() => service.assertNotLocked('stock-item-h', context.clinicId)).toThrow(ConflictError);
    expect(() => service.assertNotLocked('stock-item-h', context.clinicId)).toThrow('库存盘点锁定中');

    service.complete(String(id), context);
    expect(service.lockedItemIds(context.clinicId)).toEqual([]);
    service.assertNotLocked('stock-item-h', context.clinicId); // 完成后放行
  });

  it('租户隔离：他租户盘点单不可见、不可操作', () => {
    insertItem('stock-item-j', 'ST-J', '物品J', 3);
    const { id } = service.start({ number: 'PD-2026-010' }, context);

    // 直接构造他租户盘点单
    db.prepare(
      `INSERT INTO Stocktake (id, number, status, startedById, startedAt, clinicId, createdAt, updatedAt, deletedAt)
       VALUES ('st-other-1', 'PD-OTHER-1', 'IN_PROGRESS', 'user-other', ?, 'clinic-other-001', ?, ?, NULL)`,
    ).run(now, now, now);
    db.prepare(
      `INSERT INTO StocktakeItem (id, stocktakeId, itemId, systemStock, countedStock, difference, clinicId, createdAt, updatedAt, deletedAt)
       VALUES ('sti-other-1', 'st-other-1', 'stock-item-j', 3, NULL, 0, 'clinic-other-001', ?, ?, NULL)`,
    ).run(now, now);

    const list = service.list(context);
    expect(list.map((row) => row.number)).toEqual(['PD-2026-010']);
    expect(list.some((row) => row.id === 'st-other-1')).toBe(false);

    expect(() => service.recordCount('st-other-1', 'stock-item-j', 9, context)).toThrow(NotFoundError);
    expect(() => service.lock('st-other-1', context)).toThrow(NotFoundError);
    expect(() => service.complete('st-other-1', context)).toThrow(NotFoundError);
    expect(() => service.cancel('st-other-1', context)).toThrow(NotFoundError);
    expect(() => service.items('st-other-1', context)).toThrow(NotFoundError);
  });

  it('list：携带 itemCount 与 differenceCount，按创建时间倒序', () => {
    insertItem('stock-item-k', 'ST-K', '物品K', 9);
    const first = service.start({ number: 'PD-2026-011' }, context);
    service.cancel(String(first.id), context);

    const laterContext = { ...context, now: () => new Date('2026-08-05T11:00:00.000Z') };
    const second = service.start({ number: 'PD-2026-012' }, laterContext);
    service.recordCount(String(second.id), 'stock-item-k', 11, context);

    const list = service.list(context);
    expect(list.map((row) => row.number)).toEqual(['PD-2026-012', 'PD-2026-011']);
    // itemCount = 该租户全部在库物品数（跨用例累积），动态计算
    const totalItems = (db.prepare(
      'SELECT COUNT(*) AS c FROM InventoryItem WHERE deletedAt IS NULL AND clinicId = ?',
    ).get('clinic-v2-001') as { c: number }).c;
    expect(list[0]).toMatchObject({ status: 'IN_PROGRESS', itemCount: totalItems, differenceCount: 1 });
    expect(list[1]).toMatchObject({ status: 'CANCELLED', itemCount: totalItems, differenceCount: 0 });

    const items = service.items(String(second.id), context);
    const k = items.find((row) => row.itemId === 'stock-item-k');
    expect(k).toMatchObject({ systemStock: 9, countedStock: 11, difference: 2, name: '物品K', code: 'ST-K' });
  });
});
