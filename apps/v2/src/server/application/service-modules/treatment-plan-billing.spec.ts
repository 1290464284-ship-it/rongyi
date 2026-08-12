import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { ConflictError, NotFoundError, ValidationError } from '../../infrastructure/errors';
import type { AppContext } from '../../../domain/contracts';
import { TreatmentPlanBillingService } from './treatment-plan-billing';

describe('TreatmentPlanBillingService', () => {
  let db: Database.Database;
  let dataDir: string;
  let context: AppContext;
  const now = '2026-08-05T10:00:00.000Z';

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-treatment-plan-billing-'));
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
    // 种子演示预约使用真实当前时间，可能与固定测试日期重叠；移到遥远的未来。
    db.prepare(
      `UPDATE Appointment SET startTime = ?, endTime = ?, updatedAt = ? WHERE id = 'appointment-demo-001'`,
    ).run('2099-01-01T00:00:00.000Z', '2099-01-01T01:00:00.000Z', now);
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  function insertPlan(id: string, name: string, opts: { visitId?: string | null; discountType?: string | null; discountRate?: number | null } = {}): void {
    db.prepare(
      `INSERT INTO TreatmentPlan (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, visitId, doctorId, name, status, totalFee, remark,
         discountType, discountRate
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, 'ACTIVE', 0, NULL, ?, ?)`,
    ).run(
      id,
      context.clinicId,
      now,
      now,
      'patient-demo-001',
      opts.visitId === undefined ? null : opts.visitId,
      'user-admin-001',
      name,
      opts.discountType ?? null,
      opts.discountRate ?? null,
    );
  }

  function insertItem(
    planId: string,
    itemId: string,
    opts: { name?: string; category?: string; price?: number; quantity?: number; discountRate?: number | null; billed?: number; billedChargeId?: string | null } = {},
  ): void {
    db.prepare(
      `INSERT INTO TreatmentPlanItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         planId, code, name, category, price, quantity, teethNumbers, status,
         discountRate, billed, billedChargeId
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)`,
    ).run(
      itemId,
      context.clinicId,
      now,
      now,
      planId,
      `IT-${itemId}`,
      opts.name ?? `Item ${itemId}`,
      opts.category ?? 'GENERAL',
      opts.price ?? 0,
      opts.quantity ?? 1,
      JSON.stringify([]),
      opts.discountRate ?? null,
      opts.billed ?? 0,
      opts.billedChargeId ?? null,
    );
  }

  function planRow(id: string): Record<string, unknown> {
    return db.prepare('SELECT * FROM TreatmentPlan WHERE id = ?').get(id) as Record<string, unknown>;
  }

  function itemRow(id: string): Record<string, unknown> {
    return db.prepare('SELECT * FROM TreatmentPlanItem WHERE id = ?').get(id) as Record<string, unknown>;
  }

  function chargeRow(id: string): Record<string, unknown> {
    return db.prepare('SELECT * FROM Charge WHERE id = ?').get(id) as Record<string, unknown>;
  }

  it('setPlanDiscount applies a whole-plan discount and recomputes totalFee', () => {
    insertPlan('plan-whole', '整单折计划');
    insertItem('plan-whole', 'plan-whole-i1', { price: 10000, quantity: 1 });
    insertItem('plan-whole', 'plan-whole-i2', { price: 5000, quantity: 2 });

    const service = new TreatmentPlanBillingService(db);
    const result = service.setPlanDiscount('plan-whole', { discountType: 'WHOLE', discountRate: 10 }, context);

    expect(result).toEqual({ id: 'plan-whole', discountType: 'WHOLE', discountRate: 10, totalFee: 18000 });
    const row = planRow('plan-whole');
    expect(row.discountType).toBe('WHOLE');
    expect(row.discountRate).toBe(10);
    expect(row.totalFee).toBe(18000);
    expect(row.updatedAt).toBe(now);
  });

  it('setPlanDiscount stores DOUBLE distinctly while computing like WHOLE', () => {
    insertPlan('plan-double', '折上折计划');
    insertItem('plan-double', 'plan-double-i1', { price: 10000, quantity: 1 });
    insertItem('plan-double', 'plan-double-i2', { price: 5000, quantity: 2 });

    const service = new TreatmentPlanBillingService(db);
    const result = service.setPlanDiscount('plan-double', { discountType: 'DOUBLE', discountRate: 20 }, context);

    expect(result.discountType).toBe('DOUBLE');
    expect(result.totalFee).toBe(16000);
    expect(planRow('plan-double').discountType).toBe('DOUBLE');
    expect(planRow('plan-double').totalFee).toBe(16000);
  });

  it('setPlanDiscount rejects a plan that already has billed items', () => {
    insertPlan('plan-billed-discount', '已划价计划');
    insertItem('plan-billed-discount', 'plan-billed-discount-i1', { price: 10000, quantity: 1, billed: 1 });

    const service = new TreatmentPlanBillingService(db);
    expect(() => service.setPlanDiscount('plan-billed-discount', { discountType: 'WHOLE', discountRate: 10 }, context))
      .toThrow(ConflictError);
    const row = planRow('plan-billed-discount');
    expect(row.discountType).toBeNull();
    expect(row.discountRate).toBeNull();
  });

  it('setPlanDiscount treats NONE as no discount and stores null rate', () => {
    insertPlan('plan-none', '无折扣计划');
    insertItem('plan-none', 'plan-none-i1', { price: 10000, quantity: 1 });

    const service = new TreatmentPlanBillingService(db);
    const result = service.setPlanDiscount('plan-none', { discountType: 'NONE' }, context);

    expect(result).toEqual({ id: 'plan-none', discountType: 'NONE', discountRate: null, totalFee: 10000 });
    expect(planRow('plan-none').discountRate).toBeNull();
  });

  it('setPlanDiscount validates discountType and discountRate', () => {
    insertPlan('plan-invalid', '非法输入计划');
    insertItem('plan-invalid', 'plan-invalid-i1', { price: 10000, quantity: 1 });

    const service = new TreatmentPlanBillingService(db);
    expect(() => service.setPlanDiscount('plan-invalid', { discountType: 'XXX' as never }, context))
      .toThrow(ValidationError);
    expect(() => service.setPlanDiscount('plan-invalid', { discountType: 'WHOLE' }, context))
      .toThrow(new ValidationError('折扣率须在 0-100 之间'));
    expect(() => service.setPlanDiscount('plan-invalid', { discountType: 'WHOLE', discountRate: 101 }, context))
      .toThrow(new ValidationError('折扣率须在 0-100 之间'));
    expect(() => service.setPlanDiscount('plan-missing', { discountType: 'WHOLE', discountRate: 10 }, context))
      .toThrow(NotFoundError);
  });

  it('setItemDiscount applies a per-item discount and recomputes plan totalFee', () => {
    insertPlan('plan-item', '单条折扣计划');
    insertItem('plan-item', 'plan-item-i1', { price: 10000, quantity: 1 });
    insertItem('plan-item', 'plan-item-i2', { price: 5000, quantity: 2 });

    const service = new TreatmentPlanBillingService(db);
    const result = service.setItemDiscount('plan-item', 'plan-item-i1', { discountRate: 25 }, context);

    expect(result).toEqual({ itemId: 'plan-item-i1', discountRate: 25, planTotalFee: 17500 });
    expect(itemRow('plan-item-i1').discountRate).toBe(25);
    expect(planRow('plan-item').totalFee).toBe(17500);

    const cleared = service.setItemDiscount('plan-item', 'plan-item-i1', { discountRate: null }, context);
    expect(cleared.discountRate).toBeNull();
    expect(cleared.planTotalFee).toBe(20000);
  });

  it('setItemDiscount rejects items of other plans and items already billed', () => {
    insertPlan('plan-a', '计划A');
    insertItem('plan-a', 'plan-a-i1', { price: 10000, quantity: 1 });
    insertPlan('plan-b', '计划B');

    const service = new TreatmentPlanBillingService(db);
    expect(() => service.setItemDiscount('plan-b', 'plan-a-i1', { discountRate: 10 }, context))
      .toThrow(new NotFoundError('Treatment plan item not found'));

    db.prepare(
      `UPDATE TreatmentPlanItem SET billed = 1, billedChargeId = 'charge-x', updatedAt = ? WHERE id = 'plan-a-i1'`,
    ).run(now);
    expect(() => service.setItemDiscount('plan-a', 'plan-a-i1', { discountRate: 10 }, context))
      .toThrow(new ConflictError('已划价明细不可改价'));
  });

  it('bill creates a Charge with plan discount applied for all items by default', () => {
    insertPlan('plan-bill-all', '划价全量计划', { visitId: 'visit-bill-all', discountType: 'WHOLE', discountRate: 10 });
    insertItem('plan-bill-all', 'plan-bill-all-i1', { price: 10000, quantity: 1 });
    insertItem('plan-bill-all', 'plan-bill-all-i2', { price: 5000, quantity: 2 });

    const service = new TreatmentPlanBillingService(db);
    const result = service.bill('plan-bill-all', {}, context);

    expect(result.number).toMatch(/^CHG-/);
    expect(result.totalAmount).toBe(18000);
    expect(result.itemCount).toBe(2);
    expect(result.billedItemIds).toEqual(['plan-bill-all-i1', 'plan-bill-all-i2']);

    const charge = chargeRow(result.chargeId);
    expect(charge.patientId).toBe('patient-demo-001');
    expect(charge.visitId).toBe('visit-bill-all');
    expect(charge.doctorId).toBe('user-admin-001');
    expect(charge.number).toBe(result.number);
    expect(charge.totalAmount).toBe(18000);
    expect(charge.discount).toBe(2000);
    expect(charge.paidAmount).toBe(0);
    expect(charge.refundedAmount).toBe(0);
    expect(charge.status).toBe('UNPAID');
    expect(charge.remark).toBe('治疗计划划价：划价全量计划');

    const chargeItems = db.prepare(
      `SELECT * FROM ChargeItem WHERE chargeId = ? ORDER BY name ASC`,
    ).all(result.chargeId) as Array<Record<string, unknown>>;
    expect(chargeItems).toHaveLength(2);
    // ChargeItem.treatmentId 仅当明细关联到真实 Treatment 行时才会写入；
    // 此用例的明细没有对应 Treatment 行，因此为 NULL，改用 name 定位。
    const i1 = chargeItems.find((row) => row.name === 'Item plan-bill-all-i1')!;
    const i2 = chargeItems.find((row) => row.name === 'Item plan-bill-all-i2')!;
    expect(i1.treatmentId).toBeNull();
    expect(i2.treatmentId).toBeNull();
    expect(i1.price).toBe(10000);
    expect(i1.quantity).toBe(1);
    expect(i1.subtotal).toBe(10000);
    expect(i2.price).toBe(5000);
    expect(i2.quantity).toBe(2);
    expect(i2.subtotal).toBe(10000);
    for (const item of chargeItems) {
      expect(item.costType).toBe('SERVICE');
      expect(item.teethNumbers).toBe('[]');
    }

    expect(itemRow('plan-bill-all-i1').billed).toBe(1);
    expect(itemRow('plan-bill-all-i1').billedChargeId).toBe(result.chargeId);
    expect(itemRow('plan-bill-all-i2').billed).toBe(1);
    expect(planRow('plan-bill-all').totalFee).toBe(18000);
  });

  it('bill with selected itemIds only bills the picked items', () => {
    insertPlan('plan-bill-part', '划价部分计划');
    insertItem('plan-bill-part', 'plan-bill-part-i1', { price: 10000, quantity: 1 });
    insertItem('plan-bill-part', 'plan-bill-part-i2', { price: 5000, quantity: 2 });

    const service = new TreatmentPlanBillingService(db);
    const result = service.bill('plan-bill-part', { itemIds: ['plan-bill-part-i1'] }, context);

    expect(result.totalAmount).toBe(10000);
    expect(result.itemCount).toBe(1);
    expect(result.billedItemIds).toEqual(['plan-bill-part-i1']);
    expect(itemRow('plan-bill-part-i1').billed).toBe(1);
    expect(itemRow('plan-bill-part-i2').billed).toBe(0);
    expect(planRow('plan-bill-part').totalFee).toBe(10000);

    const second = service.bill('plan-bill-part', { itemIds: ['plan-bill-part-i2'] }, context);
    expect(second.totalAmount).toBe(10000);
    expect(second.itemCount).toBe(1);
    expect(itemRow('plan-bill-part-i2').billed).toBe(1);
  });

  it('bill rejects repeated billing of an already billed item', () => {
    insertPlan('plan-bill-repeat', '重复划价计划');
    insertItem('plan-bill-repeat', 'plan-bill-repeat-i1', { price: 10000, quantity: 1 });

    const service = new TreatmentPlanBillingService(db);
    service.bill('plan-bill-repeat', {}, context);
    expect(() => service.bill('plan-bill-repeat', {}, context))
      .toThrow(new ConflictError('已划价明细不可重复划价'));
    expect(() => service.bill('plan-bill-repeat', { itemIds: ['plan-bill-repeat-i1'] }, context))
      .toThrow(new ConflictError('已划价明细不可重复划价'));
  });

  it('bill validates empty selection and unknown items', () => {
    insertPlan('plan-bill-empty', '勾空计划');
    insertItem('plan-bill-empty', 'plan-bill-empty-i1', { price: 10000, quantity: 1 });

    const service = new TreatmentPlanBillingService(db);
    expect(() => service.bill('plan-bill-empty', { itemIds: [] }, context))
      .toThrow(new ValidationError('请勾选需要划价的明细'));
    expect(() => service.bill('plan-bill-missing', {}, context))
      .toThrow(NotFoundError);
    expect(() => service.bill('plan-bill-empty', { itemIds: ['no-such-item'] }, context))
      .toThrow(new NotFoundError('Treatment plan item not found'));
  });

  it('bill combines per-item and whole-plan discounts in charge amounts', () => {
    insertPlan('plan-bill-combo', '组合折扣计划', { discountType: 'DOUBLE', discountRate: 10 });
    insertItem('plan-bill-combo', 'plan-bill-combo-i1', { price: 10000, quantity: 1, discountRate: 50 });
    insertItem('plan-bill-combo', 'plan-bill-combo-i2', { price: 5000, quantity: 2 });

    const service = new TreatmentPlanBillingService(db);
    const result = service.bill('plan-bill-combo', {}, context);

    // 明细小计：i1 = 5000，i2 = 10000 → Σ = 15000；整单 10% → 13500
    expect(result.totalAmount).toBe(13500);
    const charge = chargeRow(result.chargeId);
    expect(charge.totalAmount).toBe(13500);
    expect(charge.discount).toBe(6500);
    expect(planRow('plan-bill-combo').totalFee).toBe(13500);
  });

  it('planFollowUp updates tracking fields and preserves omitted ones', () => {
    insertPlan('plan-followup', '回访计划');

    const service = new TreatmentPlanBillingService(db);
    const updated = service.planFollowUp('plan-followup', {
      followUpStatus: 'PENDING',
      nextFollowUpAt: '2026-08-20',
      trackingNote: '患者反馈良好，下次复诊提醒',
    }, context);

    expect(updated.followUpStatus).toBe('PENDING');
    expect(updated.nextFollowUpAt).toBe('2026-08-20');
    expect(updated.trackingNote).toBe('患者反馈良好，下次复诊提醒');
    const row = planRow('plan-followup');
    expect(row.followUpStatus).toBe('PENDING');
    expect(row.nextFollowUpAt).toBe('2026-08-20');
    expect(row.trackingNote).toBe('患者反馈良好，下次复诊提醒');

    const partial = service.planFollowUp('plan-followup', { followUpStatus: 'HORIZONTAL_DONE' }, context);
    expect(partial.nextFollowUpAt).toBe('2026-08-20');
    expect(partial.trackingNote).toBe('患者反馈良好，下次复诊提醒');

    expect(() => service.planFollowUp('plan-followup', { followUpStatus: 'XXX' as never }, context))
      .toThrow(ValidationError);
    expect(() => service.planFollowUp('plan-missing', { followUpStatus: 'NONE' }, context))
      .toThrow(NotFoundError);
  });

  it('validates bill selection shapes, missing patients, and amount limits', () => {
    insertPlan('plan-shape-bill', 'Shape Bill');
    insertItem('plan-shape-bill', 'plan-shape-bill-i1', { price: 10000, quantity: 1 });
    const service = new TreatmentPlanBillingService(db);
    expect(() => service.bill('plan-shape-bill', { itemIds: 'bad' as never }, context))
      .toThrow(ValidationError);

    insertPlan('plan-overflow-bill', 'Overflow Bill');
    insertItem('plan-overflow-bill', 'plan-overflow-bill-i1', { price: 700_000_000_000, quantity: 2 });
    expect(() => service.bill('plan-overflow-bill', {}, context)).toThrow(ValidationError);

    insertPlan('plan-missing-patient-bill', 'Missing Patient', { visitId: null });
    db.prepare("UPDATE TreatmentPlan SET patientId = 'patient-missing' WHERE id = 'plan-missing-patient-bill'").run();
    insertItem('plan-missing-patient-bill', 'plan-missing-patient-bill-i1', { price: 10000, quantity: 1 });
    expect(() => service.bill('plan-missing-patient-bill', {}, context)).toThrow(NotFoundError);
  });

  it('rejects selecting an already billed item while unbilled items remain', () => {
    insertPlan('plan-partial-billed', 'Partial Billed');
    insertItem('plan-partial-billed', 'plan-partial-billed-i1', { price: 10000, quantity: 1, billed: 1 });
    insertItem('plan-partial-billed', 'plan-partial-billed-i2', { price: 10000, quantity: 1 });
    const service = new TreatmentPlanBillingService(db);
    expect(() => service.bill('plan-partial-billed', { itemIds: ['plan-partial-billed-i1'] }, context))
      .toThrow(ConflictError);
  });

  it('writes treatment ids and tolerates corrupt teeth JSON when billing', () => {
    db.prepare(
      `INSERT INTO Treatment (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, visitId, doctorId, code, name, category,
         price, quantity, status, completedDate
       ) VALUES (?, 'clinic-v2-001', ?, ?, NULL, 'patient-demo-001', 'visit-billing-treatment', 'user-admin-001', 'T-BILL', 'Billing Treatment', 'GENERAL', 100, 1, 'COMPLETED', ?)`,
    ).run('treatment-billing-1', now, now, now);
    insertPlan('plan-treatment-ids', 'Treatment Ids');
    insertItem('plan-treatment-ids', 'plan-treatment-ids-i1', { price: 10000, quantity: 1 });
    insertItem('plan-treatment-ids', 'plan-treatment-ids-i2', { price: 5000, quantity: 1 });
    db.prepare("UPDATE TreatmentPlanItem SET treatmentId = 'treatment-billing-1', teethNumbers = 'bad-json' WHERE planId = 'plan-treatment-ids'").run();

    const service = new TreatmentPlanBillingService(db);
    const result = service.bill('plan-treatment-ids', {}, context);
    const chargeItems = db.prepare('SELECT treatmentId, teethNumbers FROM ChargeItem WHERE chargeId = ?').all(result.chargeId) as Array<{
      treatmentId: string | null;
      teethNumbers: string;
    }>;
    expect(chargeItems).toHaveLength(2);
    expect(chargeItems.every((row) => row.treatmentId === 'treatment-billing-1')).toBe(true);
    expect(chargeItems.every((row) => row.teethNumbers === '[]')).toBe(true);
  });
});
