import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { ConflictError, ValidationError } from '../../infrastructure/errors';
import type { AppContext } from '../../../domain/contracts';
import { EditSaveService } from './edit-save';

describe('EditSaveService', () => {
  let db: Database.Database;
  let dataDir: string;
  let context: AppContext;
  const now = '2026-08-05T10:00:00.000Z';

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-edit-save-'));
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
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  function insertPlan(id: string, overrides: Record<string, unknown> = {}): void {
    db.prepare(
      `INSERT INTO TreatmentPlan (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, name, status, totalFee, remark
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id, context.clinicId, now, now,
      overrides.patientId ?? 'patient-demo-001',
      overrides.doctorId ?? 'user-admin-001',
      overrides.name ?? '计划',
      overrides.status ?? 'APPROVED',
      overrides.totalFee ?? 1000,
      overrides.remark ?? null,
    );
  }

  function insertPlanItem(id: string, planId: string, overrides: Record<string, unknown> = {}): void {
    db.prepare(
      `INSERT INTO TreatmentPlanItem (
         id, clinicId, createdAt, updatedAt, deletedAt, planId,
         code, name, category, price, quantity, teethNumbers, status, billed
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id, context.clinicId, now, now, planId,
      overrides.code ?? 'CODE', overrides.name ?? '项目', overrides.category ?? 'GENERAL',
      overrides.price ?? 100, overrides.quantity ?? 1,
      JSON.stringify(overrides.teethNumbers ?? []), overrides.status ?? 'PLANNED',
      overrides.billed ?? 0,
    );
  }

  function insertPrescription(id: string, overrides: Record<string, unknown> = {}): void {
    db.prepare(
      `INSERT INTO Prescription (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, remark, status
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
    ).run(
      id, context.clinicId, now, now,
      overrides.patientId ?? 'patient-demo-001',
      overrides.doctorId ?? 'user-admin-001',
      overrides.remark ?? null,
      overrides.status ?? 'DRAFT',
    );
  }

  function insertPrescriptionItem(id: string, prescriptionId: string, overrides: Record<string, unknown> = {}): void {
    db.prepare(
      `INSERT INTO PrescriptionItem (
         id, clinicId, createdAt, updatedAt, deletedAt, prescriptionId,
         name, specification, dosage, frequency, days, quantity, price
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id, context.clinicId, now, now, prescriptionId,
      overrides.name ?? '药品', overrides.specification ?? null, overrides.dosage ?? null,
      overrides.frequency ?? null, overrides.days ?? 3, overrides.quantity ?? 1, overrides.price ?? 100,
    );
  }

  it('atomically saves treatment plan main and items', () => {
    insertPlan('plan-1');
    insertPlanItem('item-1', 'plan-1', { code: 'A', name: 'A', price: 100, teethNumbers: ['11'] });
    insertPlanItem('item-2', 'plan-1', { code: 'B', name: 'B', price: 200, billed: 1 });
    insertPlanItem('item-3', 'plan-1', { code: 'C', name: 'C', price: 300 });

    const service = new EditSaveService(db);
    const result = service.saveTreatmentPlan('plan-1', {
      patientId: 'patient-demo-001',
      doctorId: 'user-admin-001',
      name: '新计划',
      status: 'APPROVED',
      totalFee: 900,
      remark: '备注',
      items: [
        { id: 'item-2', code: 'B', name: 'B', category: 'GENERAL', price: 200, quantity: 1, teethNumbers: [], status: 'PLANNED' },
        { id: 'item-1', code: 'A', name: 'A改', category: 'GENERAL', price: 100, quantity: 1, teethNumbers: ['11'], status: 'PLANNED' },
        { id: 'new-local-1', code: 'NEW', name: '新增', category: 'GENERAL', price: 300, quantity: 1, teethNumbers: [], status: 'PLANNED' },
      ],
    }, context);

    expect(result.items).toBe(3);
    const main = db.prepare('SELECT name, totalFee, remark FROM TreatmentPlan WHERE id = ?').get('plan-1') as {
      name: string; totalFee: number; remark: string | null;
    };
    expect(main.name).toBe('新计划');
    expect(main.totalFee).toBe(900);
    expect(main.remark).toBe('备注');
    const updated = db.prepare('SELECT name FROM TreatmentPlanItem WHERE id = ?').get('item-1') as { name: string };
    expect(updated.name).toBe('A改');
    const removed = db.prepare('SELECT deletedAt FROM TreatmentPlanItem WHERE id = ?').get('item-3') as { deletedAt: string | null };
    expect(removed.deletedAt).not.toBeNull();
    const created = db.prepare('SELECT id, name FROM TreatmentPlanItem WHERE name = ?').get('新增') as { id: string; name: string };
    expect(created.id).toBe('new-local-1');
    expect(created.name).toBe('新增');
  });

  it('rejects changing a billed plan item and rolls back the main update', () => {
    insertPlan('plan-2');
    insertPlanItem('item-4', 'plan-2', { code: 'B', name: 'B', price: 200, billed: 1 });
    const service = new EditSaveService(db);
    expect(() => service.saveTreatmentPlan('plan-2', {
      patientId: 'patient-demo-001',
      doctorId: 'user-admin-001',
      name: '不应保存',
      status: 'APPROVED',
      totalFee: 900,
      items: [{ id: 'item-4', code: 'B', name: 'B改', category: 'GENERAL', price: 200, quantity: 1, teethNumbers: [], status: 'PLANNED' }],
    }, context)).toThrow(ConflictError);
    const main = db.prepare('SELECT name FROM TreatmentPlan WHERE id = ?').get('plan-2') as { name: string };
    expect(main.name).toBe('计划');
  });

  it('atomically saves prescription main and items', () => {
    insertPrescription('pres-1');
    insertPrescriptionItem('pi-1', 'pres-1', { name: '阿莫西林', days: 5, quantity: 2, price: 1000 });
    const service = new EditSaveService(db);
    const result = service.savePrescription('pres-1', {
      patientId: 'patient-demo-001',
      doctorId: 'user-admin-001',
      remark: '饭后服用',
      status: 'SUBMITTED',
      items: [
        { id: 'pi-1', name: '阿莫西林', specification: '0.25g', days: 5, quantity: 2, price: 1200 },
        { id: 'pi-new', name: '布洛芬', days: 3, quantity: 1, price: 800 },
      ],
    }, context);
    expect(result.items).toBe(2);
    const main = db.prepare('SELECT remark, status FROM Prescription WHERE id = ?').get('pres-1') as {
      remark: string | null; status: string;
    };
    expect(main.remark).toBe('饭后服用');
    // 编辑保存不能直写状态机：无论客户端传 SUBMITTED 还是 PROCESSED，都只能保持 DRAFT。
    expect(main.status).toBe('DRAFT');
    const updated = db.prepare('SELECT price FROM PrescriptionItem WHERE id = ?').get('pi-1') as { price: number };
    expect(updated.price).toBe(1200);
    const created = db.prepare('SELECT id, name FROM PrescriptionItem WHERE name = ?').get('布洛芬') as { id: string; name: string };
    expect(created.id).toBe('pi-new');
    expect(created.name).toBe('布洛芬');
  });

  it('rolls back the prescription main update when an item is invalid', () => {
    insertPrescription('pres-2');
    const service = new EditSaveService(db);
    expect(() => service.savePrescription('pres-2', {
      patientId: 'patient-demo-001',
      doctorId: 'user-admin-001',
      status: 'SUBMITTED',
      items: [{ name: '药品', days: 0, quantity: 1, price: 100 }],
    }, context)).toThrow(ValidationError);
    const main = db.prepare('SELECT status FROM Prescription WHERE id = ?').get('pres-2') as { status: string };
    expect(main.status).toBe('DRAFT');
  });
});
