import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { BulkImportService, CephalometricService, NotificationService, PatientRiskService, PrescriptionSafetyService, TreatmentProgressService } from './clinical-ops';
import type { AppContext } from '../../../domain/contracts';

describe('BulkImportService edge paths', () => {
  let db: Database.Database;
  let dataDir: string;
  let service: BulkImportService;
  const baseContext = {
    userId: 'user-admin-001',
    clinicId: 'clinic-v2-001',
    role: 'BOSS' as const,
    traceId: 'bulk-edge-test',
    now: () => new Date('2026-08-14T10:00:00.000Z'),
  };

  const patientRow = () => ({
    code: `BULK-EDGE-${Math.floor(Math.random() * 1e9)}`,
    name: 'Bulk Edge Patient',
    gender: 'UNKNOWN',
    phone: '13600000099',
    source: 'OTHER',
    active: true,
  });

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-bulk-import-edge-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
    service = new BulkImportService(db);
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('rejects imports for resources whose module permission the caller lacks', async () => {
    const context: AppContext = { ...baseContext, permissions: ['analytics'] };
    await expect(service.importRows('patients', [patientRow()], context)).rejects.toThrow(
      'Forbidden resource: patients',
    );
  });

  it('aborts with the message when the insert statement fails with a systematic sqlite error', async () => {
    const originalPrepare = db.prepare.bind(db);
    vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      if (sql.includes('INSERT INTO Patient')) {
        throw Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' });
      }
      return originalPrepare(sql);
    });
    try {
      await expect(service.importRows('patients', [patientRow()], baseContext)).rejects.toThrow(
        '批量导入中止：database is locked',
      );
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('rolls back and aborts with the message when COMMIT fails with a systematic sqlite error', async () => {
    const originalExec = db.exec.bind(db);
    vi.spyOn(db, 'exec').mockImplementation((sql: string) => {
      if (sql === 'COMMIT') {
        throw Object.assign(new Error('database or disk is full'), { code: 'SQLITE_FULL' });
      }
      return originalExec(sql);
    });
    try {
      await expect(service.importRows('patients', [patientRow()], baseContext)).rejects.toThrow(
        '批量导入中止：前 0 条已导入，请人工核对后重试（database or disk is full）',
      );
      const count = db.prepare(
        "SELECT COUNT(*) AS count FROM Patient WHERE code LIKE 'BULK-EDGE-%' AND deletedAt IS NULL",
      ).get() as { count: number };
      expect(count.count).toBe(0);
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe('PatientRiskService', () => {
  // 复用同模块文件（clinical-ops.ts）的共享库：风险评分只读种子患者数据。
  let db: Database.Database;
  let dataDir: string;

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-risk-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('calculates a patient risk score', () => {
    const service = new PatientRiskService(db);
    const result = service.calculate('patient-demo-001', {
      userId: 'user-admin-001',
      clinicId: 'clinic-v2-001',
      role: 'BOSS',
      traceId: 'risk-test',
      now: () => new Date(),
    });
    expect(result).toHaveProperty('cariesScore');
    expect(result).toHaveProperty('periodontalScore');
  });
});

describe('Clinical services edge branches', () => {
  let db: Database.Database;
  let dataDir: string;
  let context: AppContext;
  const now = '2026-08-04T00:00:00.000Z';

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-clinical-edge-'));
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

  it('covers risk score levels and missing patients', () => {
    const risk = new PatientRiskService(db);
    const riskResult = risk.calculate('patient-demo-001', context);
    expect(riskResult).toHaveProperty('cariesScore');
    db.prepare(
      `INSERT INTO Patient (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, gender, phone, tags, allergies, medicalHistory,
         medicationHistory, systemicDiseases, source, active
       ) VALUES (?, ?, ?, ?, NULL, 'RISK', 'Risk Patient', 'UNKNOWN', '13600000004',
         '[]', '[]', '[]', '[]', '[]', 'WALK_IN', 1)`,
    ).run('patient-risk-high', context.clinicId, now, now);
    for (let i = 0; i < 16; i += 1) {
      db.prepare(
        `INSERT INTO Treatment (
           id, clinicId, createdAt, updatedAt, deletedAt,
           patientId, doctorId, code, name, category, price, quantity, status
         ) VALUES (?, ?, ?, ?, NULL, 'patient-risk-high', 'user-admin-001', ?, 'T', 'GENERAL', 100, 1, 'COMPLETED')`,
      ).run(`risk-treatment-${i}`, context.clinicId, now, now, `R-${i}`);
    }
    const riskHigh = new PatientRiskService(db).calculate('patient-risk-high', context);
    expect(riskHigh).toHaveProperty('cariesScore');
    expect(() => risk.calculate('missing-risk-patient', context)).toThrow('Patient not found');
    for (const [patientId, codePrefix, count] of [
      ['patient-risk-medium', 'RM', 6],
      ['patient-risk-high-level', 'RH', 12],
    ] as Array<[string, string, number]>) {
      db.prepare(
        `INSERT INTO Patient (
           id, clinicId, createdAt, updatedAt, deletedAt,
           code, name, gender, phone, tags, allergies, medicalHistory,
           medicationHistory, systemicDiseases, source, active
         ) VALUES (?, ?, ?, ?, NULL, ?, ?, 'UNKNOWN', '13600000005',
           '[]', '[]', '[]', '[]', '[]', 'WALK_IN', 1)`,
      ).run(patientId, context.clinicId, now, now, codePrefix, patientId);
      for (let i = 0; i < count; i += 1) {
        db.prepare(
          `INSERT INTO Treatment (
             id, clinicId, createdAt, updatedAt, deletedAt,
             patientId, doctorId, code, name, category, price, quantity, status
           ) VALUES (?, ?, ?, ?, NULL, ?, 'user-admin-001', ?, 'T', 'GENERAL', 100, 1, 'COMPLETED')`,
        ).run(`${patientId}-${i}`, context.clinicId, now, now, patientId, `${codePrefix}-${i}`);
      }
      new PatientRiskService(db).calculate(patientId, context);
    }
    new PatientRiskService(db).calculate('patient-risk-medium', { ...context, clinicId: null });
  });

  it('covers prescription safety checks with missing and empty allergy data', async () => {
    const prescription = new PrescriptionSafetyService(db);
    await expect(() => prescription.check('missing-rx', context)).toThrow('Prescription not found');
    db.prepare(
      `INSERT INTO Prescription (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId
       ) VALUES (?, ?, ?, ?, NULL, 'missing-patient', 'user-admin-001')`,
    ).run('rx-edge-missing-patient', context.clinicId, now, now);
    expect(prescription.check('rx-edge-missing-patient', context).safe).toBe(true);
    db.prepare(
      `INSERT INTO Patient (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, gender, phone, tags, allergies, medicalHistory,
         medicationHistory, systemicDiseases, source, active
       ) VALUES (?, ?, ?, ?, NULL, 'ALLERGY-EMPTY', 'Empty Allergy', 'UNKNOWN', '13600000007',
         '[]', '', '[]', '[]', '[]', 'WALK_IN', 1)`,
    ).run('patient-allergy-empty', context.clinicId, now, now);
    db.prepare(
      `INSERT INTO Prescription (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId
       ) VALUES (?, ?, ?, ?, NULL, 'patient-allergy-empty', 'user-admin-001')`,
    ).run('rx-edge-empty-allergy', context.clinicId, now, now);
    expect(prescription.check('rx-edge-empty-allergy', context).safe).toBe(true);
    db.prepare(
      `INSERT INTO Patient (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, gender, phone, tags, allergies, medicalHistory,
         medicationHistory, systemicDiseases, source, active
       ) VALUES (?, ?, ?, ?, NULL, 'ALLERGY-OBJECT', 'Object Allergy', 'UNKNOWN', '13600000010',
         '[]', '{}', '[]', '[]', '[]', 'WALK_IN', 1)`,
    ).run('patient-allergy-object', context.clinicId, now, now);
    db.prepare(
      `INSERT INTO Prescription (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId
       ) VALUES (?, ?, ?, ?, NULL, 'patient-allergy-object', 'user-admin-001')`,
    ).run('rx-edge-object-allergy', context.clinicId, now, now);
    expect(prescription.check('rx-edge-object-allergy', context).safe).toBe(true);
    db.prepare(
      `INSERT INTO Patient (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, gender, phone, tags, allergies, medicalHistory,
         medicationHistory, systemicDiseases, source, active
       ) VALUES (?, ?, ?, ?, NULL, 'ALLERGY-NULL', 'Null Allergy', 'UNKNOWN', '13600000011',
         '[]', NULL, '[]', '[]', '[]', 'WALK_IN', 1)`,
    ).run('patient-allergy-null', context.clinicId, now, now);
    db.prepare(
      `INSERT INTO Prescription (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId
       ) VALUES (?, ?, ?, ?, NULL, 'patient-allergy-null', 'user-admin-001')`,
    ).run('rx-edge-null-allergy', context.clinicId, now, now);
    expect(prescription.check('rx-edge-null-allergy', context).safe).toBe(true);
  });

  it('covers cephalometric compute with malformed and valid landmarks', async () => {
    const ceph = new CephalometricService(db);
    await expect(() => ceph.compute('missing-ceph', context)).toThrow('Cephalometric case not found');
    db.prepare(
      `INSERT INTO CephalometricCase (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, imageUrl, landmarksJson, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', 'x.png', '{}', 'DRAFT')`,
    ).run('ceph-edge-empty', context.clinicId, now, now);
    expect(ceph.compute('ceph-edge-empty', context).metrics).toEqual({});
    db.prepare(
      `INSERT INTO CephalometricCase (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, imageUrl, landmarksJson, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', 'x.png', NULL, 'DRAFT')`,
    ).run('ceph-edge-null-landmarks', context.clinicId, now, now);
    expect(ceph.compute('ceph-edge-null-landmarks', context).metrics).toEqual({});
    db.prepare(
      `INSERT INTO CephalometricCase (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, imageUrl, landmarksJson, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', 'x.png', 'not-json', 'DRAFT')`,
    ).run('ceph-edge-malformed-landmarks', context.clinicId, now, now);
    expect(ceph.compute('ceph-edge-malformed-landmarks', context).metrics).toEqual({});
    db.prepare(
      `INSERT INTO CephalometricCase (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, imageUrl, landmarksJson, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', 'x.png', '[]', 'DRAFT')`,
    ).run('ceph-edge-array-landmarks', context.clinicId, now, now);
    expect(ceph.compute('ceph-edge-array-landmarks', context).metrics).toEqual({});
    db.prepare(
      `INSERT INTO CephalometricCase (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, imageUrl, landmarksJson, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', 'x.png', '123', 'DRAFT')`,
    ).run('ceph-edge-number-landmarks', context.clinicId, now, now);
    expect(ceph.compute('ceph-edge-number-landmarks', context).metrics).toEqual({});
    db.prepare(
      `INSERT INTO CephalometricCase (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, imageUrl, landmarksJson, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', 'x.png',
         '{"sella":{"x":0,"y":0},"nasion":{"x":10,"y":0},"upperIncisor":{"x":0,"y":10},"lowerIncisor":{"x":10,"y":10}}', 'DRAFT')`,
    ).run('ceph-edge-full', context.clinicId, now, now);
    const cephMetrics = ceph.compute('ceph-edge-full', context).metrics as Record<string, number>;
    expect(cephMetrics.snLength).toBeGreaterThan(0);
    expect(cephMetrics.interincisalAngle).toBeGreaterThanOrEqual(0);
  });

  it('covers treatment progress summary and notifications branches', async () => {
    const progress = new TreatmentProgressService(db);
    await expect(() => progress.summary('missing-plan', context)).toThrow('Treatment plan not found');
    db.prepare(
      `INSERT INTO TreatmentPlan (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, name, status, totalFee
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', 'user-admin-001', 'Plan', 'APPROVED', 0)`,
    ).run('plan-edge-empty', context.clinicId, now, now);
    expect(progress.summary('plan-edge-empty', context).progress).toBe(0);

    const notifications = new NotificationService(db);
    expect(notifications.list('user-admin-001', null).items).toBeInstanceOf(Array);
    expect(() => notifications.markRead('missing-notification', context.userId)).toThrow('Notification not found');
  });
});
