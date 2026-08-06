import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { ValidationError } from '../../infrastructure/errors';
import type { AppContext } from '../../../domain/contracts';
import { InventoryReportService } from './inventory-reports';

describe('InventoryReportService', () => {
  let db: Database.Database;
  let dataDir: string;
  let context: AppContext;
  const now = '2026-08-05T10:00:00.000Z';

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-inventory-reports-'));
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

    db.prepare(
      `INSERT INTO InventoryItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, category, unit, stock, minStock, price
       ) VALUES (?, ?, ?, ?, NULL, 'MAT-002', 'Second Material', 'CONSUMABLE', 'piece', 30, 0, 2000)`,
    ).run('inventory-demo-002', context.clinicId, now, now);

    // 手工流水：覆盖 IN/OUT/ADJUST × 各 referenceType
    insertTx('tx-in-1', 'inventory-demo-001', 'IN', 10, 100, 110, null, null, '2026-08-01T08:00:00.000Z');
    insertTx('tx-out-1', 'inventory-demo-001', 'OUT', 2, 110, 108, null, null, '2026-08-02T10:00:00.000Z');
    insertTx('tx-in-2', 'inventory-demo-001', 'IN', 5, 108, 113, null, null, '2026-08-03T09:00:00.000Z');
    insertTx('tx-ret-1', 'inventory-demo-001', 'IN', 3, 113, 116, 'DISPENSE_RETURN', 'disp-1', '2026-08-03T11:00:00.000Z');
    insertTx('tx-rs-1', 'inventory-demo-001', 'OUT', 4, 116, 112, 'RETURN_SUPPLIER', 'doc-1', '2026-08-04T12:00:00.000Z');
    insertTx('tx-loss-1', 'inventory-demo-001', 'OUT', 1, 112, 111, 'LOSS', 'doc-2', '2026-08-04T13:00:00.000Z');
    insertTx('tx-stocktake-1', 'inventory-demo-001', 'ADJUST', 6, 111, 117, 'STOCKTAKE', 'doc-3', '2026-08-04T14:00:00.000Z');
    insertTx('tx-tr-out', 'inventory-demo-001', 'OUT', 7, 117, 110, 'TRANSFER', 'doc-4', '2026-08-05T09:00:00.000Z');
    insertTx('tx-tr-in', 'inventory-demo-001', 'IN', 7, 110, 117, 'TRANSFER', 'doc-4', '2026-08-05T10:00:00.000Z');
    insertTx('tx-in-3', 'inventory-demo-002', 'IN', 20, 30, 50, null, null, '2026-08-05T11:00:00.000Z');
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  function insertTx(
    id: string,
    itemId: string,
    type: string,
    quantity: number,
    beforeStock: number,
    afterStock: number,
    referenceType: string | null,
    referenceId: string | null,
    createdAt: string,
  ): void {
    db.prepare(
      `INSERT INTO InventoryTransaction (
         id, clinicId, createdAt, updatedAt, deletedAt, itemId, type, quantity,
         beforeStock, afterStock, referenceType, referenceId, operatorId, remark, batchId
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    ).run(id, context.clinicId, createdAt, createdAt, itemId, type, quantity, beforeStock, afterStock, referenceType, referenceId, context.userId, `tx-${id}`);
  }

  function ids(result: { items: Array<Record<string, unknown>> }): string[] {
    return result.items.map((row) => String(row.id));
  }

  it('rejects an unknown report type', () => {
    const service = new InventoryReportService(db);
    expect(() => service.report('BOGUS', {}, context)).toThrow(ValidationError);
  });

  it('rejects a malformed date range', () => {
    const service = new InventoryReportService(db);
    expect(() => service.report('IN', { from: '2026/08/01' }, context)).toThrow(ValidationError);
  });

  it('reports plain IN rows, excluding DISPENSE_RETURN and TRANSFER_IN', () => {
    const service = new InventoryReportService(db);
    const result = service.report('IN', {}, context) as { type: string; total: number; items: Array<Record<string, unknown>> };
    expect(result.type).toBe('IN');
    expect(result.total).toBe(3);
    expect(ids(result)).toEqual(['tx-in-3', 'tx-in-2', 'tx-in-1']);
    const item = result.items.find((row) => row.id === 'tx-in-1')!;
    expect(item.itemName).toBe('Dental Material');
    expect(item.category).toBe('CONSUMABLE');
    expect(item.unit).toBe('box');
    expect(item.quantity).toBe(10);
    expect(item.beforeStock).toBe(100);
    expect(item.afterStock).toBe(110);
    expect(item.referenceType).toBeNull();
  });

  it('reports plain OUT rows, excluding RETURN_SUPPLIER, LOSS and TRANSFER_OUT', () => {
    const service = new InventoryReportService(db);
    const result = service.report('OUT', {}, context) as { type: string; total: number; items: Array<Record<string, unknown>> };
    expect(result.total).toBe(1);
    expect(ids(result)).toEqual(['tx-out-1']);
  });

  it('reports DISPENSE_RETURN rows', () => {
    const service = new InventoryReportService(db);
    const result = service.report('DISPENSE_RETURN', {}, context) as { total: number; items: Array<Record<string, unknown>> };
    expect(result.total).toBe(1);
    expect(ids(result)).toEqual(['tx-ret-1']);
    expect(result.items[0].referenceType).toBe('DISPENSE_RETURN');
  });

  it('reports RETURN_SUPPLIER rows', () => {
    const service = new InventoryReportService(db);
    const result = service.report('RETURN_SUPPLIER', {}, context) as { total: number; items: Array<Record<string, unknown>> };
    expect(result.total).toBe(1);
    expect(ids(result)).toEqual(['tx-rs-1']);
  });

  it('reports LOSS rows', () => {
    const service = new InventoryReportService(db);
    const result = service.report('LOSS', {}, context) as { total: number; items: Array<Record<string, unknown>> };
    expect(result.total).toBe(1);
    expect(ids(result)).toEqual(['tx-loss-1']);
  });

  it('reports STOCKTAKE rows', () => {
    const service = new InventoryReportService(db);
    const result = service.report('STOCKTAKE', {}, context) as { total: number; items: Array<Record<string, unknown>> };
    expect(result.total).toBe(1);
    expect(ids(result)).toEqual(['tx-stocktake-1']);
    expect(result.items[0].type).toBe('ADJUST');
  });

  it('reports TRANSFER_OUT rows', () => {
    const service = new InventoryReportService(db);
    const result = service.report('TRANSFER_OUT', {}, context) as { total: number; items: Array<Record<string, unknown>> };
    expect(result.total).toBe(1);
    expect(ids(result)).toEqual(['tx-tr-out']);
  });

  it('reports TRANSFER_IN rows', () => {
    const service = new InventoryReportService(db);
    const result = service.report('TRANSFER_IN', {}, context) as { total: number; items: Array<Record<string, unknown>> };
    expect(result.total).toBe(1);
    expect(ids(result)).toEqual(['tx-tr-in']);
  });

  it('summarizes stock per item with aggregated IN/OUT/ADJUST quantities', () => {
    const service = new InventoryReportService(db);
    const result = service.report('SUMMARY', {}, context) as {
      type: string;
      total: number;
      items: Array<{ itemId: string; currentStock: number; inQuantity: number; outQuantity: number; adjustQuantity: number }>;
    };
    expect(result.type).toBe('SUMMARY');
    expect(result.total).toBe(2);
    const item1 = result.items.find((row) => row.itemId === 'inventory-demo-001')!;
    expect(item1).toBeDefined();
    expect(item1.currentStock).toBe(100);
    expect(item1.inQuantity).toBe(25); // 10 + 5 + 3(DISPENSE_RETURN) + 7(TRANSFER_IN)
    expect(item1.outQuantity).toBe(14); // 2 + 4(RETURN_SUPPLIER) + 1(LOSS) + 7(TRANSFER_OUT)
    expect(item1.adjustQuantity).toBe(6);
    const item2 = result.items.find((row) => row.itemId === 'inventory-demo-002')!;
    expect(item2.currentStock).toBe(30);
    expect(item2.inQuantity).toBe(20);
    expect(item2.outQuantity).toBe(0);
    expect(item2.adjustQuantity).toBe(0);
  });

  it('filters detail reports by from/to date range (inclusive)', () => {
    const service = new InventoryReportService(db);
    const result = service.report('IN', { from: '2026-08-03', to: '2026-08-04' }, context) as { total: number; items: Array<{ id: string }> };
    expect(result.total).toBe(1);
    expect(ids(result)).toEqual(['tx-in-2']);
  });

  it('filters reports by itemId', () => {
    const service = new InventoryReportService(db);
    const result = service.report('IN', { itemId: 'inventory-demo-002' }, context) as { total: number; items: Array<{ id: string }> };
    expect(result.total).toBe(1);
    expect(ids(result)).toEqual(['tx-in-3']);
  });

  it('summarizes with from/to as period values', () => {
    const service = new InventoryReportService(db);
    const result = service.report('SUMMARY', { from: '2026-08-04', to: '2026-08-04' }, context) as {
      total: number;
      items: Array<{ itemId: string; inQuantity: number; outQuantity: number; adjustQuantity: number }>;
    };
    expect(result.total).toBe(1);
    const item1 = result.items[0];
    expect(item1.itemId).toBe('inventory-demo-001');
    expect(item1.inQuantity).toBe(0);
    expect(item1.outQuantity).toBe(5); // RETURN_SUPPLIER 4 + LOSS 1
    expect(item1.adjustQuantity).toBe(6);
  });

  it('echoes from/to on the response', () => {
    const service = new InventoryReportService(db);
    const result = service.report('LOSS', { from: '2026-08-01', to: '2026-08-31' }, context) as { from: string | null; to: string | null };
    expect(result.from).toBe('2026-08-01');
    expect(result.to).toBe('2026-08-31');
  });
});
