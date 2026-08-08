// L-04 索引：早期聚合的"主路径"测试（约 1217 行），覆盖 ChargeService、
// DebtService、MemberCardService、FollowUpService、PatientRiskService、
// BulkImportService、AppointmentService 等的主流程（创建/支付/退款/折扣/
// 余额/随访/导入/冲突分支）。多数模块已有独立 spec
// （src/server/application/service-modules/*.spec.ts），断言可逐步迁移后
// 删除本文件，迁移前保持聚合。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../infrastructure/database';
import { runMigrations } from '../infrastructure/migrations';
import {
  AppointmentService,
  AuthService,
  AuditService,
  BulkImportService,
  ChargeService,
  DebtService,
  FollowUpService,
  InventoryService,
  MemberCardService,
  PatientRiskService,
  StatsService,
  SyncService,
  maskPhoneForExport,
} from './services';
import { HttpWechatProvider, WechatService } from './workflow-services';
import { AppError } from '../infrastructure/errors';
import { SqliteRepository } from '../infrastructure/repository';
import { SqliteChargeRepository } from '../infrastructure/repositories/charge.repository';
import type { AuthRepository, MemberCardRepository, MemberCardRecord, WechatMessageRepository } from './ports';
import type { AppContext } from '../../domain/contracts';
import { SystemClock } from '../infrastructure/clock';
import type { Logger } from '../infrastructure/logger';

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

  it('creates and updates debt records for partial DEBT payments', async () => {
    const service = new ChargeService(db);
    const created = await service.create({
      patientId: 'patient-demo-001',
      items: [{ name: 'Debt Exam', category: 'EXAM', price: 200, quantity: 1 }],
    }, context);
    const partial = await service.pay(String(created.id), 80, 'DEBT', undefined, context);
    expect(partial.status).toBe('PARTIAL');
    const debt = db.prepare('SELECT id, totalAmount, paidAmount, status FROM Debt WHERE chargeId = ?').get(String(created.id)) as {
      id: string;
      totalAmount: number;
      paidAmount: number;
      status: string;
    };
    expect(debt.totalAmount).toBe(200);
    expect(debt.paidAmount).toBe(80);
    expect(debt.status).toBe('PARTIAL');

    await new DebtService(db).pay(String(debt.id), 120, context);
    const updated = db.prepare('SELECT paidAmount, status FROM Debt WHERE chargeId = ?').get(String(created.id)) as {
      paidAmount: number;
      status: string;
    };
    expect(updated.paidAmount).toBe(200);
    expect(updated.status).toBe('PAID');
    const charge = db.prepare('SELECT paidAmount, status FROM Charge WHERE id = ?').get(String(created.id)) as {
      paidAmount: number;
      status: string;
    };
    expect(charge.paidAmount).toBe(200);
    expect(charge.status).toBe('PAID');
  });

  it('rolls back debt payment when the charge update fails', async () => {
    // Dedicated temp database so DROP TABLE Charge cannot affect the shared
    // db used by the other tests in this file (or trip FK constraints from
    // existing ChargeItem rows).
    const localDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-debt-rollback-'));
    const localDb = createDatabase(localDir);
    seedDatabase(localDb);
    runMigrations(localDb);
    try {
      const now = new Date().toISOString();
      localDb.prepare(
        `INSERT INTO Charge (
           id, clinicId, createdAt, updatedAt, deletedAt, patientId, number,
           totalAmount, paidAmount, refundedAmount, discount, status
         ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', 'CHG-ROLLBACK-DEBT', 500, 0, 0, 0, 'UNPAID')`,
      ).run('charge-rollback-debt', context.clinicId, now, now);
      localDb.prepare(
        `INSERT INTO Debt (
           id, clinicId, createdAt, updatedAt, deletedAt, chargeId, patientId,
           totalAmount, paidAmount, status
         ) VALUES (?, ?, ?, ?, NULL, 'charge-rollback-debt', 'patient-demo-001', 500, 0, 'UNPAID')`,
      ).run('debt-rollback-pay', context.clinicId, now, now);

      // Make the second write (Charge UPDATE) fail after the Debt update runs.
      localDb.prepare('DROP TABLE Charge').run();
      await expect(new DebtService(localDb).pay('debt-rollback-pay', 100, context)).rejects.toThrow();
      const debt = localDb.prepare('SELECT paidAmount FROM Debt WHERE id = ?').get('debt-rollback-pay') as {
        paidAmount: number;
      };
      expect(Number(debt.paidAmount)).toBe(0);
    } finally {
      localDb.close();
      fs.rmSync(localDir, { recursive: true, force: true });
    }
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

  it('dedupes follow-up generation when no templates exist', async () => {
    const service = new FollowUpService(db);
    const now = new Date().toISOString();
    db.prepare('DELETE FROM FollowUpTemplate').run();
    db.prepare(
      `INSERT INTO Visit (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, startTime, endTime, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', 'user-admin-001', ?, ?, 'COMPLETED')`,
    ).run('visit-followup-null-template', context.clinicId, now, now, now, now);
    db.prepare(
      `INSERT INTO Treatment (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, visitId, doctorId, code, name, category,
         price, quantity, status, completedDate
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', ?, 'user-admin-001', 'T-NULL', 'T', 'GENERAL', 100, 1, 'COMPLETED', ?)`,
    ).run('treatment-followup-null-template', context.clinicId, now, now, 'visit-followup-null-template', now.slice(0, 10));
    const first = await service.batchGenerate(2, context);
    expect(first.generated).toBeGreaterThanOrEqual(1);
    const second = await service.batchGenerate(2, context);
    expect(second.generated).toBe(0);
  });

  it('rejects invalid completed dates during follow-up generation', async () => {
    const service = new FollowUpService(db);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO FollowUpTemplate (
         id, clinicId, createdAt, updatedAt, deletedAt,
         name, daysAfter, content, isEnabled
       ) VALUES (?, ?, ?, ?, NULL, 'Bad Date Template', 1, 'bad date', 1)`,
    ).run('template-bad-date', context.clinicId, now, now);
    db.prepare(
      `INSERT INTO Visit (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, startTime, endTime, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', 'user-admin-001', ?, ?, 'COMPLETED')`,
    ).run('visit-followup-bad-date', context.clinicId, now, now, now, now);
    db.prepare(
      `INSERT INTO Treatment (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, visitId, doctorId, code, name, category,
         price, quantity, status, completedDate
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', ?, 'user-admin-001', 'T-BAD', 'T', 'GENERAL', 100, 1, 'COMPLETED', 'not-a-date')`,
    ).run('treatment-followup-bad-date', context.clinicId, now, now, 'visit-followup-bad-date');
    await expect(service.batchGenerate(2, context)).rejects.toThrow('Completed date is invalid');
  });

  it('completes follow-ups with clinic scope and status checks', () => {
    const service = new FollowUpService(db);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO FollowUp (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, planDate, content, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', ?, 'Complete me', 'PENDING')`,
    ).run('followup-complete', context.clinicId, now, now, now.slice(0, 10));
    expect(service.complete('followup-complete', context)).toMatchObject({ id: 'followup-complete', status: 'COMPLETED' });
    expect(() => service.complete('followup-complete', context)).toThrow('cannot be completed from current status');

    db.prepare(
      `INSERT INTO FollowUp (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, planDate, content, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', ?, 'In progress', 'IN_PROGRESS')`,
    ).run('followup-in-progress', context.clinicId, now, now, now.slice(0, 10));
    expect(service.complete('followup-in-progress', context).status).toBe('COMPLETED');

    db.prepare(
      `INSERT INTO FollowUp (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, planDate, content, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', ?, 'With result', 'PENDING')`,
    ).run('followup-result', context.clinicId, now, now, now.slice(0, 10));
    expect(service.complete('followup-result', context, ' 已回访 ')).toMatchObject({
      id: 'followup-result',
      status: 'COMPLETED',
      result: '已回访',
    });

    db.prepare(
      `INSERT INTO FollowUp (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, planDate, content, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', ?, 'Long result', 'PENDING')`,
    ).run('followup-long-result', context.clinicId, now, now, now.slice(0, 10));
    expect(() => service.complete('followup-long-result', context, 'x'.repeat(501)))
      .toThrow('at most 500 characters');

    db.prepare(
      `INSERT INTO FollowUp (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, planDate, content, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', ?, 'Other clinic', 'PENDING')`,
    ).run('followup-other-clinic', 'clinic-v2-other', now, now, now.slice(0, 10));
    expect(() => service.complete('followup-other-clinic', context)).toThrow('Follow-up not found');
    expect(() => service.complete('missing-followup', context)).toThrow('Follow-up not found');

    const failingRepository = new FollowUpService(db, {
      reminders: () => ({ items: [], total: 0, page: 1, pageSize: 100 }),
      insert: () => undefined,
      complete: () => 0,
    });
    db.prepare(
      `INSERT INTO FollowUp (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, planDate, content, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', ?, 'Race guard', 'PENDING')`,
    ).run('followup-race-guard', context.clinicId, now, now, now.slice(0, 10));
    expect(() => failingRepository.complete('followup-race-guard', context)).toThrow('cannot be completed');
  });

  it('summarizes active follow-up reminders by due state', () => {
    const service = new FollowUpService(db);
    const clock = new SystemClock();
    const today = clock.clinicDate();
    const yesterday = clock.clinicDate(Date.now() - 86_400_000);
    const tomorrow = clock.clinicDate(Date.now() + 86_400_000);
    const now = new Date().toISOString();
    const insert = (id: string, clinicId: string | null, planDate: string, status = 'PENDING') => {
      db.prepare(
        `INSERT INTO FollowUp (
           id, clinicId, createdAt, updatedAt, deletedAt,
           patientId, planDate, content, status
         ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', ?, 'summary', ?)`,
      ).run(id, clinicId, now, now, planDate, status);
    };
    const baseline = service.summary(context);
    const nullBaseline = service.summary({ ...context, clinicId: null });
    insert('followup-summary-overdue', context.clinicId, yesterday);
    insert('followup-summary-today', context.clinicId, today);
    insert('followup-summary-upcoming', context.clinicId, tomorrow, 'IN_PROGRESS');
    insert('followup-summary-completed', context.clinicId, tomorrow, 'COMPLETED');
    insert('followup-summary-other-clinic', 'clinic-v2-other', yesterday);
    insert('followup-summary-null-clinic', null, tomorrow);

    const scoped = service.summary(context);
    // 严格租户隔离：NULL clinicId 行对 scoped 查询不可见。
    expect(scoped.total - baseline.total).toBe(3);
    expect(scoped.overdue - baseline.overdue).toBe(1);
    expect(scoped.today - baseline.today).toBe(1);
    expect(scoped.upcoming - baseline.upcoming).toBe(1);
    // unscoped 全局视图能看见全部非 COMPLETED 插入（含 other-clinic 与 null-clinic 行）。
    const unscoped = service.summary({ ...context, clinicId: null });
    expect(unscoped.total - nullBaseline.total).toBe(5);
    expect(unscoped.overdue - nullBaseline.overdue).toBe(2);
    expect(unscoped.today - nullBaseline.today).toBe(1);
    expect(unscoped.upcoming - nullBaseline.upcoming).toBe(2);
  });

  it('batch completes follow-ups and exports reminder CSV', () => {
    const service = new FollowUpService(db);
    const now = new Date().toISOString();
    const insert = (id: string, planDate: string, status = 'PENDING') => {
      db.prepare(
        `INSERT INTO FollowUp (
           id, clinicId, createdAt, updatedAt, deletedAt,
           patientId, planDate, content, status
         ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', ?, 'batch', ?)`,
      ).run(id, context.clinicId, now, now, planDate, status);
    };
    insert('followup-batch-ok', '2026-08-01');
    insert('followup-batch-completed', '2026-08-02', 'COMPLETED');

    const batch = service.batchComplete(
      ['followup-batch-ok', 'followup-batch-completed', 'followup-batch-missing'],
      context,
      '  done  ',
    );
    expect(batch).toMatchObject({ completed: 1, skipped: 2 });
    expect(batch.errors.join(' ')).toContain('当前状态不能完成随访');
    expect(batch.errors.join(' ')).toContain('随访记录不存在');
    insert('followup-batch-zero', '2026-08-01');
    const failingBatch = new FollowUpService(db, {
      reminders: () => ({ items: [], total: 0, page: 1, pageSize: 100 }),
      insert: () => undefined,
      complete: () => 0,
    });
    expect(failingBatch.batchComplete(['followup-batch-zero'], context).errors.join(' '))
      .toContain('随访无法完成');
    expect(() => service.batchComplete([], context)).toThrow('1 to 500');
    expect(() => service.batchComplete(Array.from({ length: 501 }, (_, index) => `id-${index}`), context))
      .toThrow('1 to 500');
    expect(() => service.batchComplete(['followup-batch-ok'], context, 'x'.repeat(501)))
      .toThrow('at most 500 characters');

    const today = new SystemClock().clinicDate();
    const yesterday = new SystemClock().clinicDate(Date.now() - 86_400_000);
    const tomorrow = new SystemClock().clinicDate(Date.now() + 86_400_000);
    insert('followup-batch-export-overdue', yesterday);
    insert('followup-batch-export-today', today);
    insert('followup-batch-export-upcoming', tomorrow);
    const overdueCsv = service.remindersCsv('overdue', context);
    expect(overdueCsv).toContain('患者');
    expect(overdueCsv).toContain('followup-batch-export-overdue');
    expect(overdueCsv).not.toContain('followup-batch-export-today');
    expect(service.remindersCsv('today', context)).toContain('followup-batch-export-today');
    expect(service.remindersCsv('upcoming', context)).toContain('followup-batch-export-upcoming');
    expect(service.remindersCsv('all', context)).toContain('followup-batch-export-overdue');
    expect(() => service.remindersCsv('bad-scope', context)).toThrow('overdue, today, upcoming, or all');
  });

  it('masks phones and guards formula injection in follow-up CSV exports', () => {
    const service = new FollowUpService(db);
    const now = new Date().toISOString();
    // 恶意患者：姓名与电话均以公式字符开头（CWE-1236）。
    db.prepare(
      `INSERT INTO Patient (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, gender, phone, tags, allergies, medicalHistory,
         medicationHistory, systemicDiseases, source, active
       ) VALUES (?, ?, ?, ?, NULL, 'P-CSV-EVIL', '=1+1', 'UNKNOWN', '=SUM(1,2)', '[]', '', '', '', '', 'OTHER', 1)`,
    ).run('patient-csv-evil', context.clinicId, now, now);
    db.prepare(
      `INSERT INTO FollowUp (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, planDate, content, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient-csv-evil', '2026-08-01', 'evil', 'PENDING')`,
    ).run('followup-csv-evil', context.clinicId, now, now);
    const csv = service.remindersCsv('all', context);
    // 公式注入防护：= 前缀的单元格以单引号转义（姓名未掩码，走 csvCell 防护）。
    expect(csv).toContain(`"'=1+1"`);
    expect(csv).not.toContain('"=1+1"');
    // 电话先经掩码处理：=SUM(1,2) 无 7 位以上数字 → 全掩为星号，原始公式不出现在导出中。
    expect(csv).not.toContain('=SUM(1,2)');
    expect(csv).toContain('"*********"');
    // 种子患者电话 13800000000 导出时被掩码为 138****0000。
    expect(csv).toContain('138****0000');
    expect(csv).not.toContain('13800000000');
    // 掩码函数边界：短号全掩、空值返回空串。
    expect(maskPhoneForExport('13812345678')).toBe('138****5678');
    expect(maskPhoneForExport('12345')).toBe('*****');
    expect(maskPhoneForExport(null)).toBe('');
    expect(maskPhoneForExport(undefined)).toBe('');
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

  it('calculates a patient risk score', () => {
    const service = new PatientRiskService(db);
    const result = service.calculate('patient-demo-001', context);
    expect(result).toHaveProperty('cariesScore');
    expect(result).toHaveProperty('periodontalScore');
  });

  it('bulk imports patients', async () => {
    const service = new BulkImportService(db);
    const result = await service.importRows('patients', [
      { code: 'BULK-001', name: 'Bulk Patient', gender: 'UNKNOWN', phone: '13700000001', source: 'OTHER' },
    ], context);
    expect(result.imported).toBe(1);
  });

  it('collects non-systematic bulk import insert errors and keeps importing', async () => {
    // Dedicated temp database so the failed inserts cannot pollute the shared db.
    const localDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-bulk-row-error-'));
    const localDb = createDatabase(localDir);
    seedDatabase(localDb);
    runMigrations(localDb);
    const insert = vi.spyOn(SqliteRepository.prototype, 'insert');
    try {
      insert.mockImplementation(() => { throw new Error('row level failure'); });
      const result = await new BulkImportService(localDb).importRows('patients', [
        { code: 'BULK-ROW-1', name: 'Row One', gender: 'UNKNOWN', phone: '13700000011', source: 'OTHER' },
        { code: 'BULK-ROW-2', name: 'Row Two', gender: 'UNKNOWN', phone: '13700000012', source: 'OTHER' },
      ], context);
      expect(result).toMatchObject({ imported: 0, failed: 2, errors: ['row level failure', 'row level failure'] });
    } finally {
      insert.mockRestore();
      localDb.close();
      fs.rmSync(localDir, { recursive: true, force: true });
    }
  });

  it('aborts bulk import with a 500 AppError on systematic insert errors', async () => {
    const localDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-bulk-sys-error-'));
    const localDb = createDatabase(localDir);
    seedDatabase(localDb);
    runMigrations(localDb);
    const insert = vi.spyOn(SqliteRepository.prototype, 'insert');
    try {
      insert.mockImplementation(() => {
        throw Object.assign(new Error('database or disk is full'), { code: 'SQLITE_FULL' });
      });
      let error: unknown;
      try {
        await new BulkImportService(localDb).importRows('patients', [
          { code: 'BULK-SYS-1', name: 'Sys One', gender: 'UNKNOWN', phone: '13700000021', source: 'OTHER' },
        ], context);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({ status: 500, code: 'IMPORT_SYSTEM_ERROR' });
      expect((error as Error).message).toContain('批量导入中止');
      expect((error as Error).message).toContain('database or disk is full');
      expect(localDb.prepare('SELECT id FROM Patient WHERE code = ?').get('BULK-SYS-1')).toBeUndefined();
    } finally {
      insert.mockRestore();
      localDb.close();
      fs.rmSync(localDir, { recursive: true, force: true });
    }
  });

  it('reports the rolled-back imported row count when a chunk COMMIT fails systematically', async () => {
    const localDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-bulk-commit-'));
    const localDb = createDatabase(localDir);
    seedDatabase(localDb);
    runMigrations(localDb);
    const originalExec = localDb.exec.bind(localDb);
    const exec = vi.spyOn(localDb, 'exec');
    try {
      exec.mockImplementation((sql: string) => {
        if (sql === 'COMMIT') {
          throw Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' });
        }
        return originalExec(sql);
      });
      let error: unknown;
      try {
        await new BulkImportService(localDb).importRows('patients', [
          { code: 'BULK-COMMIT-1', name: 'Commit One', gender: 'UNKNOWN', phone: '13700000031', source: 'OTHER' },
          { code: 'BULK-COMMIT-2', name: 'Commit Two', gender: 'UNKNOWN', phone: '13700000032', source: 'OTHER' },
        ], context);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({ status: 500, code: 'IMPORT_SYSTEM_ERROR' });
      expect((error as Error).message).toContain('前 0 条已导入');
      expect((error as Error).message).toContain('database is locked');
      expect(localDb.prepare('SELECT id FROM Patient WHERE code = ?').get('BULK-COMMIT-1')).toBeUndefined();
      expect(localDb.prepare('SELECT id FROM Patient WHERE code = ?').get('BULK-COMMIT-2')).toBeUndefined();
    } finally {
      exec.mockRestore();
      localDb.close();
      fs.rmSync(localDir, { recursive: true, force: true });
    }
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

  it('rotates refresh tokens and rejects reused tokens', async () => {
    const service = new AuthService(db);
    const session = await service.login('admin', 'REDACTED');
    expect(session.refreshToken).toBeDefined();
    const refreshed = await service.refresh(session.refreshToken);
    expect(refreshed.refreshToken).not.toBe(session.refreshToken);
    // B-M9：轮换成功后旧 token 进入 5 秒窗口缓存（并发刷新共享同一新会话），
    // 窗口内重复 refresh 返回同一会话；窗口过后重放才触发 RFC 6819 吊销。
    const replayed = await service.refresh(session.refreshToken);
    expect(replayed.refreshToken).toBe(refreshed.refreshToken);
    await new Promise((resolve) => setTimeout(resolve, 5100));
    const versionBeforeReplay = (db.prepare("SELECT tokenVersion FROM User WHERE username = 'admin'").get() as { tokenVersion: number }).tokenVersion;
    await expect(service.refresh(session.refreshToken)).rejects.toThrow('Invalid refresh token');
    // M5：重用检测后按 RFC 6819 吊销整个会话族——轮换出的 refresh token 也失效，且当前 refresh token 被清除、tokenVersion 递增
    await expect(service.refresh(refreshed.refreshToken)).rejects.toThrow('Invalid refresh token');
    const afterReplay = db.prepare("SELECT refreshToken, tokenVersion FROM User WHERE username = 'admin'").get() as {
      refreshToken: string | null;
      tokenVersion: number;
    };
    expect(afterReplay.refreshToken).toBeNull();
    expect(afterReplay.tokenVersion).toBe(versionBeforeReplay + 1);
    await service.logout(refreshed.refreshToken);
    await expect(service.refresh(refreshed.refreshToken)).rejects.toThrow('Invalid refresh token');
  }, 15000);

  it('maps create-user unique races to conflict errors', async () => {
    const repo = {
      findByUsername: () => null,
      insertUser: () => { throw new Error('UNIQUE constraint failed: User.username'); },
    } as unknown as AuthRepository;
    const auth = new AuthService(db, repo);
    await expect(auth.createUser({
      username: 'race-user',
      password: 'password123',
      name: 'Race User',
      role: 'DOCTOR',
    }, context)).rejects.toThrow('Username already exists');
  });

  it('rethrows non-unique create-user repository failures', async () => {
    const repo = {
      findByUsername: () => null,
      insertUser: () => { throw new Error('database down'); },
    } as unknown as AuthRepository;
    const auth = new AuthService(db, repo);
    await expect(auth.createUser({
      username: 'down-user',
      password: 'password123',
      name: 'Down User',
      role: 'DOCTOR',
    }, context)).rejects.toThrow('database down');
  });

  it('restricts non-BOSS user creation to the creator clinic scope (S-L6)', async () => {
    const auth = new AuthService(db);
    // 第二个诊所（BOSS 可跨诊所创建并分配成员）
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO Clinic (id, clinicId, createdAt, updatedAt, deletedAt, code, name, active)
       VALUES ('clinic-v2-002', NULL, ?, ?, NULL, 'B', 'Branch Clinic', 1)`,
    ).run(now, now);
    // BOSS 在 clinic-v2-001 创建 DOCTOR（仅属于本诊所；BOSS 为全局管理员）
    const doctor = await auth.createUser({
      username: 'doctor-local',
      password: 'password123',
      name: 'Local Doctor',
      role: 'DOCTOR',
      clinicIds: ['clinic-v2-001'],
    }, context);
    // 负向：会话上下文指向自己未加入的诊所（例如被错误切换的 currentClinic）→ FORBIDDEN
    const outsiderContext: AppContext = { ...context, userId: doctor.id, clinicId: 'clinic-v2-002', role: 'DOCTOR' };
    await expect(auth.createUser({
      username: 'outsider-user',
      password: 'password123',
      name: 'Outsider User',
      role: 'DOCTOR',
    }, outsiderContext)).rejects.toThrow('Cannot create users outside your clinic scope');
    // 正向：DOCTOR 在自己的诊所范围内创建用户成功
    const doctorInOwnClinic: AppContext = { ...context, userId: doctor.id, clinicId: 'clinic-v2-001', role: 'DOCTOR' };
    const created = await auth.createUser({
      username: 'inner-user',
      password: 'password123',
      name: 'Inner User',
      role: 'DOCTOR',
    }, doctorInOwnClinic);
    expect(created.username).toBe('inner-user');
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

  it('rejects user updates when the repository reports zero affected rows', async () => {
    const fakeAuth = {
      findById: () => ({
        id: 'user-1',
        clinicId: 'clinic-v2-001',
        username: 'u',
        passwordHash: 'hash',
        name: 'n',
        role: 'BOSS',
        active: true,
        loginAttempts: 0,
        lockedUntil: null,
        tokenVersion: 0,
        refreshToken: null,
        refreshTokenExpiresAt: null,
        createdAt: '2026-08-04T00:00:00.000Z',
        updatedAt: '2026-08-04T00:00:00.000Z',
        deletedAt: null,
      }),
      updateUser: () => 0,
      resetPassword: () => 0,
    } as unknown as AuthRepository;
    const service = new AuthService(db, fakeAuth);
    await expect(service.updateUser('user-1', { name: 'x' }, context)).rejects.toThrow('User not found');
    await expect(service.resetPassword('user-1', 'password123', context)).rejects.toThrow('User not found');
  });

  it('serves repeated dashboard calls from the TTL cache without re-running aggregation SQL', () => {
    const service = new StatsService(db);
    const prepare = vi.spyOn(db, 'prepare');
    try {
      service.dashboard(context);
      expect(prepare).toHaveBeenCalledTimes(1);

      const cached = service.dashboard(context);
      expect(prepare).toHaveBeenCalledTimes(1);
      expect(cached).toHaveProperty('patients');
      expect(cached).toHaveProperty('pendingFollowUps');

      // A different clinic is a different cache key, so it recomputes.
      service.dashboard({ ...context, clinicId: 'clinic-v2-002' });
      expect(prepare).toHaveBeenCalledTimes(2);
    } finally {
      prepare.mockRestore();
    }
  });

  it('keeps revenue cache keys distinct per date range and granularity', () => {
    const service = new StatsService(db);
    const prepare = vi.spyOn(db, 'prepare');
    try {
      service.revenue('2026-01-01', '2026-01-31', 'month', context);
      expect(prepare).toHaveBeenCalledTimes(1);
      service.revenue('2026-01-01', '2026-01-31', 'month', context);
      expect(prepare).toHaveBeenCalledTimes(1);

      service.revenue('2026-02-01', '2026-02-28', 'month', context);
      expect(prepare).toHaveBeenCalledTimes(2);
      service.revenue('2026-01-01', '2026-01-31', 'day', context);
      expect(prepare).toHaveBeenCalledTimes(3);
    } finally {
      prepare.mockRestore();
    }
  });

  it('recomputes dashboard aggregation after the 30s TTL expires', () => {
    const service = new StatsService(db);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-05T00:00:00.000Z'));
    const prepare = vi.spyOn(db, 'prepare');
    try {
      service.dashboard(context);
      expect(prepare).toHaveBeenCalledTimes(1);
      service.dashboard(context);
      expect(prepare).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(29_999);
      service.dashboard(context);
      expect(prepare).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(1_001);
      service.dashboard(context);
      expect(prepare).toHaveBeenCalledTimes(2);
    } finally {
      prepare.mockRestore();
      vi.useRealTimers();
    }
  });

  it('pulls sync changes with a cursor across the 1000-row page', () => {
    const service = new SyncService(db);
    const device = service.registerDevice('sync-cursor-device', 'Cursor Test', context);
    // 起点取本库当前最新 createdAt +1ms：新语义下与游标同毫秒的行也会投递（防丢变更），
    // 必须跳过同毫秒的遗留行，确保后续插入的 1001 条是唯一可见的新变更。
    const maxRow = db.prepare('SELECT MAX(createdAt) AS m FROM SyncChange WHERE clinicId = ?').get(context.clinicId) as { m: string | null };
    const since = maxRow.m ? new Date(Date.parse(maxRow.m) + 1).toISOString() : new Date(0).toISOString();
    const createdAtFor = (index: number) => new Date(Date.parse(since) + index + 1).toISOString();
    try {
      for (let index = 0; index < 1001; index += 1) {
        const createdAt = createdAtFor(index);
        db.prepare(
          `INSERT INTO SyncChange (
             id, clinicId, createdAt, updatedAt, deletedAt,
             tableName, recordId, operation, deviceId
           ) VALUES (?, ?, ?, ?, NULL, 'Patient', ?, 'INSERT', 'other-device')`,
        ).run(`sync-cursor-change-${index}`, context.clinicId, createdAt, createdAt, `sync-cursor-record-${index}`);
      }

      const first = service.pull(since, 'sync-cursor-device', device.token, context);
      expect(first.changes).toHaveLength(1000);
      expect(first.changes[0].recordId).toBe('sync-cursor-record-0');
      expect(first.changes[999].recordId).toBe('sync-cursor-record-999');
      expect(first.cursor).toBe(`${createdAtFor(999)}|${first.changes[999].rowid}`);

      const second = service.pull(first.cursor, 'sync-cursor-device', device.token, context);
      expect(second.changes).toHaveLength(1);
      expect(second.changes[0].recordId).toBe('sync-cursor-record-1000');
      expect(second.cursor).toBe(`${createdAtFor(1000)}|${second.changes[0].rowid}`);

      const empty = service.pull(second.cursor, 'sync-cursor-device', device.token, context);
      expect(empty.changes).toHaveLength(0);
      expect(empty.cursor).toBe(second.cursor);
    } finally {
      db.prepare('DELETE FROM SyncChange WHERE clinicId = ? AND recordId LIKE ?').run(context.clinicId, 'sync-cursor-record-%');
      db.prepare('DELETE FROM SyncDevice WHERE deviceId = ?').run('sync-cursor-device');
    }
  });

  it('does not lose sync changes sharing the same createdAt across the 1000-row page', () => {
    const service = new SyncService(db);
    const device = service.registerDevice('sync-tie-device', 'Tie Test', context);
    // 起点 = 当前最新 createdAt +1ms，所有新行共用该时间点：与游标同毫秒的遗留行
    // 已被排除，且该毫秒恰好没有旧数据，能精确验证同毫秒分页不丢行。
    const maxRow = db.prepare('SELECT MAX(createdAt) AS m FROM SyncChange WHERE clinicId = ?').get(context.clinicId) as { m: string | null };
    const since = maxRow.m ? new Date(Date.parse(maxRow.m) + 1).toISOString() : new Date(0).toISOString();
    const tieTime = since;
    try {
      // 1001 条变更共用同一 createdAt（同毫秒并列），且超出单页 LIMIT 1000。
      for (let index = 0; index < 1001; index += 1) {
        db.prepare(
          `INSERT INTO SyncChange (
             id, clinicId, createdAt, updatedAt, deletedAt,
             tableName, recordId, operation, deviceId
           ) VALUES (?, ?, ?, ?, NULL, 'Patient', ?, 'INSERT', 'other-device')`,
        ).run(`sync-tie-change-${index}`, context.clinicId, tieTime, tieTime, `sync-tie-record-${index}`);
      }

      const first = service.pull(since, 'sync-tie-device', device.token, context);
      expect(first.changes).toHaveLength(1000);
      const firstIds = new Set(first.changes.map((row) => String(row.recordId)));
      expect(firstIds.size).toBe(1000);

      const second = service.pull(first.cursor, 'sync-tie-device', device.token, context);
      expect(second.changes).toHaveLength(1);
      expect(second.changes[0].recordId).toBe('sync-tie-record-1000');
      expect(second.cursor).toMatch(/^.+\.\d{3}Z\|\d+$/);

      const third = service.pull(second.cursor, 'sync-tie-device', device.token, context);
      expect(third.changes).toHaveLength(0);
      expect(third.cursor).toBe(second.cursor);
    } finally {
      db.prepare('DELETE FROM SyncChange WHERE clinicId = ? AND recordId LIKE ?').run(context.clinicId, 'sync-tie-record-%');
      db.prepare('DELETE FROM SyncDevice WHERE deviceId = ?').run('sync-tie-device');
    }
  });

  it('pushes sync changes in transactional batches and persists every row', async () => {
    const service = new SyncService(db);
    const device = service.registerDevice('sync-push-batch-device', 'Push Batch', context);
    const changes = Array.from({ length: 300 }, (_, index) => ({
      tableName: 'Patient',
      recordId: `sync-push-batch-record-${index}`,
      operation: 'INSERT',
      updatedAt: new Date().toISOString(),
      data: {
        code: `SYNC-PUSH-BATCH-${index}`,
        name: `Sync Push Batch ${index}`,
        gender: 'UNKNOWN',
        phone: `13${String(400000000 + index)}`,
        source: 'OTHER',
        active: true,
      },
    }));
    try {
      const result = await service.push({
        deviceId: 'sync-push-batch-device',
        deviceToken: device.token,
        changes,
      }, context);
      expect(result.accepted).toBe(300);
      expect(result.failed).toBe(0);
      expect(result.errors).toHaveLength(0);

      const patients = db.prepare('SELECT COUNT(*) AS n FROM Patient WHERE clinicId = ? AND id LIKE ?').get(context.clinicId, 'sync-push-batch-record-%') as { n: number };
      expect(Number(patients.n)).toBe(300);
      const changeLog = db.prepare('SELECT COUNT(*) AS n FROM SyncChange WHERE deviceId = ? AND recordId LIKE ?').get('sync-push-batch-device', 'sync-push-batch-record-%') as { n: number };
      expect(Number(changeLog.n)).toBe(300);
    } finally {
      db.prepare('DELETE FROM Patient WHERE clinicId = ? AND id LIKE ?').run(context.clinicId, 'sync-push-batch-record-%');
      db.prepare('DELETE FROM SearchIndex WHERE resource = ? AND recordId LIKE ?').run('Patient', 'sync-push-batch-record-%');
      db.prepare('DELETE FROM SyncChange WHERE deviceId = ? AND recordId LIKE ?').run('sync-push-batch-device', 'sync-push-batch-record-%');
      db.prepare('DELETE FROM SyncDevice WHERE deviceId = ?').run('sync-push-batch-device');
    }
  });

  it('reports wechat provider HTTP and network failures with detail', async () => {
    const provider = new HttpWechatProvider('https://wechat.test', 'app', 'secret');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    try {
      const httpFailure = await provider.send({ id: 'wechat-http-fail' });
      expect(httpFailure).toEqual({ ok: false, result: 'http_503', detail: 'status 503' });
    } finally {
      vi.unstubAllGlobals();
    }
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    try {
      const networkFailure = await provider.send({ id: 'wechat-net-fail' });
      expect(networkFailure).toEqual({ ok: false, result: 'network_error', detail: 'ECONNREFUSED' });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('logs wechat send failures with the provider detail', async () => {
    const repo: WechatMessageRepository = {
      findById: (id) => ({ id: String(id), status: 'PENDING', clinicId: context.clinicId }),
      markSent: () => 1,
    };
    const provider = {
      name: 'failing',
      isConfigured: () => true,
      send: async () => ({ ok: false, result: 'network_error', detail: 'connection refused' }),
    };
    const loggerError = vi.fn();
    const logger = { error: loggerError } as unknown as Logger;
    const service = new WechatService(db, repo, provider, logger);

    await expect(service.send('wechat-fail-detail', context)).rejects.toThrow('Wechat channel send failed');
    expect(loggerError).toHaveBeenCalledWith('wechat send failed', expect.objectContaining({
      action: 'wechat-send',
      recordId: 'wechat-fail-detail',
      result: 'network_error',
      detail: 'connection refused',
      traceId: 'test-trace',
    }));

    const batch = await service.sendBatch(['wechat-fail-detail'], context);
    expect(batch.sent).toBe(0);
    expect(batch.failed).toBe(1);
    expect(batch.results[0]).toEqual({
      id: 'wechat-fail-detail',
      status: 'FAILED',
      result: 'network_error',
      detail: 'connection refused',
    });
  });

  it('sends wechat batches with at most 10 concurrent provider calls and full coverage', async () => {
    const repo: WechatMessageRepository = {
      findById: (id) => ({ id: String(id), status: 'PENDING', clinicId: context.clinicId }),
      markSent: () => 1,
    };
    let concurrent = 0;
    let maxConcurrent = 0;
    const provider = {
      name: 'counting',
      isConfigured: () => true,
      send: async () => {
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((resolve) => setImmediate(resolve));
        concurrent -= 1;
        return { ok: true, result: 'sent' };
      },
    };
    const ids = Array.from({ length: 300 }, (_, index) => `wechat-concurrent-${index}`);
    const service = new WechatService(db, repo, provider);
    const result = await service.sendBatch(ids, context);
    expect(result.sent).toBe(300);
    expect(result.failed).toBe(0);
    expect(result.results).toHaveLength(300);
    expect(maxConcurrent).toBeLessThanOrEqual(10);
  });

  it('keeps individual wechat batch failures without aborting the batch', async () => {
    const repo: WechatMessageRepository = {
      findById: (id) => ({ id: String(id), status: 'PENDING', clinicId: context.clinicId }),
      markSent: () => 1,
    };
    const provider = {
      name: 'flaky',
      isConfigured: () => true,
      send: async (payload: { id: string }) => {
        if (Number(payload.id.split('-').pop()) % 2 === 1) {
          return { ok: false, result: 'http_503', detail: 'status 503' };
        }
        return { ok: true, result: 'sent' };
      },
    };
    const ids = Array.from({ length: 25 }, (_, index) => `wechat-flaky-${index}`);
    const service = new WechatService(db, repo, provider);
    const result = await service.sendBatch(ids, context);
    expect(result.results).toHaveLength(25);
    expect(result.failed).toBe(12);
    expect(result.sent).toBe(13);
    expect(result.results[1]).toMatchObject({
      id: 'wechat-flaky-1',
      status: 'FAILED',
      result: 'http_503',
      detail: 'status 503',
    });
  });
});
