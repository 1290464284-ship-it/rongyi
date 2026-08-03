import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../infrastructure/database';
import { runMigrations } from '../infrastructure/migrations';
import {
  AlertService,
  AppointmentService,
  AuthService,
  BackupService,
  FollowUpService,
  HrService,
  PrintService,
  StatsService,
  SyncService,
} from './services';
import {
  AnalyticsService,
  ClinicalWorkflowService,
  ReplenishmentService,
} from './workflow-services';
import type { AppContext } from '../../domain/contracts';

describe('service coverage', () => {
  let db: Database.Database;
  let dataDir: string;
  let context: AppContext;
  const now = '2026-08-03T00:00:00.000Z';

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-services-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
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

  it('authenticates users and changes passwords', async () => {
    const auth = new AuthService(db);
    const login = await auth.login('admin', 'REDACTED');
    expect(login.user.username).toBe('admin');
    await expect(auth.login('admin', 'wrong')).rejects.toThrow('Invalid username or password');
    await auth.changePassword('user-admin-001', 'REDACTED', 'newpass123');
    await expect(auth.refresh(login.refreshToken)).rejects.toThrow('Invalid refresh token');
    await expect(auth.login('admin', 'newpass123')).resolves.toBeDefined();
  });

  it('creates and transitions appointments', async () => {
    const service = new AppointmentService(db);
    const created = await service.create({
      patientId: 'patient-demo-001',
      doctorId: 'user-admin-001',
      startTime: new Date(Date.now() + 2 * 86_400_000).toISOString(),
      endTime: new Date(Date.now() + 2 * 86_400_000 + 3_600_000).toISOString(),
      type: 'REGULAR',
    }, context);
    await expect(service.transition(String(created.id), 'CANCELLED', context)).resolves.toMatchObject({ status: 'CANCELLED' });
  });

  it('generates follow-ups and lists reminders', async () => {
    const service = new FollowUpService(db);
    db.prepare(
      `INSERT INTO FollowUpTemplate (
         id, clinicId, createdAt, updatedAt, deletedAt,
         name, daysAfter, content, isEnabled
       ) VALUES (?, ?, ?, ?, NULL, 'Template', 5, 'Template follow-up', 1)`,
    ).run('template-test', context.clinicId, now, now);
    db.prepare(
      `INSERT INTO Visit (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, startTime, endTime, status
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, 'COMPLETED')`,
    ).run('visit-followup', context.clinicId, now, now, 'patient-demo-001', 'user-admin-001', now, now);
    db.prepare(
      `INSERT INTO Treatment (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, visitId, doctorId, code, name, category,
         price, quantity, status, completedDate
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 'T-1', 'T', 'GENERAL', 100, 1, 'COMPLETED', ?)`,
    ).run('treatment-followup', context.clinicId, now, now, 'patient-demo-001', 'visit-followup', 'user-admin-001', '2026-08-01');
    await service.batchGenerate(2, context);
    const generated = db.prepare('SELECT * FROM FollowUp WHERE templateId = ?').all('template-test') as Array<Record<string, unknown>>;
    expect(generated.length).toBeGreaterThanOrEqual(1);
    expect(typeof service.adherence().rate).toBe('number');
  });

  it('creates and verifies backups', async () => {
    const service = new BackupService(db, path.join(dataDir, 'v2.sqlite'), path.join(dataDir, 'backups'));
    const backup = await service.create();
    const result = await service.verify(String(backup.filename));
    expect(result.integrity).toBe('ok');
  });

  it('creates encrypted backups, stages restore, and cleans up', async () => {
    const backupDir = path.join(dataDir, 'encrypted-backups');
    process.env.V2_BACKUP_KEY = 'test-backup-key-0123456789abcdef';
    const service = new BackupService(db, path.join(dataDir, 'v2.sqlite'), backupDir);
    const backup = await service.create({ type: 'AUTO', encrypted: true });
    expect(String(backup.filename)).toMatch(/\.enc$/);
    const verified = await service.verify(String(backup.filename));
    expect(verified.integrity).toBe('ok');
    const staged = await service.stageRestore(String(backup.filename));
    expect(staged.stagedPath).toBeDefined();
    expect(service.cleanup(0).deleted.length).toBeGreaterThanOrEqual(1);
    delete process.env.V2_BACKUP_KEY;
  });

  it('returns dashboard and revenue stats', () => {
    const service = new StatsService(db);
    expect(service.dashboard(context)).toHaveProperty('patients');
    expect(service.revenue(undefined, undefined, 'month')).toBeInstanceOf(Array);
    expect(service.patientGrowth()).toBeInstanceOf(Array);
    expect(service.doctorWorkload()).toBeInstanceOf(Array);
    expect(service.inventoryStats()).toBeInstanceOf(Array);
    expect(service.memberStats()).toHaveProperty('total');
  });

  it('runs replenishment and clinical workflows', () => {
    const replenishment = new ReplenishmentService(db);
    expect(typeof replenishment.generate(context).generated).toBe('number');
    db.prepare(
      `INSERT INTO Registration (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, type, status, registeredAt
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
    ).run('reg-workflow', context.clinicId, now, now, 'patient-demo-001', 'user-admin-001', 'REGULAR', 'REGISTERED', now);
    const workflow = new ClinicalWorkflowService(db);
    expect(workflow.registrationStatus('reg-workflow', 'IN_PROGRESS', context).status).toBe('IN_PROGRESS');
  });

  it('returns analytics, sync, print, HR, and alert data', () => {
    const analytics = new AnalyticsService(db);
    expect(analytics.rfm(context)).toBeInstanceOf(Array);
    expect(analytics.churn(context)).toBeInstanceOf(Array);
    expect(analytics.doctorAnomalies(context)).toBeInstanceOf(Array);
    const sync = new SyncService(db);
    expect(sync.pull(now, 'desktop').changes).toBeInstanceOf(Array);
    expect(sync.push({ deviceId: 'desktop', changes: [] }).accepted).toBe(0);
    expect(sync.cleanup(now).deleted).toBeGreaterThanOrEqual(0);
    const print = new PrintService();
    expect(print.render('report', { title: 'R' })).toContain('R');
    const hr = new HrService(db);
    expect(hr.attendance()).toBeInstanceOf(Array);
    db.prepare(
      `INSERT INTO LeaveRequest (
         id, clinicId, createdAt, updatedAt, deletedAt,
         userId, startDate, endDate, type, reason, status
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 'ANNUAL', 'reason', 'PENDING')`,
    ).run('leave-workflow', context.clinicId, now, now, 'user-admin-001', '2026-08-01', '2026-08-03');
    expect(hr.approveLeave('leave-workflow', context.userId, true).status).toBe('APPROVED');
    const alerts = new AlertService(db);
    expect(alerts.open()).toBeInstanceOf(Array);
    db.prepare(
      `INSERT INTO BusinessAlert (
         id, clinicId, createdAt, updatedAt, deletedAt,
         alertType, severity, level, title, message, source, status
       ) VALUES (?, ?, ?, ?, NULL, 'SCHEDULER_TASK_FAILURE', 'CRITICAL', 'CRITICAL', 'Title', 'Message', 'test', 'OPEN')`,
    ).run('alert-wf', context.clinicId, now, now);
    expect(alerts.setStatus('alert-wf', 'ACKNOWLEDGED', context.userId).status).toBe('ACKNOWLEDGED');
    const created = alerts.create({
      alertType: 'SCHEDULER_TASK_FAILURE',
      level: 'WARNING',
      severity: 'WARN',
      title: 'Created alert',
      message: 'Created message',
      source: 'test',
      clinicId: context.clinicId,
    });
    expect(created.status).toBe('OPEN');
  });
});
