import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { ConflictError } from '../../infrastructure/errors';
import {
  addInventoryStock,
  deductInventoryStock,
  inventoryStockAfter,
  recordInventoryTransaction,
  setInventoryStock,
} from './inventory-ledger';

describe('inventory-ledger', () => {
  let db: Database.Database;
  let dataDir: string;
  const now = '2026-08-05T10:00:00.000Z';
  const clinicId = 'clinic-v2-001';

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-inventory-ledger-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('deducts stock atomically and refuses to go negative', () => {
    deductInventoryStock(db, 'inventory-demo-001', 2, now, clinicId);
    expect(inventoryStockAfter(db, 'inventory-demo-001', clinicId)).toBe(98);
    const sync = db.prepare(
      "SELECT tableName, operation FROM SyncChange WHERE recordId = 'inventory-demo-001' ORDER BY rowid DESC LIMIT 1",
    ).get() as { tableName: string; operation: string } | undefined;
    expect(sync).toMatchObject({ tableName: 'InventoryItem', operation: 'UPDATE' });
    expect(() => deductInventoryStock(db, 'inventory-demo-001', 99, now, clinicId, '库存不足')).toThrow(ConflictError);
    expect(() => deductInventoryStock(db, 'inventory-demo-001', 99, now, clinicId)).toThrow('Insufficient stock');
    expect(inventoryStockAfter(db, 'inventory-demo-001', clinicId)).toBe(98);
  });

  it('adds and sets stock with tenant scoping', () => {
    const syncCount = (): number => Number(
      (db.prepare(
        "SELECT COUNT(*) AS c FROM SyncChange WHERE recordId = 'inventory-demo-001' AND tableName = 'InventoryItem'",
      ).get() as { c: number }).c,
    );
    db.prepare('UPDATE InventoryItem SET stock = 98 WHERE id = ?').run('inventory-demo-001');
    addInventoryStock(db, 'inventory-demo-001', 5, now, clinicId);
    expect(inventoryStockAfter(db, 'inventory-demo-001', clinicId)).toBe(103);
    expect(syncCount()).toBe(1);
    setInventoryStock(db, 'inventory-demo-001', 3, now, clinicId);
    expect(inventoryStockAfter(db, 'inventory-demo-001', clinicId)).toBe(3);
    expect(syncCount()).toBe(2);
    const sync = db.prepare(
      "SELECT operation FROM SyncChange WHERE recordId = 'inventory-demo-001' AND tableName = 'InventoryItem' ORDER BY createdAt DESC, rowid DESC LIMIT 1",
    ).get() as { operation: string } | undefined;
    expect(sync?.operation).toBe('UPDATE');
  });

  it('records inventory transaction rows with reference metadata', () => {
    db.prepare('UPDATE InventoryItem SET stock = 3 WHERE id = ?').run('inventory-demo-001');
    db.prepare(
      `INSERT INTO ReplenishmentSnapshot (clinicId, windowStart, windowEnd, dataJson, updatedAt)
       VALUES (?, '2026-01-01', '2026-01-31', '{}', ?)`,
    ).run(clinicId, now);
    recordInventoryTransaction(db, {
      id: 'txn-ledger-001',
      clinicId,
      itemId: 'inventory-demo-001',
      type: 'OUT',
      quantity: 1,
      beforeStock: 3,
      afterStock: 2,
      operatorId: 'user-admin-001',
      remark: '发药',
      createdAt: now,
      updatedAt: now,
      referenceType: 'DISPENSE',
      referenceId: 'dispense-001',
      batchId: null,
    });
    const row = db.prepare('SELECT * FROM InventoryTransaction WHERE id = ?').get('txn-ledger-001') as Record<string, unknown>;
    expect(row).toBeDefined();
    expect(row.referenceType).toBe('DISPENSE');
    expect(row.referenceId).toBe('dispense-001');
    expect(row.type).toBe('OUT');
    expect(Number(row.afterStock)).toBe(2);
    expect(db.prepare('SELECT 1 AS marker FROM ReplenishmentSnapshot WHERE clinicId = ?').get(clinicId)).toBeUndefined();
    db.prepare('UPDATE InventoryItem SET stock = 2 WHERE id = ?').run('inventory-demo-001');
    recordInventoryTransaction(db, {
      id: 'txn-ledger-002',
      clinicId,
      itemId: 'inventory-demo-001',
      type: 'IN',
      quantity: 2,
      beforeStock: 2,
      afterStock: 4,
      operatorId: 'user-admin-001',
      remark: null,
      createdAt: now,
      updatedAt: now,
      batchId: 'batch-1',
    });
    const batchRow = db.prepare('SELECT batchId FROM InventoryTransaction WHERE id = ?').get('txn-ledger-002') as { batchId: string | null };
    expect(batchRow.batchId).toBe('batch-1');
  });

  it('returns zero for missing inventory items', () => {
    expect(inventoryStockAfter(db, 'missing-item', clinicId)).toBe(0);
  });
});
