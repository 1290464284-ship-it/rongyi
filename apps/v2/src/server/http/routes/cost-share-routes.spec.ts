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
import type { AppContext } from '../../../domain/contracts';
import { ChargeService } from '../../application/service-modules/financial';
import { registerCostShareRoutes } from './cost-share-routes';
import { buildRouteDeps } from './route-deps.helper';

describe('cost-share routes', () => {
  let db: Database.Database;
  let dataDir: string;
  let app: express.Express;

  beforeAll(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-cost-share-routes-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);

    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.context = {
        userId: 'user-admin-001',
        clinicId: 'clinic-v2-001',
        role: 'BOSS',
        traceId: 'test-trace',
        now: () => new Date('2026-08-05T10:00:00.000Z'),
      };
      next();
    });
    registerCostShareRoutes(app, buildRouteDeps(db));
    app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      const appError = error instanceof AppError
        ? error
        : new AppError('INTERNAL_ERROR', error instanceof Error ? error.message : String(error), 500);
      res.status(appError.status).json({ success: false, code: appError.code, message: appError.message });
    });

    const chargeService = new ChargeService(db);
    const now = '2026-08-05T10:00:00.000Z';
    const inWindow: AppContext = {
      userId: 'user-admin-001',
      clinicId: 'clinic-v2-001',
      role: 'BOSS',
      traceId: 'test-trace',
      now: () => new Date(now),
    };
    const outOfWindow: AppContext = {
      userId: 'user-admin-001',
      clinicId: 'clinic-v2-001',
      role: 'BOSS',
      traceId: 'test-trace',
      now: () => new Date('2026-07-01T08:00:00.000Z'),
    };
    await chargeService.create({
      patientId: 'patient-demo-001',
      items: [
        { name: 'Cleaning', category: 'GENERAL', price: 10000, quantity: 1, costType: 'SERVICE' },
        { name: 'Crown', category: 'MATERIAL', price: 50000, quantity: 1, costType: 'MATERIAL' },
      ],
    }, inWindow);
    await chargeService.create({
      patientId: 'patient-demo-001',
      items: [
        { name: 'Old Service', category: 'GENERAL', price: 11111, quantity: 1, costType: 'SERVICE' },
      ],
    }, outOfWindow);
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('GET /api/v2/stats/cost-share returns rows and summary', async () => {
    const res = await request(app).get('/api/v2/stats/cost-share').expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.rows).toEqual([
      { costType: 'MATERIAL', category: 'MATERIAL', total: 50000, itemCount: 1, chargeCount: 1 },
      { costType: 'SERVICE', category: 'GENERAL', total: 21111, itemCount: 2, chargeCount: 2 },
    ]);
    expect(res.body.data.summary).toEqual({
      SERVICE: { total: 21111, itemCount: 2, chargeCount: 2 },
      MATERIAL: { total: 50000, itemCount: 1, chargeCount: 1 },
      grandTotal: 71111,
    });
  });

  it('GET /api/v2/stats/cost-share honors from/to query params', async () => {
    const res = await request(app)
      .get('/api/v2/stats/cost-share')
      .query({ from: '2026-08-01', to: '2026-08-31' })
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.rows).toEqual([
      { costType: 'MATERIAL', category: 'MATERIAL', total: 50000, itemCount: 1, chargeCount: 1 },
      { costType: 'SERVICE', category: 'GENERAL', total: 10000, itemCount: 1, chargeCount: 1 },
    ]);
    expect(res.body.data.summary).toEqual({
      SERVICE: { total: 10000, itemCount: 1, chargeCount: 1 },
      MATERIAL: { total: 50000, itemCount: 1, chargeCount: 1 },
      grandTotal: 60000,
    });
  });

  it('GET /api/v2/stats/cost-share returns 400 for an invalid from', async () => {
    const res = await request(app)
      .get('/api/v2/stats/cost-share')
      .query({ from: 'not-a-date' })
      .expect(400);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.message).toBe('from 必须是合法的日期字符串（YYYY-MM-DD 或 ISO 格式）');
  });

  it('GET /api/v2/stats/cost-share returns 400 for an invalid to', async () => {
    const res = await request(app)
      .get('/api/v2/stats/cost-share')
      .query({ to: '2026/08/31' })
      .expect(400);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});
