import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { ConflictError, NotFoundError, ValidationError } from '../../infrastructure/errors';
import type { AppContext } from '../../../domain/contracts';
import { InventoryDocService } from './inventory-docs';

describe('InventoryDocService', () => {
  let db: Database.Database;
  let dataDir: string;
  let context: AppContext;
  const now = '2026-08-05T10:00:00.000Z';

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-inventory-docs-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
    context = {
      userId: 'user-admin-001',
      clinicId: 'clinic-v2-001',
      role: 'BOSS',
      traceId: 'trace',
      now: () => new Date('2026-08-05T10:00:00.000Z'),
    };
    db.prepare(
      `UPDATE Appointment SET startTime = ?, endTime = ?, updatedAt = ? WHERE id = 'appointment-demo-001'`,
    ).run('2099-01-01T00:00:00.000Z', '2099-01-01T01:00:00.000Z', now);
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  function insertSupplier(id: string, code: string, name: string): void {
    db.prepare(
      `INSERT INTO Supplier (id, clinicId, createdAt, updatedAt, deletedAt, code, name)
       VALUES (?, ?, ?, ?, NULL, ?, ?)`,
    ).run(id, context.clinicId, now, now, code, name);
  }

  function insertItem(id: string, code: string, stock: number): void {
    db.prepare(
      `INSERT INTO InventoryItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, category, unit, stock, minStock, price
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 0, 1000)`,
    ).run(id, context.clinicId, now, now, code, `Item ${code}`, 'CONSUMABLE', 'box', stock);
  }

  function stockOf(itemId: string): number {
    const row = db.prepare('SELECT stock FROM InventoryItem WHERE id = ?').get(itemId) as { stock: number };
    return Number(row.stock);
  }

  it('creates a return-supplier doc, deducts stock and records an OUT transaction', () => {
    insertSupplier('sup-001', 'SUP-001', '供应商甲');
    const service = new InventoryDocService(db);
    const result = service.createReturnSupplier({
      supplierId: 'sup-001',
      items: [{ itemId: 'inventory-demo-001', quantity: 5, unitPrice: 500, remark: '破损退货' }],
      remark: '整单备注',
    }, context) as {
      doc: Record<string, unknown>;
      items: Array<Record<string, unknown>>;
    };

    expect(result.doc.type).toBe('RETURN_SUPPLIER');
    expect(result.doc.status).toBe('COMPLETED');
    expect(String(result.doc.number)).toMatch(/^RTS-/);
    expect(result.doc.supplierId).toBe('sup-001');
    expect(result.doc.operatorId).toBe('user-admin-001');
    expect(result.doc.operatorName).toBeNull();
    expect(result.doc.completedAt).toBe(now);
    expect(result.doc.remark).toBe('整单备注');
    expect(result.items).toHaveLength(1);
    expect(result.items[0].itemId).toBe('inventory-demo-001');
    expect(result.items[0].quantity).toBe(5);
    expect(result.items[0].unitPrice).toBe(500);
    expect(result.items[0].toItemId).toBeNull();
    expect(stockOf('inventory-demo-001')).toBe(95);

    const tx = db.prepare('SELECT * FROM InventoryTransaction WHERE referenceId = ?').get(result.doc.id) as Record<string, unknown>;
    expect(tx).toBeDefined();
    expect(tx.type).toBe('OUT');
    expect(tx.quantity).toBe(5);
    expect(tx.beforeStock).toBe(100);
    expect(tx.afterStock).toBe(95);
    expect(tx.referenceType).toBe('RETURN_SUPPLIER');
    expect(tx.operatorId).toBe('user-admin-001');
    expect(tx.remark).toBe('退回厂商');
    expect(tx.batchId).toBeNull();
  });

  it('throws NotFound when the supplier does not exist', () => {
    const service = new InventoryDocService(db);
    expect(() => service.createReturnSupplier({
      supplierId: 'sup-missing',
      items: [{ itemId: 'inventory-demo-001', quantity: 1 }],
    }, context)).toThrow(NotFoundError);
  });

  it('throws NotFound when an item does not exist', () => {
    insertSupplier('sup-002', 'SUP-002', '供应商乙');
    const service = new InventoryDocService(db);
    expect(() => service.createReturnSupplier({
      supplierId: 'sup-002',
      items: [{ itemId: 'item-missing', quantity: 1 }],
    }, context)).toThrow(NotFoundError);
  });

  it('throws Conflict when stock is insufficient and leaves stock unchanged', () => {
    const service = new InventoryDocService(db);
    expect(() => service.createReturnSupplier({
      supplierId: 'sup-002',
      items: [{ itemId: 'inventory-demo-001', quantity: 200 }],
    }, context)).toThrow(ConflictError);
    expect(stockOf('inventory-demo-001')).toBe(95);
  });

  it('creates a loss doc, deducts stock and records a LOSS transaction', () => {
    const service = new InventoryDocService(db);
    const result = service.createLoss({
      items: [{ itemId: 'inventory-demo-001', quantity: 3, remark: '过期报废' }],
    }, context) as { doc: Record<string, unknown>; items: Array<Record<string, unknown>> };

    expect(result.doc.type).toBe('LOSS');
    expect(result.doc.status).toBe('COMPLETED');
    expect(String(result.doc.number)).toMatch(/^LSS-/);
    expect(result.doc.supplierId).toBeNull();
    expect(result.items).toHaveLength(1);
    expect(stockOf('inventory-demo-001')).toBe(92);

    const tx = db.prepare('SELECT * FROM InventoryTransaction WHERE referenceId = ?').get(result.doc.id) as Record<string, unknown>;
    expect(tx.type).toBe('OUT');
    expect(tx.quantity).toBe(3);
    expect(tx.beforeStock).toBe(95);
    expect(tx.afterStock).toBe(92);
    expect(tx.referenceType).toBe('LOSS');
    expect(tx.remark).toBe('库损');
  });

  it('throws Conflict when loss quantity exceeds stock', () => {
    const service = new InventoryDocService(db);
    expect(() => service.createLoss({
      items: [{ itemId: 'inventory-demo-001', quantity: 1000 }],
    }, context)).toThrow(ConflictError);
    expect(stockOf('inventory-demo-001')).toBe(92);
  });

  it('invokes the stocktake lock guard and rolls back when the item is locked', () => {
    insertSupplier('sup-lock', 'SUP-LOCK', '锁定供应商');
    const lockGuard = vi.fn(() => { throw new ConflictError('盘点已锁定'); });
    const ServiceWithGuard = InventoryDocService as unknown as new (
      db: Database.Database,
      lockGuard?: (itemId: string, clinicId?: string | null) => void,
    ) => InventoryDocService;
    const service = new ServiceWithGuard(db, lockGuard);

    expect(() => service.createLoss({ items: [{ itemId: 'inventory-demo-001', quantity: 1 }] }, context))
      .toThrow(ConflictError);
    expect(lockGuard).toHaveBeenCalledWith('inventory-demo-001', 'clinic-v2-001');
    const docRows = db.prepare("SELECT COUNT(*) AS c FROM InventoryDoc WHERE type = 'LOSS'").get() as { c: number };
    expect(docRows.c).toBe(1);
    expect(stockOf('inventory-demo-001')).toBe(92);
  });

  it('creates a transfer doc with OUT and IN transactions', () => {
    insertItem('inventory-demo-002', 'MAT-002', 10);
    const service = new InventoryDocService(db);
    const result = service.createTransfer({
      items: [{ fromItemId: 'inventory-demo-001', toItemId: 'inventory-demo-002', quantity: 4, remark: '门店调拨' }],
    }, context) as { doc: Record<string, unknown>; items: Array<Record<string, unknown>> };

    expect(result.doc.type).toBe('TRANSFER');
    expect(result.doc.status).toBe('COMPLETED');
    expect(String(result.doc.number)).toMatch(/^TRF-/);
    expect(result.doc.supplierId).toBeNull();
    expect(result.items).toHaveLength(1);
    expect(result.items[0].itemId).toBe('inventory-demo-001');
    expect(result.items[0].toItemId).toBe('inventory-demo-002');
    expect(result.items[0].quantity).toBe(4);
    expect(stockOf('inventory-demo-001')).toBe(88);
    expect(stockOf('inventory-demo-002')).toBe(14);

    const txs = db.prepare('SELECT * FROM InventoryTransaction WHERE referenceId = ? ORDER BY type DESC').all(result.doc.id) as Array<Record<string, unknown>>;
    expect(txs).toHaveLength(2);
    const outTx = txs.find((row) => row.type === 'OUT')!;
    expect(outTx.itemId).toBe('inventory-demo-001');
    expect(outTx.quantity).toBe(4);
    expect(outTx.beforeStock).toBe(92);
    expect(outTx.afterStock).toBe(88);
    expect(outTx.referenceType).toBe('TRANSFER');
    expect(outTx.remark).toBe('调拨出库');
    const inTx = txs.find((row) => row.type === 'IN')!;
    expect(inTx.itemId).toBe('inventory-demo-002');
    expect(inTx.quantity).toBe(4);
    expect(inTx.beforeStock).toBe(10);
    expect(inTx.afterStock).toBe(14);
    expect(inTx.referenceType).toBe('TRANSFER');
    expect(inTx.remark).toBe('调拨入库');
  });

  it('throws Conflict when transfer source stock is insufficient', () => {
    const service = new InventoryDocService(db);
    expect(() => service.createTransfer({
      items: [{ fromItemId: 'inventory-demo-001', toItemId: 'inventory-demo-002', quantity: 500 }],
    }, context)).toThrow(ConflictError);
    expect(stockOf('inventory-demo-001')).toBe(88);
  });

  it('throws NotFound when transfer target item is missing', () => {
    const service = new InventoryDocService(db);
    expect(() => service.createTransfer({
      items: [{ fromItemId: 'inventory-demo-001', toItemId: 'item-missing', quantity: 1 }],
    }, context)).toThrow(NotFoundError);
  });

  it('throws NotFound when transfer source item is missing', () => {
    const service = new InventoryDocService(db);
    expect(() => service.createTransfer({
      items: [{ fromItemId: 'item-missing', toItemId: 'inventory-demo-002', quantity: 1 }],
    }, context)).toThrow(NotFoundError);
  });

  it('validates input shape', () => {
    const service = new InventoryDocService(db);
    expect(() => service.createReturnSupplier({ supplierId: '', items: [{ itemId: 'inventory-demo-001', quantity: 1 }] }, context)).toThrow(ValidationError);
    expect(() => service.createReturnSupplier({ supplierId: 'sup-002', items: [] }, context)).toThrow(ValidationError);
    expect(() => service.createLoss({ items: [{ itemId: 'inventory-demo-001', quantity: 0 }] }, context)).toThrow(ValidationError);
    expect(() => service.createTransfer({ items: [{ fromItemId: 'inventory-demo-001', toItemId: 'inventory-demo-002', quantity: -1 }] }, context)).toThrow(ValidationError);
    expect(() => service.createTransfer({ items: [{ fromItemId: '', toItemId: 'inventory-demo-002', quantity: 1 }] }, context)).toThrow(ValidationError);
    expect(() => service.createTransfer({ items: [{ fromItemId: 'inventory-demo-001', toItemId: 'inventory-demo-001', quantity: 1 }] }, context)).toThrow(ValidationError);
  });
});
