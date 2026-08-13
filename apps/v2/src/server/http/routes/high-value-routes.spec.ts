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
import { registerHighValueRoutes } from './high-value-routes';
import { buildRouteDeps } from './route-deps.helper';

describe('high value routes', () => {
  let dataDir: string;
  let db: Database.Database;
  let app: Express;
  const nowIso = '2026-08-05T10:00:00.000Z';

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-high-value-routes-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
    db.prepare(
      `UPDATE Appointment SET startTime = ?, endTime = ?, updatedAt = ? WHERE id = 'appointment-demo-001'`,
    ).run('2099-01-01T00:00:00.000Z', '2099-01-01T01:00:00.000Z', nowIso);
    db.prepare(
      `INSERT INTO TreatmentCatalog (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, category, price, remark, costType, anesthesia, parentId, businessCategory
       ) VALUES ('route-hv-cat', 'clinic-v2-001', ?, ?, NULL, 'RT-HV-1', '种植体', 'MATERIAL', 150000, NULL, 'MATERIAL', 0, NULL, 'MATERIAL')`,
    ).run(nowIso, nowIso);

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
    registerHighValueRoutes(app, buildRouteDeps(db));
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

  it('POST /api/v2/inventory-items/:id/high-value marks an item', async () => {
    const res = await request(app)
      .post('/api/v2/inventory-items/inventory-demo-001/high-value')
      .send({ isHighValue: true, catalogId: 'route-hv-cat' })
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({ itemId: 'inventory-demo-001', isHighValue: true, catalogId: 'route-hv-cat' });
    const row = db.prepare('SELECT isHighValue, catalogId FROM InventoryItem WHERE id = ?').get('inventory-demo-001') as {
      isHighValue: number;
      catalogId: string;
    };
    expect(row.isHighValue).toBe(1);
    expect(row.catalogId).toBe('route-hv-cat');
  });

  it('POST without a catalog returns 400', async () => {
    const res = await request(app)
      .post('/api/v2/inventory-items/inventory-demo-001/high-value')
      .send({ isHighValue: true })
      .expect(400);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('POST unmarks and clears the catalog', async () => {
    const res = await request(app)
      .post('/api/v2/inventory-items/inventory-demo-001/high-value')
      .send({ isHighValue: false })
      .expect(200);
    expect(res.body.data).toEqual({ itemId: 'inventory-demo-001', isHighValue: false, catalogId: null });
  });

  it('parses string booleans strictly for isHighValue', async () => {
    await request(app)
      .post('/api/v2/inventory-items/inventory-demo-001/high-value')
      .send({ isHighValue: 'false', catalogId: 'route-hv-cat' })
      .expect(200);
    expect((db.prepare('SELECT isHighValue FROM InventoryItem WHERE id = ?').get('inventory-demo-001') as { isHighValue: number }).isHighValue).toBe(0);
    await request(app)
      .post('/api/v2/inventory-items/inventory-demo-001/high-value')
      .send({ isHighValue: 'maybe' })
      .expect(400);
  });

  it('tolerates a missing request body', async () => {
    const res = await request(app).post('/api/v2/inventory-items/missing/high-value');
    expect([200, 400, 404]).toContain(res.status);
  });
});
