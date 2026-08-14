import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../../infrastructure/database';
import { runMigrations } from '../../../infrastructure/migrations';
import { ConflictError, NotFoundError, ValidationError } from '../../../infrastructure/errors';
import type { AppContext } from '../../../../domain/contracts';
import { ChargeService } from './charge.service';
import { MemberCardService } from './member-card.service';
import { AppointmentService } from '../appointment.service';
import { InventoryService } from '../inventory-service';

describe('ChargeService coverage', () => {
  let db: Database.Database;
  let dataDir: string;
  let context: AppContext;
  const now = '2026-08-06T10:00:00.000Z';
  const nullContext: AppContext = {
    userId: 'user-admin-001',
    clinicId: null,
    role: 'BOSS',
    traceId: 'trace-null',
    now: () => new Date(),
  };

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-charge-service-'));
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
    db.prepare(
      `INSERT INTO TreatmentCatalog (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, category, price, remark, costType, anesthesia, parentId, businessCategory
       ) VALUES (?, ?, ?, ?, NULL, 'CAT-1', 'Catalog One', 'GENERAL', 100, NULL, NULL, 0, NULL, NULL)`,
    ).run('cat-1', context.clinicId, now, now);
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  function validItems(overrides: Array<{
    name: string;
    category: string;
    price: number;
    quantity: number;
    teethNumbers?: string[];
    costType?: 'SERVICE' | 'MATERIAL';
    catalogId?: string;
  }> = []): Array<{
    name: string;
    category: string;
    price: number;
    quantity: number;
    teethNumbers?: string[];
    costType?: 'SERVICE' | 'MATERIAL';
    catalogId?: string;
  }> {
    return overrides.length > 0 ? overrides : [{ name: 'Exam', category: 'GENERAL', price: 100, quantity: 1 }];
  }

  function insertPatientEdge(): void {
    // 共享库内多个测试复用同一患者行：OR IGNORE 保证幂等。
    db.prepare(
      `INSERT OR IGNORE INTO Patient (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, gender, phone, tags, allergies, medicalHistory,
         medicationHistory, systemicDiseases, source, active
       ) VALUES (?, ?, ?, ?, NULL, 'EDGE-P', 'Edge Patient', 'UNKNOWN', '13600000001',
         '[]', '[]', '[]', '[]', '[]', 'WALK_IN', 1)`,
    ).run('patient-edge', context.clinicId, now, now);
  }

  it('rejects missing and mismatched catalog prices', async () => {
    const service = new ChargeService(db);
    await expect(service.create({
      patientId: 'patient-demo-001',
      items: validItems([{ name: 'Missing', category: 'GENERAL', price: 100, quantity: 1, catalogId: 'cat-missing' }]),
    }, context)).rejects.toThrow(ValidationError);
    await expect(service.create({
      patientId: 'patient-demo-001',
      items: validItems([{ name: 'Mismatch', category: 'GENERAL', price: 200, quantity: 1, catalogId: 'cat-1' }]),
    }, context)).rejects.toThrow(ValidationError);
  });

  it('cancels unpaid charges and rejects paid charges', async () => {
    const service = new ChargeService(db);
    const created = await service.create({
      patientId: 'patient-demo-001',
      items: validItems([{ name: 'Cancel Me', category: 'GENERAL', price: 100, quantity: 1, catalogId: 'cat-1' }]),
    }, context);
    await service.cancel(String(created.id), context);
    const charge = db.prepare('SELECT deletedAt FROM Charge WHERE id = ?').get(String(created.id)) as { deletedAt: string | null };
    expect(charge.deletedAt).not.toBeNull();

    const paid = await service.create({
      patientId: 'patient-demo-001',
      items: validItems([{ name: 'Paid', category: 'GENERAL', price: 400, quantity: 1 }]),
    }, context);
    db.prepare("UPDATE Charge SET status = 'PAID', paidAmount = 400 WHERE id = ?").run(String(paid.id));
    await expect(service.cancel(String(paid.id), context)).rejects.toThrow(ConflictError);
  });

  it('updates an existing debt when the charge is paid partially and fully', async () => {
    const service = new ChargeService(db);
    const created = await service.create({
      patientId: 'patient-demo-001',
      items: validItems([{ name: 'Debt Item', category: 'GENERAL', price: 500, quantity: 1 }]),
    }, context);
    const chargeId = String(created.id);
    db.prepare(
      `INSERT INTO Debt (
         id, clinicId, createdAt, updatedAt, deletedAt,
         chargeId, patientId, totalAmount, paidAmount, status
       ) VALUES (?, ?, ?, ?, NULL, ?, 'patient-demo-001', 500, 0, 'UNPAID')`,
    ).run('debt-charge-coverage', context.clinicId, now, now, chargeId);

    await service.pay(chargeId, 200, 'CASH', undefined, context);
    let debt = db.prepare('SELECT paidAmount, status FROM Debt WHERE id = ?').get('debt-charge-coverage') as { paidAmount: number; status: string };
    expect(Number(debt.paidAmount)).toBe(200);
    expect(debt.status).toBe('PARTIAL');

    await service.pay(chargeId, 300, 'CASH', undefined, context);
    debt = db.prepare('SELECT paidAmount, status FROM Debt WHERE id = ?').get('debt-charge-coverage') as { paidAmount: number; status: string };
    expect(Number(debt.paidAmount)).toBe(500);
    expect(debt.status).toBe('PAID');
  });

  it('rejects cancelling missing charges and charges with null paid columns', async () => {
    const service = new ChargeService(db);
    await expect(service.cancel('missing-charge', context)).rejects.toThrow(NotFoundError);
    const created = await service.create({
      patientId: 'patient-demo-001',
      items: validItems([{ name: 'NullPaid', category: 'GENERAL', price: 100, quantity: 1 }]),
    }, context);
    db.prepare('UPDATE Charge SET paidAmount = NULL, refundedAmount = NULL WHERE id = ?').run(String(created.id));
    await expect(service.cancel(String(created.id), context)).rejects.toThrow(ConflictError);
  });

  it('creates snapshots and cancels charges without a clinic tenant', async () => {
    const service = new ChargeService(db);
    const noClinic: AppContext = { ...context, clinicId: null };
    const snap = await service.create({
      patientId: 'patient-demo-001',
      items: validItems([{ name: 'Snap', category: 'GENERAL', price: 100, quantity: 1 }]),
      discountPlanSnapshot: { planId: 'plan-1' } as never,
    }, noClinic);
    expect(snap.id).toBeDefined();
    const result = await service.cancel(String(snap.id), noClinic);
    expect(result.status).toBe('CANCELLED');
  });

  it('records the payment method name with and without a clinic tenant', async () => {
    const service = new ChargeService(db);
    const created = await service.create({
      patientId: 'patient-demo-001',
      items: validItems([{ name: 'NamedPay', category: 'GENERAL', price: 100, quantity: 1 }]),
    }, context);
    await service.pay(String(created.id), 100, 'CASH', undefined, context, '微信支付');
    const row = db.prepare('SELECT payMethodName FROM Charge WHERE id = ?').get(String(created.id)) as { payMethodName: string | null };
    expect(row.payMethodName).toBe('微信支付');

    const second = await service.create({
      patientId: 'patient-demo-001',
      items: validItems([{ name: 'NamedPayNullClinic', category: 'GENERAL', price: 100, quantity: 1 }]),
    }, context);
    const noClinic: AppContext = { ...context, clinicId: null };
    await service.pay(String(second.id), 100, 'CASH', undefined, noClinic, '刷卡');

    const third = await service.create({
      patientId: 'patient-demo-001',
      items: validItems([{ name: 'DebtNullClinic', category: 'GENERAL', price: 200, quantity: 1 }]),
    }, context);
    await service.pay(String(third.id), 100, 'DEBT', undefined, noClinic);
    const debtRow = db.prepare('SELECT clinicId FROM Debt WHERE chargeId = ?').get(String(third.id)) as { clinicId: string | null };
    expect(debtRow.clinicId).toBe('clinic-v2-001');

    // context 完全缺省：可选链短路的防御路径
    const fourth = await service.create({
      patientId: 'patient-demo-001',
      items: validItems([{ name: 'NoContextDebt', category: 'GENERAL', price: 200, quantity: 1 }]),
    }, context);
    await service.pay(String(fourth.id), 100, 'DEBT', undefined, undefined);
    await service.pay(String(fourth.id), 100, 'DEBT', undefined, undefined);
  });

  it('marks the debt PAID and rejects null debt paid columns', async () => {
    const service = new ChargeService(db);
    const created = await service.create({
      patientId: 'patient-demo-001',
      items: validItems([{ name: 'DebtPaid', category: 'GENERAL', price: 300, quantity: 1 }]),
    }, context);
    const chargeId = String(created.id);
    await service.pay(chargeId, 100, 'DEBT', undefined, context);
    db.prepare('UPDATE Debt SET paidAmount = NULL WHERE chargeId = ?').run(chargeId);
    await expect(service.pay(chargeId, 50, 'DEBT', undefined, context)).rejects.toThrow('Debt payment state changed');
    db.prepare('UPDATE Debt SET paidAmount = 100 WHERE chargeId = ?').run(chargeId);
    await service.pay(chargeId, 200, 'DEBT', undefined, context);
    const debt = db.prepare('SELECT status FROM Debt WHERE chargeId = ?').get(chargeId) as { status: string };
    expect(debt.status).toBe('PAID');
  });

  it('skips fully reversed ledger rows and falls back for missing card ids', async () => {
    const service = new ChargeService(db);
    const memberCardService = new MemberCardService(db);
    const card = memberCardService.create({
      patientId: 'patient-demo-001',
      cardNo: `CHARGE-CARD-${Math.random().toString(36).slice(2, 8)}`,
      status: 'ACTIVE',
      level: 'NORMAL',
    }, context);
    await memberCardService.recharge(String(card.id), 1000, context);

    const a = await service.create({
      patientId: 'patient-demo-001',
      items: validItems([{ name: 'RevA', category: 'GENERAL', price: 100, quantity: 1 }]),
    }, context);
    await service.pay(String(a.id), 100, 'MEMBER_CARD', undefined, context);
    db.prepare("UPDATE PaymentLedger SET reversedAmount = amount WHERE type = 'PAY' AND chargeId = ?").run(String(a.id));
    const refundA = await service.refund(String(a.id), 100, 'fully reversed', context);
    expect(refundA.status).toBe('REFUNDED');

    const b = await service.create({
      patientId: 'patient-demo-001',
      items: validItems([{ name: 'RevB', category: 'GENERAL', price: 200, quantity: 1 }]),
    }, context);
    await service.pay(String(b.id), 200, 'MEMBER_CARD', undefined, context);
    db.prepare("UPDATE PaymentLedger SET cardId = NULL WHERE type = 'PAY' AND chargeId = ?").run(String(b.id));
    const refundB = await service.refund(String(b.id), 200, 'missing card id', context);
    expect(refundB.status).toBe('REFUNDED');
  });

  // ---- 主路径测试（自 services.spec.ts 聚合文件迁移，相对顺序保留）----

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

  // ---- 边缘分支测试（自 services-edge.spec.ts 聚合文件迁移，相对顺序保留）----

  it('covers charge creation, payment, refund, member-card, and debt branches', async () => {
    const service = new ChargeService(db);
    await expect(service.create({ patientId: 'patient-demo-001', items: [] }, context)).rejects.toThrow('At least one');
    await expect(service.create({
      patientId: 'patient-demo-001',
      items: [{ name: 'X', category: 'EXAM', price: 100, quantity: 1 }],
      discount: -1,
    }, context)).rejects.toThrow('Discount');
    await expect(service.create({ patientId: '', items: [{ name: 'X', category: 'EXAM', price: 100, quantity: 1 }] }, context))
      .rejects.toThrow('patientId');
    await expect(service.create({ patientId: 'patient-demo-001', items: [{ name: '', category: '', price: 100, quantity: 1 }] }, context))
      .rejects.toThrow('name and category');
    await expect(service.create({ patientId: 'patient-demo-001', items: [{ name: 'X', category: 'EXAM', price: 0, quantity: 1 }] }, context))
      .rejects.toThrow('positive integer');
    await expect(service.create({ patientId: 'patient-demo-001', items: [{ name: 'X', category: 'EXAM', price: 100, quantity: 0 }] }, context))
      .rejects.toThrow('quantity must be positive');

    const insertNow = new Date().toISOString();
    db.prepare(
      `INSERT OR IGNORE INTO Patient (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, gender, phone, tags, allergies, medicalHistory,
         medicationHistory, systemicDiseases, source, active
       ) VALUES (?, ?, ?, ?, NULL, 'EDGE-P', 'Edge Patient', 'UNKNOWN', '13600000001',
         '[]', '[]', '[]', '[]', '[]', 'WALK_IN', 1)`,
    ).run('patient-edge', context.clinicId, insertNow, insertNow);
    db.prepare(
      `INSERT OR IGNORE INTO Visit (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, startTime, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient-edge', 'user-admin-001', ?, 'IN_PROGRESS')`,
    ).run('visit-edge', context.clinicId, insertNow, insertNow, insertNow);
    db.prepare(
      `INSERT OR IGNORE INTO Patient (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, gender, phone, tags, allergies, medicalHistory,
         medicationHistory, systemicDiseases, source, active
       ) VALUES (?, ?, ?, ?, NULL, 'EDGE-P-OTHER', 'Other Edge Patient', 'UNKNOWN', '13600000009',
         '[]', '[]', '[]', '[]', '[]', 'WALK_IN', 1)`,
    ).run('patient-edge-other', context.clinicId, insertNow, insertNow);
    db.prepare(
      `INSERT OR IGNORE INTO Visit (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, startTime, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient-edge-other', 'user-admin-001', ?, 'IN_PROGRESS')`,
    ).run('visit-edge-other', context.clinicId, insertNow, insertNow, insertNow);
    await expect(service.create({
      patientId: 'patient-edge',
      visitId: 'missing-visit',
      items: [{ name: 'Exam', category: 'EXAM', price: 100, quantity: 1 }],
    }, context)).rejects.toThrow('Visit not found');
    await expect(service.create({
      patientId: 'patient-edge',
      visitId: 'visit-edge-other',
      items: [{ name: 'Exam', category: 'EXAM', price: 100, quantity: 1 }],
    }, context)).rejects.toThrow('Visit does not belong to the patient');
    await expect(service.create({
      patientId: 'patient-edge',
      doctorId: 'missing-doctor',
      items: [{ name: 'Exam', category: 'EXAM', price: 100, quantity: 1 }],
    }, context)).rejects.toThrow('Doctor not found');
    const created = await service.create({
      patientId: 'patient-edge',
      visitId: 'visit-edge',
      doctorId: 'user-admin-001',
      items: [{ name: 'Exam', category: 'EXAM', price: 100, quantity: 1 }],
      remark: 'r',
    }, context);
    const chargeId = String(created.id);
    await expect(service.pay(chargeId, 1, 'NOT_A_REAL_METHOD', undefined, context))
      .rejects.toThrow('Invalid payment method');
    await expect(service.pay('missing-charge', 1, 'CASH', undefined, context)).rejects.toThrow('Charge not found');
    db.prepare('UPDATE Charge SET status = ? WHERE id = ?').run('CANCELLED', chargeId);
    await expect(service.pay(chargeId, 1, 'CASH', undefined, context)).rejects.toThrow('cannot be paid');
    db.prepare('UPDATE Charge SET status = ? WHERE id = ?').run('UNPAID', chargeId);
    await expect(service.pay(chargeId, 0, 'CASH', undefined, context)).rejects.toThrow('positive');
    const partial = await service.pay(chargeId, 40, 'CASH', undefined, context);
    expect(partial.status).toBe('PARTIAL');
    const paid = await service.pay(chargeId, 60, 'CASH', 'edge-pay-request', context);
    expect(paid.status).toBe('PAID');
    const duplicate = await service.pay(chargeId, 60, 'CASH', 'edge-pay-request', context);
    expect(duplicate.paidAmount).toBe(100);

    await expect(service.refund('missing-charge', 1, 'x', context)).rejects.toThrow('Charge not found');
    await expect(service.refund(chargeId, 0, 'x', context)).rejects.toThrow('Refund amount');
    const refunded = await service.refund(chargeId, 100, 'full', context);
    expect(refunded.status).toBe('REFUNDED');

    const memberCharge = await service.create({
      patientId: 'patient-edge',
      items: [{ name: 'Implant', category: 'IMPLANT', price: 200, quantity: 1 }],
    }, context);
    await expect(service.pay(String(memberCharge.id), 200, 'MEMBER_CARD', undefined, context)).rejects.toThrow('No active member card');

    db.prepare(
      `INSERT INTO MemberCard (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, cardNo, balance, totalRecharge, totalConsume,
         status, points, totalPoints, level
       ) VALUES (?, ?, ?, ?, NULL, ?, 'CARD-EDGE', 50, 0, 0, 'ACTIVE', 0, 0, 'NORMAL')`,
    ).run('card-edge', context.clinicId, insertNow, insertNow, 'patient-edge');
    await expect(service.pay(String(memberCharge.id), 200, 'MEMBER_CARD', undefined, context)).rejects.toThrow('Insufficient member card');

    const debtCharge = await service.create({
      patientId: 'patient-edge',
      items: [{ name: 'Debt', category: 'EXAM', price: 500, quantity: 1 }],
    }, context);
    await service.pay(String(debtCharge.id), 500, 'CASH', undefined, context);
    db.prepare(
      `INSERT INTO Debt (
         id, clinicId, createdAt, updatedAt, deletedAt,
         chargeId, patientId, totalAmount, paidAmount, status
       ) VALUES (?, ?, ?, ?, NULL, ?, 'patient-edge', 500, 500, 'PAID')`,
    ).run('debt-edge', context.clinicId, insertNow, insertNow, debtCharge.id);
    await service.refund(String(debtCharge.id), 50, 'debt refund', context);
  });

  it('covers null clinic context, missing charge context, member-card refund, and full debt refund', async () => {
    insertPatientEdge();
    const insertNow = new Date().toISOString();
    const service = new ChargeService(db);
    const appointments = new AppointmentService(db);
    const nullAppointment = await appointments.create({
      patientId: 'patient-edge',
      doctorId: 'user-admin-001',
      startTime: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      endTime: new Date(Date.now() + 3 * 86_400_000 + 3_600_000).toISOString(),
      type: 'REGULAR',
    }, nullContext);
    expect(nullAppointment).toHaveProperty('id');

    const nullCharge = await service.create({
      patientId: 'patient-edge',
      items: [{ name: 'Null Clinic', category: 'EXAM', price: 100, quantity: 1 }],
    }, nullContext);
    await service.pay(String(nullCharge.id), 100, 'CASH', undefined, undefined);
    const nullIdemCharge = await service.create({
      patientId: 'patient-edge',
      items: [{ name: 'Null Idem', category: 'EXAM', price: 50, quantity: 1 }],
    }, nullContext);
    await service.pay(String(nullIdemCharge.id), 50, 'CASH', 'null-pay-request', undefined);
    await service.refund(String(nullCharge.id), 100, 'null refund', nullContext);

    db.prepare(
      `INSERT INTO Patient (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, gender, phone, tags, allergies, medicalHistory,
         medicationHistory, systemicDiseases, source, active
       ) VALUES (?, NULL, ?, ?, NULL, 'NULL-CLINIC-P', 'Null Clinic Patient', 'UNKNOWN', '13600000008',
         '[]', '[]', '[]', '[]', '[]', 'WALK_IN', 1)`,
    ).run('patient-null-clinic', insertNow, insertNow);
    db.prepare(
      `INSERT INTO MemberCard (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, cardNo, balance, totalRecharge, totalConsume,
         status, points, totalPoints, level
       ) VALUES (?, NULL, ?, ?, NULL, ?, 'CARD-NULL-CLINIC', 500, 500, 0, 'ACTIVE', 0, 0, 'NORMAL')`,
    ).run('card-null-clinic', insertNow, insertNow, 'patient-null-clinic');
    const nullMemberCharge = await service.create({
      patientId: 'patient-null-clinic',
      items: [{ name: 'Null Member', category: 'IMPLANT', price: 100, quantity: 1 }],
    }, nullContext);
    await service.pay(String(nullMemberCharge.id), 100, 'MEMBER_CARD', undefined, nullContext);
    await service.refund(String(nullMemberCharge.id), 100, 'null member refund', nullContext);

    const inventory = new InventoryService(db);
    await inventory.createTransaction({ itemId: 'inventory-demo-001', type: 'OUT', quantity: 1 }, nullContext);

    db.prepare(
      `INSERT INTO Patient (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, gender, phone, tags, allergies, medicalHistory,
         medicationHistory, systemicDiseases, source, active
       ) VALUES (?, ?, ?, ?, NULL, 'MEMBER-REFUND', 'Member Refund', 'UNKNOWN', '13600000006',
         '[]', '[]', '[]', '[]', '[]', 'WALK_IN', 1)`,
    ).run('patient-member-refund', context.clinicId, insertNow, insertNow);
    db.prepare(
      `INSERT INTO MemberCard (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, cardNo, balance, totalRecharge, totalConsume,
         status, points, totalPoints, level
       ) VALUES (?, ?, ?, ?, NULL, ?, 'CARD-REFUND-MISSING', 500, 500, 0, 'ACTIVE', 0, 0, 'NORMAL')`,
    ).run('card-refund-missing', context.clinicId, insertNow, insertNow, 'patient-member-refund');
    const memberCharge = await service.create({
      patientId: 'patient-member-refund',
      items: [{ name: 'Member', category: 'IMPLANT', price: 200, quantity: 1 }],
    }, context);
    await service.pay(String(memberCharge.id), 200, 'MEMBER_CARD', undefined, context);
    db.prepare('UPDATE MemberCard SET status = ? WHERE id = ?').run('INACTIVE', 'card-refund-missing');
    await service.refund(String(memberCharge.id), 50, 'member missing', context);
    const cardAfterRefund = db.prepare('SELECT balance FROM MemberCard WHERE id = ?').get('card-refund-missing') as { balance: number };
    expect(Number(cardAfterRefund.balance)).toBe(350);

    const fullDebtCharge = await service.create({
      patientId: 'patient-edge',
      items: [{ name: 'Full Debt', category: 'EXAM', price: 300, quantity: 1 }],
    }, context);
    await service.pay(String(fullDebtCharge.id), 300, 'CASH', undefined, context);
    db.prepare(
      `INSERT INTO Debt (
         id, clinicId, createdAt, updatedAt, deletedAt,
         chargeId, patientId, totalAmount, paidAmount, status
       ) VALUES (?, ?, ?, ?, NULL, ?, 'patient-edge', 300, 300, 'PAID')`,
    ).run('debt-edge-full', context.clinicId, insertNow, insertNow, fullDebtCharge.id);
    await service.refund(String(fullDebtCharge.id), 300, 'full debt refund', context);

    const paidOverCharge = await service.create({
      patientId: 'patient-edge',
      items: [{ name: 'Paid Over Debt', category: 'EXAM', price: 500, quantity: 1 }],
    }, context);
    await service.pay(String(paidOverCharge.id), 500, 'CASH', undefined, context);
    db.prepare(
      `INSERT INTO Debt (
         id, clinicId, createdAt, updatedAt, deletedAt,
         chargeId, patientId, totalAmount, paidAmount, status
       ) VALUES (?, ?, ?, ?, NULL, ?, 'patient-edge', 100, 500, 'PAID')`,
    ).run('debt-edge-paid-over', context.clinicId, insertNow, insertNow, paidOverCharge.id);
    await service.refund(String(paidOverCharge.id), 50, 'paid over debt refund', context);
  });

  it('keeps the first payment time when a charge is paid in parts', async () => {
    insertPatientEdge();
    const service = new ChargeService(db);
    const created = await service.create({
      patientId: 'patient-edge',
      items: [{ name: 'PaidAt Edge', category: 'EXAM', price: 100, quantity: 1 }],
    }, context);
    let tick = new Date('2026-08-04T00:00:00.000Z');
    const tickingContext: AppContext = {
      ...context,
      now: () => {
        const value = new Date(tick);
        tick = new Date(tick.getTime() + 1000);
        return value;
      },
    };
    await service.pay(String(created.id), 40, 'CASH', undefined, tickingContext);
    await service.pay(String(created.id), 60, 'CASH', undefined, tickingContext);
    const row = db.prepare('SELECT paidAt FROM Charge WHERE id = ?').get(String(created.id)) as { paidAt: string };
    expect(row.paidAt).toBe('2026-08-04T00:00:00.000Z');
  });
});
