import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express, { type Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { AppError } from '../../infrastructure/errors';
import { registerTriageRoutes } from './triage-routes';

describe('triage routes', () => {
  let dataDir: string;
  let db: Database.Database;
  let app: Express;
  const nowIso = '2026-08-05T10:00:00.000Z';

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-triage-routes-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
    db.prepare(
      `UPDATE Appointment SET startTime = ?, endTime = ?, updatedAt = ? WHERE id = 'appointment-demo-001'`,
    ).run('2099-01-01T00:00:00.000Z', '2099-01-01T01:00:00.000Z', nowIso);

    app = express();
    app.use(express.json());
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
    registerTriageRoutes(app, db);
    app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      const appError = error instanceof AppError
        ? error
        : new AppError('INTERNAL_ERROR', error instanceof Error ? error.message : String(error), 500);
      res.status(appError.status).json({ success: false, code: appError.code, message: appError.message });
    });
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  function insertDepartment(id: string, name: string): void {
    db.prepare(
      `INSERT INTO Department (id, clinicId, createdAt, updatedAt, deletedAt, name, active, sortOrder, remark)
       VALUES (?, ?, ?, ?, NULL, ?, 1, 0, NULL)`,
    ).run(id, 'clinic-v2-001', nowIso, nowIso, name);
  }

  function insertRegistration(id: string, departmentId: string | null = null): void {
    db.prepare(
      `INSERT INTO Registration (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, departmentId, type, status, triageNote, chiefComplaint,
         registeredBy, registeredAt, triagedAt
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', NULL, ?, 'REGULAR', 'REGISTERED', NULL, '牙痛',
         'user-admin-001', ?, NULL)`,
    ).run(id, 'clinic-v2-001', nowIso, nowIso, departmentId, nowIso);
  }

  it('triages a registration and returns the updated row', async () => {
    insertDepartment('route-dept-1', '口腔内科');
    insertRegistration('route-reg-1', 'route-dept-1');

    const res = await request(app)
      .post('/api/v2/registrations/route-reg-1/triage')
      .send({ departmentId: 'route-dept-1', doctorId: 'user-admin-001', triageNote: '优先安排' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('TRIAGED');
    expect(res.body.data.triagedAt).toBe(nowIso);
    expect(res.body.data.departmentId).toBe('route-dept-1');
    expect(res.body.data.doctorId).toBe('user-admin-001');
    expect(res.body.data.triageNote).toBe('优先安排');
  });

  it('returns the triage queue with optional filters', async () => {
    insertDepartment('route-dept-2', '口腔外科');
    insertRegistration('route-reg-2', 'route-dept-2');
    insertRegistration('route-reg-3');

    const all = await request(app).get('/api/v2/triage/queue').expect(200);
    expect(all.body.success).toBe(true);
    expect(all.body.data.total).toBeGreaterThanOrEqual(2);
    const routeReg = all.body.data.items.find((row: { id: string }) => row.id === 'route-reg-2');
    expect(routeReg.patientName).toBe('Demo Patient');
    expect(routeReg.departmentName).toBe('口腔外科');

    const filtered = await request(app).get('/api/v2/triage/queue?departmentId=route-dept-2&status=REGISTERED').expect(200);
    expect(filtered.body.data.items.map((row: { id: string }) => row.id)).toEqual(['route-reg-2']);
  });

  it('rejects an invalid queue status with 400', async () => {
    const res = await request(app).get('/api/v2/triage/queue?status=IN_PROGRESS').expect(400);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('reschedules an appointment (time/doctor/chair)', async () => {
    const res = await request(app)
      .post('/api/v2/appointments/appointment-demo-001/reschedule')
      .send({ startTime: '2099-06-01T09:30:00.000Z', endTime: '2099-06-01T10:30:00.000Z', doctorId: 'user-admin-001', chairId: 'chair-route-1' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.startTime).toBe('2099-06-01T09:30:00.000Z');
    expect(res.body.data.endTime).toBe('2099-06-01T10:30:00.000Z');
    expect(res.body.data.doctorId).toBe('user-admin-001');
    expect(res.body.data.chairId).toBe('chair-route-1');
  });

  it('rejects reschedule with an invalid startTime with 400', async () => {
    const res = await request(app)
      .post('/api/v2/appointments/appointment-demo-001/reschedule')
      .send({ startTime: 'not-a-date' })
      .expect(400);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.message).toBe('startTime 必须是合法时间');
  });

  it('rejects triaging a missing registration with 404', async () => {
    const res = await request(app)
      .post('/api/v2/registrations/route-reg-missing/triage')
      .send({})
      .expect(404);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('NOT_FOUND');
  });
});
