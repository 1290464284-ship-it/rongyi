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
import { registerCommissionRoutes } from './commission-routes';
import { buildRouteDeps } from './route-deps.helper';

describe('commission routes', () => {
  let dataDir: string;
  let db: Database.Database;
  let app: Express;
  const nowIso = '2026-08-05T10:00:00.000Z';

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-commission-routes-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
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
    registerCommissionRoutes(app, buildRouteDeps(db));
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

  function insertPaidCharge(): void {
    db.prepare(
      `INSERT INTO Charge (
         id, patientId, visitId, doctorId, number, totalAmount, paidAmount, refundedAmount,
         discount, status, payMethod, paidAt, remark, clinicId, createdAt, updatedAt, deletedAt
       ) VALUES ('charge-route-commission', 'patient-demo-001', NULL, 'user-admin-001', 'CHG-COMM-ROUTE',
         10000, 10000, 0, 0, 'PAID', 'CASH', ?, NULL, 'clinic-v2-001', ?, ?, NULL)`,
    ).run('2026-08-01T09:00:00.000Z', nowIso, nowIso);
    db.prepare(
      `INSERT INTO ChargeItem (
         id, chargeId, treatmentId, inventoryItemId, consumedQuantity, name, category, price,
         quantity, teethNumbers, subtotal, clinicId, createdAt, updatedAt, deletedAt, costType
       ) VALUES ('item-route-commission', 'charge-route-commission', NULL, NULL, 0, 'Route 项目',
         'TREATMENT', 10000, 1, '[]', 10000, 'clinic-v2-001', ?, ?, NULL, 'SERVICE')`,
    ).run(nowIso, nowIso);
  }

  it('creates, lists, updates and deletes commission rules', async () => {
    const created = await request(app)
      .post('/api/v2/commission/rules')
      .send({ name: '路由规则', rateType: 'PERCENT', rate: 500 })
      .expect(201);
    expect(created.body.success).toBe(true);
    const ruleId = created.body.data.id as string;
    expect(ruleId).toBeTruthy();

    const listed = await request(app).get('/api/v2/commission/rules').expect(200);
    expect(listed.body.data.some((row: { id: string }) => row.id === ruleId)).toBe(true);

    const updated = await request(app)
      .patch(`/api/v2/commission/rules/${ruleId}`)
      .send({ rate: 800, enabled: false })
      .expect(200);
    expect(updated.body.data).toMatchObject({ rate: 800, enabled: 0 });

    await request(app).delete(`/api/v2/commission/rules/${ruleId}`).expect(200);
    const afterDelete = await request(app).get('/api/v2/commission/rules').expect(200);
    expect(afterDelete.body.data.some((row: { id: string }) => row.id === ruleId)).toBe(false);
  });

  it('normalizes doctorId on rule creation', async () => {
    const asNull = await request(app)
      .post('/api/v2/commission/rules')
      .send({ name: '无医生', rateType: 'PERCENT', rate: 100, doctorId: null })
      .expect(201);
    expect(asNull.body.data.doctorId).toBeNull();

    const asEmpty = await request(app)
      .post('/api/v2/commission/rules')
      .send({ name: '空医生', rateType: 'PERCENT', rate: 100, doctorId: '' })
      .expect(201);
    expect(asEmpty.body.data.doctorId).toBeNull();

    const asString = await request(app)
      .post('/api/v2/commission/rules')
      .send({ name: '字符串医生', rateType: 'PERCENT', rate: 100, doctorId: 'user-admin-001' })
      .expect(201);
    expect(asString.body.data.doctorId).toBe('user-admin-001');
  });

  it('calculates statements and lists them by period', async () => {
    await request(app)
      .post('/api/v2/commission/rules')
      .send({ name: '服务 5%', category: 'TREATMENT', costType: 'SERVICE', rateType: 'PERCENT', rate: 500 })
      .expect(201);
    insertPaidCharge();

    const calculated = await request(app)
      .post('/api/v2/commission/calculate')
      .send({ period: '2026-08' })
      .expect(200);
    expect(calculated.body.success).toBe(true);
    expect(calculated.body.data.length).toBeGreaterThanOrEqual(1);

    const statements = await request(app)
      .get('/api/v2/commission/statements?period=2026-08')
      .expect(200);
    expect(statements.body.data.some((row: { doctorId: string }) => row.doctorId === 'user-admin-001')).toBe(true);
  });

  it('rejects an invalid period with 400', async () => {
    const res = await request(app)
      .post('/api/v2/commission/calculate')
      .send({ period: '2026-13' })
      .expect(400);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('rejects rule management from a DOCTOR context with 403', async () => {
    const doctorApp = express();
    doctorApp.use(express.json());
    doctorApp.use((req, _res, next) => {
      (req as unknown as { context: unknown }).context = {
        userId: 'user-doctor-001',
        clinicId: 'clinic-v2-001',
        role: 'DOCTOR',
        traceId: 'test-trace',
        now: () => new Date('2026-08-05T10:00:00.000Z'),
      };
      next();
    });
    registerCommissionRoutes(doctorApp, buildRouteDeps(db));
    doctorApp.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      const appError = error instanceof AppError
        ? error
        : new AppError('INTERNAL_ERROR', error instanceof Error ? error.message : String(error), 500);
      res.status(appError.status).json({ success: false, code: appError.code, message: appError.message });
    });

    const res = await request(doctorApp)
      .post('/api/v2/commission/rules')
      .send({ name: 'x', rateType: 'PERCENT', rate: 100 })
      .expect(403);
    expect(res.body.code).toBe('FORBIDDEN');

    const statements = await request(doctorApp).get('/api/v2/commission/statements?period=2026-08').expect(200);
    expect(statements.body.success).toBe(true);
    expect(statements.body.data.every((row: { doctorId: string }) => row.doctorId === 'user-doctor-001')).toBe(true);
  });

  it('patches every optional rule field and filters statements by doctor', async () => {
    const created = await request(app)
      .post('/api/v2/commission/rules')
      .send({ name: '初始规则', rateType: 'PERCENT', rate: 100 })
      .expect(201);
    const ruleId = created.body.data.id as string;

    const updated = await request(app)
      .patch(`/api/v2/commission/rules/${ruleId}`)
      .send({
        name: '更新规则',
        category: 'TREATMENT',
        costType: 'SERVICE',
        rateType: 'FIXED',
        rate: 200,
        doctorId: 'user-admin-001',
        enabled: true,
      })
      .expect(200);
    expect(updated.body.data).toMatchObject({
      name: '更新规则',
      category: 'TREATMENT',
      costType: 'SERVICE',
      rateType: 'FIXED',
      rate: 200,
      doctorId: 'user-admin-001',
      enabled: 1,
    });

    const cleared = await request(app)
      .patch(`/api/v2/commission/rules/${ruleId}`)
      .send({ category: null, costType: '', doctorId: '' })
      .expect(200);
    expect(cleared.body.data).toMatchObject({
      category: null,
      costType: null,
      doctorId: null,
    });

    const filtered = await request(app)
      .get('/api/v2/commission/statements?period=2026-08&doctorId=user-admin-001')
      .expect(200);
    expect(filtered.body.data.every((row: { doctorId: string }) => row.doctorId === 'user-admin-001')).toBe(true);
  });

  it('parses string booleans strictly for enabled', async () => {
    const created = await request(app)
      .post('/api/v2/commission/rules')
      .send({ name: '关闭规则', rateType: 'PERCENT', rate: 100, enabled: 'false' })
      .expect(201);
    expect(created.body.data.enabled).toBe(0);
    const ruleId = created.body.data.id as string;
    await request(app)
      .patch(`/api/v2/commission/rules/${ruleId}`)
      .send({ enabled: '0' })
      .expect(200);
    expect((db.prepare('SELECT enabled FROM CommissionRule WHERE id = ?').get(ruleId) as { enabled: number }).enabled).toBe(0);
    await request(app)
      .post('/api/v2/commission/rules')
      .send({ name: '非法布尔', rateType: 'PERCENT', rate: 100, enabled: 'yes' })
      .expect(400);
  });

  it('tolerates missing request bodies and period filters', async () => {
    const create = await request(app).post('/api/v2/commission/rules');
    expect([200, 400]).toContain(create.status);
    const update = await request(app).patch('/api/v2/commission/rules/missing');
    expect([200, 400, 404]).toContain(update.status);
    const calculate = await request(app).post('/api/v2/commission/calculate');
    expect([200, 400]).toContain(calculate.status);
    const statements = await request(app).get('/api/v2/commission/statements');
    expect([200, 400]).toContain(statements.status);
  });
});
