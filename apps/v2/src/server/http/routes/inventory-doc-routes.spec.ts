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
import { registerInventoryDocRoutes } from './inventory-doc-routes';

describe('inventory doc routes', () => {
  let db: Database.Database;
  let dataDir: string;
  let app: express.Express;
  const now = '2026-08-05T10:00:00.000Z';
  const clinicId = 'clinic-v2-001';

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-inventory-doc-routes-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
    db.prepare(
      `UPDATE Appointment SET startTime = ?, endTime = ?, updatedAt = ? WHERE id = 'appointment-demo-001'`,
    ).run('2099-01-01T00:00:00.000Z', '2099-01-01T01:00:00.000Z', now);

    db.prepare(
      `INSERT INTO Supplier (id, clinicId, createdAt, updatedAt, deletedAt, code, name)
       VALUES ('route-sup-1', ?, ?, ?, NULL, 'R-SUP-1', '路由供应商')`,
    ).run(clinicId, now, now);
    db.prepare(
      `INSERT INTO InventoryItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, category, unit, stock, minStock, price
       ) VALUES (?, ?, ?, ?, NULL, 'MAT-ROUTE-2', 'Route Material 2', 'CONSUMABLE', 'piece', 10, 0, 2000)`,
    ).run('route-item-2', clinicId, now, now);

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
    registerInventoryDocRoutes(app, db);
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

  function stockOf(itemId: string): number {
    const row = db.prepare('SELECT stock FROM InventoryItem WHERE id = ?').get(itemId) as { stock: number };
    return Number(row.stock);
  }

  it('creates a return-supplier doc', async () => {
    const res = await request(app)
      .post('/api/v2/inventory-docs/return-supplier')
      .send({ supplierId: 'route-sup-1', items: [{ itemId: 'inventory-demo-001', quantity: 5, unitPrice: 500 }], remark: '路由退回' })
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.doc.type).toBe('RETURN_SUPPLIER');
    expect(res.body.data.doc.status).toBe('COMPLETED');
    expect(String(res.body.data.doc.number)).toMatch(/^RTS-/);
    expect(res.body.data.doc.supplierId).toBe('route-sup-1');
    expect(res.body.data.items).toHaveLength(1);
    expect(stockOf('inventory-demo-001')).toBe(95);
  });

  it('returns 404 for an unknown supplier', async () => {
    const res = await request(app)
      .post('/api/v2/inventory-docs/return-supplier')
      .send({ supplierId: 'route-sup-missing', items: [{ itemId: 'inventory-demo-001', quantity: 1 }] })
      .expect(404);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('returns 409 when stock is insufficient', async () => {
    const res = await request(app)
      .post('/api/v2/inventory-docs/return-supplier')
      .send({ supplierId: 'route-sup-1', items: [{ itemId: 'inventory-demo-001', quantity: 500 }] })
      .expect(409);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('CONFLICT');
  });

  it('returns 400 for an invalid body', async () => {
    const res = await request(app)
      .post('/api/v2/inventory-docs/loss')
      .send({ items: [] })
      .expect(400);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('creates a loss doc', async () => {
    const res = await request(app)
      .post('/api/v2/inventory-docs/loss')
      .send({ items: [{ itemId: 'inventory-demo-001', quantity: 3, remark: '过期' }] })
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.doc.type).toBe('LOSS');
    expect(String(res.body.data.doc.number)).toMatch(/^LSS-/);
    expect(stockOf('inventory-demo-001')).toBe(92);
    const tx = db.prepare('SELECT referenceType, remark FROM InventoryTransaction WHERE referenceId = ?').get(res.body.data.doc.id) as { referenceType: string; remark: string };
    expect(tx.referenceType).toBe('LOSS');
    expect(tx.remark).toBe('库损');
  });

  it('creates a transfer doc', async () => {
    const res = await request(app)
      .post('/api/v2/inventory-docs/transfer')
      .send({ items: [{ fromItemId: 'inventory-demo-001', toItemId: 'route-item-2', quantity: 4 }], remark: '路由调拨' })
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.doc.type).toBe('TRANSFER');
    expect(String(res.body.data.doc.number)).toMatch(/^TRF-/);
    expect(res.body.data.items[0].itemId).toBe('inventory-demo-001');
    expect(res.body.data.items[0].toItemId).toBe('route-item-2');
    expect(stockOf('inventory-demo-001')).toBe(88);
    expect(stockOf('route-item-2')).toBe(14);
    const txs = db.prepare('SELECT itemId, type, referenceType, remark FROM InventoryTransaction WHERE referenceId = ? ORDER BY type DESC').all(res.body.data.doc.id) as Array<{ itemId: string; type: string; referenceType: string; remark: string }>;
    expect(txs).toHaveLength(2);
    expect(txs.map((row) => row.referenceType)).toEqual(['TRANSFER', 'TRANSFER']);
    expect(txs.find((row) => row.type === 'OUT')?.remark).toBe('调拨出库');
    expect(txs.find((row) => row.type === 'IN')?.remark).toBe('调拨入库');
  });

  it('returns 409 when transfer source stock is insufficient', async () => {
    const res = await request(app)
      .post('/api/v2/inventory-docs/transfer')
      .send({ items: [{ fromItemId: 'inventory-demo-001', toItemId: 'route-item-2', quantity: 999 }] })
      .expect(409);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('CONFLICT');
  });
});
