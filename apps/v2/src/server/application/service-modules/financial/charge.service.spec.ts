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

describe('ChargeService coverage', () => {
  let db: Database.Database;
  let dataDir: string;
  let context: AppContext;
  const now = '2026-08-06T10:00:00.000Z';

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
});
