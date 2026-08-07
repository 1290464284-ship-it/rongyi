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
import { registerChargeComboRoutes } from './charge-combo-routes';

describe('charge combo routes', () => {
  let db: Database.Database;
  let dataDir: string;
  let app: express.Express;
  const now = '2026-08-05T10:00:00.000Z';

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-charge-combo-routes-'));
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
        now: () => new Date(now),
      };
      next();
    });
    registerChargeComboRoutes(app, db);
    app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      const appError = error instanceof AppError
        ? error
        : new AppError('INTERNAL_ERROR', error instanceof Error ? error.message : String(error), 500);
      res.status(appError.status).json({ success: false, code: appError.code, message: appError.message });
    });

    const insertCombo = (id: string, code: string, name: string, type: 'PUBLIC' | 'PRIVATE', ownerId: string | null): void => {
      db.prepare(
        `INSERT INTO ChargeCombo (
           id, code, name, type, ownerId, active, clinicId, createdAt, updatedAt, deletedAt
         ) VALUES (?, ?, ?, ?, ?, 1, 'clinic-v2-001', ?, ?, NULL)`,
      ).run(id, code, name, type, ownerId, now, now);
    };
    const insertItem = (id: string, comboId: string, name: string, category: string, price: number, quantity: number, costType: string | null): void => {
      db.prepare(
        `INSERT INTO ChargeComboItem (
           id, comboId, catalogId, name, category, price, quantity, costType,
           clinicId, createdAt, updatedAt, deletedAt
         ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, 'clinic-v2-001', ?, ?, NULL)`,
      ).run(id, comboId, name, category, price, quantity, costType, now, now);
    };
    insertCombo('route-combo-1', 'CB-ROUTE-1', '正畸复诊包', 'PUBLIC', null);
    insertItem('route-combo-1-item-1', 'route-combo-1', '调整', 'ORTHODONTIC', 20000, 1, 'SERVICE');
    insertItem('route-combo-1-item-2', 'route-combo-1', '弓丝', 'MATERIAL', 3000, 2, 'MATERIAL');
    insertCombo('route-combo-2', 'CB-ROUTE-2', '我的私有包', 'PRIVATE', 'user-admin-001');
    insertItem('route-combo-2-item-1', 'route-combo-2', '私人项目', 'GENERAL', 8800, 1, null);
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('GET /api/v2/charge-combos lists visible combos with items', async () => {
    const res = await request(app).get('/api/v2/charge-combos').expect(200);
    expect(res.body.success).toBe(true);
    const data = res.body.data as Array<Record<string, unknown>>;
    expect(data.map((combo) => combo.id)).toEqual(expect.arrayContaining(['route-combo-1', 'route-combo-2']));
    const combo1 = data.find((combo) => combo.id === 'route-combo-1');
    expect(combo1?.items).toEqual([
      { id: 'route-combo-1-item-1', comboId: 'route-combo-1', catalogId: null, name: '调整', category: 'ORTHODONTIC', price: 20000, quantity: 1, costType: 'SERVICE' },
      { id: 'route-combo-1-item-2', comboId: 'route-combo-1', catalogId: null, name: '弓丝', category: 'MATERIAL', price: 3000, quantity: 2, costType: 'MATERIAL' },
    ]);
  });

  it('GET /api/v2/charge-combos/:id/items returns a single combo with items', async () => {
    const res = await request(app).get('/api/v2/charge-combos/route-combo-2/items').expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({ id: 'route-combo-2', name: '我的私有包', type: 'PRIVATE', ownerId: 'user-admin-001' });
    expect(res.body.data.items).toEqual([
      { id: 'route-combo-2-item-1', comboId: 'route-combo-2', catalogId: null, name: '私人项目', category: 'GENERAL', price: 8800, quantity: 1, costType: null },
    ]);
  });

  it('POST /api/v2/charge-combos/:id/apply creates a charge and persists it', async () => {
    const res = await request(app)
      .post('/api/v2/charge-combos/route-combo-1/apply')
      .send({ patientId: 'patient-demo-001' })
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      comboId: 'route-combo-1',
      comboName: '正畸复诊包',
      status: 'UNPAID',
      totalAmount: 20000 + 3000 * 2,
    });
    const charge = db.prepare('SELECT * FROM Charge WHERE id = ?').get(String(res.body.data.id)) as Record<string, unknown>;
    expect(charge.patientId).toBe('patient-demo-001');
    expect(charge.remark).toBe('收费组合 正畸复诊包');
    const items = db.prepare(
      'SELECT name, costType FROM ChargeItem WHERE chargeId = ? ORDER BY name',
    ).all(String(res.body.data.id)) as Array<{ name: string; costType: string }>;
    expect(items).toEqual([
      { name: '弓丝', costType: 'MATERIAL' },
      { name: '调整', costType: 'SERVICE' },
    ]);
  });

  it('POST /api/v2/charge-combos/:id/apply returns 404 for a missing combo', async () => {
    const res = await request(app)
      .post('/api/v2/charge-combos/route-missing/apply')
      .send({ patientId: 'patient-demo-001' })
      .expect(404);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('NOT_FOUND');
    expect(res.body.message).toBe('Charge combo not found');
  });
});
