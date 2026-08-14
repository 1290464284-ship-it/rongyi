// L-04 索引：租户隔离集成测试（原"边缘/异常分支"聚合文件拆分后的保留层）。
// 其余服务边界路径均已迁入 service-modules/*.spec.ts（auth/sync/follow-up/
// backup/stats/analytics/print/search/satisfaction/hr-alerts/clinical-ops/
// bulk-import/financial 等，rounds 20-32）；本文件仅保留跨服务租户隔离
// 断言（integration 层），迁移前保持聚合。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../infrastructure/database';
import { runMigrations } from '../infrastructure/migrations';
import { rebuildSearchIndex } from '../infrastructure/search-index';
import {
  AppointmentService,
  ChargeService,
  DebtService,
  InventoryService,
  MemberCardService,
  SearchService,
  StatsService,
} from './services';
import {
  AnalyticsService,
  ReplenishmentService,
} from './workflow-services';
import type { AppContext } from '../../domain/contracts';

describe('service edge coverage', () => {
  let db: Database.Database;
  let dataDir: string;
  let context: AppContext;
  let nullContext: AppContext;
  const now = '2026-08-04T00:00:00.000Z';

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-service-edge-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
    context = {
      userId: 'user-admin-001',
      clinicId: 'clinic-v2-001',
      role: 'BOSS',
      traceId: 'trace',
      now: () => new Date(),
    };
    nullContext = {
      userId: 'user-admin-001',
      clinicId: null,
      role: 'BOSS',
      traceId: 'trace-null',
      now: () => new Date(),
    };
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('enforces tenant scope in core workflows', async () => {
    const now = new Date().toISOString();
    const otherClinic = 'other-clinic';

    db.prepare(
      `INSERT INTO Appointment (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, startTime, endTime, status, type
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', 'user-admin-001', ?, ?, 'BOOKED', 'REGULAR')`,
    ).run('appointment-other', otherClinic, now, now, now, new Date(Date.now() + 3_600_000).toISOString());
    const appointments = new AppointmentService(db);
    await expect(appointments.transition('appointment-other', 'CANCELLED', context)).rejects.toThrow('Appointment not found');

    db.prepare(
      `INSERT INTO Charge (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, number, totalAmount, paidAmount, refundedAmount, discount, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', 'OTHER-CHARGE', 100, 0, 0, 0, 'UNPAID')`,
    ).run('charge-other', otherClinic, now, now);
    const charges = new ChargeService(db);
    await expect(charges.pay('charge-other', 10, 'CASH', undefined, context)).rejects.toThrow('Charge not found');
    await expect(charges.refund('charge-other', 10, 'other', context)).rejects.toThrow('Charge not found');

    db.prepare(
      `INSERT INTO Debt (
         id, clinicId, createdAt, updatedAt, deletedAt,
         chargeId, patientId, totalAmount, paidAmount, status
       ) VALUES (?, ?, ?, ?, NULL, 'charge-other', 'patient-demo-001', 100, 0, 'UNPAID')`,
    ).run('debt-other', otherClinic, now, now);
    const debts = new DebtService(db);
    await expect(debts.pay('debt-other', 10, context)).rejects.toThrow('Debt record not found');

    db.prepare(
      `INSERT INTO MemberCard (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, cardNo, balance, totalRecharge, totalConsume,
         status, points, totalPoints, level
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', 'OTHER-CARD', 100, 100, 0, 'ACTIVE', 0, 0, 'NORMAL')`,
    ).run('card-other', otherClinic, now, now);
    const cards = new MemberCardService(db);
    await expect(cards.recharge('card-other', 10, context)).rejects.toThrow('Member card not found');
    await expect(cards.consume('card-other', 10, context)).rejects.toThrow('Member card not found');
    await expect(cards.addPoints('card-other', 10, context)).rejects.toThrow('Member card not found');
    await expect(cards.recharge('missing-card', 10, context)).rejects.toThrow('Member card not found');
    expect(() => cards.create({ patientId: 'patient-demo-001', cardNo: 'BAD-STATUS', status: 'BAD', level: 'NORMAL' }, context))
      .toThrow('Invalid member card status');
    expect(() => cards.create({ patientId: 'patient-demo-001', cardNo: 'BAD-LEVEL', status: 'ACTIVE', level: 'BAD' }, context))
      .toThrow('Invalid member card level');
    expect(() => cards.create({ patientId: '', cardNo: '', status: 'ACTIVE', level: 'NORMAL' }, context))
      .toThrow('patientId and cardNo are required');
    expect(() => cards.create({} as never, context)).toThrow('patientId and cardNo are required');
    const createdCard = cards.create({ patientId: 'patient-demo-001', cardNo: 'CREATED-CARD', status: 'ACTIVE', level: 'NORMAL' }, context);
    expect(createdCard.id).toBeDefined();
    expect(() => cards.create({ patientId: 'patient-demo-001', cardNo: 'CREATED-CARD', status: 'ACTIVE', level: 'NORMAL' }, context))
      .toThrow('Member card number already exists');

    db.prepare(
      `INSERT INTO InventoryItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, category, unit, stock, minStock, price
       ) VALUES (?, ?, ?, ?, NULL, 'OTHER-ITEM', 'Other Item', 'MAT', 'box', 10, 1, 100)`,
    ).run('inventory-other', otherClinic, now, now);
    const inventory = new InventoryService(db);
    await expect(inventory.createTransaction({ itemId: 'inventory-other', type: 'IN', quantity: 1 }, context))
      .rejects.toThrow('Inventory item not found');
    expect(inventory.expiringSoon(30, { ...context, clinicId: null }).items).toBeInstanceOf(Array);
  });

  it('keeps analytics, search, and replenishment scoped to the active clinic', () => {
    const otherClinic = 'clinic-v2-read-other';
    db.prepare(
      `INSERT OR IGNORE INTO Clinic (id, clinicId, createdAt, updatedAt, deletedAt, code, name, active)
       VALUES (?, NULL, ?, ?, NULL, 'V2-READ-OTHER', 'Read Other Clinic', 1)`,
    ).run(otherClinic, now, now);
    db.prepare(
      `INSERT OR IGNORE INTO Patient (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, gender, phone, tags, allergies, medicalHistory,
         medicationHistory, systemicDiseases, source, active
       ) VALUES (?, ?, ?, ?, NULL, 'READ-OTHER', 'Isolation Secret Patient', 'UNKNOWN', '13900008888',
         '[]', '[]', '[]', '[]', '[]', 'WALK_IN', 1)`,
    ).run('patient-read-other', otherClinic, now, now);
    db.prepare(
      `INSERT OR IGNORE INTO Charge (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, number, totalAmount, paidAmount, refundedAmount, discount, status, paidAt
       ) VALUES (?, ?, ?, ?, NULL, 'patient-read-other', 'READ-OTHER-CHARGE', 888, 888, 0, 0, 'PAID', ?)`,
    ).run('charge-read-other', otherClinic, now, now, now);
    db.prepare(
      `INSERT OR IGNORE INTO InventoryItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, category, unit, stock, minStock, price
       ) VALUES (?, ?, ?, ?, NULL, 'READ-OTHER-ITEM', 'Read Other Item', 'ISOLATION', 'box', 2, 20, 100)`,
    ).run('inventory-read-other', otherClinic, now, now);

    // 当前用户只属于 clinic-v2-001，不属于 otherClinic
    db.prepare(
      `INSERT OR IGNORE INTO UserClinic (userId, clinicId, role, createdAt, updatedAt, deletedAt)
       VALUES (?, 'clinic-v2-001', 'BOSS', ?, ?, NULL)`,
    ).run(context.userId, now, now);

    const stats = new StatsService(db);
    expect(Number(stats.dashboard(nullContext).patients)).toBeGreaterThan(Number(stats.dashboard(context).patients));
    const revenue = stats.revenue('2026-08-04T00:00:00.000Z', '2026-08-04T23:59:59.999Z', 'day', context);
    expect(revenue.some((row) => Number(row.amount) === 888)).toBe(false);
    expect(stats.inventoryStats(context).some((row) => row.category === 'ISOLATION')).toBe(false);

    rebuildSearchIndex(db);
    const search = new SearchService(db);
    expect(search.search('Isolation Secret', context)).toEqual([]);
    expect(search.search('Isolation Secret', nullContext).some((row) => row.id === 'patient-read-other')).toBe(true);

    const inventory = new InventoryService(db);
    expect(inventory.lowStock(context).items.some((row) => row.id === 'inventory-read-other')).toBe(false);

    const replenishment = new ReplenishmentService(db);
    replenishment.generate(context);
    const otherSuggestion = db.prepare(
      'SELECT id FROM InventoryReplenishmentSuggestion WHERE inventoryId = ? AND clinicId = ? AND deletedAt IS NULL',
    ).get('inventory-read-other', otherClinic) as { id: string } | undefined;
    expect(otherSuggestion).toBeUndefined();

    const analytics = new AnalyticsService(db);
    // 只展示当前用户有成员关系的诊所（UserClinic 过滤）+ legacy 兜底行
    const overview = analytics.clinicOverview(context);
    const otherOverview = overview.find((row) => row.clinicId === otherClinic) as Record<string, unknown>;
    expect(otherOverview).toBeUndefined();
    expect(overview.some((row) => row.clinicId === 'clinic-v2-001')).toBe(true);
  });

});
