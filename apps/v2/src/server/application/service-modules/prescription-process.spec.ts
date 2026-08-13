import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { ConflictError, NotFoundError, ValidationError } from '../../infrastructure/errors';
import type { AppContext } from '../../../domain/contracts';
import { PrescriptionProcessService } from './prescription-process';

describe('PrescriptionProcessService', () => {
  let db: Database.Database;
  let dataDir: string;
  let context: AppContext;
  const now = '2026-08-05T10:00:00.000Z';

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-prescription-process-'));
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

  function insertPrescription(id: string, remark: string | null = null): void {
    db.prepare(
      `INSERT INTO Prescription (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, visitId, doctorId, remark, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', NULL, 'user-admin-001', ?, 'DRAFT')`,
    ).run(id, context.clinicId, now, now, remark);
  }

  function insertPrescriptionItem(
    id: string,
    prescriptionId: string,
    name: string,
    opts: { drugId?: string | null; specification?: string | null; quantity?: number; price?: number } = {},
  ): void {
    db.prepare(
      `INSERT INTO PrescriptionItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         prescriptionId, drugId, name, specification, dosage, frequency, days, quantity, price
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, NULL, NULL, 1, ?, ?)`,
    ).run(
      id,
      context.clinicId,
      now,
      now,
      prescriptionId,
      opts.drugId === undefined ? null : opts.drugId,
      name,
      opts.specification === undefined ? null : opts.specification,
      opts.quantity ?? 1,
      opts.price ?? 1000,
    );
  }

  function insertInventory(id: string, name: string, opts: { spec?: string | null; stock?: number } = {}): void {
    db.prepare(
      `INSERT INTO InventoryItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, spec, category, unit, stock, minStock, price
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 'DRUG', 'box', ?, 0, 5000)`,
    ).run(id, context.clinicId, now, now, `CODE-${id}`, name, opts.spec === undefined ? null : opts.spec, opts.stock ?? 50);
  }

  it('processes a prescription into an UNPAID charge and a PENDING dispense order', () => {
    insertPrescription('rx-success', '术后用药');
    insertInventory('rx-inv-item', 'Rx Drug A', { spec: '10mg' });
    insertInventory('rx-inv-item-2', 'Rx Drug B');
    insertPrescriptionItem('rx-success-item-1', 'rx-success', 'Rx Drug A', { specification: '10mg', quantity: 2, price: 1000 });
    insertPrescriptionItem('rx-success-item-2', 'rx-success', 'Rx Drug B', { quantity: 1, price: 2500 });

    const service = new PrescriptionProcessService(db);
    const result = service.process('rx-success', {}, context);

    expect(result).toMatchObject({
      prescriptionId: 'rx-success',
      status: 'PROCESSED',
      chargeTotalAmount: 1000 * 2 + 2500,
      itemCount: 2,
    });
    expect(String(result.chargeNumber)).toMatch(/^CHG-/);
    expect(String(result.dispenseNumber)).toMatch(/^DSP-/);

    // 划价单
    const charge = db.prepare('SELECT * FROM Charge WHERE id = ?').get(String(result.chargeId)) as Record<string, unknown>;
    expect(charge).toBeDefined();
    expect(charge.patientId).toBe('patient-demo-001');
    expect(charge.doctorId).toBe('user-admin-001');
    expect(charge.number).toBe(result.chargeNumber);
    expect(charge.totalAmount).toBe(1000 * 2 + 2500);
    expect(charge.paidAmount).toBe(0);
    expect(charge.refundedAmount).toBe(0);
    expect(charge.discount).toBe(0);
    expect(charge.status).toBe('UNPAID');
    expect(charge.remark).toBe('处方划价');

    const chargeItems = db.prepare(
      'SELECT * FROM ChargeItem WHERE chargeId = ? ORDER BY name',
    ).all(String(result.chargeId)) as Array<Record<string, unknown>>;
    expect(chargeItems).toHaveLength(2);
    expect(chargeItems[0]).toMatchObject({
      name: 'Rx Drug A',
      category: 'DRUG',
      price: 1000,
      quantity: 2,
      subtotal: 2000,
      costType: 'MATERIAL',
    });
    expect(chargeItems[0].teethNumbers).toBe('[]');
    expect(chargeItems[1]).toMatchObject({
      name: 'Rx Drug B',
      category: 'DRUG',
      price: 2500,
      quantity: 1,
      subtotal: 2500,
      costType: 'MATERIAL',
    });

    // 领药单
    const dispense = db.prepare('SELECT * FROM Dispense WHERE id = ?').get(String(result.dispenseId)) as Record<string, unknown>;
    expect(dispense).toBeDefined();
    expect(dispense.chargeId).toBe(result.chargeId);
    expect(dispense.prescriptionId).toBe('rx-success');
    expect(dispense.patientId).toBe('patient-demo-001');
    expect(dispense.doctorId).toBe('user-admin-001');
    expect(dispense.pharmacistId).toBeNull();
    expect(dispense.status).toBe('PENDING');
    expect(dispense.dispensedAt).toBeNull();
    expect(dispense.returnedAt).toBeNull();
    expect(dispense.note).toBe('术后用药');
    expect(dispense.number).toBe(result.dispenseNumber);

    const dispenseItems = db.prepare(
      'SELECT * FROM DispenseItem WHERE dispenseId = ? ORDER BY name',
    ).all(String(result.dispenseId)) as Array<Record<string, unknown>>;
    expect(dispenseItems).toHaveLength(2);
    expect(dispenseItems[0]).toMatchObject({
      itemId: 'rx-inv-item',
      batchId: null,
      name: 'Rx Drug A',
      spec: '10mg',
      quantity: 2,
      returnedQuantity: 0,
    });
    expect(dispenseItems[1]).toMatchObject({
      itemId: 'rx-inv-item-2',
      batchId: null,
      name: 'Rx Drug B',
      spec: null,
      quantity: 1,
      returnedQuantity: 0,
    });

    // 处方状态
    const prescription = db.prepare('SELECT * FROM Prescription WHERE id = ?').get('rx-success') as Record<string, unknown>;
    expect(prescription.status).toBe('PROCESSED');
    expect(prescription.processedAt).toBe(now);
    expect(prescription.chargeId).toBe(result.chargeId);
    expect(prescription.dispenseId).toBe(result.dispenseId);
  });

  it('processes only the selected itemIds', () => {
    insertPrescription('rx-partial');
    insertInventory('rx-inv-item-3', 'Rx Drug C');
    insertInventory('rx-inv-item-4', 'Rx Drug D');
    insertPrescriptionItem('rx-partial-item-1', 'rx-partial', 'Rx Drug C', { quantity: 1, price: 1000 });
    insertPrescriptionItem('rx-partial-item-2', 'rx-partial', 'Rx Drug D', { quantity: 3, price: 500 });

    const service = new PrescriptionProcessService(db);
    const result = service.process('rx-partial', { itemIds: ['rx-partial-item-2'] }, context);

    expect(result.itemCount).toBe(1);
    expect(result.chargeTotalAmount).toBe(500 * 3);

    const chargeItems = db.prepare(
      'SELECT name FROM ChargeItem WHERE chargeId = ?',
    ).all(String(result.chargeId)) as Array<{ name: string }>;
    expect(chargeItems).toEqual([{ name: 'Rx Drug D' }]);

    const dispenseItems = db.prepare(
      'SELECT itemId FROM DispenseItem WHERE dispenseId = ?',
    ).all(String(result.dispenseId)) as Array<{ itemId: string }>;
    expect(dispenseItems).toEqual([{ itemId: 'rx-inv-item-4' }]);

    const prescription = db.prepare('SELECT status FROM Prescription WHERE id = ?').get('rx-partial') as { status: string };
    expect(prescription.status).toBe('PROCESSED');
  });

  it('rejects prescriptions without any processable items', () => {
    insertPrescription('rx-empty');

    const service = new PrescriptionProcessService(db);
    expect(() => service.process('rx-empty', {}, context)).toThrow(ValidationError);
    expect(() => service.process('rx-empty', {}, context)).toThrow('处方没有可处理的药品明细');
  });

  it('rejects repeated processing with ConflictError', () => {
    insertPrescription('rx-repeat');
    insertInventory('rx-inv-item-5', 'Rx Drug E');
    insertPrescriptionItem('rx-repeat-item-1', 'rx-repeat', 'Rx Drug E');

    const service = new PrescriptionProcessService(db);
    const first = service.process('rx-repeat', {}, context);
    expect(() => service.process('rx-repeat', {}, context)).toThrow(ConflictError);
    expect(() => service.process('rx-repeat', {}, context)).toThrow('处方已处理');

    // 重复处理不得留下第二张划价单/领药单
    const charges = db.prepare('SELECT COUNT(*) AS c FROM Charge WHERE id = ?').get(String(first.chargeId)) as { c: number };
    const dispenses = db.prepare('SELECT COUNT(*) AS c FROM Dispense WHERE id = ?').get(String(first.dispenseId)) as { c: number };
    expect(charges.c).toBe(1);
    expect(dispenses.c).toBe(1);
  });

  it('rejects drugs without an inventory archive entry', () => {
    insertPrescription('rx-no-stock');
    insertPrescriptionItem('rx-no-stock-item-1', 'rx-no-stock', 'No Such Drug', { quantity: 1, price: 800 });

    const service = new PrescriptionProcessService(db);
    expect(() => service.process('rx-no-stock', {}, context)).toThrow(ValidationError);
    expect(() => service.process('rx-no-stock', {}, context)).toThrow('库存中未找到药品「No Such Drug」，请先建立库存档案');

    // 失败时不应留下半成品单
    const prescription = db.prepare('SELECT chargeId, dispenseId FROM Prescription WHERE id = ?').get('rx-no-stock') as {
      chargeId: string | null;
      dispenseId: string | null;
    };
    expect(prescription.chargeId).toBeNull();
    expect(prescription.dispenseId).toBeNull();
    const dispenses = db.prepare('SELECT COUNT(*) AS c FROM Dispense WHERE prescriptionId = ?').get('rx-no-stock') as { c: number };
    expect(dispenses.c).toBe(0);
  });

  it('rejects itemIds that do not belong to the prescription', () => {
    insertPrescription('rx-own');
    insertInventory('rx-inv-item-6', 'Rx Drug F');
    insertPrescriptionItem('rx-own-item-1', 'rx-own', 'Rx Drug F');
    insertPrescription('rx-other');
    insertPrescriptionItem('rx-other-item-1', 'rx-other', 'Rx Drug F');

    const service = new PrescriptionProcessService(db);
    expect(() => service.process('rx-own', { itemIds: ['rx-other-item-1'] }, context)).toThrow(NotFoundError);
    expect(() => service.process('rx-own', { itemIds: ['rx-other-item-1'] }, context)).toThrow('Prescription item not found');
    expect(() => service.process('rx-own', { itemIds: ['missing-item'] }, context)).toThrow(NotFoundError);
  });

  it('rejects non-array itemIds', () => {
    insertPrescription('rx-item-bad');
    insertInventory('rx-inv-item-bad', 'Rx Drug Bad');
    insertPrescriptionItem('rx-item-bad-1', 'rx-item-bad', 'Rx Drug Bad');

    const service = new PrescriptionProcessService(db);
    expect(() => service.process('rx-item-bad', { itemIds: 'rx-item-bad-1' as unknown as string[] }, context)).toThrow('itemIds 格式无效');
  });

  it('resolves inventory by drugId when the drug name differs', () => {
    insertPrescription('rx-drug-id');
    insertInventory('rx-inv-item-7', 'Rx Drug G');
    // drugId 指向库存档案，name 与库存名不一致，应仍能匹配
    insertPrescriptionItem('rx-drug-id-item-1', 'rx-drug-id', 'G 药', { drugId: 'rx-inv-item-7', quantity: 1, price: 1200 });

    const service = new PrescriptionProcessService(db);
    const result = service.process('rx-drug-id', {}, context);

    const dispenseItems = db.prepare(
      'SELECT itemId, name FROM DispenseItem WHERE dispenseId = ?',
    ).all(String(result.dispenseId)) as Array<{ itemId: string; name: string }>;
    expect(dispenseItems).toEqual([{ itemId: 'rx-inv-item-7', name: 'Rx Drug G' }]);
  });

  it('uses the prescription specification when the inventory spec is empty', () => {
    insertPrescription('rx-spec');
    insertInventory('rx-inv-item-8', 'Rx Drug H', { spec: null });
    insertPrescriptionItem('rx-spec-item-1', 'rx-spec', 'Rx Drug H', { specification: '20mg', quantity: 1, price: 900 });

    const service = new PrescriptionProcessService(db);
    const result = service.process('rx-spec', {}, context);

    const dispenseItems = db.prepare(
      'SELECT spec FROM DispenseItem WHERE dispenseId = ?',
    ).all(String(result.dispenseId)) as Array<{ spec: string | null }>;
    expect(dispenseItems).toEqual([{ spec: '20mg' }]);
  });

  it('status returns processing state and throws NotFound for unknown prescriptions', () => {
    insertPrescription('rx-status');
    insertInventory('rx-inv-item-9', 'Rx Drug I');
    insertPrescriptionItem('rx-status-item-1', 'rx-status', 'Rx Drug I');

    const service = new PrescriptionProcessService(db);
    const before = service.status('rx-status', context);
    expect(before).toEqual({
      id: 'rx-status',
      status: 'DRAFT',
      processedAt: null,
      chargeId: null,
      dispenseId: null,
    });

    service.process('rx-status', {}, context);
    const after = service.status('rx-status', context);
    expect(after.id).toBe('rx-status');
    expect(after.status).toBe('PROCESSED');
    expect(after.processedAt).toBe(now);
    expect(after.chargeId).not.toBeNull();
    expect(after.dispenseId).not.toBeNull();

    expect(() => service.status('missing-prescription', context)).toThrow(NotFoundError);
    expect(() => service.process('missing-prescription', {}, context)).toThrow(NotFoundError);
  });

  it('rejects item subtotals and charge totals above the money cap', () => {
    insertPrescription('rx-over-subtotal');
    insertInventory('rx-inv-over-subtotal', 'Over Subtotal Drug');
    insertPrescriptionItem('rx-over-subtotal-item', 'rx-over-subtotal', 'Over Subtotal Drug', {
      quantity: 1,
      price: 1_000_000_000_001,
    });
    const service = new PrescriptionProcessService(db);
    expect(() => service.process('rx-over-subtotal', {}, context)).toThrow('处方明细小计超出上限');

    insertPrescription('rx-over-total');
    insertInventory('rx-inv-over-total-a', 'Over Total A');
    insertInventory('rx-inv-over-total-b', 'Over Total B');
    insertPrescriptionItem('rx-over-total-item-a', 'rx-over-total', 'Over Total A', { price: 600_000_000_000 });
    insertPrescriptionItem('rx-over-total-item-b', 'rx-over-total', 'Over Total B', { price: 600_000_000_000 });
    expect(() => service.process('rx-over-total', {}, context)).toThrow('处方划价总额超出上限');
  });

  it('persists a null doctor id and exposes a null status as DRAFT', () => {
    db.prepare(
      `INSERT INTO Prescription (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, visitId, doctorId, remark, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', NULL, NULL, NULL, NULL)`,
    ).run('rx-null-fields', context.clinicId, now, now);
    db.prepare(
      `INSERT INTO PrescriptionItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         prescriptionId, drugId, name, specification, dosage, frequency, days, quantity, price
       ) VALUES (?, ?, ?, ?, NULL, ?, NULL, 'Null Drug', NULL, NULL, NULL, 1, 1, 100)`,
    ).run('rx-null-fields-item', context.clinicId, now, now, 'rx-null-fields');
    db.prepare(
      `INSERT INTO InventoryItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, spec, category, unit, stock, minStock, price
       ) VALUES ('rx-inv-null', ?, ?, ?, NULL, 'CODE-NULL', 'Null Drug', NULL, 'DRUG', 'box', 10, 0, 100)`,
    ).run(context.clinicId, now, now);

    const service = new PrescriptionProcessService(db);
    expect(service.status('rx-null-fields', context)).toMatchObject({ status: 'DRAFT' });
    const processed = service.process('rx-null-fields', {}, context);
    const dispense = db.prepare('SELECT doctorId, clinicId FROM Dispense WHERE id = ?').get(String(processed.dispenseId)) as { doctorId: string | null; clinicId: string | null };
    expect(dispense.doctorId).toBeNull();
    expect(dispense.clinicId).toBe(context.clinicId);
  });
});
