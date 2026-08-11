import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../infrastructure/database';
import {
  BulkImportService,
  CephalometricService,
  DebtService,
  NotificationService,
  PrescriptionSafetyService,
  SatisfactionService,
  TreatmentProgressService,
} from './services';
import type { AppContext } from '../../domain/contracts';

describe('remaining services', () => {
  let db: Database.Database;
  let dataDir: string;
  let context: AppContext;
  const now = '2026-08-03T00:00:00.000Z';

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-remaining-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    context = {
      userId: 'user-admin-001',
      clinicId: 'clinic-v2-001',
      role: 'BOSS',
      traceId: 'trace',
      now: () => new Date(),
    };
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('detects prescription allergy warnings', () => {
    db.prepare('UPDATE Patient SET allergies = ? WHERE id = ?').run('["Aspirin"]', 'patient-demo-001');
    db.prepare(
      `INSERT INTO Prescription (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', 'user-admin-001')`,
    ).run('rx-remaining', context.clinicId, now, now);
    db.prepare(
      `INSERT INTO PrescriptionItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         prescriptionId, name, days, quantity, price
       ) VALUES (?, ?, ?, ?, NULL, ?, 'Aspirin', 1, 1, 10)`,
    ).run('rxi-remaining', context.clinicId, now, now, 'rx-remaining');
    const result = new PrescriptionSafetyService(db).check('rx-remaining', context);
    expect(result.safe).toBe(false);
    expect(result.warnings[0]).toContain('Aspirin');
  });

  it('computes cephalometric metrics and treatment progress', () => {
    db.prepare(
      `INSERT INTO CephalometricCase (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, imageUrl, landmarksJson, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', 'x.png',
         '{"sella":{"x":0,"y":0},"nasion":{"x":10,"y":0}}', 'DRAFT')`,
    ).run('ceph-remaining', context.clinicId, now, now);
    const ceph = new CephalometricService(db).compute('ceph-remaining', context);
    expect(ceph.metrics).toHaveProperty('snLength');

    db.prepare(
      `INSERT INTO TreatmentPlan (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, name, status, totalFee
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', 'user-admin-001', 'Plan', 'APPROVED', 100)`,
    ).run('plan-remaining', context.clinicId, now, now);
    db.prepare(
      `INSERT INTO TreatmentPlanItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         planId, code, name, category, price, quantity, status
       ) VALUES (?, ?, ?, ?, NULL, ?, 'C-1', 'Item', 'GENERAL', 100, 1, 'COMPLETED')`,
    ).run('plan-item-remaining', context.clinicId, now, now, 'plan-remaining');
    const progress = new TreatmentProgressService(db).summary('plan-remaining', context);
    expect(progress.progress).toBe(100);
  });

  it('pays debt, lists notifications, and calculates NPS', async () => {
    db.prepare(
      `INSERT INTO Debt (
         id, clinicId, createdAt, updatedAt, deletedAt,
         chargeId, patientId, totalAmount, paidAmount, status
       ) VALUES (?, ?, ?, ?, NULL, 'charge', 'patient-demo-001', 1000, 0, 'UNPAID')`,
    ).run('debt-remaining', context.clinicId, now, now);
    expect((await new DebtService(db).pay('debt-remaining', 300, context)).status).toBe('PARTIAL');

    db.prepare(
      `INSERT INTO Notification (
         id, clinicId, createdAt, updatedAt, deletedAt,
         userId, kind, title, body
       ) VALUES (?, ?, ?, ?, NULL, 'user-admin-001', 'system', 'Title', 'Content')`,
    ).run('notification-remaining', context.clinicId, now, now);
    const notifications = new NotificationService(db);
    expect(notifications.list('user-admin-001', null).items.length).toBeGreaterThanOrEqual(1);
    const paged = notifications.list('user-admin-001', null, { page: 1, pageSize: 5 });
    expect(paged.items.length).toBeGreaterThanOrEqual(1);
    expect(paged.total).toBeGreaterThanOrEqual(paged.items.length);
    expect(notifications.markRead('notification-remaining', 'user-admin-001').read).toBe(true);

    db.prepare(
      `INSERT INTO SatisfactionSurvey (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, score, channel, surveyDate
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', 10, 'WECHAT', '2026-08-01')`,
    ).run('survey-remaining', context.clinicId, now, now);
    const satisfaction = new SatisfactionService(db);
    expect(satisfaction.nps(context).score).toBeGreaterThanOrEqual(0);
    expect(satisfaction.trend(context).length).toBeGreaterThanOrEqual(1);
    expect(satisfaction.doctorRankings(context)).toBeInstanceOf(Array);
  });

  it('reports failed bulk import rows', async () => {
    const service = new BulkImportService(db);
    const result = await service.importRows('patients', [
      { code: 'BAD-1', name: 'Bad', gender: 'INVALID' },
    ], context);
    expect(result.imported).toBe(0);
    expect(result.failed).toBe(1);
  });
});
