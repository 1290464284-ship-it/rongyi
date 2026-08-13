import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { AppError } from '../../infrastructure/errors';
import { registerTreatmentPlanBillingRoutes } from './treatment-plan-billing-routes';
import { buildRouteDeps } from './route-deps.helper';

describe('treatment plan billing routes', () => {
  let dataDir: string;
  let db: Database.Database;
  let app: express.Express;
  const nowIso = '2026-08-05T10:00:00.000Z';

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-treatment-plan-billing-routes-'));
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
    registerTreatmentPlanBillingRoutes(app, buildRouteDeps(db));
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

  function insertPlan(id: string, name: string): void {
    db.prepare(
      `INSERT INTO TreatmentPlan (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, name, status, totalFee
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', 'user-admin-001', ?, 'ACTIVE', 0)`,
    ).run(id, 'clinic-v2-001', nowIso, nowIso, name);
  }

  function insertItem(planId: string, itemId: string, price = 10000, quantity = 1): void {
    db.prepare(
      `INSERT INTO TreatmentPlanItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         planId, code, name, category, price, quantity, teethNumbers, status
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 'GENERAL', ?, ?, '[]', 'ACTIVE')`,
    ).run(itemId, 'clinic-v2-001', nowIso, nowIso, planId, `IT-${itemId}`, `Item ${itemId}`, price, quantity);
  }

  it('sets a whole-plan discount and returns the recomputed total', async () => {
    insertPlan('route-plan-1', '路由整单折');
    insertItem('route-plan-1', 'route-plan-1-i1', 10000, 1);
    insertItem('route-plan-1', 'route-plan-1-i2', 5000, 2);

    const res = await request(app)
      .post('/api/v2/treatment-plans/route-plan-1/discount')
      .send({ discountType: 'WHOLE', discountRate: 10 })
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({ id: 'route-plan-1', discountType: 'WHOLE', discountRate: 10, totalFee: 18000 });
  });

  it('sets a per-item discount', async () => {
    insertPlan('route-plan-2', '路由单条折');
    insertItem('route-plan-2', 'route-plan-2-i1', 10000, 1);

    const res = await request(app)
      .post('/api/v2/treatment-plans/route-plan-2/items/route-plan-2-i1/discount')
      .send({ discountRate: 25 })
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({ itemId: 'route-plan-2-i1', discountRate: 25, planTotalFee: 7500 });
  });

  it('bills a plan and returns the charge id', async () => {
    insertPlan('route-plan-3', '路由划价');
    insertItem('route-plan-3', 'route-plan-3-i1', 10000, 1);
    insertItem('route-plan-3', 'route-plan-3-i2', 5000, 2);

    const res = await request(app)
      .post('/api/v2/treatment-plans/route-plan-3/bill')
      .send({ itemIds: ['route-plan-3-i1'] })
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.chargeId).toBeDefined();
    expect(res.body.data.number).toMatch(/^CHG-/);
    expect(res.body.data.totalAmount).toBe(10000);
    expect(res.body.data.itemCount).toBe(1);
    expect(res.body.data.billedItemIds).toEqual(['route-plan-3-i1']);

    const charge = db.prepare('SELECT status, patientId FROM Charge WHERE id = ?').get(res.body.data.chargeId) as { status: string; patientId: string };
    expect(charge.status).toBe('UNPAID');
    expect(charge.patientId).toBe('patient-demo-001');
  });

  it('rejects repeated billing of the same plan with 409', async () => {
    insertPlan('route-plan-4', '路由重复划价');
    insertItem('route-plan-4', 'route-plan-4-i1', 10000, 1);

    await request(app)
      .post('/api/v2/treatment-plans/route-plan-4/bill')
      .send({})
      .expect(200);
    const res = await request(app)
      .post('/api/v2/treatment-plans/route-plan-4/bill')
      .send({})
      .expect(409);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('CONFLICT');
    expect(res.body.message).toBe('已划价明细不可重复划价');
  });

  it('updates plan follow-up tracking', async () => {
    insertPlan('route-plan-5', '路由回访');

    const res = await request(app)
      .post('/api/v2/treatment-plans/route-plan-5/follow-up')
      .send({ followUpStatus: 'PENDING', nextFollowUpAt: '2026-08-20', trackingNote: '复诊提醒' })
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.followUpStatus).toBe('PENDING');
    expect(res.body.data.nextFollowUpAt).toBe('2026-08-20');
    expect(res.body.data.trackingNote).toBe('复诊提醒');

    const row = db.prepare('SELECT followUpStatus FROM TreatmentPlan WHERE id = ?').get('route-plan-5') as { followUpStatus: string };
    expect(row.followUpStatus).toBe('PENDING');
  });

  it('rejects invalid input with 400 and unknown plans with 404', async () => {
    insertPlan('route-plan-6', '路由校验');
    insertItem('route-plan-6', 'route-plan-6-i1', 10000, 1);

    const badType = await request(app)
      .post('/api/v2/treatment-plans/route-plan-6/discount')
      .send({ discountType: 'XXX', discountRate: 10 })
      .expect(400);
    expect(badType.body.code).toBe('VALIDATION_ERROR');

    const badRate = await request(app)
      .post('/api/v2/treatment-plans/route-plan-6/items/route-plan-6-i1/discount')
      .send({ discountRate: 150 })
      .expect(400);
    expect(badRate.body.message).toBe('折扣率须在 0-100 之间');

    const missing = await request(app)
      .post('/api/v2/treatment-plans/route-plan-missing/bill')
      .send({})
      .expect(404);
    expect(missing.body.code).toBe('NOT_FOUND');
  });

  it('tolerates missing request bodies', async () => {
    for (const path of [
      '/api/v2/treatment-plans/missing/discount',
      '/api/v2/treatment-plans/missing/items/missing/discount',
      '/api/v2/treatment-plans/missing/bill',
      '/api/v2/treatment-plans/missing/follow-up',
    ]) {
      const res = await request(app).post(path);
      expect([200, 400, 404, 409]).toContain(res.status);
    }
  });
});
