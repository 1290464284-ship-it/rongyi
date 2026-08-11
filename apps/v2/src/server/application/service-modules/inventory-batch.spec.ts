import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { ConflictError, NotFoundError, ValidationError } from '../../infrastructure/errors';
import type { AppContext } from '../../../domain/contracts';
import { InventoryBatchService } from './inventory-batch';

describe('InventoryBatchService', () => {
  let db: Database.Database;
  let dataDir: string;
  let context: AppContext;
  const now = '2026-08-05T10:00:00.000Z';

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-inventory-batch-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
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

  function insertItem(
    id: string,
    overrides: {
      code?: string;
      name?: string;
      stock?: number;
      batchManaged?: number;
      clinicId?: string;
    } = {},
  ): void {
    db.prepare(
      `INSERT INTO InventoryItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, category, unit, stock, minStock, price, batchManaged
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, 'CONSUMABLE', 'box', ?, 0, 100, ?)`,
    ).run(
      id,
      overrides.clinicId ?? 'clinic-v2-001',
      now,
      now,
      overrides.code ?? `CODE-${id}`,
      overrides.name ?? `物料-${id}`,
      overrides.stock ?? 0,
      overrides.batchManaged ?? 1,
    );
  }

  function insertBatch(
    id: string,
    overrides: {
      itemId?: string;
      batchNo?: string | null;
      expiryDate?: string | null;
      initialQuantity?: number;
      remainingQuantity?: number;
      active?: number;
      clinicId?: string;
      deletedAt?: string | null;
    } = {},
  ): void {
    db.prepare(
      `INSERT INTO InventoryBatch (
         id, itemId, batchNo, productionDate, expiryDate, initialQuantity,
         remainingQuantity, supplierId, purchaseOrderId, active, clinicId,
         createdAt, updatedAt, deletedAt
       ) VALUES (?, ?, ?, NULL, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      overrides.itemId ?? 'item-create',
      overrides.batchNo === undefined ? `B-${id}` : overrides.batchNo,
      overrides.expiryDate === undefined ? '2026-09-01' : overrides.expiryDate,
      overrides.initialQuantity ?? overrides.remainingQuantity ?? 0,
      overrides.remainingQuantity ?? overrides.initialQuantity ?? 0,
      overrides.active ?? 1,
      overrides.clinicId ?? 'clinic-v2-001',
      now,
      now,
      overrides.deletedAt === undefined ? null : overrides.deletedAt,
    );
  }

  function batchRow(id: string): Record<string, unknown> {
    const row = db.prepare('SELECT * FROM InventoryBatch WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) throw new Error(`batch ${id} not found`);
    return row;
  }

  it('creates a batch, increases item stock, and records an IN transaction with the batch id', () => {
    insertItem('item-create', { code: 'CREATE-001', name: '进口树脂', stock: 10, batchManaged: 1 });
    const service = new InventoryBatchService(db);
    const result = service.create({
      itemId: 'item-create',
      batchNo: 'B-2026-001',
      productionDate: '2026-07-01',
      expiryDate: '2026-09-01',
      initialQuantity: 5,
    }, context);
    expect(result).toEqual({
      id: expect.any(String),
      batchNo: 'B-2026-001',
      remainingQuantity: 5,
      stockAfter: 15,
    });

    const batch = batchRow(result.id);
    expect(batch.itemId).toBe('item-create');
    expect(batch.batchNo).toBe('B-2026-001');
    expect(batch.productionDate).toBe('2026-07-01');
    expect(batch.expiryDate).toBe('2026-09-01');
    expect(batch.initialQuantity).toBe(5);
    expect(batch.remainingQuantity).toBe(5);
    expect(batch.active).toBe(1);
    expect(batch.clinicId).toBe('clinic-v2-001');
    expect(batch.deletedAt).toBeNull();

    const item = db.prepare('SELECT stock FROM InventoryItem WHERE id = ?').get('item-create') as { stock: number };
    expect(item.stock).toBe(15);

    const tx = db.prepare(
      'SELECT * FROM InventoryTransaction WHERE batchId = ?',
    ).get(result.id) as Record<string, unknown>;
    expect(tx).toBeDefined();
    expect(tx.itemId).toBe('item-create');
    expect(tx.type).toBe('IN');
    expect(tx.quantity).toBe(5);
    expect(tx.beforeStock).toBe(10);
    expect(tx.afterStock).toBe(15);
    expect(tx.operatorId).toBe('user-admin-001');
    expect(tx.remark).toBe('批次入库');
    expect(tx.clinicId).toBe('clinic-v2-001');
  });

  it('rejects invalid initialQuantity, bad dates, and unknown items without side effects', () => {
    insertItem('item-invalid', { code: 'INVALID-001' });
    const service = new InventoryBatchService(db);
    const before = db.prepare('SELECT COUNT(*) AS n FROM InventoryBatch').get() as { n: number };
    expect(() => service.create({ itemId: 'item-invalid', initialQuantity: -1 }, context)).toThrow(ValidationError);
    expect(() => service.create({ itemId: 'item-invalid', initialQuantity: 1.5 }, context)).toThrow(ValidationError);
    expect(() => service.create({ itemId: 'item-invalid', initialQuantity: 2, expiryDate: '2026/09/01' }, context)).toThrow(ValidationError);
    expect(() => service.create({ itemId: 'item-invalid', initialQuantity: 2, productionDate: 'not-a-date' }, context)).toThrow(ValidationError);
    expect(() => service.create({ itemId: 'item-missing', initialQuantity: 2 }, context)).toThrow(NotFoundError);
    const after = db.prepare('SELECT COUNT(*) AS n FROM InventoryBatch').get() as { n: number };
    expect(after.n).toBe(before.n);
  });

  it('consumes FIFO across batches by expiry date and rolls back on insufficient stock', () => {
    insertItem('item-fifo', { code: 'FIFO-001', name: '正畸弓丝' });
    insertBatch('batch-fifo-early', { itemId: 'item-fifo', batchNo: 'EARLY', expiryDate: '2026-08-10', initialQuantity: 5, remainingQuantity: 5 });
    insertBatch('batch-fifo-late', { itemId: 'item-fifo', batchNo: 'LATE', expiryDate: '2026-09-10', initialQuantity: 10, remainingQuantity: 10 });
    const service = new InventoryBatchService(db);

    const result = service.consumeFifo('item-fifo', 7, context);
    expect(result).toEqual({
      allocations: [
        { batchId: 'batch-fifo-early', quantity: 5 },
        { batchId: 'batch-fifo-late', quantity: 2 },
      ],
      itemId: 'item-fifo',
    });
    expect(batchRow('batch-fifo-early').remainingQuantity).toBe(0);
    expect(batchRow('batch-fifo-late').remainingQuantity).toBe(8);

    insertBatch('batch-fifo-over-a', { itemId: 'item-fifo', batchNo: 'OVER-A', expiryDate: '2026-09-20', initialQuantity: 3, remainingQuantity: 3 });
    insertBatch('batch-fifo-over-b', { itemId: 'item-fifo', batchNo: 'OVER-B', expiryDate: '2026-09-30', initialQuantity: 2, remainingQuantity: 2 });
    expect(() => service.consumeFifo('item-fifo', 20, context)).toThrow(ConflictError);
    expect(() => service.consumeFifo('item-fifo', 20, context)).toThrow('批次库存不足');
    // 超量时整体回滚：不产生部分扣减
    expect(batchRow('batch-fifo-over-a').remainingQuantity).toBe(3);
    expect(batchRow('batch-fifo-over-b').remainingQuantity).toBe(2);
  });

  it('calls the stocktake lock guard while consuming FIFO', () => {
    insertItem('item-lock-fifo', { code: 'LOCK-FIFO' });
    insertBatch('batch-lock-fifo', { itemId: 'item-lock-fifo', batchNo: 'LOCK', initialQuantity: 5, remainingQuantity: 5 });
    const lockGuard = vi.fn();
    const service = new InventoryBatchService(db, lockGuard);

    service.consumeFifo('item-lock-fifo', 1, context);

    expect(lockGuard).toHaveBeenCalledWith('item-lock-fifo', 'clinic-v2-001');
  });

  it('rejects consume for non-batch-managed or missing items and invalid quantities', () => {
    insertItem('item-nonbatch', { code: 'NONBATCH-001', batchManaged: 0 });
    const service = new InventoryBatchService(db);
    expect(() => service.consumeFifo('item-nonbatch', 1, context)).toThrow(ValidationError);
    expect(() => service.consumeFifo('item-nonbatch', 1, context)).toThrow('未启用批次管理');
    expect(() => service.consumeFifo('item-missing', 1, context)).toThrow(NotFoundError);
    expect(() => service.consumeFifo('item-fifo', 0, context)).toThrow(ValidationError);
    expect(() => service.consumeFifo('item-fifo', -3, context)).toThrow(ValidationError);
    expect(() => service.consumeFifo('item-fifo', 2.5, context)).toThrow(ValidationError);
  });

  it('adjusts the remaining quantity and rejects missing batches', () => {
    insertItem('item-adjust', { code: 'ADJUST-001' });
    insertBatch('batch-adjust', { itemId: 'item-adjust', batchNo: 'ADJ', initialQuantity: 9, remainingQuantity: 9 });
    const service = new InventoryBatchService(db);
    const result = service.adjust('batch-adjust', { remainingQuantity: 3, note: '盘点修正' }, context);
    expect(result).toEqual({ id: 'batch-adjust', remainingQuantity: 3 });
    expect(batchRow('batch-adjust').remainingQuantity).toBe(3);
    expect(batchRow('batch-adjust').updatedAt).toBe(now);

    expect(() => service.adjust('batch-missing', { remainingQuantity: 1 }, context)).toThrow(NotFoundError);
    expect(() => service.adjust('batch-adjust', { remainingQuantity: -1 }, context)).toThrow(ValidationError);
  });

  it('updates batch metadata without touching quantities and clears fields on empty strings', () => {
    insertItem('item-update', { code: 'UPDATE-001' });
    insertBatch('batch-update', { itemId: 'item-update', batchNo: 'OLD', expiryDate: '2026-09-01', initialQuantity: 7, remainingQuantity: 7 });
    const service = new InventoryBatchService(db);

    const result = service.update('batch-update', {
      batchNo: 'NEW-BATCH',
      productionDate: '2026-07-15',
      expiryDate: '2026-12-01',
      supplierId: 'sup-1',
    }, context);
    expect(result).toEqual({
      id: 'batch-update',
      batchNo: 'NEW-BATCH',
      productionDate: '2026-07-15',
      expiryDate: '2026-12-01',
      supplierId: 'sup-1',
    });
    const row = batchRow('batch-update');
    expect(row.batchNo).toBe('NEW-BATCH');
    expect(row.productionDate).toBe('2026-07-15');
    expect(row.expiryDate).toBe('2026-12-01');
    expect(row.supplierId).toBe('sup-1');
    expect(row.initialQuantity).toBe(7);
    expect(row.remainingQuantity).toBe(7);
    expect(row.updatedAt).toBe(now);

    // 空字符串 → 清空为 null
    const cleared = service.update('batch-update', { batchNo: '', productionDate: '', expiryDate: '', supplierId: '' }, context);
    expect(cleared).toEqual({ id: 'batch-update', batchNo: null, productionDate: null, expiryDate: null, supplierId: null });

    // 缺省字段保持不变
    const partial = service.update('batch-update', { batchNo: 'PARTIAL' }, context);
    expect(partial).toEqual({ id: 'batch-update', batchNo: 'PARTIAL', productionDate: null, expiryDate: null, supplierId: null });

    expect(() => service.update('batch-update', { expiryDate: '2026/09/01' }, context)).toThrow(ValidationError);
    expect(() => service.update('batch-update', { productionDate: 'not-a-date' }, context)).toThrow(ValidationError);
    expect(() => service.update('batch-missing', { batchNo: 'X' }, context)).toThrow(NotFoundError);
  });

  it('removes only empty batches with a soft delete and rejects batches with remaining stock', () => {
    insertItem('item-remove', { code: 'REMOVE-001' });
    insertBatch('batch-remove-empty', { itemId: 'item-remove', batchNo: 'EMPTY', initialQuantity: 5, remainingQuantity: 0 });
    insertBatch('batch-remove-stock', { itemId: 'item-remove', batchNo: 'STOCK', initialQuantity: 5, remainingQuantity: 5 });
    const service = new InventoryBatchService(db);

    expect(() => service.remove('batch-remove-stock', context)).toThrow(ConflictError);
    expect(() => service.remove('batch-remove-stock', context)).toThrow('批次仍有剩余库存，不能删除');
    expect(() => service.remove('batch-missing', context)).toThrow(NotFoundError);

    expect(service.remove('batch-remove-empty', context)).toEqual({ id: 'batch-remove-empty' });
    const row = batchRow('batch-remove-empty');
    expect(row.deletedAt).toBe(now);
    expect(row.active).toBe(0);

    // 软删后 list 不再出现，且再次删除/更新均报 NotFound
    const { batches } = service.list(context, { itemId: 'item-remove' });
    expect(batches.map((batch) => batch.id)).not.toContain('batch-remove-empty');
    expect(batches.map((batch) => batch.id)).toContain('batch-remove-stock');
    expect(() => service.remove('batch-remove-empty', context)).toThrow(NotFoundError);
    expect(() => service.update('batch-remove-empty', { batchNo: 'X' }, context)).toThrow(NotFoundError);
  });

  it('generates expiry alerts with dedup and ignores far-future batches', () => {
    insertItem('item-alert', { code: 'ALERT-001', name: '麻醉剂' });
    insertBatch('batch-alert-near', { itemId: 'item-alert', batchNo: 'NEAR', expiryDate: '2026-08-12', initialQuantity: 4, remainingQuantity: 4 });
    insertBatch('batch-alert-far', { itemId: 'item-alert', batchNo: 'FAR', expiryDate: '2026-12-31', initialQuantity: 6, remainingQuantity: 6 });
    const service = new InventoryBatchService(db);

    const first = service.generateExpiryAlerts(10, context);
    expect(first).toEqual({ generated: 1, total: 1 });

    const alert = db.prepare(
      "SELECT * FROM BusinessAlert WHERE alertType = 'BATCH_EXPIRY'",
    ).get() as Record<string, unknown>;
    expect(alert).toBeDefined();
    expect(alert.metricName).toBe('batch-alert-near');
    expect(alert.status).toBe('OPEN');
    expect(alert.severity).toBe('WARN');
    expect(alert.level).toBe('WARNING');
    expect(alert.title).toBe('批次临近效期');
    expect(alert.source).toBe('inventory-batch');
    expect(alert.clinicId).toBe('clinic-v2-001');
    const message = String(alert.message);
    expect(message).toContain('麻醉剂');
    expect(message).toContain('NEAR');
    expect(message).toContain('2026-08-12');
    expect(message).toContain('剩余 4');

    // 重复调用去重：仍只有 1 条
    const second = service.generateExpiryAlerts(10, context);
    expect(second).toEqual({ generated: 0, total: 1 });
    const count = db.prepare(
      "SELECT COUNT(*) AS n FROM BusinessAlert WHERE alertType = 'BATCH_EXPIRY' AND metricName = 'batch-alert-near'",
    ).get() as { n: number };
    expect(count.n).toBe(1);
  });

  it('isolates batches and alerts by tenant', () => {
    insertItem('item-tenant', { code: 'TENANT-001', name: '本诊所物料' });
    insertBatch('batch-tenant-a', { itemId: 'item-tenant', batchNo: 'A', expiryDate: '2026-08-08', initialQuantity: 9, remainingQuantity: 9 });
    insertBatch('batch-tenant-other', { itemId: 'item-tenant', batchNo: 'OTHER', expiryDate: '2026-08-08', initialQuantity: 9, remainingQuantity: 9, clinicId: 'clinic-other' });
    const service = new InventoryBatchService(db);

    const { batches, expiring } = service.list(context, { days: 30 });
    const ids = batches.map((batch) => batch.id);
    expect(ids).toContain('batch-tenant-a');
    expect(ids).not.toContain('batch-tenant-other');
    const expiringIds = expiring.map((batch) => batch.id);
    expect(expiringIds).toContain('batch-tenant-a');
    expect(expiringIds).not.toContain('batch-tenant-other');

    const joined = batches.find((batch) => batch.id === 'batch-tenant-a');
    expect(joined?.itemName).toBe('本诊所物料');
    expect(joined?.itemCode).toBe('TENANT-001');

    // 跨租户调整/出库/提醒均不可见
    expect(() => service.adjust('batch-tenant-other', { remainingQuantity: 1 }, context)).toThrow(NotFoundError);
    expect(() => service.consumeFifo('item-tenant-other', 1, context)).toThrow(NotFoundError);
    const alerts = service.generateExpiryAlerts(30, context);
    const alert = db.prepare(
      "SELECT metricName FROM BusinessAlert WHERE alertType = 'BATCH_EXPIRY' AND metricName = 'batch-tenant-other'",
    ).get();
    expect(alerts.generated).toBeGreaterThan(0);
    expect(alert).toBeUndefined();
  });

  it('filters batches by itemId in list', () => {
    insertItem('item-filter-a', { code: 'FILTER-A' });
    insertItem('item-filter-b', { code: 'FILTER-B' });
    insertBatch('batch-filter-a', { itemId: 'item-filter-a', batchNo: 'FA' });
    insertBatch('batch-filter-b', { itemId: 'item-filter-b', batchNo: 'FB' });
    const service = new InventoryBatchService(db);
    const { batches } = service.list(context, { itemId: 'item-filter-a' });
    expect(batches.map((batch) => batch.id)).toEqual(['batch-filter-a']);
  });

  it('skips the lock guard when none is provided and invokes it when provided', () => {
    insertItem('item-lock', { code: 'LOCK-001' });
    const guard = vi.fn();
    const service = new InventoryBatchService(db, guard);
    service.create({ itemId: 'item-lock', initialQuantity: 1 }, context);
    expect(guard).toHaveBeenCalledWith('item-lock', 'clinic-v2-001');
  });
});
