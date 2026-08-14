// L-04 索引：早期聚合的"主路径 + 跨服务集成"测试（22 个），当前仅剩
// ChargeService/DebtService/MemberCardService/AppointmentService 的
// 主流程与跨服务集成（收费/欠款/会员卡/预约冲突/操作日志），以及刻意保留的
// 集成层测试（回滚联动、跨服务缺患者校验）。其余模块（Wechat/Stats/Auth/
// Sync/FollowUp/BulkImport/PatientRisk）已迁出到 service-modules/*.spec.ts，
// 后续逐域迁移后删除本文件，迁移前保持聚合。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../infrastructure/database';
import { runMigrations } from '../infrastructure/migrations';
import {
  AppointmentService,
  AuditService,
  ChargeService,
  DebtService,
  InventoryService,
  MemberCardService,
  PatientRiskService,
} from './services';
import { SqliteChargeRepository } from '../infrastructure/repositories/charge.repository';
import type { MemberCardRepository, MemberCardRecord } from './ports';
import type { AppContext } from '../../domain/contracts';

describe('application services', () => {
  let db: Database.Database;
  let dataDir: string;
  let context: AppContext;

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-test-'));
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

  it('creates, pays, and refunds a charge', async () => {
    const service = new ChargeService(db);
    const created = await service.create({
      patientId: 'patient-demo-001',
      items: [{ name: 'Exam', category: 'EXAM', price: 100, quantity: 2 }],
    }, context);
    const paid = await service.pay(String(created.id), 200, 'CASH', undefined, context);
    expect(paid.status).toBe('PAID');
    const refunded = await service.refund(String(created.id), 50, 'adjustment', context);
    expect(refunded.amount).toBe(50);
  });

  it('keeps a charge UNPAID when its paid balance is still non-positive', async () => {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO Charge (
         id, clinicId, createdAt, updatedAt, deletedAt, patientId, number,
         totalAmount, paidAmount, refundedAmount, discount, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', 'CHG-UNPAID-DEBT', 200, -100, 0, 0, 'UNPAID')`,
    ).run('charge-unpaid-debt', context.clinicId, now, now);
    db.prepare(
      `INSERT INTO Debt (
         id, clinicId, createdAt, updatedAt, deletedAt, chargeId, patientId,
         totalAmount, paidAmount, status
       ) VALUES (?, ?, ?, ?, NULL, 'charge-unpaid-debt', 'patient-demo-001', 200, 0, 'UNPAID')`,
    ).run('debt-unpaid-pay', context.clinicId, now, now);

    const result = await new DebtService(db).pay('debt-unpaid-pay', 50, context);

    expect(result.status).toBe('PARTIAL');
    const debt = db.prepare('SELECT paidAmount, status FROM Debt WHERE id = ?').get('debt-unpaid-pay') as {
      paidAmount: number;
      status: string;
    };
    expect(Number(debt.paidAmount)).toBe(50);
    expect(debt.status).toBe('PARTIAL');
    const charge = db.prepare('SELECT paidAmount, status FROM Charge WHERE id = ?').get('charge-unpaid-debt') as {
      paidAmount: number;
      status: string;
    };
    // 负数 paidAmount 是损坏/历史脏数据场景：chargePaid = min(200, -100 + 50) = -50 → UNPAID。
    expect(Number(charge.paidAmount)).toBe(-50);
    expect(charge.status).toBe('UNPAID');
  });

  it('applies a discount when creating a charge', async () => {
    const service = new ChargeService(db);
    const created = await service.create({
      patientId: 'patient-demo-001',
      items: [{ name: 'Exam', category: 'EXAM', price: 200, quantity: 1 }],
      discount: 50,
    }, context);
    expect(created.totalAmount).toBe(150);
    const row = db.prepare('SELECT totalAmount, discount FROM Charge WHERE id = ?').get(String(created.id)) as {
      totalAmount: number;
      discount: number;
    };
    expect(row.totalAmount).toBe(150);
    expect(row.discount).toBe(50);
  });

  it('persists costType and discount plan snapshot on charge items', async () => {
    const service = new ChargeService(db);
    const created = await service.create({
      patientId: 'patient-demo-001',
      items: [
        { name: 'Brace Adjustment', category: 'ORTHODONTIC', price: 300, quantity: 1, costType: 'SERVICE' },
        { name: 'Bracket', category: 'MATERIAL', price: 500, quantity: 2, costType: 'MATERIAL' },
        { name: 'Default Type', category: 'OTHER', price: 100, quantity: 1 },
      ],
      discount: 50,
      discountPlanSnapshot: { plan: 'VIP', discountRate: 90 },
    }, context);
    expect(created.totalAmount).toBe(300 + 1000 + 100 - 50);
    const rows = db.prepare(
      'SELECT name, costType FROM ChargeItem WHERE chargeId = ? ORDER BY name',
    ).all(String(created.id)) as Array<{ name: string; costType: string }>;
    expect(rows).toEqual([
      { name: 'Brace Adjustment', costType: 'SERVICE' },
      { name: 'Bracket', costType: 'MATERIAL' },
      { name: 'Default Type', costType: 'SERVICE' },
    ]);
    const charge = db.prepare('SELECT discountPlanSnapshotJson FROM Charge WHERE id = ?').get(String(created.id)) as {
      discountPlanSnapshotJson: string | null;
    };
    expect(JSON.parse(String(charge.discountPlanSnapshotJson))).toEqual({ plan: 'VIP', discountRate: 90 });
  });

  it('rejects charge items with an invalid costType', async () => {
    const service = new ChargeService(db);
    await expect(service.create({
      patientId: 'patient-demo-001',
      items: [{ name: 'Bad Type', category: 'OTHER', price: 100, quantity: 1, costType: 'LABOR' as 'SERVICE' }],
    }, context)).rejects.toThrow('Charge item costType must be SERVICE or MATERIAL');
  });

  it('rejects charge items whose quantity exceeds the maximum', async () => {
    const service = new ChargeService(db);
    const before = db.prepare('SELECT COUNT(*) AS n FROM Charge').get() as { n: number };
    await expect(service.create({
      patientId: 'patient-demo-001',
      items: [{ name: 'Huge Quantity', category: 'EXAM', price: 100, quantity: 1e15 }],
    }, context)).rejects.toThrow('Charge item quantity must not exceed 1000000');
    // Validation must fail before any write happens.
    const after = db.prepare('SELECT COUNT(*) AS n FROM Charge').get() as { n: number };
    expect(after.n).toBe(before.n);
  });

  it('rejects charge items whose subtotal exceeds the maximum allowed amount', async () => {
    const service = new ChargeService(db);
    const before = db.prepare('SELECT COUNT(*) AS n FROM Charge').get() as { n: number };
    await expect(service.create({
      patientId: 'patient-demo-001',
      items: [{ name: 'Huge Subtotal', category: 'EXAM', price: 100_000_000, quantity: 100_000 }],
    }, context)).rejects.toThrow('Charge item subtotal exceeds maximum allowed amount');
    // Validation must fail before any write happens.
    const after = db.prepare('SELECT COUNT(*) AS n FROM Charge').get() as { n: number };
    expect(after.n).toBe(before.n);
  });

  it('rejects a stock decrease below zero', async () => {
    const service = new InventoryService(db);
    await expect(
      service.createTransaction({ itemId: 'inventory-demo-001', type: 'OUT', quantity: 10_000 }, context),
    ).rejects.toThrow('Insufficient stock');
  });

  it('rejects missing patients and keeps appointment conflicts clinic-scoped', async () => {
    const appointments = new AppointmentService(db);
    const charges = new ChargeService(db);
    const memberCards = new MemberCardService(db);
    const risk = new PatientRiskService(db);
    const startTime = new Date(Date.now() + 5 * 86_400_000).toISOString();
    const endTime = new Date(Date.now() + 5 * 86_400_000 + 3_600_000).toISOString();

    await expect(appointments.create({
      patientId: 'missing-patient-audit',
      doctorId: 'user-admin-001',
      startTime,
      endTime,
      type: 'REGULAR',
    }, context)).rejects.toMatchObject({ status: 404 });
    await expect(charges.create({
      patientId: 'missing-patient-audit',
      items: [{ name: 'Exam', category: 'EXAM', price: 100, quantity: 1 }],
    }, context)).rejects.toMatchObject({ status: 404 });
    expect(() => memberCards.create({
      patientId: 'missing-patient-audit',
      cardNo: 'CARD-MISSING-PATIENT',
      status: 'ACTIVE',
      level: 'NORMAL',
    }, context)).toThrow('Patient not found');
    expect(() => risk.calculate('missing-patient-audit', context)).toThrow('Patient not found');

    const now = new Date().toISOString();
    const otherClinicStart = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const otherClinicEnd = new Date(Date.now() + 30 * 86_400_000 + 3_600_000).toISOString();
    db.prepare(
      `INSERT INTO Chair (id, clinicId, createdAt, updatedAt, deletedAt, name, location, active)
       VALUES (?, ?, ?, ?, NULL, 'Audit Chair', 'Room 1', 1)`,
    ).run('chair-audit', context.clinicId, now, now);
    db.prepare(
      `INSERT INTO Appointment (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, chairId, startTime, endTime, status, type
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 'BOOKED', 'REGULAR')`,
    ).run('appointment-other-clinic-audit', 'clinic-v2-002', now, now, 'patient-demo-001', 'user-admin-001', 'chair-audit', otherClinicStart, otherClinicEnd);

    await expect(appointments.create({
      patientId: 'patient-demo-001',
      doctorId: 'user-admin-001',
      chairId: 'chair-audit',
      startTime: otherClinicStart,
      endTime: otherClinicEnd,
      type: 'REGULAR',
    }, context)).resolves.toHaveProperty('id');
  });

  it('recharges and consumes from a member card', async () => {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO MemberCard (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, cardNo, balance, totalRecharge, totalConsume,
         status, points, totalPoints, level
       ) VALUES (?, ?, ?, ?, NULL, ?, 'CARD-TEST', 0, 0, 0, 'ACTIVE', 0, 0, 'NORMAL')`,
    ).run('card-test', context.clinicId, now, now, 'patient-demo-001');
    const service = new MemberCardService(db);
    await service.recharge('card-test', 1000, context);
    await service.consume('card-test', 300, context);
    await service.addPoints('card-test', 20, context);
    const card = db.prepare('SELECT * FROM MemberCard WHERE id = ?').get('card-test') as Record<string, unknown>;
    expect(Number(card.balance)).toBe(700);
    expect(Number(card.points)).toBe(20);
  });

  it('rejects member card operations when the card is not active', async () => {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO Patient (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, gender, phone, tags, allergies, medicalHistory,
         medicationHistory, systemicDiseases, source, active
       ) VALUES (?, ?, ?, ?, NULL, 'INACTIVE-CARD-P', 'Inactive Card Patient', 'UNKNOWN', '13300000000',
         '[]', '[]', '[]', '[]', '[]', 'WALK_IN', 1)`,
    ).run('patient-inactive-card', context.clinicId, now, now);
    db.prepare(
      `INSERT INTO MemberCard (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, cardNo, balance, totalRecharge, totalConsume,
         status, points, totalPoints, level
       ) VALUES (?, ?, ?, ?, NULL, ?, 'CARD-INACTIVE-TEST', 100, 100, 0, 'INACTIVE', 0, 0, 'NORMAL')`,
    ).run('card-inactive-test', context.clinicId, now, now, 'patient-inactive-card');
    const service = new MemberCardService(db);
    await expect(service.recharge('card-inactive-test', 10, context)).rejects.toThrow('not active');
    await expect(service.consume('card-inactive-test', 10, context)).rejects.toThrow('not active');
    await expect(service.addPoints('card-inactive-test', 10, context)).rejects.toThrow('not active');
  });

  it('allows the same member card number in different clinics', () => {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO Patient (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, gender, phone, tags, allergies, medicalHistory,
         medicationHistory, systemicDiseases, source, active
       ) VALUES (?, ?, ?, ?, NULL, 'DUP-CARD-B', 'Duplicate Card Patient B', 'UNKNOWN', '13300000001',
         '[]', '[]', '[]', '[]', '[]', 'WALK_IN', 1)`,
    ).run('patient-dup-card-b', 'clinic-v2-002', now, now);
    const service = new MemberCardService(db);
    service.create({
      patientId: 'patient-demo-001',
      cardNo: 'CARD-DUP-GLOBAL',
      status: 'ACTIVE',
      level: 'NORMAL',
    }, context);
    const second = service.create({
      patientId: 'patient-dup-card-b',
      cardNo: 'CARD-DUP-GLOBAL',
      status: 'ACTIVE',
      level: 'NORMAL',
    }, { ...context, clinicId: 'clinic-v2-002' });
    expect(second.id).toBeDefined();
  });

  it('maps member-card create unique races to conflict errors', () => {
    const repo = {
      create: () => { throw new Error('UNIQUE constraint failed: MemberCard.cardNo'); },
    } as unknown as MemberCardRepository;
    const service = new MemberCardService(db, repo);
    expect(() => service.create({
      patientId: 'patient-demo-001',
      cardNo: 'CARD-CATCH-UNIQUE',
      status: 'ACTIVE',
      level: 'NORMAL',
    }, context)).toThrow('already exists');
  });

  it('rethrows non-unique member-card create failures', () => {
    const repo = {
      create: () => { throw new Error('database down'); },
    } as unknown as MemberCardRepository;
    const service = new MemberCardService(db, repo);
    expect(() => service.create({
      patientId: 'patient-demo-001',
      cardNo: 'CARD-CATCH-DOWN',
      status: 'ACTIVE',
      level: 'NORMAL',
    }, context)).toThrow('database down');
  });

  it('fails a member-card refund when the card has been deleted', async () => {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO Patient (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, gender, phone, tags, allergies, medicalHistory,
         medicationHistory, systemicDiseases, source, active
       ) VALUES (?, ?, ?, ?, NULL, 'DELETED-CARD-P', 'Deleted Card Patient', 'UNKNOWN', '13300000002',
         '[]', '[]', '[]', '[]', '[]', 'WALK_IN', 1)`,
    ).run('patient-deleted-card-refund', context.clinicId, now, now);
    db.prepare(
      `INSERT INTO MemberCard (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, cardNo, balance, totalRecharge, totalConsume,
         status, points, totalPoints, level
       ) VALUES (?, ?, ?, ?, NULL, ?, 'CARD-DELETED-REFUND', 500, 500, 0, 'ACTIVE', 0, 0, 'NORMAL')`,
    ).run('card-deleted-refund', context.clinicId, now, now, 'patient-deleted-card-refund');
    const charges = new ChargeService(db);
    const created = await charges.create({
      patientId: 'patient-deleted-card-refund',
      items: [{ name: 'Implant', category: 'IMPLANT', price: 200, quantity: 1 }],
    }, context);
    await charges.pay(String(created.id), 200, 'MEMBER_CARD', undefined, context);
    db.prepare('UPDATE MemberCard SET deletedAt = ? WHERE id = ?').run(now, 'card-deleted-refund');
    await expect(charges.refund(String(created.id), 50, 'deleted card', context)).rejects.toThrow('Member card used for payment is not found');
  });

  it('refunds legacy member-card charges without a recorded card id', async () => {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO Patient (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, gender, phone, tags, allergies, medicalHistory,
         medicationHistory, systemicDiseases, source, active
       ) VALUES (?, ?, ?, ?, NULL, 'LEGACY-CARD-P', 'Legacy Card Patient', 'UNKNOWN', '13300000003',
         '[]', '[]', '[]', '[]', '[]', 'WALK_IN', 1)`,
    ).run('patient-legacy-card-refund', context.clinicId, now, now);
    db.prepare(
      `INSERT INTO MemberCard (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, cardNo, balance, totalRecharge, totalConsume,
         status, points, totalPoints, level
       ) VALUES (?, ?, ?, ?, NULL, ?, 'CARD-LEGACY-REFUND', 500, 500, 0, 'ACTIVE', 0, 0, 'NORMAL')`,
    ).run('card-legacy-refund', context.clinicId, now, now, 'patient-legacy-card-refund');
    const charges = new ChargeService(db);
    const created = await charges.create({
      patientId: 'patient-legacy-card-refund',
      items: [{ name: 'Implant', category: 'IMPLANT', price: 200, quantity: 1 }],
    }, context);
    await charges.pay(String(created.id), 200, 'MEMBER_CARD', undefined, context);
    db.prepare('UPDATE Charge SET memberCardId = NULL WHERE id = ?').run(String(created.id));
    await charges.refund(String(created.id), 50, 'legacy refund', context);
    const card = db.prepare('SELECT balance FROM MemberCard WHERE id = ?').get('card-legacy-refund') as { balance: number };
    expect(Number(card.balance)).toBe(350);
  });

  it('deducts and refunds member card balance with a charge', async () => {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO Patient (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, gender, phone, tags, allergies, medicalHistory,
         medicationHistory, systemicDiseases, source, active
       ) VALUES (?, ?, ?, ?, NULL, 'CARD-P', 'Card Patient', 'UNKNOWN', '13000000000',
         '[]', '[]', '[]', '[]', '[]', 'WALK_IN', 1)`,
    ).run('patient-card-refund', context.clinicId, now, now);
    db.prepare(
      `INSERT INTO MemberCard (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, cardNo, balance, totalRecharge, totalConsume,
         status, points, totalPoints, level
       ) VALUES (?, ?, ?, ?, NULL, ?, 'CARD-REFUND', 1000, 1000, 0, 'ACTIVE', 0, 0, 'NORMAL')`,
    ).run('card-refund-test', context.clinicId, now, now, 'patient-card-refund');
    const chargeService = new ChargeService(db);
    const created = await chargeService.create({
      patientId: 'patient-card-refund',
      items: [{ name: 'Implant', category: 'IMPLANT', price: 300, quantity: 1 }],
    }, context);
    await chargeService.pay(String(created.id), 300, 'MEMBER_CARD', undefined, context);
    let card = db.prepare('SELECT * FROM MemberCard WHERE id = ?').get('card-refund-test') as Record<string, unknown>;
    expect(Number(card.balance)).toBe(700);
    await chargeService.refund(String(created.id), 100, 'adjustment', context);
    card = db.prepare('SELECT * FROM MemberCard WHERE id = ?').get('card-refund-test') as Record<string, unknown>;
    expect(Number(card.balance)).toBe(800);
  });

  it('rolls back charge payment when member card deduction fails', async () => {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO Patient (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, gender, phone, tags, allergies, medicalHistory,
         medicationHistory, systemicDiseases, source, active
       ) VALUES (?, ?, ?, ?, NULL, 'ROLLBACK-P', 'Rollback Patient', 'UNKNOWN', '13100000000',
         '[]', '[]', '[]', '[]', '[]', 'WALK_IN', 1)`,
    ).run('patient-rollback', context.clinicId, now, now);
    const card: MemberCardRecord = {
      id: 'card-rollback',
      clinicId: context.clinicId,
      patientId: 'patient-rollback',
      cardNo: 'CARD-ROLLBACK',
      balance: 1000,
      totalRecharge: 1000,
      totalConsume: 0,
      points: 0,
      totalPoints: 0,
      status: 'ACTIVE',
      level: 'NORMAL',
      createdAt: now,
      updatedAt: now,
    };
    const failingMemberRepository: MemberCardRepository = {
      create: () => {},
      findById: () => card,
      findByPatient: () => card,
      findByPatientForRefund: () => card,
      updateBalanceRefund: () => {},
      updateRecharge: () => {},
      updateConsume: () => { throw new Error('member card failure'); },
      updatePoints: () => {},
      insertLog: () => {},
      insertPointLog: () => {},
    };
    const service = new ChargeService(
      db,
      new SqliteChargeRepository(db),
      failingMemberRepository,
    );
    const created = await service.create({
      patientId: 'patient-rollback',
      items: [{ name: 'Exam', category: 'EXAM', price: 200, quantity: 1 }],
    }, context);
    await expect(service.pay(String(created.id), 200, 'MEMBER_CARD', undefined, context))
      .rejects.toThrow('member card failure');
    const charge = db.prepare('SELECT * FROM Charge WHERE id = ?').get(String(created.id)) as Record<string, unknown>;
    expect(Number(charge.paidAmount)).toBe(0);
    expect(charge.status).toBe('UNPAID');
  });

  it('writes operation log entries', () => {
    const audit = new AuditService(db);
    audit.log({
      userId: 'user-admin-001',
      action: 'TEST_WRITE',
      target: 'target-1',
      traceId: 'trace-audit',
      clinicId: 'clinic-v2-001',
    });
    const row = db.prepare('SELECT * FROM OperationLog WHERE target = ?').get('target-1') as Record<string, unknown>;
    expect(row.action).toBe('TEST_WRITE');
    expect(row.traceId).toBe('trace-audit');
    db.prepare('UPDATE OperationLog SET createdAt = ? WHERE target = ?')
      .run('2000-01-01T00:00:00.000Z', 'target-1');
    expect(audit.cleanup('2000-01-02T00:00:00.000Z')).toBe(1);
  });
});
