import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../infrastructure/database';
import { runMigrations } from '../infrastructure/migrations';
import {
  AlertService,
  AppointmentService,
  AuthService,
  BackupService,
  ChargeService,
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
    const first = await service.batchGenerate(2, context);
    expect(first.generated).toBeGreaterThanOrEqual(1);
    const beforeSecond = (db.prepare('SELECT COUNT(*) AS c FROM FollowUp WHERE templateId = ?').get('template-test') as { c: number }).c;
    const second = await service.batchGenerate(2, context);
    expect(second.generated).toBe(0);
    const afterSecond = (db.prepare('SELECT COUNT(*) AS c FROM FollowUp WHERE templateId = ?').get('template-test') as { c: number }).c;
    expect(afterSecond).toBe(beforeSecond);
    await service.batchGenerate(0, context);
    await service.batchGenerate(1000, context);
    const generated = db.prepare('SELECT * FROM FollowUp WHERE templateId = ?').all('template-test') as Array<Record<string, unknown>>;
    expect(generated.length).toBeGreaterThanOrEqual(1);
    expect(typeof service.adherence(context).rate).toBe('number');
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
    await service.create({ type: 'AUTO', encrypted: true });
    const verified = await service.verify(String(backup.filename));
    expect(verified.integrity).toBe('ok');
    const staged = await service.stageRestore(String(backup.filename));
    expect(staged.stagedPath).toBeDefined();
    expect(fs.existsSync(path.join(dataDir, '.restore-pending.json'))).toBe(true);
    const cleanup = service.cleanup(0);
    expect(cleanup.deleted.length).toBeGreaterThanOrEqual(1);
    for (const file of cleanup.deleted) {
      expect(db.prepare('SELECT 1 FROM BackupRecord WHERE filename = ?').get(file.filename)).toBeUndefined();
    }
    expect(service.cleanup(366).kept).toBeGreaterThanOrEqual(1);
    expect(service.cleanup(Number.NaN).kept).toBeGreaterThanOrEqual(1);
    delete process.env.V2_BACKUP_KEY;
  });

  it('refuses plaintext backups outside test unless explicitly allowed', async () => {
    const backupDir = path.join(dataDir, 'plaintext-policy-backups');
    const service = new BackupService(db, path.join(dataDir, 'v2.sqlite'), backupDir);
    const prevNodeEnv = process.env.NODE_ENV;
    const prevAllow = process.env.V2_ALLOW_PLAINTEXT_BACKUP;
    delete process.env.V2_BACKUP_KEY;
    try {
      // production 无 key 无授权：显式明文被拒，默认加密因缺 key 被拒
      process.env.NODE_ENV = 'production';
      delete process.env.V2_ALLOW_PLAINTEXT_BACKUP;
      await expect(service.create({ encrypted: false })).rejects.toThrow('Refusing to create plaintext backup');
      await expect(service.create()).rejects.toThrow('V2_BACKUP_KEY is required');
      // production 显式授权明文：允许
      process.env.V2_ALLOW_PLAINTEXT_BACKUP = '1';
      const allowed = await service.create({ encrypted: false });
      expect(String(allowed.filename)).toMatch(/\.sqlite$/);
      // test 环境：明文始终允许（现有用例已隐式覆盖，这里显式断言一次）
      process.env.NODE_ENV = 'test';
      delete process.env.V2_ALLOW_PLAINTEXT_BACKUP;
      const inTest = await service.create({ encrypted: false });
      expect(String(inTest.filename)).toMatch(/\.sqlite$/);
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prevNodeEnv;
      if (prevAllow === undefined) delete process.env.V2_ALLOW_PLAINTEXT_BACKUP; else process.env.V2_ALLOW_PLAINTEXT_BACKUP = prevAllow;
    }
  });

  it('removes the temp file when backup creation fails', async () => {
    const backupDir = path.join(dataDir, 'failed-backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const service = new BackupService(db, path.join(dataDir, 'v2.sqlite'), backupDir);
    delete process.env.V2_BACKUP_KEY;

    await expect(service.create({ encrypted: true })).rejects.toThrow('V2_BACKUP_KEY is required');

    const leftovers = fs.readdirSync(backupDir).filter((name) => name.endsWith('.tmp'));
    expect(leftovers).toEqual([]);
  });

  it('cleanup removes stale .tmp and .staged-* files but keeps fresh temp files and normal backups', async () => {
    const backupDir = path.join(dataDir, 'cleanup-temp-backups');
    const service = new BackupService(db, path.join(dataDir, 'v2.sqlite'), backupDir);
    const backup = await service.create();
    const normalPath = path.join(backupDir, String(backup.filename));
    const staleTmp = path.join(backupDir, 'stale.tmp');
    const staleStaged = path.join(backupDir, '.staged-old.sqlite');
    const freshTmp = path.join(backupDir, 'fresh.tmp');
    fs.writeFileSync(staleTmp, 'stale');
    fs.writeFileSync(staleStaged, 'stale');
    fs.writeFileSync(freshTmp, 'fresh');
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    fs.utimesSync(staleTmp, old, old);
    fs.utimesSync(staleStaged, old, old);

    const result = service.cleanup(30);

    expect(fs.existsSync(staleTmp)).toBe(false);
    expect(fs.existsSync(staleStaged)).toBe(false);
    expect(fs.existsSync(freshTmp)).toBe(true);
    expect(fs.existsSync(normalPath)).toBe(true);
    expect(result.deleted).toHaveLength(0);
  });

  it('returns dashboard and revenue stats', async () => {
    const service = new StatsService(db);
    expect(service.dashboard(context)).toHaveProperty('patients');
    expect(service.revenue(undefined, undefined, 'month', context)).toBeInstanceOf(Array);
    expect(service.patientGrowth(undefined, undefined, context)).toBeInstanceOf(Array);
    expect(service.inventoryStats(context)).toBeInstanceOf(Array);
    expect(service.memberStats(context)).toHaveProperty('total');

    const before = service.dashboard(context) as { paidAmount: number; unpaidAmount: number };
    const beforeRevenue = service.revenue(undefined, undefined, 'day', context)
      .reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
    const dashboardNow = new Date().toISOString();
    db.prepare(
      `INSERT INTO Patient (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, gender, phone, tags, allergies, medicalHistory,
         medicationHistory, systemicDiseases, source, active
       ) VALUES (?, ?, ?, ?, NULL, 'DASH-AUDIT', 'Dashboard Audit', 'UNKNOWN', '13600000009',
         '[]', '[]', '[]', '[]', '[]', 'WALK_IN', 1)`,
    ).run('patient-dashboard-audit', context.clinicId, dashboardNow, dashboardNow);
    const charges = new ChargeService(db);
    const refundedCharge = await charges.create({
      patientId: 'patient-dashboard-audit',
      items: [{ name: 'Audit', category: 'EXAM', price: 1000, quantity: 1 }],
    }, context);
    await charges.pay(String(refundedCharge.id), 500, 'CASH', undefined, context);
    await charges.refund(String(refundedCharge.id), 500, 'dashboard audit', context);
    const after = service.dashboard(context) as { paidAmount: number; unpaidAmount: number };
    expect(after.paidAmount).toBe(before.paidAmount);
    expect(after.unpaidAmount).toBe(before.unpaidAmount);
    const afterRevenue = service.revenue(undefined, undefined, 'day', context)
      .reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
    expect(afterRevenue).toBe(beforeRevenue);

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

  it('returns analytics, sync, print, HR, and alert data', async () => {
    const analytics = new AnalyticsService(db);
    expect(analytics.rfm(context)).toMatchObject({ items: expect.any(Array), truncated: expect.any(Boolean) });
    expect(analytics.churn(context)).toMatchObject({ items: expect.any(Array), truncated: expect.any(Boolean) });
    expect(analytics.doctorAnomalies(context)).toBeInstanceOf(Array);
    const sync = new SyncService(db);
    const device = sync.registerDevice('desktop', 'Desktop', context);
    expect(sync.pull(now, 'desktop', device.token, context).changes).toBeInstanceOf(Array);
    expect(await sync.push({ deviceId: 'desktop', deviceToken: device.token, changes: [] }, context)).toMatchObject({ accepted: 0, failed: 0 });
    const pushResult = await sync.push({
      deviceId: 'desktop',
      deviceToken: device.token,
      changes: [{
        tableName: 'Patient',
        recordId: 'patient-synced',
        operation: 'INSERT',
        updatedAt: now,
        data: {
          code: 'SYNC-1',
          name: 'Sync Patient',
          gender: 'UNKNOWN',
          phone: '13200000000',
          source: 'OTHER',
          active: true,
        },
      }],
    }, context);
    expect(pushResult.accepted).toBe(1);
    const synced = db.prepare('SELECT * FROM Patient WHERE id = ?').get('patient-synced') as { name: string } | undefined;
    expect(synced?.name).toBe('Sync Patient');
    expect(sync.cleanup(now, context).deleted).toBeGreaterThanOrEqual(0);
    const print = new PrintService();
    expect(print.render('report', { title: 'R' })).toContain('R');
    const hr = new HrService(db);
    expect(hr.attendance(undefined, context).items).toBeInstanceOf(Array);
    db.prepare(
      `INSERT INTO LeaveRequest (
         id, clinicId, createdAt, updatedAt, deletedAt,
         userId, startDate, endDate, type, reason, status
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 'ANNUAL', 'reason', 'PENDING')`,
    ).run('leave-workflow', context.clinicId, now, now, 'user-admin-001', '2026-08-01', '2026-08-03');
    expect(hr.approveLeave('leave-workflow', context.userId, true, context).status).toBe('APPROVED');
    const alerts = new AlertService(db);
    expect(alerts.open(context).items).toBeInstanceOf(Array);
    db.prepare(
      `INSERT INTO BusinessAlert (
         id, clinicId, createdAt, updatedAt, deletedAt,
         alertType, severity, level, title, message, source, status
       ) VALUES (?, ?, ?, ?, NULL, 'SCHEDULER_TASK_FAILURE', 'CRITICAL', 'CRITICAL', 'Title', 'Message', 'test', 'OPEN')`,
    ).run('alert-wf', context.clinicId, now, now);
    expect(alerts.setStatus('alert-wf', 'ACKNOWLEDGED', context.userId, context).status).toBe('ACKNOWLEDGED');
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

  it('caches analytics aggregates within the TTL', () => {
    const analytics = new AnalyticsService(db);
    const prepare = vi.spyOn(db, 'prepare');
    try {
      analytics.rfm(context);
      analytics.rfm(context);
      expect(prepare).toHaveBeenCalledTimes(2);
      analytics.churn(context);
      analytics.churn(context);
      expect(prepare).toHaveBeenCalledTimes(4);
      analytics.doctorAnomalies(context);
      analytics.doctorAnomalies(context);
      expect(prepare).toHaveBeenCalledTimes(5);
    } finally {
      prepare.mockRestore();
    }
  });

  it('rejects re-registering a device already owned by another user (S-L4)', () => {
    const sync = new SyncService(db);
    const ownerContext: AppContext = { ...context, userId: 'user-doctor-001' };
    const otherContext: AppContext = { ...context, userId: 'user-staff-002' };
    // 设备先由 A 注册
    const device = sync.registerDevice('device-owner-check', 'Owner Desktop', ownerContext);
    expect(device.token).toBeTruthy();
    // 同一用户可重复注册（轮换令牌）
    const reRegister = sync.registerDevice('device-owner-check', 'Owner Desktop', ownerContext);
    expect(reRegister.token).toBeTruthy();
    // 其他用户注册同一设备 → ConflictError（409）
    expect(() => sync.registerDevice('device-owner-check', 'Intruder', otherContext))
      .toThrowError(/already registered to another user/);
    // 未被抢占：轮换后的新令牌仍可正常拉取
    expect(sync.pull(now, 'device-owner-check', reRegister.token, context).changes).toBeInstanceOf(Array);
  });
});
