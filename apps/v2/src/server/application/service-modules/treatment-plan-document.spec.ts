import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { NotFoundError, ValidationError } from '../../infrastructure/errors';
import type { AppContext } from '../../../domain/contracts';
import { TreatmentPlanDocumentService } from './treatment-plan-document';

describe('TreatmentPlanDocumentService', () => {
  let db: Database.Database;
  let dataDir: string;
  let context: AppContext;
  const now = '2026-08-05T10:00:00.000Z';

  function insertTemplate(): void {
    db.prepare(
      `INSERT INTO PrintTemplate (
         id, clinicId, code, name, category, content, variables, isDefault, paperSize, orientation, createdBy, createdAt, updatedAt, deletedAt
       ) VALUES (?, ?, 'TREATMENT_PLAN', '治疗计划模板', 'TREATMENT_PLAN', '<html/>', '{}', 1, 'A4', 'portrait', 'user-admin-001', ?, ?, NULL)`,
    ).run('ptpl-001', 'clinic-v2-001', now, now);
  }

  function removeTemplate(): void {
    db.prepare('DELETE FROM PrintTemplate WHERE id = ?').run('ptpl-001');
  }

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-treatment-plan-doc-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
    context = {
      userId: 'user-admin-001',
      clinicId: 'clinic-v2-001',
      role: 'BOSS',
      traceId: 'test-trace',
      now: () => new Date('2026-08-05T10:00:00.000Z'),
    };
    db.prepare(
      `INSERT INTO TreatmentPlan (
         id, clinicId, createdAt, updatedAt, deletedAt, patientId, doctorId, name, status, totalFee, remark
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', 'user-admin-001', '正畸计划', 'APPROVED', 20000, '备注')`,
    ).run('plan-doc-001', 'clinic-v2-001', now, now);
    db.prepare(
      `INSERT INTO TreatmentPlanItem (
         id, planId, code, name, category, price, quantity, teethNumbers, status, clinicId, createdAt, updatedAt, deletedAt
       ) VALUES (?, ?, 'IT-A', '种植体', 'IMPLANT', 500000, 1, '[]', 'PLANNED', 'clinic-v2-001', ?, ?, NULL)`,
    ).run('tpi-001', 'plan-doc-001', now, now);
    db.prepare(
      `INSERT INTO TreatmentPlanItem (
         id, planId, code, name, category, price, quantity, teethNumbers, status, clinicId, createdAt, updatedAt, deletedAt
       ) VALUES (?, ?, 'IT-B', '基台', 'IMPLANT', 100000, 2, '[]', 'PLANNED', 'clinic-v2-001', ?, ?, NULL)`,
    ).run('tpi-002', 'plan-doc-001', now, now);
    db.prepare(
      `INSERT INTO TreatmentPlan (
         id, clinicId, createdAt, updatedAt, deletedAt, patientId, doctorId, name, status, totalFee
       ) VALUES ('plan-other-clinic', 'clinic-other-001', ?, ?, NULL, 'patient-demo-001', 'user-admin-001', '其他诊所计划', 'APPROVED', 100)`,
    ).run(now, now);
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('prints a plan: increments printCount, sets lastPrintedAt, returns printable payload', () => {
    removeTemplate();
    insertTemplate();
    const result = new TreatmentPlanDocumentService(db).print('plan-doc-001', context);
    expect(result.plan).toMatchObject({
      id: 'plan-doc-001',
      name: '正畸计划',
      patientName: 'Demo Patient',
      doctorName: 'System Administrator',
      printCount: 1,
      lastPrintedAt: now,
    });
    expect(result.items).toHaveLength(2);
    expect(result.template).toMatchObject({ code: 'TREATMENT_PLAN', name: '治疗计划模板' });
    const row = db.prepare('SELECT printCount, lastPrintedAt FROM TreatmentPlan WHERE id = ?').get('plan-doc-001') as {
      printCount: number;
      lastPrintedAt: string;
    };
    expect(row.printCount).toBe(1);
    expect(row.lastPrintedAt).toBe(now);
    removeTemplate();
  });

  it('increments printCount to 2 on a second print', () => {
    const result = new TreatmentPlanDocumentService(db).print('plan-doc-001', context);
    expect(result.plan).toMatchObject({ printCount: 2 });
    const row = db.prepare('SELECT printCount FROM TreatmentPlan WHERE id = ?').get('plan-doc-001') as { printCount: number };
    expect(row.printCount).toBe(2);
  });

  it('throws NotFoundError when the plan does not exist', () => {
    expect(() => new TreatmentPlanDocumentService(db).print('plan-missing', context)).toThrow(NotFoundError);
  });

  it('throws NotFoundError when the plan belongs to another clinic', () => {
    expect(() => new TreatmentPlanDocumentService(db).print('plan-other-clinic', context)).toThrow(NotFoundError);
  });

  it('returns null template when no matching PrintTemplate exists', () => {
    removeTemplate();
    const result = new TreatmentPlanDocumentService(db).print('plan-doc-001', context);
    expect(result.template).toBeNull();
  });

  it('signs a plan and persists signature fields', () => {
    const result = new TreatmentPlanDocumentService(db).sign('plan-doc-001', {
      signature: 'data:image/png;base64,AAAA',
      signerName: '张三',
      remark: '患者已确认',
    }, context);
    expect(result).toEqual({ id: 'plan-doc-001', signedAt: now, signerName: '张三' });
    const row = db.prepare(
      'SELECT patientSignature, signerName, signedAt, signatureRemark FROM TreatmentPlan WHERE id = ?',
    ).get('plan-doc-001') as { patientSignature: string; signerName: string; signedAt: string; signatureRemark: string };
    expect(row.patientSignature).toBe('data:image/png;base64,AAAA');
    expect(row.signerName).toBe('张三');
    expect(row.signedAt).toBe(now);
    expect(row.signatureRemark).toBe('患者已确认');
  });

  it('stores null signatureRemark when remark is omitted', () => {
    new TreatmentPlanDocumentService(db).sign('plan-doc-001', { signature: 'data:image/png;base64,BBBB', signerName: '李四' }, context);
    const row = db.prepare('SELECT signatureRemark FROM TreatmentPlan WHERE id = ?').get('plan-doc-001') as {
      signatureRemark: string | null;
    };
    expect(row.signatureRemark).toBeNull();
  });

  it('throws ValidationError when signature is missing or blank', () => {
    const service = new TreatmentPlanDocumentService(db);
    expect(() => service.sign('plan-doc-001', { signature: '', signerName: '张三' }, context)).toThrow(ValidationError);
    expect(() => service.sign('plan-doc-001', { signature: '   ', signerName: '张三' }, context)).toThrow('签名不能为空');
  });

  it('throws ValidationError when signerName is missing or blank', () => {
    const service = new TreatmentPlanDocumentService(db);
    expect(() => service.sign('plan-doc-001', { signature: 'data:image/png;base64,CCCC', signerName: '' }, context)).toThrow(ValidationError);
    expect(() => service.sign('plan-doc-001', { signature: 'data:image/png;base64,CCCC', signerName: '  ' }, context)).toThrow('签署人姓名不能为空');
  });

  it('throws NotFoundError when signing a plan that does not exist', () => {
    expect(() => new TreatmentPlanDocumentService(db).sign('plan-missing', { signature: 'x', signerName: '张三' }, context)).toThrow(NotFoundError);
  });
});
