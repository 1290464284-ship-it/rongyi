// AnalyticsService 模块化 spec：自 services-edge.spec.ts（聚合文件）迁移而来。
// 迁移约定：聚合文件按模块逐步拆出后删除（迁移前保持聚合）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { AnalyticsService } from './analytics';
import type { AppContext } from '../../../domain/contracts';

describe('AnalyticsService', () => {
  let db: Database.Database;
  let dataDir: string;
  let context: AppContext;
  const now = '2026-08-04T00:00:00.000Z';

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-analytics-'));
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

  it('includes doctors linked only through UserClinic in doctor anomalies', () => {
    db.prepare(
      `INSERT INTO User (
         id, clinicId, createdAt, updatedAt, deletedAt,
         username, passwordHash, name, role, active, loginAttempts, tokenVersion
       ) VALUES ('doctor-anomaly-membership', NULL, ?, ?, NULL, 'anomaly-doc', 'x', 'Anomaly Doc', 'DOCTOR', 1, 0, 0)`,
    ).run(now, now);
    db.prepare(
      `INSERT INTO UserClinic (userId, clinicId, role, createdAt, updatedAt, deletedAt)
       VALUES ('doctor-anomaly-membership', 'clinic-v2-001', 'DOCTOR', ?, ?, NULL)`,
    ).run(now, now);
    db.prepare(
      `INSERT INTO Charge (
         id, patientId, visitId, doctorId, number, totalAmount, paidAmount, refundedAmount,
         discount, status, payMethod, paidAt, remark, clinicId, createdAt, updatedAt, deletedAt
       ) VALUES ('charge-anomaly-membership', 'patient-demo-001', NULL, 'doctor-anomaly-membership', 'CHG-ANOM',
         10000, 10000, 0, 0, 'PAID', 'CASH', ?, NULL, 'clinic-v2-001', ?, ?, NULL)`,
    ).run(now, now, now);

    const analytics = new AnalyticsService(db);
    const rows = analytics.doctorAnomalies(context);
    expect(rows.some((row) => row.doctorId === 'doctor-anomaly-membership')).toBe(true);
    const other = analytics.doctorAnomalies({ ...context, clinicId: 'clinic-other' });
    expect(other.some((row) => row.doctorId === 'doctor-anomaly-membership')).toBe(false);
  });
});
