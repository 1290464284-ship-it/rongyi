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
import { registerInventoryBatchRoutes } from './inventory-batch-routes';

describe('inventory batch routes', () => {
  let db: Database.Database;
  let dataDir: string;
  let app: express.Express;
  const now = '2026-08-05T10:00:00.000Z';

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-inventory-batch-routes-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);

    db.prepare(
      `INSERT INTO InventoryItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, category, unit, stock, minStock, price, batchManaged
       ) VALUES (?, 'clinic-v2-001', ?, ?, NULL, ?, ?, 'CONSUMABLE', 'box', 10, 0, 100, 1)`,
    ).run('route-item-1', now, now, 'ROUTE-001', '路由物料');

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
    registerInventoryBatchRoutes(app, db);
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

  it('POST /api/v2/inventory-batches creates a batch and persists it', async () => {
    const res = await request(app)
      .post('/api/v2/inventory-batches')
      .send({
        itemId: 'route-item-1',
        batchNo: 'ROUTE-B-1',
        productionDate: '2026-07-01',
        expiryDate: '2026-09-01',
        initialQuantity: 5,
      })
      .expect(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({ batchNo: 'ROUTE-B-1', remainingQuantity: 5, stockAfter: 15 });

    const batch = db.prepare('SELECT * FROM InventoryBatch WHERE id = ?').get(String(res.body.data.id)) as Record<string, unknown>;
    expect(batch.itemId).toBe('route-item-1');
    expect(batch.batchNo).toBe('ROUTE-B-1');
    expect(batch.remainingQuantity).toBe(5);
    expect(batch.clinicId).toBe('clinic-v2-001');
    const tx = db.prepare('SELECT * FROM InventoryTransaction WHERE batchId = ?').get(String(res.body.data.id)) as Record<string, unknown>;
    expect(tx).toBeDefined();
    expect(tx.type).toBe('IN');
    expect(tx.beforeStock).toBe(10);
    expect(tx.afterStock).toBe(15);
  });

  it('GET /api/v2/inventory-batches lists batches and expiring subsets', async () => {
    const res = await request(app).get('/api/v2/inventory-batches?days=30').expect(200);
    expect(res.body.success).toBe(true);
    const data = res.body.data as { batches: Array<Record<string, unknown>>; expiring: Array<Record<string, unknown>> };
    expect(data.batches.map((batch) => batch.batchNo)).toEqual(expect.arrayContaining(['ROUTE-B-1']));
    expect(data.batches[0]?.itemName).toBe('路由物料');
    expect(data.expiring.map((batch) => batch.batchNo)).toContain('ROUTE-B-1');
  });

  it('GET /api/v2/inventory-batches?itemId= filters by item', async () => {
    db.prepare(
      `INSERT INTO InventoryItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, category, unit, stock, minStock, price, batchManaged
       ) VALUES (?, 'clinic-v2-001', ?, ?, NULL, ?, ?, 'CONSUMABLE', 'box', 0, 0, 100, 1)`,
    ).run('route-item-2', now, now, 'ROUTE-002', '另一物料');
    const res = await request(app).get('/api/v2/inventory-batches?itemId=route-item-2').expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.batches).toEqual([]);
  });

  it('PATCH /api/v2/inventory-batches/:id adjusts the remaining quantity', async () => {
    const batch = db.prepare("SELECT id FROM InventoryBatch WHERE batchNo = 'ROUTE-B-1'").get() as { id: string };
    const res = await request(app)
      .patch(`/api/v2/inventory-batches/${batch.id}`)
      .send({ remainingQuantity: 2, note: '盘点修正' })
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({ id: batch.id, remainingQuantity: 2 });
    const row = db.prepare('SELECT remainingQuantity FROM InventoryBatch WHERE id = ?').get(batch.id) as { remainingQuantity: number };
    expect(row.remainingQuantity).toBe(2);
  });

  it('POST /api/v2/inventory-batches/consume allocates FIFO and reduces batches', async () => {
    db.prepare(
      `INSERT INTO InventoryItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, category, unit, stock, minStock, price, batchManaged
       ) VALUES (?, 'clinic-v2-001', ?, ?, NULL, ?, ?, 'CONSUMABLE', 'box', 0, 0, 100, 1)`,
    ).run('route-item-fifo', now, now, 'ROUTE-FIFO-ITEM', 'FIFO 物料');
    db.prepare(
      `INSERT INTO InventoryBatch (
         id, itemId, batchNo, productionDate, expiryDate, initialQuantity,
         remainingQuantity, supplierId, purchaseOrderId, active, clinicId,
         createdAt, updatedAt, deletedAt
       ) VALUES (?, 'route-item-fifo', 'ROUTE-FIFO-1', NULL, '2026-08-10', 4, 4, NULL, NULL, 1, 'clinic-v2-001', ?, ?, NULL)`,
    ).run('route-fifo-1', now, now);
    db.prepare(
      `INSERT INTO InventoryBatch (
         id, itemId, batchNo, productionDate, expiryDate, initialQuantity,
         remainingQuantity, supplierId, purchaseOrderId, active, clinicId,
         createdAt, updatedAt, deletedAt
       ) VALUES (?, 'route-item-fifo', 'ROUTE-FIFO-2', NULL, '2026-09-10', 10, 10, NULL, NULL, 1, 'clinic-v2-001', ?, ?, NULL)`,
    ).run('route-fifo-2', now, now);

    const res = await request(app)
      .post('/api/v2/inventory-batches/consume')
      .send({ itemId: 'route-item-fifo', quantity: 6 })
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({
      allocations: [
        { batchId: 'route-fifo-1', quantity: 4 },
        { batchId: 'route-fifo-2', quantity: 2 },
      ],
      itemId: 'route-item-fifo',
    });
    const first = db.prepare('SELECT remainingQuantity FROM InventoryBatch WHERE id = ?').get('route-fifo-1') as { remainingQuantity: number };
    const second = db.prepare('SELECT remainingQuantity FROM InventoryBatch WHERE id = ?').get('route-fifo-2') as { remainingQuantity: number };
    expect(first.remainingQuantity).toBe(0);
    expect(second.remainingQuantity).toBe(8);
  });

  it('POST /api/v2/inventory-batches/expiry-alerts generates a BusinessAlert', async () => {
    db.prepare(
      `INSERT INTO InventoryBatch (
         id, itemId, batchNo, productionDate, expiryDate, initialQuantity,
         remainingQuantity, supplierId, purchaseOrderId, active, clinicId,
         createdAt, updatedAt, deletedAt
       ) VALUES (?, 'route-item-1', 'ROUTE-ALERT', NULL, '2026-08-12', 3, 3, NULL, NULL, 1, 'clinic-v2-001', ?, ?, NULL)`,
    ).run('route-alert', now, now);

    const res = await request(app)
      .post('/api/v2/inventory-batches/expiry-alerts')
      .send({ days: 10 })
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({ generated: 1, total: 1 });

    const alert = db.prepare(
      "SELECT * FROM BusinessAlert WHERE alertType = 'BATCH_EXPIRY' AND metricName = 'route-alert'",
    ).get() as Record<string, unknown>;
    expect(alert).toBeDefined();
    expect(alert.status).toBe('OPEN');
    expect(alert.source).toBe('inventory-batch');
  });

  it('returns 404 when adjusting a missing batch', async () => {
    const res = await request(app)
      .patch('/api/v2/inventory-batches/route-missing')
      .send({ remainingQuantity: 1 })
      .expect(404);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('returns 400 for invalid create payloads', async () => {
    const res = await request(app)
      .post('/api/v2/inventory-batches')
      .send({ itemId: 'route-item-1', initialQuantity: -1 })
      .expect(400);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});
