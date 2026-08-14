import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { ValidationError } from '../../infrastructure/errors';
import type { AppContext } from '../../../domain/contracts';
import { ChargeService } from './financial';
import { CostShareService, type CostShareStats } from './cost-share';

const NOW = '2026-08-05T10:00:00.000Z';
const OUTSIDE_NOW = '2026-07-01T08:00:00.000Z';

describe('CostShareService', () => {
  let db: Database.Database;
  let dataDir: string;
  let context: AppContext;
  let outsideContext: AppContext;
  let chargeService: ChargeService;

  beforeEach(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-cost-share-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
    context = {
      userId: 'user-admin-001',
      clinicId: 'clinic-v2-001',
      role: 'BOSS',
      traceId: 'trace',
      now: () => new Date(NOW),
    };
    outsideContext = {
      userId: 'user-admin-001',
      clinicId: 'clinic-v2-001',
      role: 'BOSS',
      traceId: 'trace',
      now: () => new Date(OUTSIDE_NOW),
    };
    chargeService = new ChargeService(db);

    // 单1：SERVICE 两条（不同 category）+ MATERIAL 一条（显式 costType）
    await chargeService.create({
      patientId: 'patient-demo-001',
      items: [
        { name: 'Cleaning', category: 'GENERAL', price: 10000, quantity: 1, costType: 'SERVICE' },
        { name: 'Whitening', category: 'COSMETIC', price: 15000, quantity: 1, costType: 'SERVICE' },
        { name: 'Impression Material', category: 'CONSUMABLE', price: 8000, quantity: 2, costType: 'MATERIAL' },
      ],
    }, context);

    // 单2：MATERIAL 一条 + 不传 costType 的明细（应落库 SERVICE）
    await chargeService.create({
      patientId: 'patient-demo-001',
      items: [
        { name: 'Crown', category: 'MATERIAL', price: 50000, quantity: 1, costType: 'MATERIAL' },
        { name: 'Exam', category: 'GENERAL', price: 5000, quantity: 1 },
      ],
    }, context);

    // 单3：创建后置为 CANCELLED（应被排除）
    const cancelled = await chargeService.create({
      patientId: 'patient-demo-001',
      items: [
        { name: 'Cancelled Service', category: 'GENERAL', price: 99999, quantity: 1, costType: 'SERVICE' },
        { name: 'Cancelled Material', category: 'MATERIAL', price: 77777, quantity: 1, costType: 'MATERIAL' },
      ],
    }, context);
    db.prepare('UPDATE Charge SET status = ? WHERE id = ?').run('CANCELLED', String(cancelled.id));

    // 单4：createdAt 在统计窗口外（2026-07-01）
    await chargeService.create({
      patientId: 'patient-demo-001',
      items: [
        { name: 'Old Service', category: 'GENERAL', price: 11111, quantity: 1, costType: 'SERVICE' },
      ],
    }, outsideContext);

    // 其他诊所：原始插入 Charge + ChargeItem（应被租户隔离排除）
    db.prepare(
      `INSERT INTO Charge (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, number, totalAmount, paidAmount, refundedAmount, discount, status
       ) VALUES (?, 'clinic-other', ?, ?, NULL, 'patient-demo-001', 'CHG-OTHER-001', 12345, 0, 0, 0, 'UNPAID')`,
    ).run('charge-other-1', NOW, NOW);
    db.prepare(
      `INSERT INTO ChargeItem (
         id, chargeId, clinicId, createdAt, updatedAt, deletedAt,
         name, category, price, quantity, subtotal, costType
       ) VALUES (?, 'charge-other-1', 'clinic-other', ?, ?, NULL, 'Other Clinic Material', 'MATERIAL', 12345, 1, 12345, 'MATERIAL')`,
    ).run('ci-other-1', NOW, NOW);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  function stats(input: { from?: string; to?: string } = {}): CostShareStats {
    return new CostShareService(db).stats(input, context);
  }

  it('persists costType when creating charges through ChargeService', () => {
    const rows = db.prepare(
      `SELECT ci.name, ci.costType FROM ChargeItem ci
       JOIN Charge c ON c.id = ci.chargeId
       WHERE c.status != 'CANCELLED' ORDER BY ci.name`,
    ).all() as Array<{ name: string; costType: string }>;
    const byName = new Map(rows.map((row) => [row.name, row.costType]));
    expect(byName.get('Cleaning')).toBe('SERVICE');
    expect(byName.get('Whitening')).toBe('SERVICE');
    expect(byName.get('Impression Material')).toBe('MATERIAL');
    expect(byName.get('Crown')).toBe('MATERIAL');
    expect(byName.get('Exam')).toBe('SERVICE'); // 未传 costType 默认 SERVICE
    expect(byName.get('Old Service')).toBe('SERVICE');
  });

  it('groups charge items by costType and category with exact totals', () => {
    const result = stats();
    expect(result.rows).toEqual([
      { costType: 'MATERIAL', category: 'MATERIAL', total: 50000, itemCount: 1, chargeCount: 1 },
      { costType: 'MATERIAL', category: 'CONSUMABLE', total: 16000, itemCount: 1, chargeCount: 1 },
      { costType: 'SERVICE', category: 'GENERAL', total: 26111, itemCount: 3, chargeCount: 3 },
      { costType: 'SERVICE', category: 'COSMETIC', total: 15000, itemCount: 1, chargeCount: 1 },
    ]);
    expect(result.summary).toEqual({
      // charge-1 的 SERVICE 明细横跨 GENERAL/COSMETIC 两个 category，
      // 按 (costType, category) 分组后 chargeCount 各计一次：3 (GENERAL) + 1 (COSMETIC)
      SERVICE: { total: 41111, itemCount: 4, chargeCount: 4 },
      MATERIAL: { total: 66000, itemCount: 2, chargeCount: 2 },
      grandTotal: 107111,
    });
  });

  it('excludes cancelled charges from the statistics', () => {
    const result = stats();
    const categories = result.rows.map((row) => row.category);
    expect(categories).not.toContain('CANCELLED');
    const cancelledItems = db.prepare(
      `SELECT COUNT(*) AS count FROM ChargeItem ci
       JOIN Charge c ON c.id = ci.chargeId WHERE c.status = 'CANCELLED'`,
    ).get() as { count: number };
    expect(cancelledItems.count).toBe(2);
    expect(result.summary.SERVICE.total).toBe(41111); // 不含 99999
    expect(result.summary.MATERIAL.total).toBe(66000); // 不含 77777
  });

  it('filters the window by from/to on Charge.createdAt', () => {
    const result = stats({ from: '2026-08-01', to: '2026-08-31' });
    const sortedRows = [...result.rows].sort((a, b) =>
      a.costType.localeCompare(b.costType) || a.category.localeCompare(b.category));
    expect(sortedRows).toEqual([
      { costType: 'MATERIAL', category: 'CONSUMABLE', total: 16000, itemCount: 1, chargeCount: 1 },
      { costType: 'MATERIAL', category: 'MATERIAL', total: 50000, itemCount: 1, chargeCount: 1 },
      { costType: 'SERVICE', category: 'COSMETIC', total: 15000, itemCount: 1, chargeCount: 1 },
      { costType: 'SERVICE', category: 'GENERAL', total: 15000, itemCount: 2, chargeCount: 2 },
    ]);
    expect(result.summary).toEqual({
      SERVICE: { total: 30000, itemCount: 3, chargeCount: 3 },
      MATERIAL: { total: 66000, itemCount: 2, chargeCount: 2 },
      grandTotal: 96000,
    });
  });

  it('supports to-only filtering and full ISO date strings', () => {
    const result = stats({ to: '2026-07-31T23:59:59.999Z' });
    expect(result.summary).toEqual({
      SERVICE: { total: 11111, itemCount: 1, chargeCount: 1 },
      MATERIAL: { total: 0, itemCount: 0, chargeCount: 0 },
      grandTotal: 11111,
    });
  });

  it('rejects invalid from/to date strings with ValidationError', () => {
    const service = new CostShareService(db);
    for (const bad of ['not-a-date', '2026-13-01', '2026-02-30', '2026/08/05', '']) {
      expect(() => service.stats({ from: bad }, context)).toThrow(ValidationError);
      expect(() => service.stats({ to: bad }, context)).toThrow(ValidationError);
    }
    expect(() => service.stats({ from: '2026-08-01', to: '2026-08-05T10:00:00.000Z' }, context)).not.toThrow();
  });

  it('enforces tenant isolation for other clinics', () => {
    const result = stats();
    const material = result.rows.find((row) => row.costType === 'MATERIAL' && row.category === 'MATERIAL');
    expect(material).toEqual({ costType: 'MATERIAL', category: 'MATERIAL', total: 50000, itemCount: 1, chargeCount: 1 });
    expect(result.summary.MATERIAL.total).toBe(66000); // 不含 clinic-other 的 12345
    expect(result.summary.grandTotal).toBe(107111);
  });

  it('uses the +8 clinic day boundary for date-only filters', () => {
    const beforeFrom = stats({ from: '2026-08-05' }).summary.SERVICE.total;
    const beforeTo = stats({ to: '2026-08-04' }).summary.SERVICE.total;
    const insertCharge = (id: string, createdAt: string, subtotal: number): void => {
      db.prepare(
        `INSERT INTO Charge (
           id, clinicId, createdAt, updatedAt, deletedAt,
           patientId, number, totalAmount, paidAmount, refundedAmount, discount, status
         ) VALUES (?, 'clinic-v2-001', ?, ?, NULL, 'patient-demo-001', ?, ?, 0, 0, 0, 'PAID')`,
      ).run(id, createdAt, createdAt, id, subtotal);
      db.prepare(
        `INSERT INTO ChargeItem (
           id, chargeId, clinicId, createdAt, updatedAt, deletedAt,
           name, category, price, quantity, subtotal, costType
         ) VALUES (?, ?, 'clinic-v2-001', ?, ?, NULL, 'Boundary', 'BOUNDARY', ?, 1, ?, 'SERVICE')`,
      ).run(`ci-${id}`, id, createdAt, createdAt, subtotal, subtotal);
    };
    insertCharge('charge-boundary-include', '2026-08-04T16:00:00.000Z', 12345);
    insertCharge('charge-boundary-exclude', '2026-08-04T15:59:59.000Z', 999);

    const fromAug5 = stats({ from: '2026-08-05' });
    expect(fromAug5.summary.SERVICE.total).toBe(beforeFrom + 12345);
    const toAug4 = stats({ to: '2026-08-04' });
    expect(toAug4.summary.SERVICE.total).toBe(beforeTo + 999);
  });

  it('supports from-only filtering with full ISO datetime strings', () => {
    const result = stats({ from: '2026-08-01T00:00:00.000Z' });
    expect(result.summary.grandTotal).toBe(96000);
  });

  it('creates a new bucket for unknown costTypes via the nullish fallback', () => {
    db.prepare(
      `INSERT INTO Charge (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, number, totalAmount, paidAmount, refundedAmount, discount, status
       ) VALUES (?, 'clinic-v2-001', ?, ?, NULL, 'patient-demo-001', 'CHG-WEIRD-001', 4321, 0, 0, 0, 'UNPAID')`,
    ).run('charge-weird-1', NOW, NOW);
    db.prepare(
      `INSERT INTO ChargeItem (
         id, chargeId, clinicId, createdAt, updatedAt, deletedAt,
         name, category, price, quantity, subtotal, costType
       ) VALUES (?, 'charge-weird-1', 'clinic-v2-001', ?, ?, NULL, 'Weird Item', 'WEIRD', 4321, 1, 4321, 'WEIRD')`,
    ).run('ci-weird-1', NOW, NOW);

    const result = stats();
    expect(result.rows.find((row) => row.costType === 'WEIRD')).toEqual({
      costType: 'WEIRD', category: 'WEIRD', total: 4321, itemCount: 1, chargeCount: 1,
    });
    // 未知 costType 仍计入 grandTotal，但不影响 SERVICE/MATERIAL 汇总。
    expect(result.summary.grandTotal).toBe(107111 + 4321);
    expect(result.summary.SERVICE.total).toBe(41111);
    expect(result.summary.MATERIAL.total).toBe(66000);
  });
});

describe('CostShareService (empty database)', () => {
  let db: Database.Database;
  let dataDir: string;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-cost-share-empty-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('returns zeroed summary when no charge items exist', () => {
    const context: AppContext = {
      userId: 'user-admin-001',
      clinicId: 'clinic-v2-001',
      role: 'BOSS',
      traceId: 'trace',
      now: () => new Date(NOW),
    };
    expect(new CostShareService(db).stats({}, context)).toEqual({
      rows: [],
      summary: {
        SERVICE: { total: 0, itemCount: 0, chargeCount: 0 },
        MATERIAL: { total: 0, itemCount: 0, chargeCount: 0 },
        grandTotal: 0,
      },
    });
  });
});
