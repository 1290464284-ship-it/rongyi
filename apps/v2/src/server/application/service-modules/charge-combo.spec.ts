import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { NotFoundError, ValidationError } from '../../infrastructure/errors';
import type { AppContext } from '../../../domain/contracts';
import { ChargeComboService } from './charge-combo';

describe('ChargeComboService', () => {
  let db: Database.Database;
  let dataDir: string;
  let context: AppContext;
  let otherContext: AppContext;
  const now = '2026-08-05T10:00:00.000Z';

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-charge-combo-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
    context = {
      userId: 'user-admin-001',
      clinicId: 'clinic-v2-001',
      role: 'BOSS',
      traceId: 'trace',
      now: () => new Date(now),
    };
    otherContext = {
      userId: 'user-other-001',
      clinicId: 'clinic-v2-001',
      role: 'DOCTOR',
      traceId: 'trace-other',
      now: () => new Date(now),
    };
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  function insertCombo(
    id: string,
    overrides: {
      code?: string;
      name?: string;
      type?: 'PUBLIC' | 'PRIVATE';
      ownerId?: string | null;
      active?: number;
      clinicId?: string;
    } = {},
  ): void {
    db.prepare(
      `INSERT INTO ChargeCombo (
         id, code, name, type, ownerId, active, clinicId, createdAt, updatedAt, deletedAt
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    ).run(
      id,
      overrides.code ?? `CB-${id}`,
      overrides.name ?? `Combo ${id}`,
      overrides.type ?? 'PUBLIC',
      overrides.ownerId === undefined ? null : overrides.ownerId,
      overrides.active ?? 1,
      overrides.clinicId ?? 'clinic-v2-001',
      now,
      now,
    );
  }

  function insertComboItem(
    id: string,
    comboId: string,
    overrides: {
      name?: string;
      category?: string;
      price?: number;
      quantity?: number;
      costType?: 'SERVICE' | 'MATERIAL' | null;
      catalogId?: string | null;
    } = {},
  ): void {
    db.prepare(
      `INSERT INTO ChargeComboItem (
         id, comboId, catalogId, name, category, price, quantity, costType,
         clinicId, createdAt, updatedAt, deletedAt
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    ).run(
      id,
      comboId,
      overrides.catalogId === undefined ? null : overrides.catalogId,
      overrides.name ?? `Item ${id}`,
      overrides.category ?? 'GENERAL',
      overrides.price ?? 100,
      overrides.quantity ?? 1,
      overrides.costType === undefined ? null : overrides.costType,
      'clinic-v2-001',
      now,
      now,
    );
  }

  it('lists active combos with items; PUBLIC visible to all, PRIVATE only to its owner', () => {
    insertCombo('combo-public-a', { name: '洁牙套餐', code: 'CB-A' });
    insertComboItem('combo-public-a-item-1', 'combo-public-a', { name: '洁牙', category: 'CLEAN', price: 30000, costType: 'SERVICE' });
    insertComboItem('combo-public-a-item-2', 'combo-public-a', { name: '抛光膏', category: 'MATERIAL', price: 5000, quantity: 2, costType: 'MATERIAL' });
    insertCombo('combo-private-mine', { name: '我的组合', type: 'PRIVATE', ownerId: 'user-admin-001' });
    insertComboItem('combo-private-mine-item-1', 'combo-private-mine', { name: '私人项目', price: 8800, costType: null });
    insertCombo('combo-private-other', { name: '他人组合', type: 'PRIVATE', ownerId: 'user-other-001' });
    insertCombo('combo-inactive', { name: '停用组合', active: 0 });
    insertCombo('combo-other-clinic', { name: '他院组合', clinicId: 'clinic-other' });

    const service = new ChargeComboService(db);
    const mine = service.list(context).map((combo) => String(combo.id));
    expect(mine).toContain('combo-public-a');
    expect(mine).toContain('combo-private-mine');
    expect(mine).not.toContain('combo-private-other');
    expect(mine).not.toContain('combo-inactive');
    expect(mine).not.toContain('combo-other-clinic');

    const others = service.list(otherContext).map((combo) => String(combo.id));
    expect(others).toContain('combo-public-a');
    expect(others).toContain('combo-private-other');
    expect(others).not.toContain('combo-private-mine');

    const publicCombo = service.list(context).find((combo) => combo.id === 'combo-public-a');
    expect(publicCombo?.items).toEqual([
      { id: 'combo-public-a-item-1', comboId: 'combo-public-a', catalogId: null, name: '洁牙', category: 'CLEAN', price: 30000, quantity: 1, costType: 'SERVICE' },
      { id: 'combo-public-a-item-2', comboId: 'combo-public-a', catalogId: null, name: '抛光膏', category: 'MATERIAL', price: 5000, quantity: 2, costType: 'MATERIAL' },
    ]);
  });

  it('returns a combo with items; owner can read own PRIVATE combo', () => {
    insertCombo('combo-private-mine', { name: '我的组合', type: 'PRIVATE', ownerId: 'user-admin-001' });
    insertComboItem('combo-private-mine-item-1', 'combo-private-mine', { name: '私人项目', price: 8800, costType: null });
    const service = new ChargeComboService(db);
    const result = service.comboWithItems('combo-private-mine', context);
    expect(result.id).toBe('combo-private-mine');
    expect(result.type).toBe('PRIVATE');
    expect(result.ownerId).toBe('user-admin-001');
    expect(result.items).toEqual([
      { id: 'combo-private-mine-item-1', comboId: 'combo-private-mine', catalogId: null, name: '私人项目', category: 'GENERAL', price: 8800, quantity: 1, costType: null },
    ]);
  });

  it('hides PRIVATE combos from other users and rejects missing/inactive combos', () => {
    insertCombo('combo-private-mine', { type: 'PRIVATE', ownerId: 'user-admin-001' });
    insertCombo('combo-inactive', { active: 0 });
    const service = new ChargeComboService(db);
    expect(() => service.comboWithItems('combo-private-mine', otherContext)).toThrow(NotFoundError);
    expect(() => service.comboWithItems('combo-private-mine', otherContext)).toThrow('Charge combo not found');
    expect(() => service.comboWithItems('combo-missing', context)).toThrow(NotFoundError);
    expect(() => service.comboWithItems('combo-inactive', context)).toThrow(NotFoundError);
  });

  it('applies a combo to a charge and persists costType on charge items', async () => {
    insertCombo('combo-public-a', { name: '洁牙套餐' });
    insertComboItem('combo-public-a-item-1', 'combo-public-a', { name: '洁牙', price: 30000, costType: 'SERVICE' });
    insertComboItem('combo-public-a-item-2', 'combo-public-a', { name: '抛光膏', price: 5000, quantity: 2, costType: 'MATERIAL' });
    const service = new ChargeComboService(db);
    const result = await service.applyToCharge('combo-public-a', 'patient-demo-001', context);
    expect(result).toMatchObject({
      comboId: 'combo-public-a',
      comboName: '洁牙套餐',
      status: 'UNPAID',
      totalAmount: 30000 + 5000 * 2,
    });
    expect(typeof result.id).toBe('string');
    expect(typeof result.number).toBe('string');

    const charge = db.prepare('SELECT * FROM Charge WHERE id = ?').get(String(result.id)) as Record<string, unknown>;
    expect(charge.totalAmount).toBe(30000 + 5000 * 2);
    expect(charge.status).toBe('UNPAID');
    expect(charge.patientId).toBe('patient-demo-001');
    expect(charge.remark).toBe('收费组合 洁牙套餐');

    const items = db.prepare(
      'SELECT name, price, quantity, costType FROM ChargeItem WHERE chargeId = ? ORDER BY name',
    ).all(String(result.id)) as Array<{ name: string; price: number; quantity: number; costType: string }>;
    expect(items).toEqual([
      { name: '抛光膏', price: 5000, quantity: 2, costType: 'MATERIAL' },
      { name: '洁牙', price: 30000, quantity: 1, costType: 'SERVICE' },
    ]);
  });

  it('rejects combos without items with a validation error', async () => {
    insertCombo('combo-empty', { name: '空组合' });
    const service = new ChargeComboService(db);
    await expect(service.applyToCharge('combo-empty', 'patient-demo-001', context))
      .rejects.toThrow(ValidationError);
    await expect(service.applyToCharge('combo-empty', 'patient-demo-001', context))
      .rejects.toThrow('收费组合没有明细');
  });

  it('throws NotFoundError when applying a missing combo', async () => {
    const service = new ChargeComboService(db);
    await expect(service.applyToCharge('combo-missing', 'patient-demo-001', context))
      .rejects.toThrow(NotFoundError);
  });

  it('validates catalog references and prices when applying combo items', async () => {
    db.prepare(
      `INSERT INTO TreatmentCatalog (id, code, name, category, price, clinicId, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('catalog-1', 'CAT-1', '目录洁牙', 'CLEAN', 100, 'clinic-v2-001', now, now);

    insertCombo('combo-catalog-ok');
    insertComboItem('combo-catalog-ok-item', 'combo-catalog-ok', { catalogId: 'catalog-1', price: 100, costType: null });
    const service = new ChargeComboService(db);
    await expect(service.applyToCharge('combo-catalog-ok', 'patient-demo-001', context))
      .resolves.toMatchObject({ comboId: 'combo-catalog-ok' });

    insertCombo('combo-catalog-missing');
    insertComboItem('combo-catalog-missing-item', 'combo-catalog-missing', { catalogId: 'missing-catalog', price: 100 });
    await expect(service.applyToCharge('combo-catalog-missing', 'patient-demo-001', context))
      .rejects.toThrow('收费组合明细引用的目录项不存在: Item combo-catalog-missing-item');

    insertCombo('combo-catalog-mismatch');
    insertComboItem('combo-catalog-mismatch-item', 'combo-catalog-mismatch', { catalogId: 'catalog-1', price: 999 });
    await expect(service.applyToCharge('combo-catalog-mismatch', 'patient-demo-001', context))
      .rejects.toThrow('收费组合明细价格与目录不一致: Item combo-catalog-mismatch-item');
  });
});
