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
    expect(() => deductInventoryStock(db, 'inventory-demo-001', 99, now, clinicId, '库存不足')).toThrow(ConflictError);
    expect(inventoryStockAfter(db, 'inventory-demo-001', clinicId)).toBe(98);
  });

  it('adds and sets stock with tenant scoping', () => {
    db.prepare('UPDATE InventoryItem SET stock = 98 WHERE id = ?').run('inventory-demo-001');
    addInventoryStock(db, 'inventory-demo-001', 5, now, clinicId);
    expect(inventoryStockAfter(db, 'inventory-demo-001', clinicId)).toBe(103);
    setInventoryStock(db, 'inventory-demo-001', 3, now, clinicId);
    expect(inventoryStockAfter(db, 'inventory-demo-001', clinicId)).toBe(3);
  });

  it('records inventory transaction rows with reference metadata', () => {
    db.prepare('UPDATE InventoryItem SET stock = 3 WHERE id = ?').run('inventory-demo-001');
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
  });
});
