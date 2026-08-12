import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { AppError } from '../../infrastructure/errors';
import { registerPrescriptionProcessRoutes } from './prescription-process-routes';
import { buildRouteDeps } from './route-deps.helper';

describe('prescription process routes', () => {
  let db: Database.Database;
  let dataDir: string;
  let app: express.Express;
  const now = '2026-08-05T10:00:00.000Z';

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-prescription-process-routes-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
    db.prepare(
      `UPDATE Appointment SET startTime = ?, endTime = ?, updatedAt = ? WHERE id = 'appointment-demo-001'`,
    ).run('2099-01-01T00:00:00.000Z', '2099-01-01T01:00:00.000Z', now);

    db.prepare(
      `INSERT INTO Prescription (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, visitId, doctorId, remark, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', NULL, 'user-admin-001', '开药', 'DRAFT')`,
    ).run('route-rx-1', 'clinic-v2-001', now, now);
    db.prepare(
      `INSERT INTO PrescriptionItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         prescriptionId, drugId, name, specification, dosage, frequency, days, quantity, price
       ) VALUES (?, ?, ?, ?, NULL, ?, NULL, ?, NULL, NULL, NULL, 1, ?, ?)`,
    ).run('route-rx-1-item-1', 'clinic-v2-001', now, now, 'route-rx-1', 'Route Drug A', 2, 1500);
    db.prepare(
      `INSERT INTO PrescriptionItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         prescriptionId, drugId, name, specification, dosage, frequency, days, quantity, price
       ) VALUES (?, ?, ?, ?, NULL, ?, NULL, ?, NULL, NULL, NULL, 1, ?, ?)`,
    ).run('route-rx-1-item-2', 'clinic-v2-001', now, now, 'route-rx-1', 'Route Drug B', 1, 800);
    db.prepare(
      `INSERT INTO InventoryItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, spec, category, unit, stock, minStock, price
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, NULL, 'DRUG', 'box', 50, 0, 5000)`,
    ).run('route-inv-1', 'clinic-v2-001', now, now, 'CODE-ROUTE-1', 'Route Drug A');
    db.prepare(
      `INSERT INTO InventoryItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, spec, category, unit, stock, minStock, price
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, NULL, 'DRUG', 'box', 50, 0, 5000)`,
    ).run('route-inv-2', 'clinic-v2-001', now, now, 'CODE-ROUTE-2', 'Route Drug B');

    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.context = {
        userId: 'user-admin-001',
        clinicId: 'clinic-v2-001',
        role: 'BOSS',
        traceId: 'test-trace',
        now: () => new Date(now),
      };
      next();
    });
    registerPrescriptionProcessRoutes(app, buildRouteDeps(db));
    app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      const appError = error instanceof AppError
        ? error
        : new AppError('INTERNAL_ERROR', error instanceof Error ? error.message : String(error), 500);
      res.status(appError.status).json({ success: false, code: appError.code, message: appError.message });
    });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  async function processPrescription(): Promise<request.Response> {
    return request(app)
      .post('/api/v2/prescriptions/route-rx-1/process')
      .send({ itemIds: ['route-rx-1-item-1', 'route-rx-1-item-2'] })
      .expect(200);
  }

  it('POST /api/v2/prescriptions/:id/process creates a charge and a dispense order', async () => {
    const res = await processPrescription();

    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      prescriptionId: 'route-rx-1',
      status: 'PROCESSED',
      chargeTotalAmount: 1500 * 2 + 800,
      itemCount: 2,
    });
    expect(String(res.body.data.chargeNumber)).toMatch(/^CHG-/);
    expect(String(res.body.data.dispenseNumber)).toMatch(/^DSP-/);

    const charge = db.prepare('SELECT number, totalAmount, status, remark FROM Charge WHERE id = ?')
      .get(String(res.body.data.chargeId)) as { number: string; totalAmount: number; status: string; remark: string };
    expect(charge.number).toBe(res.body.data.chargeNumber);
    expect(charge.totalAmount).toBe(1500 * 2 + 800);
    expect(charge.status).toBe('UNPAID');
    expect(charge.remark).toBe('处方划价');

    const dispense = db.prepare('SELECT number, status FROM Dispense WHERE id = ?')
      .get(String(res.body.data.dispenseId)) as { number: string; status: string };
    expect(dispense.number).toBe(res.body.data.dispenseNumber);
    expect(dispense.status).toBe('PENDING');

    const prescription = db.prepare('SELECT status, chargeId, dispenseId FROM Prescription WHERE id = ?')
      .get('route-rx-1') as { status: string; chargeId: string; dispenseId: string };
    expect(prescription.status).toBe('PROCESSED');
    expect(prescription.chargeId).toBe(res.body.data.chargeId);
    expect(prescription.dispenseId).toBe(res.body.data.dispenseId);
  });

  it('POST process returns 409 for an already processed prescription', async () => {
    await processPrescription();
    const res = await request(app)
      .post('/api/v2/prescriptions/route-rx-1/process')
      .send({})
      .expect(409);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('CONFLICT');
    expect(res.body.message).toBe('处方已处理');
  });

  it('GET /api/v2/prescriptions/:id/status returns the processing state', async () => {
    await processPrescription();
    const res = await request(app).get('/api/v2/prescriptions/route-rx-1/status').expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      id: 'route-rx-1',
      status: 'PROCESSED',
    });
    expect(res.body.data.processedAt).toBe(now);
    expect(res.body.data.chargeId).toBeDefined();
    expect(res.body.data.dispenseId).toBeDefined();
  });

  it('returns 404 for unknown prescriptions', async () => {
    const statusRes = await request(app).get('/api/v2/prescriptions/route-missing/status').expect(404);
    expect(statusRes.body.success).toBe(false);
    expect(statusRes.body.code).toBe('NOT_FOUND');

    const processRes = await request(app).post('/api/v2/prescriptions/route-missing/process').send({}).expect(404);
    expect(processRes.body.success).toBe(false);
    expect(processRes.body.code).toBe('NOT_FOUND');
  });
});
