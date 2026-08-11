import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { ConflictError, NotFoundError, ValidationError } from '../../infrastructure/errors';
import type { AppContext } from '../../../domain/contracts';
import { ChargeTreeService } from './charge-tree';

describe('ChargeTreeService', () => {
  let db: Database.Database;
  let dataDir: string;
  let context: AppContext;
  const now = '2026-08-05T10:00:00.000Z';

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-charge-tree-'));
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

  function insertCatalog(
    id: string,
    code: string,
    name: string,
    price: number,
    options: {
      category?: string;
      costType?: 'SERVICE' | 'MATERIAL' | null;
      anesthesia?: boolean;
      businessCategory?: 'SERVICE' | 'DRUG' | 'MATERIAL' | 'OTHER' | null;
      parentId?: string | null;
      deletedAt?: string | null;
    } = {},
  ): void {
    db.prepare(
      `INSERT INTO TreatmentCatalog (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, category, price, remark, costType, anesthesia, parentId, businessCategory
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
    ).run(
      id,
      context.clinicId,
      now,
      now,
      options.deletedAt ?? null,
      code,
      name,
      options.category ?? 'GENERAL',
      price,
      options.costType ?? null,
      options.anesthesia ? 1 : 0,
      options.parentId ?? null,
      options.businessCategory ?? null,
    );
  }

  it('returns an empty tree when no catalogs exist', () => {
    const service = new ChargeTreeService(db);
    expect(service.tree(context).items).toEqual([]);
  });

  it('builds a two-level tree with children sorted by code', () => {
    insertCatalog('cat-root-1', 'CAT-ROOT-1', '正畸项目', 10000, { costType: 'SERVICE' });
    insertCatalog('cat-child-2', 'CAT-ROOT-1-02', '调整复诊', 5000, { parentId: 'cat-root-1', costType: 'SERVICE' });
    insertCatalog('cat-child-1', 'CAT-ROOT-1-01', '初诊检查', 3000, { parentId: 'cat-root-1', costType: 'SERVICE', anesthesia: true });
    insertCatalog('cat-root-2', 'CAT-ROOT-2', '种植材料', 200000, { costType: 'MATERIAL', businessCategory: 'MATERIAL' });

    const service = new ChargeTreeService(db);
    const items = service.tree(context).items;
    expect(items.map((node) => node.id)).toEqual(['cat-root-1', 'cat-root-2']);
    const root1 = items[0];
    expect(root1).toMatchObject({ code: 'CAT-ROOT-1', name: '正畸项目', price: 10000, costType: 'SERVICE', parentId: null });
    expect(root1.children.map((child) => child.id)).toEqual(['cat-child-1', 'cat-child-2']);
    expect(root1.children[0]).toMatchObject({ code: 'CAT-ROOT-1-01', anesthesia: true, businessCategory: null });
    expect(root1.children[0].children).toEqual([]);
  });

  it('quick-charges a catalog into a Charge with correct amounts', () => {
    insertCatalog('cat-qc-1', 'CAT-QC-1', '树脂充填', 15000, { costType: 'MATERIAL', businessCategory: 'MATERIAL' });
    const service = new ChargeTreeService(db);
    const result = service.quickCharge('cat-qc-1', {
      patientId: 'patient-demo-001',
      doctorId: 'user-admin-001',
      quantity: 2,
      remark: '两次充填',
    }, context);

    expect(result).toMatchObject({ catalogId: 'cat-qc-1', totalAmount: 30000, itemId: null });
    expect(result.chargeId).toBeDefined();
    expect(result.number).toMatch(/^CHG-[A-Z0-9]+-[A-Z0-9]{8}$/);
    expect(() => service.quickCharge('cat-qc-1', { patientId: 'patient-demo-001', visitId: 'missing-visit' }, context))
      .toThrow(NotFoundError);
    expect(() => service.quickCharge('cat-qc-1', { patientId: 'patient-demo-001', doctorId: 'missing-doctor' }, context))
      .toThrow(NotFoundError);

    const charge = db.prepare('SELECT * FROM Charge WHERE id = ?').get(result.chargeId) as Record<string, unknown>;
    expect(charge.patientId).toBe('patient-demo-001');
    expect(charge.doctorId).toBe('user-admin-001');
    expect(charge.status).toBe('UNPAID');
    expect(charge.totalAmount).toBe(30000);
    expect(charge.paidAmount).toBe(0);
    expect(charge.refundedAmount).toBe(0);
    expect(charge.discount).toBe(0);
    expect(charge.remark).toBe('两次充填');
    expect(charge.createdAt).toBe(now);
    expect(charge.clinicId).toBe('clinic-v2-001');

    const items = db.prepare('SELECT * FROM ChargeItem WHERE chargeId = ?').all(result.chargeId) as Array<Record<string, unknown>>;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      name: '树脂充填',
      category: 'GENERAL',
      price: 15000,
      quantity: 2,
      teethNumbers: '[]',
      subtotal: 30000,
      costType: 'MATERIAL',
      treatmentId: null,
    });
  });

  it('uses default remark and quantity 1 when omitted', () => {
    insertCatalog('cat-qc-2', 'CAT-QC-2', '洁牙', 8000, { costType: 'SERVICE' });
    const service = new ChargeTreeService(db);
    const result = service.quickCharge('cat-qc-2', { patientId: 'patient-demo-001' }, context);
    expect(result.totalAmount).toBe(8000);
    const charge = db.prepare('SELECT remark FROM Charge WHERE id = ?').get(result.chargeId) as { remark: string };
    expect(charge.remark).toBe('快捷划价：洁牙');
  });

  it('rejects quick charge subtotals above the maximum allowed amount', () => {
    insertCatalog('cat-qc-over', 'CAT-QC-OVER', '超限项目', 60_000_000, { costType: 'SERVICE' });
    const service = new ChargeTreeService(db);
    expect(() => service.quickCharge('cat-qc-over', { patientId: 'patient-demo-001', quantity: 2 }, context))
      .toThrow(ValidationError);
  });

  it('rejects non-positive or non-integer quantities with ValidationError', () => {
    insertCatalog('cat-qc-3', 'CAT-QC-3', '拍片', 20000, { costType: 'SERVICE' });
    const service = new ChargeTreeService(db);
    expect(() => service.quickCharge('cat-qc-3', { patientId: 'patient-demo-001', quantity: 0 }, context)).toThrow(ValidationError);
    expect(() => service.quickCharge('cat-qc-3', { patientId: 'patient-demo-001', quantity: -2 }, context)).toThrow(ValidationError);
    expect(() => service.quickCharge('cat-qc-3', { patientId: 'patient-demo-001', quantity: 1.5 }, context)).toThrow(ValidationError);
  });

  it('throws NotFound when the catalog is missing or deleted', () => {
    insertCatalog('cat-qc-deleted', 'CAT-QC-DEL', '已删项目', 1000, { deletedAt: now });
    const service = new ChargeTreeService(db);
    expect(() => service.quickCharge('cat-qc-missing', { patientId: 'patient-demo-001' }, context)).toThrow(NotFoundError);
    expect(() => service.quickCharge('cat-qc-deleted', { patientId: 'patient-demo-001' }, context)).toThrow(NotFoundError);
  });

  it('throws NotFound when the patient does not exist', () => {
    insertCatalog('cat-qc-4', 'CAT-QC-4', '拔牙', 30000, { costType: 'SERVICE' });
    const service = new ChargeTreeService(db);
    expect(() => service.quickCharge('cat-qc-4', { patientId: 'patient-missing' }, context)).toThrow(NotFoundError);
  });

  it('throws NotFound when the inventory item does not exist', () => {
    insertCatalog('cat-qc-5', 'CAT-QC-5', '粘接', 5000, { costType: 'SERVICE' });
    const service = new ChargeTreeService(db);
    expect(() => service.quickCharge('cat-qc-5', { patientId: 'patient-demo-001', itemId: 'item-missing' }, context)).toThrow(NotFoundError);
  });

  it('rejects a high-value item whose catalog does not match', () => {
    insertCatalog('cat-hv-1', 'CAT-HV-1', '种植体标准', 150000, { costType: 'MATERIAL', businessCategory: 'MATERIAL' });
    insertCatalog('cat-hv-2', 'CAT-HV-2', '种植体特惠', 120000, { costType: 'MATERIAL', businessCategory: 'MATERIAL' });
    db.prepare(
      `UPDATE InventoryItem SET isHighValue = 1, catalogId = ?, updatedAt = ? WHERE id = 'inventory-demo-001'`,
    ).run('cat-hv-1', now);

    const service = new ChargeTreeService(db);
    expect(() => service.quickCharge('cat-hv-2', { patientId: 'patient-demo-001', itemId: 'inventory-demo-001' }, context))
      .toThrow(ConflictError);
  });

  it('allows a high-value item when its linked catalog matches', () => {
    const service = new ChargeTreeService(db);
    const result = service.quickCharge('cat-hv-1', { patientId: 'patient-demo-001', itemId: 'inventory-demo-001', quantity: 1 }, context);
    expect(result.itemId).toBe('inventory-demo-001');
    expect(result.totalAmount).toBe(150000);
  });

  it('allows a non-high-value item with any catalog', () => {
    insertCatalog('cat-hv-3', 'CAT-HV-3', '普通材料', 2000, { costType: 'MATERIAL' });
    db.prepare(
      `UPDATE InventoryItem SET isHighValue = 0, catalogId = NULL, updatedAt = ? WHERE id = 'inventory-demo-001'`,
    ).run(now);
    const service = new ChargeTreeService(db);
    const result = service.quickCharge('cat-hv-3', { patientId: 'patient-demo-001', itemId: 'inventory-demo-001' }, context);
    expect(result.totalAmount).toBe(2000);
  });
});
