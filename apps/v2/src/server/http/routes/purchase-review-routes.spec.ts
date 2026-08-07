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
import { registerPurchaseReviewRoutes } from './purchase-review-routes';
import { buildRouteDeps } from './route-deps.helper';

describe('purchase review routes', () => {
  let db: Database.Database;
  let dataDir: string;
  let app: express.Express;
  const now = '2026-08-05T10:00:00.000Z';
  const clinicId = 'clinic-v2-001';

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-purchase-review-routes-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);

    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.context = {
        userId: 'user-admin-001',
        clinicId,
        role: 'BOSS',
        traceId: 'test-trace',
        now: () => new Date(now),
      };
      next();
    });
    registerPurchaseReviewRoutes(app, buildRouteDeps(db));
    app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      const appError = error instanceof AppError
        ? error
        : new AppError('INTERNAL_ERROR', error instanceof Error ? error.message : String(error), 500);
      res.status(appError.status).json({ success: false, code: appError.code, message: appError.message });
    });

    db.prepare(
      `INSERT INTO Supplier (id, clinicId, createdAt, updatedAt, deletedAt, code, name)
       VALUES ('route-sup-1', ?, ?, ?, NULL, 'R-SUP-1', '路由供应商')`,
    ).run(clinicId, now, now);

    const insertOrder = (id: string, overrides: Record<string, unknown> = {}): void => {
      db.prepare(
        `INSERT INTO PurchaseOrder (
           id, clinicId, createdAt, updatedAt, deletedAt,
           number, supplierId, totalAmount, status, receivedAt,
           reviewStatus, approvedById, approvedAt, rejectionReason, receivedById
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        overrides.clinicId ?? clinicId,
        overrides.createdAt ?? now,
        overrides.updatedAt ?? now,
        null,
        overrides.number ?? `ROUTE-${id}`,
        overrides.supplierId ?? 'route-sup-1',
        overrides.totalAmount ?? 1000,
        overrides.status ?? 'PENDING',
        null,
        overrides.reviewStatus ?? 'PENDING',
        null,
        null,
        overrides.rejectionReason ?? null,
        null,
      );
    };
    insertOrder('route-po-pending', { number: 'ROUTE-PO-1' });
    insertOrder('route-po-submitted', { reviewStatus: 'SUBMITTED', number: 'ROUTE-PO-2' });
    insertOrder('route-po-rejected', { reviewStatus: 'REJECTED', rejectionReason: '价格过高', number: 'ROUTE-PO-3' });
    insertOrder('route-po-approved', { reviewStatus: 'APPROVED', number: 'ROUTE-PO-4' });
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('GET /api/v2/purchase-orders/review lists orders with review fields', async () => {
    const res = await request(app).get('/api/v2/purchase-orders/review').expect(200);
    expect(res.body.success).toBe(true);
    const data = res.body.data as Array<Record<string, unknown>>;
    expect(data.map((entry) => entry.id)).toEqual(expect.arrayContaining([
      'route-po-pending',
      'route-po-submitted',
      'route-po-rejected',
      'route-po-approved',
    ]));
    const submitted = data.find((entry) => entry.id === 'route-po-submitted') as Record<string, unknown>;
    expect(submitted.reviewStatus).toBe('SUBMITTED');
    expect(submitted.supplierName).toBe('路由供应商');
    expect(submitted.itemsCount).toBe(0);
    expect(submitted).toHaveProperty('rejectionReason');
  });

  it('GET /api/v2/purchase-orders/review filters by reviewStatus', async () => {
    const res = await request(app).get('/api/v2/purchase-orders/review?reviewStatus=REJECTED').expect(200);
    expect(res.body.success).toBe(true);
    const data = res.body.data as Array<Record<string, unknown>>;
    expect(data.map((entry) => entry.id)).toEqual(['route-po-rejected']);
    expect(data[0].rejectionReason).toBe('价格过高');
  });

  it('GET /api/v2/purchase-orders/review rejects an invalid filter', async () => {
    const res = await request(app).get('/api/v2/purchase-orders/review?reviewStatus=INVALID').expect(400);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('GET /api/v2/purchase-orders/review-stats returns status counts', async () => {
    const res = await request(app).get('/api/v2/purchase-orders/review-stats').expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      total: 4,
      pending: 1,
      submitted: 1,
      approved: 1,
      rejected: 1,
    });
    expect(typeof res.body.data.pendingAmount).toBe('number');
  });

  it('POST submit → approve 全链路后 DB reviewStatus=APPROVED', async () => {
    const id = 'route-po-flow';
    db.prepare(
      `INSERT INTO PurchaseOrder (
         id, clinicId, createdAt, updatedAt, deletedAt, number, supplierId, totalAmount,
         status, receivedAt, reviewStatus, approvedById, approvedAt, rejectionReason, receivedById
       ) VALUES (?, ?, ?, ?, NULL, 'ROUTE-FLOW', 'route-sup-1', 2000, 'PENDING', NULL, 'PENDING', NULL, NULL, NULL, NULL)`,
    ).run(id, clinicId, now, now);

    const submitRes = await request(app).post(`/api/v2/purchase-orders/${id}/submit`).expect(200);
    expect(submitRes.body).toEqual({ success: true, data: { id, reviewStatus: 'SUBMITTED' } });

    const approveRes = await request(app).post(`/api/v2/purchase-orders/${id}/approve`).expect(200);
    expect(approveRes.body.success).toBe(true);
    expect(approveRes.body.data).toMatchObject({ id, reviewStatus: 'APPROVED', approvedById: 'user-admin-001' });

    const row = db.prepare('SELECT * FROM PurchaseOrder WHERE id = ?').get(id) as Record<string, unknown>;
    expect(row.reviewStatus).toBe('APPROVED');
    expect(row.approvedById).toBe('user-admin-001');
    expect(row.approvedAt).toBe(now);
  });

  it('POST reject 带 reason 落库', async () => {
    const id = 'route-po-reject-flow';
    db.prepare(
      `INSERT INTO PurchaseOrder (
         id, clinicId, createdAt, updatedAt, deletedAt, number, supplierId, totalAmount,
         status, receivedAt, reviewStatus, approvedById, approvedAt, rejectionReason, receivedById
       ) VALUES (?, ?, ?, ?, NULL, 'ROUTE-REJ', 'route-sup-1', 2000, 'PENDING', NULL, 'SUBMITTED', NULL, NULL, NULL, NULL)`,
    ).run(id, clinicId, now, now);

    const res = await request(app)
      .post(`/api/v2/purchase-orders/${id}/reject`)
      .send({ reason: '库存成本核算有误' })
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({ id, reviewStatus: 'REJECTED', rejectionReason: '库存成本核算有误' });

    const row = db.prepare('SELECT * FROM PurchaseOrder WHERE id = ?').get(id) as Record<string, unknown>;
    expect(row.reviewStatus).toBe('REJECTED');
    expect(row.rejectionReason).toBe('库存成本核算有误');
  });

  it('POST reopen：REJECTED → SUBMITTED 且清空 rejectionReason', async () => {
    const res = await request(app).post('/api/v2/purchase-orders/route-po-rejected/reopen').expect(200);
    expect(res.body).toEqual({ success: true, data: { id: 'route-po-rejected', reviewStatus: 'SUBMITTED' } });
    const row = db.prepare('SELECT * FROM PurchaseOrder WHERE id = ?').get('route-po-rejected') as Record<string, unknown>;
    expect(row.reviewStatus).toBe('SUBMITTED');
    expect(row.rejectionReason).toBeNull();
  });

  it('POST approve 不存在 id → 404', async () => {
    const res = await request(app).post('/api/v2/purchase-orders/route-missing/approve').expect(404);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('POST approve 非法状态流转（PENDING 直接通过）→ 409', async () => {
    const res = await request(app).post('/api/v2/purchase-orders/route-po-pending/approve').expect(409);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('CONFLICT');
  });

  it('POST reject 空 reason → 400', async () => {
    const res = await request(app)
      .post('/api/v2/purchase-orders/route-po-submitted/reject')
      .send({ reason: '   ' })
      .expect(400);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});
