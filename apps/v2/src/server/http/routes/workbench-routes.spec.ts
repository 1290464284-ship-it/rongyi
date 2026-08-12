import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express, { type Express } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { registerWorkbenchRoutes } from './workbench-routes';
import { buildRouteDeps } from './route-deps.helper';

describe('workbench routes', () => {
  let dataDir: string;
  let db: Database.Database;
  let app: Express;
  const nowIso = '2026-08-05T10:00:00.000Z';

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-workbench-routes-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
    // 种子数据中的演示预约使用真实当前时间，可能与固定测试日期重叠；
    // 将其移到遥远的未来，保证断言只依赖本用例插入的数据。
    db.prepare(
      `UPDATE Appointment SET startTime = ?, endTime = ?, updatedAt = ? WHERE id = 'appointment-demo-001'`,
    ).run('2099-01-01T00:00:00.000Z', '2099-01-01T01:00:00.000Z', nowIso);

    app = express();
    app.use((req, _res, next) => {
      (req as unknown as { context: unknown }).context = {
        userId: 'user-admin-001',
        clinicId: 'clinic-v2-001',
        role: 'BOSS',
        traceId: 'test-trace',
        now: () => new Date('2026-08-05T10:00:00.000Z'),
      };
      next();
    });
    registerWorkbenchRoutes(app, buildRouteDeps(db));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('returns zero totals when there is no data for the day', async () => {
    const res = await request(app).get('/api/v2/workbench/today').expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.date).toBe('2026-08-05');
    expect(res.body.data.totals).toEqual({ registrations: 0, appointments: 0, inProgressVisits: 0 });
    expect(res.body.data.registrations).toEqual([]);
    expect(res.body.data.appointments).toEqual([]);
  });

  it('returns today registrations, appointments, and totals', async () => {
    db.prepare(
      `INSERT INTO Registration (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, type, status, registeredAt
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, 'REGULAR', 'REGISTERED', ?)`,
    ).run('route-reg-1', 'clinic-v2-001', nowIso, nowIso, 'patient-demo-001', 'user-admin-001', '2026-08-05T01:00:00.000Z');
    db.prepare(
      `INSERT INTO Appointment (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, startTime, endTime, status, type
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, 'BOOKED', 'REGULAR')`,
    ).run('route-appt-1', 'clinic-v2-001', nowIso, nowIso, 'patient-demo-001', 'user-admin-001', '2026-08-05T09:00:00.000Z', '2026-08-05T10:00:00.000Z');
    db.prepare(
      `INSERT INTO Visit (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, startTime, status
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 'IN_PROGRESS')`,
    ).run('route-visit-1', 'clinic-v2-001', nowIso, nowIso, 'patient-demo-001', 'user-admin-001', '2026-08-05T08:00:00.000Z');

    const res = await request(app).get('/api/v2/workbench/today').expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.date).toBe('2026-08-05');
    expect(res.body.data.totals).toEqual({ registrations: 1, appointments: 1, inProgressVisits: 1 });
    expect(res.body.data.registrations).toHaveLength(1);
    expect(res.body.data.registrations[0].id).toBe('route-reg-1');
    expect(res.body.data.registrations[0].patientName).toBe('Demo Patient');
    expect(res.body.data.appointments).toHaveLength(1);
    expect(res.body.data.appointments[0].id).toBe('route-appt-1');
  });
});
