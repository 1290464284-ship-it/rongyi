import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { ConflictError, NotFoundError, ValidationError } from '../../infrastructure/errors';
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
      // 存在已划价明细（item-2 billed=1）：费用与状态字段不可变更，保持原值
      totalFee: 1000,
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
    expect(main.totalFee).toBe(1000);
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

  it('locks fee and status fields once a plan has billed items but allows other field edits', () => {
    insertPlan('plan-billed-lock');
    insertPlanItem('bi-lock', 'plan-billed-lock', { code: 'L', name: 'L', billed: 1 });
    const service = new EditSaveService(db);
    const baseItems = [
      { id: 'bi-lock', code: 'L', name: 'L', category: 'GENERAL', price: 100, quantity: 1, teethNumbers: [], status: 'PLANNED' },
    ];
    // 变更 totalFee → 拒绝
    expect(() => service.saveTreatmentPlan('plan-billed-lock', {
      patientId: 'patient-demo-001', doctorId: 'user-admin-001', name: '计划', status: 'APPROVED', totalFee: 999, items: baseItems,
    }, context)).toThrow('治疗计划已划价，费用与状态字段不可修改');
    // 变更 status → 拒绝
    expect(() => service.saveTreatmentPlan('plan-billed-lock', {
      patientId: 'patient-demo-001', doctorId: 'user-admin-001', name: '计划', status: 'IN_PROGRESS', totalFee: 1000, items: baseItems,
    }, context)).toThrow('治疗计划已划价，费用与状态字段不可修改');
    // 仅变更名称/备注（费用与状态保持原值）→ 允许
    const result = service.saveTreatmentPlan('plan-billed-lock', {
      patientId: 'patient-demo-001', doctorId: 'user-admin-001', name: '改名', status: 'APPROVED', totalFee: 1000, remark: '备注', items: baseItems,
    }, context);
    expect(result.id).toBe('plan-billed-lock');
    const main = db.prepare('SELECT name, remark FROM TreatmentPlan WHERE id = ?').get('plan-billed-lock') as {
      name: string; remark: string | null;
    };
    expect(main.name).toBe('改名');
    expect(main.remark).toBe('备注');
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

  it('rejects invalid treatment plan totals and item shapes', () => {
    const service = new EditSaveService(db);
    const base = {
      patientId: 'patient-demo-001',
      doctorId: 'user-admin-001',
      name: 'Invalid Plan',
      status: 'APPROVED',
      totalFee: 1000,
      items: [{ code: 'A', name: 'A', category: 'GENERAL', price: 100, quantity: 1, teethNumbers: [], status: 'PLANNED' }],
    };
    insertPlan('plan-invalid-total');
    expect(() => service.saveTreatmentPlan('plan-invalid-total', { ...base, totalFee: -1 }, context)).toThrow(ValidationError);

    insertPlan('plan-invalid-price');
    expect(() => service.saveTreatmentPlan('plan-invalid-price', {
      ...base,
      items: [{ code: 'A', name: 'A', category: 'GENERAL', price: 0, quantity: 1, teethNumbers: [], status: 'PLANNED' }],
    }, context)).toThrow(ValidationError);

    insertPlan('plan-missing-code');
    expect(() => service.saveTreatmentPlan('plan-missing-code', {
      ...base,
      items: [{ name: 'A', category: 'GENERAL', price: 100, quantity: 1, teethNumbers: [], status: 'PLANNED' } as never],
    }, context)).toThrow(ValidationError);

    insertPlan('plan-invalid-quantity');
    expect(() => service.saveTreatmentPlan('plan-invalid-quantity', {
      ...base,
      items: [{ code: 'A', name: 'A', category: 'GENERAL', price: 100, quantity: 0, teethNumbers: [], status: 'PLANNED' }],
    }, context)).toThrow(ValidationError);

    insertPlan('plan-invalid-subtotal');
    expect(() => service.saveTreatmentPlan('plan-invalid-subtotal', {
      ...base,
      items: [{ code: 'A', name: 'A', category: 'GENERAL', price: 700_000_000_000, quantity: 2, teethNumbers: [], status: 'PLANNED' }],
    }, context)).toThrow(ValidationError);

    insertPlan('plan-invalid-status');
    expect(() => service.saveTreatmentPlan('plan-invalid-status', {
      ...base,
      items: [{ code: 'A', name: 'A', category: 'GENERAL', price: 100, quantity: 1, teethNumbers: [], status: '' }],
    }, context)).toThrow(ValidationError);
  });

  it('rejects invalid prescription item quantities, prices, and subtotals', () => {
    const service = new EditSaveService(db);
    const base = {
      patientId: 'patient-demo-001',
      doctorId: 'user-admin-001',
      status: 'SUBMITTED',
      items: [{ name: 'Medicine', days: 3, quantity: 1, price: 100 }],
    };
    insertPrescription('pres-invalid-qty');
    expect(() => service.savePrescription('pres-invalid-qty', { ...base, items: [{ name: 'Medicine', days: 3, quantity: 0, price: 100 }] }, context)).toThrow(ValidationError);

    insertPrescription('pres-invalid-price');
    expect(() => service.savePrescription('pres-invalid-price', { ...base, items: [{ name: 'Medicine', days: 3, quantity: 1, price: -1 }] }, context)).toThrow(ValidationError);

    insertPrescription('pres-invalid-subtotal');
    expect(() => service.savePrescription('pres-invalid-subtotal', { ...base, items: [{ name: 'Medicine', days: 3, quantity: 2, price: 700_000_000_000 }] }, context)).toThrow(ValidationError);
  });

  it('soft-deletes removed prescription items and tolerates corrupt teeth JSON on billed items', () => {
    insertPrescription('pres-remove');
    insertPrescriptionItem('pi-keep', 'pres-remove', { name: 'Keep' });
    insertPrescriptionItem('pi-drop', 'pres-remove', { name: 'Drop' });
    new EditSaveService(db).savePrescription('pres-remove', {
      patientId: 'patient-demo-001',
      doctorId: 'user-admin-001',
      status: 'SUBMITTED',
      items: [{ id: 'pi-keep', name: 'Keep', days: 3, quantity: 1, price: 100 }],
    }, context);
    const removed = db.prepare('SELECT deletedAt FROM PrescriptionItem WHERE id = ?').get('pi-drop') as { deletedAt: string | null };
    expect(removed.deletedAt).not.toBeNull();

    insertPlan('plan-teeth-corrupt');
    insertPlanItem('item-teeth-corrupt', 'plan-teeth-corrupt', { code: 'T', name: 'T', billed: 1, teethNumbers: ['11'] });
    db.prepare('UPDATE TreatmentPlanItem SET teethNumbers = ? WHERE id = ?').run('not-json', 'item-teeth-corrupt');
    expect(() => new EditSaveService(db).saveTreatmentPlan('plan-teeth-corrupt', {
      patientId: 'patient-demo-001',
      doctorId: 'user-admin-001',
      name: 'Teeth Plan',
      status: 'APPROVED',
      // 已划价明细存在：费用与状态保持原值
      totalFee: 1000,
      items: [{ id: 'item-teeth-corrupt', code: 'T', name: 'T', category: 'GENERAL', price: 100, quantity: 1, teethNumbers: [], status: 'PLANNED' }],
    }, context)).not.toThrow();
  });

  it('rejects missing targets and malformed plan/prescription shapes', () => {
    const service = new EditSaveService(db);
    const base = {
      patientId: 'patient-demo-001',
      doctorId: 'user-admin-001',
      name: 'Shape Plan',
      status: 'APPROVED',
      totalFee: 1000,
      items: [{ code: 'A', name: 'A', category: 'GENERAL', price: 100, quantity: 1, teethNumbers: [], status: 'PLANNED' }],
    };
    expect(() => service.saveTreatmentPlan('missing-plan', base, context)).toThrow(NotFoundError);

    insertPlan('plan-shape-1');
    expect(() => service.saveTreatmentPlan('plan-shape-1', { ...base, name: '  ' }, context)).toThrow(ValidationError);
    expect(() => service.saveTreatmentPlan('plan-shape-1', { ...base, status: 'BOGUS' }, context)).toThrow(ValidationError);
    expect(() => service.saveTreatmentPlan('plan-shape-1', { ...base, patientId: '' }, context)).toThrow(ValidationError);
    expect(() => service.saveTreatmentPlan('plan-shape-1', { ...base, doctorId: '' }, context)).toThrow(ValidationError);
    expect(() => service.saveTreatmentPlan('plan-shape-1', { ...base, items: 'bad' as never }, context)).toThrow(ValidationError);
    expect(() => service.saveTreatmentPlan('plan-shape-1', { ...base, items: [] }, context)).toThrow(ValidationError);

    const prescriptionBase = {
      patientId: 'patient-demo-001',
      doctorId: 'user-admin-001',
      status: 'SUBMITTED',
      items: [{ name: 'Medicine', days: 3, quantity: 1, price: 100 }],
    };
    expect(() => service.savePrescription('missing-prescription', prescriptionBase, context)).toThrow(NotFoundError);
    insertPrescription('pres-shape-1');
    expect(() => service.savePrescription('pres-shape-1', { ...prescriptionBase, patientId: '' }, context)).toThrow(ValidationError);
    expect(() => service.savePrescription('pres-shape-1', { ...prescriptionBase, doctorId: '' }, context)).toThrow(ValidationError);
    expect(() => service.savePrescription('pres-shape-1', { ...prescriptionBase, items: 'bad' as never }, context)).toThrow(ValidationError);
    expect(() => service.savePrescription('pres-shape-1', { ...prescriptionBase, items: [] }, context)).toThrow(ValidationError);
    expect(() => service.savePrescription('pres-shape-1', { ...prescriptionBase, items: [{ days: 3, quantity: 1, price: 100 } as never] }, context)).toThrow(ValidationError);
  });

  it('rejects removing a billed plan item', () => {
    insertPlan('plan-remove-billed');
    insertPlanItem('item-remove-billed', 'plan-remove-billed', { code: 'B', name: 'B', billed: 1 });
    expect(() => new EditSaveService(db).saveTreatmentPlan('plan-remove-billed', {
      patientId: 'patient-demo-001',
      doctorId: 'user-admin-001',
      name: 'Keep Other',
      status: 'APPROVED',
      totalFee: 100,
      items: [{ code: 'NEW', name: 'New', category: 'GENERAL', price: 100, quantity: 1, teethNumbers: [], status: 'PLANNED' }],
    }, context)).toThrow(ConflictError);
  });

  it('saves a global-tenant plan and normalizes empty item ids to generated ids', () => {
    const globalContext: AppContext = { ...context, clinicId: null };
    db.prepare(
      `INSERT INTO TreatmentPlan (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, name, status, totalFee, remark
       ) VALUES (?, NULL, ?, ?, NULL, 'patient-demo-001', 'user-admin-001', 'Global Plan', 'APPROVED', 100, NULL)`,
    ).run('plan-global', now, now);
    db.prepare(
      `INSERT INTO TreatmentPlanItem (
         id, clinicId, createdAt, updatedAt, deletedAt, planId,
         code, name, category, price, quantity, teethNumbers, status, billed
       ) VALUES (?, NULL, ?, ?, NULL, ?, 'A', 'A', 'GENERAL', 100, 1, '[]', 'PLANNED', 0)`,
    ).run('item-global', now, now, 'plan-global');

    const result = new EditSaveService(db).saveTreatmentPlan('plan-global', {
      patientId: 'patient-demo-001',
      doctorId: 'user-admin-001',
      name: 'Global Plan Updated',
      status: 'APPROVED',
      totalFee: 200,
      items: [
        { id: 'item-global', code: 'A', name: 'A', category: 'GENERAL', price: 100, quantity: 1, teethNumbers: [], status: 'PLANNED' },
        { id: '', code: 'GB', name: 'Global New Item', category: 'GENERAL', price: 100, quantity: 1, teethNumbers: [], status: 'PLANNED' },
      ],
    }, globalContext);

    expect(result.items).toBe(2);
    const created = db.prepare('SELECT id, clinicId FROM TreatmentPlanItem WHERE planId = ? AND name = ?')
      .get('plan-global', 'Global New Item') as { id: string; clinicId: string | null };
    expect(created.id).not.toBe('');
    expect(created.clinicId).toBeNull();
  });

  it('reports NotFound when a prescription item optimistic update affects zero rows', () => {
    insertPrescription('pres-race');
    insertPrescriptionItem('pi-race', 'pres-race', { name: 'Race Item' });
    const originalPrepare = db.prepare.bind(db);
    const spy = vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      if (sql.includes('UPDATE PrescriptionItem') && sql.includes('SET name')) {
        return { run: () => ({ changes: 0 }) } as never;
      }
      return originalPrepare(sql);
    });
    try {
      expect(() => new EditSaveService(db).savePrescription('pres-race', {
        patientId: 'patient-demo-001',
        doctorId: 'user-admin-001',
        status: 'SUBMITTED',
        items: [{ id: 'pi-race', name: 'Updated Race Item', days: 3, quantity: 1, price: 100 }],
      }, context)).toThrow(NotFoundError);
    } finally {
      spy.mockRestore();
    }
  });

  it('reports NotFound when plan or prescription main updates affect zero rows', () => {
    insertPlan('plan-race-main');
    insertPlanItem('item-race-main', 'plan-race-main');
    insertPrescription('pres-race-main');
    const originalPrepare = db.prepare.bind(db);
    const service = new EditSaveService(db);
    const planBase = {
      patientId: 'patient-demo-001',
      doctorId: 'user-admin-001',
      name: 'Race',
      status: 'APPROVED',
      totalFee: 100,
      items: [{ id: 'item-race-main', code: 'A', name: 'A', category: 'GENERAL', price: 100, quantity: 1, teethNumbers: [], status: 'PLANNED' }],
    };
    const spyMain = vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      if (sql.includes('UPDATE TreatmentPlan') && sql.includes('SET patientId')) {
        return { run: () => ({ changes: 0 }) } as never;
      }
      return originalPrepare(sql);
    });
    try {
      expect(() => service.saveTreatmentPlan('plan-race-main', planBase, context)).toThrow(NotFoundError);
    } finally {
      spyMain.mockRestore();
    }
    const spyItem = vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      if (sql.includes('UPDATE TreatmentPlanItem') && sql.includes('SET code')) {
        return { run: () => ({ changes: 0 }) } as never;
      }
      return originalPrepare(sql);
    });
    try {
      expect(() => service.saveTreatmentPlan('plan-race-main', planBase, context)).toThrow(NotFoundError);
    } finally {
      spyItem.mockRestore();
    }
    const spyPres = vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      if (sql.includes('UPDATE Prescription') && sql.includes('SET patientId')) {
        return { run: () => ({ changes: 0 }) } as never;
      }
      return originalPrepare(sql);
    });
    try {
      expect(() => service.savePrescription('pres-race-main', {
        patientId: 'patient-demo-001',
        doctorId: 'user-admin-001',
        status: 'SUBMITTED',
        items: [{ name: 'M', days: 3, quantity: 1, price: 100 }],
      }, context)).toThrow(NotFoundError);
    } finally {
      spyPres.mockRestore();
    }
  });

  it('saves a global-tenant prescription with mixed item shapes', () => {
    const globalContext: AppContext = { ...context, clinicId: null };
    db.prepare(
      `INSERT INTO Prescription (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, remark, status
       ) VALUES ('pres-global', NULL, ?, ?, NULL, 'patient-demo-001', 'user-admin-001', NULL, 'DRAFT')`,
    ).run(now, now);
    db.prepare(
      `INSERT INTO PrescriptionItem (
         id, clinicId, createdAt, updatedAt, deletedAt, prescriptionId,
         name, specification, dosage, frequency, days, quantity, price
       ) VALUES ('pi-global-keep', NULL, ?, ?, NULL, 'pres-global', 'Keep', NULL, NULL, NULL, 3, 1, 100)`,
    ).run(now, now);
    db.prepare(
      `INSERT INTO PrescriptionItem (
         id, clinicId, createdAt, updatedAt, deletedAt, prescriptionId,
         name, specification, dosage, frequency, days, quantity, price
       ) VALUES ('pi-global-drop', NULL, ?, ?, NULL, 'pres-global', 'Drop', NULL, NULL, NULL, 3, 1, 100)`,
    ).run(now, now);
    const result = new EditSaveService(db).savePrescription('pres-global', {
      patientId: 'patient-demo-001',
      doctorId: 'user-admin-001',
      status: 'SUBMITTED',
      items: [
        { id: 'pi-global-keep', name: 'Keep', dosage: '5mg', frequency: 'tid', days: 3, quantity: 1, price: 100 },
        { id: '', name: 'New', dosage: null as never, frequency: null as never, days: 3, quantity: 1, price: 100 },
      ],
    }, globalContext);
    expect(result.items).toBe(2);
    const dropped = db.prepare('SELECT deletedAt FROM PrescriptionItem WHERE id = ?').get('pi-global-drop') as { deletedAt: string | null };
    expect(dropped.deletedAt).not.toBeNull();
    const created = db.prepare('SELECT id, clinicId, dosage, frequency FROM PrescriptionItem WHERE prescriptionId = ? AND name = ?')
      .get('pres-global', 'New') as { id: string; clinicId: string | null; dosage: string | null; frequency: string | null };
    expect(created.id).not.toBe('');
    expect(created.clinicId).toBeNull();
    expect(created.dosage).toBeNull();
    expect(created.frequency).toBeNull();
  });

  it('saves a global plan, soft-deletes removed items, and normalizes sparse shapes', () => {
    const globalContext: AppContext = { ...context, clinicId: null };
    db.prepare(
      `INSERT INTO TreatmentPlan (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, name, status, totalFee, remark
       ) VALUES ('plan-global-2', NULL, ?, ?, NULL, 'patient-demo-001', 'user-admin-001', 'Global 2', 'APPROVED', 100, NULL)`,
    ).run(now, now);
    db.prepare(
      `INSERT INTO TreatmentPlanItem (
         id, clinicId, createdAt, updatedAt, deletedAt, planId,
         code, name, category, price, quantity, teethNumbers, status, billed
       ) VALUES ('item-global-keep', NULL, ?, ?, NULL, 'plan-global-2', 'A', 'A', 'GENERAL', 100, 1, '[]', 'PLANNED', 0)`,
    ).run(now, now);
    db.prepare(
      `INSERT INTO TreatmentPlanItem (
         id, clinicId, createdAt, updatedAt, deletedAt, planId,
         code, name, category, price, quantity, teethNumbers, status, billed
       ) VALUES ('item-global-drop', NULL, ?, ?, NULL, 'plan-global-2', 'B', 'B', 'GENERAL', 100, 1, '[]', 'PLANNED', 0)`,
    ).run(now, now);
    const result = new EditSaveService(db).saveTreatmentPlan('plan-global-2', {
      patientId: 'patient-demo-001',
      doctorId: 'user-admin-001',
      name: 'Global 2 Updated',
      status: 'APPROVED',
      totalFee: 200,
      items: [
        { id: 'item-global-keep', code: 'A', name: 'A', category: 'GENERAL', price: 100, quantity: 1, teethNumbers: '11' as never, status: 'PLANNED' },
      ],
    }, globalContext);
    expect(result.items).toBe(1);
    const dropped = db.prepare('SELECT deletedAt FROM TreatmentPlanItem WHERE id = ?').get('item-global-drop') as { deletedAt: string | null };
    expect(dropped.deletedAt).not.toBeNull();
  });

  it('normalizes missing plan name and sparse item fields before validation', () => {
    insertPlan('plan-sparse');
    const service = new EditSaveService(db);
    const base = {
      patientId: 'patient-demo-001',
      doctorId: 'user-admin-001',
      name: 'Sparse',
      status: 'APPROVED',
      totalFee: 100,
      items: [{ code: 'A', name: 'A', category: 'GENERAL', price: 100, quantity: 1, teethNumbers: [], status: 'PLANNED' }],
    };
    expect(() => service.saveTreatmentPlan('plan-sparse', { ...base, name: undefined as never }, context)).toThrow(ValidationError);
    expect(() => service.saveTreatmentPlan('plan-sparse', {
      ...base,
      items: [{ code: 'A', name: undefined as never, category: 'GENERAL', price: 100, quantity: 1, teethNumbers: [], status: 'PLANNED' }],
    }, context)).toThrow(ValidationError);
    expect(() => service.saveTreatmentPlan('plan-sparse', {
      ...base,
      items: [{ code: 'A', name: 'A', category: undefined as never, price: 100, quantity: 1, teethNumbers: [], status: 'PLANNED' }],
    }, context)).toThrow(ValidationError);
    expect(() => service.saveTreatmentPlan('plan-sparse', {
      ...base,
      items: [{ code: 'A', name: 'A', category: 'GENERAL', price: 100, quantity: 1, teethNumbers: [], status: undefined as never }],
    }, context)).toThrow(/状态无效/);
  });

  it('keeps matching billed items with array or non-array teeth payloads', () => {
    insertPlan('plan-billed-keep');
    insertPlanItem('bi-array', 'plan-billed-keep', { code: 'K', name: 'K', billed: 1 });
    insertPlanItem('bi-five', 'plan-billed-keep', { code: 'K2', name: 'K2', billed: 1 });
    // 非数组 JSON 载荷：parseTeeth 回退为空数组后仍可匹配
    db.prepare('UPDATE TreatmentPlanItem SET teethNumbers = ? WHERE id = ?').run('5', 'bi-five');
    const result = new EditSaveService(db).saveTreatmentPlan('plan-billed-keep', {
      patientId: 'patient-demo-001',
      doctorId: 'user-admin-001',
      name: 'K',
      status: 'APPROVED',
      // 已划价明细存在：费用与状态保持原值
      totalFee: 1000,
      items: [
        { id: 'bi-array', code: 'K', name: 'K', category: 'GENERAL', price: 100, quantity: 1, teethNumbers: [], status: 'PLANNED' },
        { id: 'bi-five', code: 'K2', name: 'K2', category: 'GENERAL', price: 100, quantity: 1, teethNumbers: [], status: 'PLANNED' },
      ],
    }, context);
    expect(result.items).toBe(2);
  });
});
