// HrService / AlertService 模块化 spec：自 services-edge.spec.ts（聚合文件）迁移而来。
// 迁移约定：聚合文件按模块逐步拆出后删除（迁移前保持聚合）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { HrService, AlertService } from './hr-alerts';
import type { AppContext } from '../../../domain/contracts';

describe('HrService and AlertService edge branches', () => {
  let db: Database.Database;
  let dataDir: string;
  let context: AppContext;
  const now = '2026-08-04T00:00:00.000Z';

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-hr-alerts-'));
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

  it('covers HR attendance and leave approval branches', () => {
    const hr = new HrService(db);
    expect(hr.attendance(now.slice(0, 10), context).items).toBeInstanceOf(Array);
    expect(hr.attendance().items).toBeInstanceOf(Array);
    db.prepare(
      `INSERT INTO LeaveRequest (
         id, clinicId, createdAt, updatedAt, deletedAt,
         userId, startDate, endDate, type, reason, status
       ) VALUES (?, ?, ?, ?, NULL, 'user-admin-001', '2026-08-01', '2026-08-02', 'ANNUAL', 'r', 'PENDING')`,
    ).run('leave-edge-reject', context.clinicId, now, now);
    expect(hr.approveLeave('leave-edge-reject', 'user-admin-001', false, context).status).toBe('REJECTED');
    expect(() => hr.approveLeave('leave-edge-reject', 'user-admin-001', true, context)).toThrow('cannot be approved');
    expect(() => hr.approveLeave('missing-leave', 'user-admin-001', true, context)).toThrow('Leave request not found');
    db.prepare(
      `INSERT INTO LeaveRequest (
         id, clinicId, createdAt, updatedAt, deletedAt,
         userId, startDate, endDate, type, reason, status
       ) VALUES (?, ?, ?, ?, NULL, 'user-admin-001', '2026-08-01', '2026-08-02', 'ANNUAL', 'race', 'PENDING')`,
    ).run('leave-edge-race', context.clinicId, now, now);
    const failingHr = new HrService(db, {
      attendance: () => ({ items: [], total: 0, page: 1, pageSize: 200 }),
      approveLeave: () => 0,
    });
    expect(() => failingHr.approveLeave('leave-edge-race', 'user-admin-001', true, context)).toThrow('cannot be approved');
  });

  it('covers business alert lifecycle, transitions, and race guards', () => {
    const alerts = new AlertService(db);
    expect(alerts.open().items).toBeInstanceOf(Array);
    expect(() => alerts.setStatus('missing-alert', 'RESOLVED', 'user-admin-001')).toThrow('Business alert not found');
    expect(() => alerts.setStatus('missing-alert', 'RESOLVED')).toThrow('Business alert not found');
    const alertEdge = alerts.create({
      alertType: 'TEST',
      level: 'INFO',
      severity: 'INFO',
      title: 'T',
      message: 'M',
      source: 'edge',
      clinicId: context.clinicId,
    });
    expect(alerts.setStatus(String(alertEdge.id), 'ACKNOWLEDGED', 'user-admin-001', context).status).toBe('ACKNOWLEDGED');
    expect(alerts.setStatus(String(alertEdge.id), 'RESOLVED', 'user-admin-001', context).status).toBe('RESOLVED');
    expect(() => alerts.setStatus(String(alertEdge.id), 'OPEN', 'user-admin-001', context)).toThrow('Cannot transition');
    expect(() => alerts.setStatus(String(alertEdge.id), 'BAD' as never, 'user-admin-001', context)).toThrow('Invalid business alert status');
    const alertRace = alerts.create({
      alertType: 'TEST',
      level: 'INFO',
      severity: 'INFO',
      title: 'R',
      message: 'R',
      source: 'edge-race',
      clinicId: context.clinicId,
    });
    const failingAlerts = new AlertService(db, {
      open: () => ({ items: [], total: 0, page: 1, pageSize: 100 }),
      setStatus: () => 0,
    });
    expect(() => failingAlerts.setStatus(String(alertRace.id), 'RESOLVED', 'user-admin-001', context)).toThrow('status update failed');
    const nullAlertRace = alerts.create({
      alertType: 'TEST',
      level: 'INFO',
      severity: 'INFO',
      title: 'Null',
      message: 'Null',
      source: 'edge-null-race',
    });
    const failingNullAlerts = new AlertService(db, {
      open: () => ({ items: [], total: 0, page: 1, pageSize: 100 }),
      setStatus: () => 0,
    });
    expect(() => failingNullAlerts.setStatus(String(nullAlertRace.id), 'RESOLVED')).toThrow('status update failed');
    expect(() => alerts.setStatus('missing-alert', 'RESOLVED', 'user-admin-001', context)).toThrow('Business alert not found');
  });

  it('open：keyset 游标翻页与快照一致、不重不漏', () => {
    const service = new AlertService(db);
    // 本文件共享 DB：快照过滤本用例 edge-cursor-* 告警，再按 nextCursor 逐页对账。
    for (let i = 0; i < 3; i += 1) {
      service.create({
        alertType: 'TEST',
        level: 'INFO',
        severity: 'INFO',
        title: `Cursor ${i}`,
        message: 'M',
        source: `edge-cursor-${i}`,
        clinicId: context.clinicId,
      });
    }
    const onlyCursor = (rows: Array<Record<string, unknown>>) =>
      rows.filter((row) => String(row.source ?? '').startsWith('edge-cursor-'));
    const snapshot = onlyCursor(service.open(context, { page: 1, pageSize: 500 }).items);
    expect(snapshot.length).toBeGreaterThanOrEqual(3);
    const walked: string[] = [];
    let cursor: string | null = null;
    for (let page = 1; page <= 10; page += 1) {
      const pageResult = service.open(context, { page, pageSize: 1, cursor });
      walked.push(...onlyCursor(pageResult.items).map((row) => String(row.id)));
      if (!pageResult.nextCursor) break;
      cursor = pageResult.nextCursor;
    }
    expect(walked).toEqual(snapshot.map((row) => String(row.id)));
    expect(new Set(walked).size).toBe(snapshot.length);
  });
});
