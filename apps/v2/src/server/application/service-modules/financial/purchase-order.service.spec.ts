// PurchaseOrderService 模块化 spec：自 services-edge.spec.ts（聚合文件）迁移而来。
// 迁移约定：聚合文件按模块逐步拆出后删除（迁移前保持聚合）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../../infrastructure/database';
import { runMigrations } from '../../../infrastructure/migrations';
import { PurchaseOrderService } from './purchase-order.service';
import { PurchaseReviewService } from '../purchase-review';
import type { AppContext } from '../../../../domain/contracts';

describe('PurchaseOrderService', () => {
  let db: Database.Database;
  let dataDir: string;
  let context: AppContext;
  const now = '2026-08-04T00:00:00.000Z';
  const nullContext: AppContext = {
    userId: 'user-admin-001',
    clinicId: null,
    role: 'BOSS',
    traceId: 'trace-null',
    now: () => new Date(),
  };

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-purchase-'));
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

  it('creates purchase orders with validation and review flow', async () => {
    const purchase = new PurchaseOrderService(db);
    const createdPo = await purchase.create({
      number: 'PO-CREATE',
      items: [{ itemId: 'inventory-demo-001', name: 'Dental Material', quantity: 2, unitPrice: 100 }],
    }, context);
    expect(createdPo).toMatchObject({ status: 'PENDING', totalAmount: 200 });
    expect(db.prepare(
      `SELECT 1 FROM SyncChange WHERE tableName = 'PurchaseOrder' AND recordId = ? AND operation = 'INSERT' AND clinicId = ?`,
    ).get(String(createdPo.id), context.clinicId)).toBeDefined();
    // 全新库回归：服务建单必须显式落 reviewStatus='PENDING'（不能依赖 DB 列默认值，
    // 资源注册表建表不带 DEFAULT，迁移 addColumns 会因列已存在而跳过）。
    const poRow = db.prepare('SELECT reviewStatus FROM PurchaseOrder WHERE id = ?').get(String(createdPo.id)) as { reviewStatus: string | null };
    expect(poRow.reviewStatus).toBe('PENDING');
    const review = new PurchaseReviewService(db);
    expect(review.submit(String(createdPo.id), context).reviewStatus).toBe('SUBMITTED');
    expect(review.approve(String(createdPo.id), context).reviewStatus).toBe('APPROVED');
    expect(db.prepare(
      `SELECT 1 FROM SyncChange WHERE tableName = 'PurchaseOrder' AND recordId = ? AND operation = 'UPDATE' AND clinicId = ?`,
    ).get(String(createdPo.id), context.clinicId)).toBeDefined();
    expect(purchase.items(String(createdPo.id), context)).toHaveLength(1);

    await expect(purchase.create({ items: [{ name: 'X', quantity: 1, unitPrice: 1 }] } as unknown as Parameters<typeof purchase.create>[0], context)).rejects.toThrow('number is required');
    await expect(purchase.create({
      number: 'PO-BAD-NAME',
      items: [{ name: undefined as unknown as string, quantity: 1, unitPrice: 1 }],
    }, context)).rejects.toThrow('Each purchase item requires');
    await expect(purchase.create({ number: 'PO-BAD', items: [] }, context)).rejects.toThrow('1 to 500');
    await expect(purchase.create({
      number: 'PO-BAD-2',
      items: [{ name: 'X', quantity: 0, unitPrice: 1 }],
    }, context)).rejects.toThrow('positive quantity');
    await expect(purchase.create({
      number: 'PO-BAD-3',
      items: [{ itemId: 'missing-item', name: 'X', quantity: 1, unitPrice: 1 }],
    }, context)).rejects.toThrow('Inventory item not found');
    // P0-4：单价必须是整数分，小数单价会导致 unitPrice 取整与 subtotal 不一致的坏账。
    await expect(purchase.create({
      number: 'PO-BAD-4',
      items: [{ name: 'X', quantity: 1, unitPrice: 10.5 }],
    }, context)).rejects.toThrow('unit price');
    const nullPurchase = await purchase.create({
      number: 'PO-NULL-CLINIC',
      items: [{ name: 'Null Clinic Item', quantity: 1, unitPrice: 1 }],
    }, nullContext);
    expect(nullPurchase.status).toBe('PENDING');
  });

  it('validates supplier links, overflow amounts and non-approved receives', async () => {
    const purchase = new PurchaseOrderService(db);
    db.prepare(
      `INSERT INTO Supplier (id, clinicId, createdAt, updatedAt, deletedAt, code, name)
       VALUES ('sup-po-edge', ?, ?, ?, NULL, 'SUP-PO-EDGE', 'PO供应商')`,
    ).run(context.clinicId, now, now);

    await expect(purchase.create({
      number: 'PO-SUP-1',
      supplierId: 'sup-po-edge',
      items: [{ name: 'X', quantity: 1, unitPrice: 1 }],
    }, context)).resolves.toMatchObject({ status: 'PENDING' });
    await expect(purchase.create({
      number: 'PO-SUP-2',
      supplierId: 'sup-missing',
      items: [{ name: 'X', quantity: 1, unitPrice: 1 }],
    }, context)).rejects.toThrow('Supplier not found');
    await expect(purchase.create({
      number: 'PO-SUB-OVER',
      items: [{ name: 'X', quantity: 1, unitPrice: 2_000_000_000_000 }],
    }, context)).rejects.toThrow('Purchase item subtotal exceeds');
    await expect(purchase.create({
      number: 'PO-TOTAL-OVER',
      items: [
        { name: 'A', quantity: 1, unitPrice: 600_000_000_000 },
        { name: 'B', quantity: 1, unitPrice: 600_000_000_000 },
      ],
    }, context)).rejects.toThrow('Purchase order total exceeds');

    db.prepare(
      `INSERT INTO PurchaseOrder (
         id, clinicId, createdAt, updatedAt, deletedAt,
         number, supplierId, totalAmount, status, reviewStatus
       ) VALUES ('po-not-approved', ?, ?, ?, NULL, 'PO-NA', NULL, 0, 'PENDING', 'SUBMITTED')`,
    ).run(context.clinicId, now, now);
    await expect(purchase.receive('po-not-approved', context)).rejects.toThrow('must be approved before receiving');
  });

  it('falls back to the pre-adjust stock when the post-adjust snapshot is missing', async () => {
    db.prepare(
      `INSERT INTO InventoryItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, category, unit, stock, minStock, price
       ) VALUES ('item-af', ?, ?, ?, NULL, 'AF-CODE', 'AF Item', 'MAT', 'box', 5, 0, 100)`,
    ).run(context.clinicId, now, now);
    db.prepare(
      `INSERT INTO PurchaseOrder (
         id, clinicId, createdAt, updatedAt, deletedAt,
         number, supplierId, totalAmount, status, reviewStatus
       ) VALUES ('po-after-fallback', ?, ?, ?, NULL, 'PO-AF', NULL, 0, 'PENDING', 'APPROVED')`,
    ).run(context.clinicId, now, now);
    db.prepare(
      `INSERT INTO PurchaseOrderItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         orderId, itemId, name, quantity, unitPrice, subtotal
       ) VALUES ('poi-af', ?, ?, ?, NULL, 'po-after-fallback', 'item-af', 'AF Item', 2, 100, 200)`,
    ).run(context.clinicId, now, now);

    let finds = 0;
    const fakeInventory = {
      findItem: () => {
        finds += 1;
        return finds === 1 ? { id: 'item-af', stock: 5 } : null;
      },
      adjustStock: () => undefined,
      createTransaction: () => undefined,
    };
    const purchase = new PurchaseOrderService(db, undefined, fakeInventory as never);
    const result = await purchase.receive('po-after-fallback', context) as {
      items: Array<{ itemId: string; beforeStock: number; afterStock: number }>;
    };
    expect(result.items[0]).toMatchObject({ itemId: 'item-af', beforeStock: 5, afterStock: 7 });
  });

  it('calls the stocktake lock guard while receiving a purchase order', async () => {
    const lockGuard = vi.fn();
    const purchase = new PurchaseOrderService(db, undefined, undefined, lockGuard);
    db.prepare(
      `INSERT INTO InventoryItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, category, unit, stock, minStock, price
       ) VALUES (?, ?, ?, ?, NULL, 'PO-LOCK-ITEM', 'Lock Item', 'MAT', 'box', 1, 0, 100)`,
    ).run('inventory-po-lock', context.clinicId, now, now);
    db.prepare(
      `INSERT INTO PurchaseOrder (
         id, clinicId, createdAt, updatedAt, deletedAt,
         number, supplierId, totalAmount, status, reviewStatus
       ) VALUES (?, ?, ?, ?, NULL, 'PO-LOCK', NULL, 0, 'PENDING', 'APPROVED')`,
    ).run('po-lock', context.clinicId, now, now);
    db.prepare(
      `INSERT INTO PurchaseOrderItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         orderId, itemId, name, quantity, unitPrice, subtotal
       ) VALUES (?, ?, ?, ?, NULL, 'po-lock', 'inventory-po-lock', 'Lock Item', 1, 100, 100)`,
    ).run('poi-lock', context.clinicId, now, now);

    await purchase.receive('po-lock', context);
    expect(lockGuard).toHaveBeenCalledWith('inventory-po-lock', 'clinic-v2-001');
  });

  it('covers receive branches: missing, non-pending, missing items, and null clinic receipts', async () => {
    const purchase = new PurchaseOrderService(db);
    await expect(purchase.receive('missing-po', context)).rejects.toThrow('Purchase order not found');
    db.prepare(
      `INSERT INTO PurchaseOrder (
         id, clinicId, createdAt, updatedAt, deletedAt,
         number, supplierId, totalAmount, status
       ) VALUES (?, ?, ?, ?, NULL, 'PO-EDGE', NULL, 0, 'RECEIVED')`,
    ).run('po-edge', context.clinicId, now, now);
    await expect(purchase.receive('po-edge', context)).rejects.toThrow('not pending');
    db.prepare(
      `INSERT INTO PurchaseOrder (
         id, clinicId, createdAt, updatedAt, deletedAt,
         number, supplierId, totalAmount, status, reviewStatus
       ) VALUES (?, ?, ?, ?, NULL, 'PO-EDGE-2', NULL, 0, 'PENDING', 'APPROVED')`,
    ).run('po-edge-2', context.clinicId, now, now);
    db.prepare(
      `INSERT INTO PurchaseOrderItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         orderId, itemId, name, quantity, unitPrice, subtotal
       ) VALUES (?, ?, ?, ?, NULL, 'po-edge-2', NULL, 'No item', 1, 100, 100)`,
    ).run('poi-edge-null', context.clinicId, now, now);
    db.prepare(
      `INSERT INTO InventoryItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, category, unit, stock, minStock, price
       ) VALUES (?, ?, ?, ?, NULL, 'PO-OTHER', 'Other Clinic Item', 'MAT', 'box', 1, 0, 100)`,
    ).run('inventory-po-other', 'clinic-v2-other', now, now);
    db.prepare(
      `INSERT INTO PurchaseOrderItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         orderId, itemId, name, quantity, unitPrice, subtotal
       ) VALUES (?, ?, ?, ?, NULL, 'po-edge-2', 'inventory-po-other', 'Other Clinic Item', 1, 100, 100)`,
    ).run('poi-edge-missing', context.clinicId, now, now);
    await expect(purchase.receive('po-edge-2', context)).rejects.toThrow('missing inventory items');
    db.prepare(
      `INSERT INTO InventoryItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, category, unit, stock, minStock, price
       ) VALUES (?, ?, ?, ?, NULL, 'PO-ITEM', 'PO Item', 'MAT', 'box', 1, 0, 100)`,
    ).run('inventory-po-valid', context.clinicId, now, now);
    db.prepare(
      `INSERT INTO PurchaseOrder (
         id, clinicId, createdAt, updatedAt, deletedAt,
         number, supplierId, totalAmount, status, reviewStatus
       ) VALUES (?, ?, ?, ?, NULL, 'PO-EDGE-3', NULL, 0, 'PENDING', 'APPROVED')`,
    ).run('po-edge-3', context.clinicId, now, now);
    db.prepare(
      `INSERT INTO PurchaseOrderItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         orderId, itemId, name, quantity, unitPrice, subtotal
       ) VALUES (?, ?, ?, ?, NULL, 'po-edge-3', 'inventory-po-valid', 'Valid', 2, 100, 200)`,
    ).run('poi-edge-valid', context.clinicId, now, now);
    const receipt = await purchase.receive('po-edge-3', context);
    expect(receipt).toMatchObject({
      id: 'po-edge-3',
      status: 'RECEIVED',
      number: 'PO-EDGE-3',
      items: [
        {
          itemId: 'inventory-po-valid',
          name: 'Valid',
          quantity: 2,
          unitPrice: 100,
          subtotal: 200,
          beforeStock: 1,
          afterStock: 3,
        },
      ],
    });
    expect(purchase.items('po-edge-3', context).length).toBe(1);
    expect(() => purchase.items('missing-po', context)).toThrow('Purchase order not found');
    db.prepare(
      `INSERT INTO PurchaseOrder (
         id, clinicId, createdAt, updatedAt, deletedAt,
         number, supplierId, totalAmount, status, reviewStatus
       ) VALUES (?, NULL, ?, ?, NULL, 'PO-EDGE-NULL', NULL, 0, 'PENDING', 'APPROVED')`,
    ).run('po-edge-null', now, now);
    db.prepare(
      `INSERT INTO PurchaseOrderItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         orderId, itemId, name, quantity, unitPrice, subtotal
       ) VALUES (?, NULL, ?, ?, NULL, 'po-edge-null', 'inventory-po-valid', 'Null Clinic', 1, 100, 100)`,
    ).run('poi-edge-null-clinic', now, now);
    const nullReceipt = await purchase.receive('po-edge-null', nullContext);
    expect(nullReceipt.items).toEqual([
      expect.objectContaining({
        itemId: 'inventory-po-valid',
        beforeStock: 3,
        afterStock: 4,
      }),
    ]);
    const stock = db.prepare('SELECT stock FROM InventoryItem WHERE id = ?').get('inventory-po-valid') as { stock: number };
    expect(Number(stock.stock)).toBe(4);
  });
});
