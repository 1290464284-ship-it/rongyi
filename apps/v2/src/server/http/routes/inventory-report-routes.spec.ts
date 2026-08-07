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
import { registerInventoryReportRoutes } from './inventory-report-routes';
import { buildRouteDeps } from './route-deps.helper';

describe('inventory report routes', () => {
  let db: Database.Database;
  let dataDir: string;
  let app: express.Express;
  const now = '2026-08-05T10:00:00.000Z';
  const clinicId = 'clinic-v2-001';

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-inventory-report-routes-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
    db.prepare(
      `UPDATE Appointment SET startTime = ?, endTime = ?, updatedAt = ? WHERE id = 'appointment-demo-001'`,
    ).run('2099-01-01T00:00:00.000Z', '2099-01-01T01:00:00.000Z', now);

    db.prepare(
      `INSERT INTO InventoryTransaction (
         id, clinicId, createdAt, updatedAt, deletedAt, itemId, type, quantity,
         beforeStock, afterStock, referenceType, referenceId, operatorId, remark, batchId
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    ).run('route-tx-in', clinicId, '2026-08-03T08:00:00.000Z', '2026-08-03T08:00:00.000Z', 'inventory-demo-001', 'IN', 10, 100, 110, null, null, 'user-admin-001', 'route-tx-in');
    db.prepare(
      `INSERT INTO InventoryTransaction (
         id, clinicId, createdAt, updatedAt, deletedAt, itemId, type, quantity,
         beforeStock, afterStock, referenceType, referenceId, operatorId, remark, batchId
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    ).run('route-tx-out', clinicId, '2026-08-04T08:00:00.000Z', '2026-08-04T08:00:00.000Z', 'inventory-demo-001', 'OUT', 2, 110, 108, 'LOSS', 'doc-1', 'user-admin-001', 'route-tx-out');

    app = express();
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
    registerInventoryReportRoutes(app, buildRouteDeps(db));
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

  it('returns the IN report', async () => {
    const res = await request(app).get('/api/v2/inventory-reports/IN').expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.type).toBe('IN');
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.items[0].id).toBe('route-tx-in');
    expect(res.body.data.items[0].itemName).toBe('Dental Material');
  });

  it('returns the SUMMARY report with aggregated quantities', async () => {
    const res = await request(app).get('/api/v2/inventory-reports/SUMMARY').expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.type).toBe('SUMMARY');
    expect(res.body.data.total).toBe(1);
    const item = res.body.data.items[0];
    expect(item.itemId).toBe('inventory-demo-001');
    expect(item.inQuantity).toBe(10);
    expect(item.outQuantity).toBe(2);
    expect(item.currentStock).toBe(100);
  });

  it('supports from/to/itemId/supplierId query parameters', async () => {
    const res = await request(app)
      .get('/api/v2/inventory-reports/IN?from=2026-08-03&to=2026-08-03&itemId=inventory-demo-001&supplierId=route-sup-1')
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.from).toBe('2026-08-03');
    expect(res.body.data.to).toBe('2026-08-03');
    expect(res.body.data.supplierId).toBe('route-sup-1');
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.items[0].id).toBe('route-tx-in');
  });

  it('returns 400 for an unknown report type', async () => {
    const res = await request(app).get('/api/v2/inventory-reports/BOGUS').expect(400);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});
