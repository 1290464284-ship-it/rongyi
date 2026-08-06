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
import { registerChargeTreeRoutes } from './charge-tree-routes';

describe('charge tree routes', () => {
  let dataDir: string;
  let db: Database.Database;
  let app: Express;
  const nowIso = '2026-08-05T10:00:00.000Z';

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-charge-tree-routes-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
    db.prepare(
      `UPDATE Appointment SET startTime = ?, endTime = ?, updatedAt = ? WHERE id = 'appointment-demo-001'`,
    ).run('2099-01-01T00:00:00.000Z', '2099-01-01T01:00:00.000Z', nowIso);

    const insertCatalog = (
      id: string,
      code: string,
      name: string,
      price: number,
      parentId: string | null,
      costType: string | null,
    ): void => {
      db.prepare(
        `INSERT INTO TreatmentCatalog (
           id, clinicId, createdAt, updatedAt, deletedAt,
           code, name, category, price, remark, costType, anesthesia, parentId, businessCategory
         ) VALUES (?, 'clinic-v2-001', ?, ?, NULL, ?, ?, 'GENERAL', ?, NULL, ?, 0, ?, NULL)`,
      ).run(id, nowIso, nowIso, code, name, price, costType, parentId);
    };
    insertCatalog('route-cat-root', 'RT-CAT-1', '正畸项目', 10000, null, 'SERVICE');
    insertCatalog('route-cat-child', 'RT-CAT-1-01', '复诊调整', 5000, 'route-cat-root', 'SERVICE');
    insertCatalog('route-cat-material', 'RT-CAT-2', '种植材料', 150000, null, 'MATERIAL');

    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.context = {
        userId: 'user-admin-001',
        clinicId: 'clinic-v2-001',
        role: 'BOSS',
        traceId: 'test-trace',
        now: () => new Date(nowIso),
      };
      next();
    });
    registerChargeTreeRoutes(app, db);
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

  it('GET /api/v2/charge-trees returns the two-level catalog tree', async () => {
    const res = await request(app).get('/api/v2/charge-trees').expect(200);
    expect(res.body.success).toBe(true);
    const items = res.body.data.items as Array<Record<string, unknown>>;
    expect(items.map((node) => node.id)).toEqual(['route-cat-root', 'route-cat-material']);
    const root = items[0];
    expect(root.children).toEqual([
      expect.objectContaining({ id: 'route-cat-child', code: 'RT-CAT-1-01', name: '复诊调整', price: 5000 }),
    ]);
  });

  it('POST /api/v2/charge-trees/:catalogId/quick-charge creates a charge', async () => {
    const res = await request(app)
      .post('/api/v2/charge-trees/route-cat-root/quick-charge')
      .send({ patientId: 'patient-demo-001', quantity: 2 })
      .expect(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      catalogId: 'route-cat-root',
      totalAmount: 20000,
      itemId: null,
    });
    expect(res.body.data.chargeId).toBeDefined();
    expect(res.body.data.number).toMatch(/^CHG-/);
    const charge = db.prepare('SELECT * FROM Charge WHERE id = ?').get(res.body.data.chargeId) as Record<string, unknown>;
    expect(charge.status).toBe('UNPAID');
    expect(charge.patientId).toBe('patient-demo-001');
    expect(charge.totalAmount).toBe(20000);
    const item = db.prepare('SELECT * FROM ChargeItem WHERE chargeId = ?').get(res.body.data.chargeId) as Record<string, unknown>;
    expect(item.name).toBe('正畸项目');
    expect(item.quantity).toBe(2);
    expect(item.subtotal).toBe(20000);
  });

  it('POST quick-charge rejects a high-value item whose catalog does not match with 409', async () => {
    db.prepare(
      `UPDATE InventoryItem SET isHighValue = 1, catalogId = 'route-cat-material', updatedAt = ? WHERE id = 'inventory-demo-001'`,
    ).run(nowIso);
    const res = await request(app)
      .post('/api/v2/charge-trees/route-cat-root/quick-charge')
      .send({ patientId: 'patient-demo-001', itemId: 'inventory-demo-001' })
      .expect(409);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('CONFLICT');
    expect(res.body.message).toContain('高值耗材');
  });

  it('POST quick-charge returns 404 for a missing catalog', async () => {
    const res = await request(app)
      .post('/api/v2/charge-trees/route-cat-missing/quick-charge')
      .send({ patientId: 'patient-demo-001' })
      .expect(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });
});
