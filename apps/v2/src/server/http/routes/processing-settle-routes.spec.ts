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
import { registerProcessingSettleRoutes } from './processing-settle-routes';
import { buildRouteDeps } from './route-deps.helper';

describe('processing settle routes', () => {
  let db: Database.Database;
  let dataDir: string;
  let app: express.Express;

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-processing-settle-routes-'));
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
    registerProcessingSettleRoutes(app, buildRouteDeps(db));
    app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      const appError = error instanceof AppError
        ? error
        : new AppError('INTERNAL_ERROR', error instanceof Error ? error.message : String(error), 500);
      res.status(appError.status).json({ success: false, code: appError.code, message: appError.message });
    });

    const now = '2026-08-05T10:00:00.000Z';
    const insert = (
      id: string,
      status: string,
      settleStatus: string,
      totalFee: number,
      settledAmount: number | null = null,
      clinicId = 'clinic-v2-001',
    ): void => {
      db.prepare(
        `INSERT INTO ProcessingOrder (
           id, clinicId, createdAt, updatedAt, deletedAt,
           patientId, number, totalFee, status, settleStatus, settledAmount, settledAt
         ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        clinicId,
        now,
        now,
        'patient-demo-001',
        `PO-${id}`,
        totalFee,
        status,
        settleStatus,
        settledAmount,
        settledAmount === null ? null : now,
      );
    };
    insert('route-po-settle', 'COMPLETED', 'UNSETTLED', 80000);
    insert('route-po-settle2', 'COMPLETED', 'UNSETTLED', 20000);
    insert('route-po-settled', 'RECEIVED', 'SETTLED', 80000, 80000);
    insert('route-po-draft', 'DRAFT', 'UNSETTLED', 30000);
    insert('route-po-other', 'COMPLETED', 'UNSETTLED', 50000, null, 'clinic-other');
    insert('route-po-unsettle', 'RECEIVED', 'SETTLED', 60000, 60000);
    insert('route-po-cancelled', 'CANCELLED', 'UNSETTLED', 40000);
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('POST /api/v2/processing-orders/:id/settle settles an order and persists it', async () => {
    const res = await request(app)
      .post('/api/v2/processing-orders/route-po-settle/settle')
      .send({ amount: 80000, ref: 'REF-1', note: '对账' })
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({
      id: 'route-po-settle',
      settleStatus: 'SETTLED',
      settledAmount: 80000,
      settledAt: '2026-08-05T10:00:00.000Z',
    });

    const row = db.prepare('SELECT * FROM ProcessingOrder WHERE id = ?').get('route-po-settle') as Record<string, unknown>;
    expect(row.settleStatus).toBe('SETTLED');
    expect(row.settledAmount).toBe(80000);
    expect(row.settledAt).toBe('2026-08-05T10:00:00.000Z');
    expect(row.settlementNote).toBe('对账');
    expect(row.settlementRef).toBe('REF-1');
    expect(row.updatedAt).toBe('2026-08-05T10:00:00.000Z');
  });

  it('returns 409 when the order was already settled', async () => {
    const res = await request(app)
      .post('/api/v2/processing-orders/route-po-settled/settle')
      .send({ amount: 80000 })
      .expect(409);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('CONFLICT');
    expect(res.body.message).toBe('加工单已结算');
  });

  it('returns 400 when the order is not completed or received', async () => {
    const res = await request(app)
      .post('/api/v2/processing-orders/route-po-draft/settle')
      .send({ amount: 30000 })
      .expect(400);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.message).toBe('仅已完成或已收货的加工单可结算');
  });

  it('returns 404 for an out-of-tenant or missing order', async () => {
    const other = await request(app)
      .post('/api/v2/processing-orders/route-po-other/settle')
      .send({ amount: 50000 })
      .expect(404);
    expect(other.body.code).toBe('NOT_FOUND');
    expect(other.body.message).toBe('Processing order not found');

    const missing = await request(app)
      .post('/api/v2/processing-orders/missing-po/settle')
      .send({ amount: 1 })
      .expect(404);
    expect(missing.body.success).toBe(false);
    expect(missing.body.code).toBe('NOT_FOUND');
  });

  it('returns 400 for an invalid settlement amount', async () => {
    const negative = await request(app)
      .post('/api/v2/processing-orders/route-po-settle2/settle')
      .send({ amount: -5 })
      .expect(400);
    expect(negative.body.code).toBe('VALIDATION_ERROR');

    const fractional = await request(app)
      .post('/api/v2/processing-orders/route-po-settle2/settle')
      .send({ amount: 10.5 })
      .expect(400);
    expect(fractional.body.code).toBe('VALIDATION_ERROR');

    const missing = await request(app)
      .post('/api/v2/processing-orders/route-po-settle2/settle')
      .send({})
      .expect(400);
    expect(missing.body.success).toBe(false);
    expect(missing.body.code).toBe('VALIDATION_ERROR');
  });

  it('POST /api/v2/processing-orders/:id/unsettle clears the settlement', async () => {
    const res = await request(app)
      .post('/api/v2/processing-orders/route-po-unsettle/unsettle')
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({ id: 'route-po-unsettle', settleStatus: 'UNSETTLED' });

    const row = db.prepare('SELECT * FROM ProcessingOrder WHERE id = ?').get('route-po-unsettle') as Record<string, unknown>;
    expect(row.settleStatus).toBe('UNSETTLED');
    expect(row.settledAmount).toBeNull();
    expect(row.settledAt).toBeNull();
  });

  it('returns 409 when un-settling an order that is not settled', async () => {
    const res = await request(app)
      .post('/api/v2/processing-orders/route-po-draft/unsettle')
      .expect(409);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('CONFLICT');
    expect(res.body.message).toBe('加工单未结算');
  });

  it('returns 404 when un-settling a missing order', async () => {
    const res = await request(app)
      .post('/api/v2/processing-orders/missing-po/unsettle')
      .expect(404);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('GET /api/v2/processing-orders/settle-stats returns counts and totals', async () => {
    db.prepare('DELETE FROM ProcessingOrder').run();
    const now = '2026-08-05T10:00:00.000Z';
    const insert = (
      id: string,
      status: string,
      settleStatus: string,
      totalFee: number,
      settledAmount: number | null,
      clinicId = 'clinic-v2-001',
      deletedAt: string | null = null,
    ): void => {
      db.prepare(
        `INSERT INTO ProcessingOrder (
           id, clinicId, createdAt, updatedAt, deletedAt,
           patientId, number, totalFee, status, settleStatus, settledAmount, settledAt
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        clinicId,
        now,
        now,
        deletedAt,
        'patient-demo-001',
        `PO-${id}`,
        totalFee,
        status,
        settleStatus,
        settledAmount,
        settledAmount === null ? null : now,
      );
    };
    insert('stats-u1', 'COMPLETED', 'UNSETTLED', 10000, null);
    insert('stats-u2', 'RECEIVED', 'UNSETTLED', 20000, null);
    insert('stats-c1', 'CANCELLED', 'UNSETTLED', 99999, null);
    insert('stats-s1', 'RECEIVED', 'SETTLED', 30000, 15000);
    insert('stats-s2', 'COMPLETED', 'SETTLED', 30000, 25000);
    insert('stats-other', 'COMPLETED', 'UNSETTLED', 77777, null, 'clinic-other');
    insert('stats-deleted', 'COMPLETED', 'UNSETTLED', 55555, null, 'clinic-v2-001', now);

    const res = await request(app).get('/api/v2/processing-orders/settle-stats').expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({
      unsettled: { count: 2, feeTotal: 30000 },
      settled: { count: 2, amountTotal: 40000 },
    });
  });
});
