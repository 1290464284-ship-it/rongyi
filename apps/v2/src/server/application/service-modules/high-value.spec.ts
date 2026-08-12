import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { NotFoundError, ValidationError } from '../../infrastructure/errors';
import type { AppContext } from '../../../domain/contracts';
import { HighValueService } from './high-value';

describe('HighValueService', () => {
  let db: Database.Database;
  let dataDir: string;
  let context: AppContext;
  const now = '2026-08-05T10:00:00.000Z';

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-high-value-'));
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

  function insertCatalog(id: string, code: string, name: string, price: number): void {
    db.prepare(
      `INSERT INTO TreatmentCatalog (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, category, price, remark, costType, anesthesia, parentId, businessCategory
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, 'MATERIAL', ?, NULL, 'MATERIAL', 0, NULL, 'MATERIAL')`,
    ).run(id, context.clinicId, now, now, code, name, price);
  }

  function itemRow(): Record<string, unknown> {
    return db.prepare('SELECT * FROM InventoryItem WHERE id = ?').get('inventory-demo-001') as Record<string, unknown>;
  }

  it('marks an item as high-value with a linked catalog', () => {
    insertCatalog('cat-hv-a', 'CAT-HV-A', '种植体A', 150000);
    const service = new HighValueService(db);
    const result = service.mark('inventory-demo-001', { isHighValue: true, catalogId: 'cat-hv-a' }, context);
    expect(result).toEqual({ itemId: 'inventory-demo-001', isHighValue: true, catalogId: 'cat-hv-a' });
    const row = itemRow();
    expect(row.isHighValue).toBe(1);
    expect(row.catalogId).toBe('cat-hv-a');
    expect(row.updatedAt).toBe(now);
  });

  it('rejects marking high-value without a catalog', () => {
    const service = new HighValueService(db);
    expect(() => service.mark('inventory-demo-001', { isHighValue: true }, context)).toThrow(ValidationError);
    expect(() => service.mark('inventory-demo-001', { isHighValue: true, catalogId: '' }, context)).toThrow(ValidationError);
  });

  it('rejects a catalog that does not exist', () => {
    const service = new HighValueService(db);
    expect(() => service.mark('inventory-demo-001', { isHighValue: true, catalogId: 'cat-missing' }, context))
      .toThrow(ValidationError);
    expect(() => service.mark('inventory-demo-001', { isHighValue: true, catalogId: 'cat-missing' }, context))
      .toThrow(/收费标准不存在/);
  });

  it('unmarks high-value and clears the linked catalog', () => {
    insertCatalog('cat-hv-b', 'CAT-HV-B', '种植体B', 100000);
    const service = new HighValueService(db);
    service.mark('inventory-demo-001', { isHighValue: true, catalogId: 'cat-hv-b' }, context);
    const result = service.mark('inventory-demo-001', { isHighValue: false, catalogId: '' }, context);
    expect(result).toEqual({ itemId: 'inventory-demo-001', isHighValue: false, catalogId: null });
    const row = itemRow();
    expect(row.isHighValue).toBe(0);
    expect(row.catalogId).toBeNull();
  });

  it('keeps a provided catalog when unmarking (no forced clear)', () => {
    insertCatalog('cat-hv-c', 'CAT-HV-C', '种植体C', 90000);
    const service = new HighValueService(db);
    const result = service.mark('inventory-demo-001', { isHighValue: false, catalogId: 'cat-hv-c' }, context);
    expect(result.catalogId).toBe('cat-hv-c');
    expect(itemRow().catalogId).toBe('cat-hv-c');
  });

  it('throws NotFound for an unknown item', () => {
    const service = new HighValueService(db);
    expect(() => service.mark('item-missing', { isHighValue: true, catalogId: 'cat-hv-a' }, context)).toThrow(NotFoundError);
  });

  it('does not mark a soft-deleted item', () => {
    const service = new HighValueService(db);
    db.prepare(
      `INSERT INTO InventoryItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, category, unit, stock, minStock, price, batchManaged
       ) VALUES (?, ?, ?, ?, ?, 'CODE-HV-DEL', '已删除耗材', 'CONSUMABLE', 'box', 0, 0, 100, 0)`,
    ).run('inventory-hv-deleted', context.clinicId, now, now, now);
    expect(() => service.mark('inventory-hv-deleted', { isHighValue: true, catalogId: 'cat-hv-a' }, context))
      .toThrow(NotFoundError);
  });
});
