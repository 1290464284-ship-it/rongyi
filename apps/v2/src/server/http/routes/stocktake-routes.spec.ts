import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { AppError } from '../../infrastructure/errors';
import { registerStocktakeRoutes } from './stocktake-routes';
import { buildRouteDeps } from './route-deps.helper';

describe('stocktake routes', () => {
  let db: Database.Database;
  let dataDir: string;
  let app: express.Express;
  const now = '2026-08-05T10:00:00.000Z';

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-stocktake-routes-'));
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
    registerStocktakeRoutes(app, buildRouteDeps(db));
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

  beforeEach(() => {
    db.prepare('DELETE FROM StocktakeItem').run();
    db.prepare('DELETE FROM Stocktake').run();
    db.prepare('DELETE FROM InventoryTransaction').run();
  });

  function insertItem(id: string, code: string, name: string, stock: number): void {
    db.prepare(
      `INSERT INTO InventoryItem (id, clinicId, createdAt, updatedAt, deletedAt, code, name, category, unit, stock, minStock, price)
       VALUES (?, 'clinic-v2-001', ?, ?, NULL, ?, ?, 'CONSUMABLE', 'box', ?, 0, 1000)`,
    ).run(id, now, now, code, name, stock);
  }

  it('POST /api/v2/stocktakes 创建盘点单并生成明细，201', async () => {
    insertItem('route-item-a', 'RT-A', '物品A', 12);
    const res = await request(app)
      .post('/api/v2/stocktakes')
      .send({ number: 'PD-ROUTE-001', note: '路由测试' })
      .expect(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({ number: 'PD-ROUTE-001', status: 'IN_PROGRESS', itemCount: 2 });

    const row = db.prepare('SELECT * FROM Stocktake WHERE id = ?').get(String(res.body.data.id)) as Record<string, unknown>;
    expect(row.status).toBe('IN_PROGRESS');
    expect(row.startedById).toBe('user-admin-001');
    expect(row.startedAt).toBe(now);
    expect(row.note).toBe('路由测试');
    const items = db.prepare('SELECT itemId, systemStock FROM StocktakeItem WHERE stocktakeId = ?').all(String(res.body.data.id)) as Array<Record<string, unknown>>;
    expect(items).toHaveLength(2);
    expect(items.find((item) => item.itemId === 'route-item-a')).toMatchObject({ systemStock: 12 });
  });

  it('POST /api/v2/stocktakes 空单号 → 400；进行中重复创建 → 409', async () => {
    await request(app).post('/api/v2/stocktakes').send({ number: '  ' }).expect(400);
    await request(app).post('/api/v2/stocktakes').send({ number: 'PD-ROUTE-002' }).expect(201);
    const dup = await request(app).post('/api/v2/stocktakes').send({ number: 'PD-ROUTE-003' }).expect(409);
    expect(dup.body.code).toBe('CONFLICT');
  });

  it('GET /api/v2/stocktakes 列表含 itemCount/differenceCount', async () => {
    insertItem('route-item-b', 'RT-B', '物品B', 5);
    const created = await request(app).post('/api/v2/stocktakes').send({ number: 'PD-ROUTE-004' }).expect(201);
    const stocktakeId = String(created.body.data.id);
    await request(app).patch(`/api/v2/stocktakes/${stocktakeId}/items/route-item-b`).send({ countedStock: 8 }).expect(200);

    const res = await request(app).get('/api/v2/stocktakes').expect(200);
    expect(res.body.success).toBe(true);
    const data = res.body.data as Array<Record<string, unknown>>;
    expect(data).toHaveLength(1);
    // itemCount = 该租户全部在库物品数（跨用例累积），动态计算
    const totalItems = (db.prepare(
      'SELECT COUNT(*) AS c FROM InventoryItem WHERE deletedAt IS NULL AND clinicId = ?',
    ).get('clinic-v2-001') as { c: number }).c;
    expect(data[0]).toMatchObject({ id: stocktakeId, number: 'PD-ROUTE-004', status: 'IN_PROGRESS', itemCount: totalItems, differenceCount: 1 });
  });

  it('GET /api/v2/stocktakes/:id/items 返回明细与物品信息；不存在 → 404', async () => {
    insertItem('route-item-c', 'RT-C', '物品C', 7);
    const created = await request(app).post('/api/v2/stocktakes').send({ number: 'PD-ROUTE-005' }).expect(201);
    const stocktakeId = String(created.body.data.id);

    const res = await request(app).get(`/api/v2/stocktakes/${stocktakeId}/items`).expect(200);
    const items = res.body.data as Array<Record<string, unknown>>;
    expect(items.find((item) => item.itemId === 'route-item-c')).toMatchObject({
      systemStock: 7, countedStock: null, difference: 0, name: '物品C', code: 'RT-C',
    });

    const missing = await request(app).get('/api/v2/stocktakes/st-missing/items').expect(404);
    expect(missing.body.code).toBe('NOT_FOUND');
  });

  it('PATCH 录入数量后差异正确；非法数量 → 400', async () => {
    insertItem('route-item-d', 'RT-D', '物品D', 20);
    const created = await request(app).post('/api/v2/stocktakes').send({ number: 'PD-ROUTE-006' }).expect(201);
    const stocktakeId = String(created.body.data.id);

    const bad = await request(app).patch(`/api/v2/stocktakes/${stocktakeId}/items/route-item-d`).send({ countedStock: -3 }).expect(400);
    expect(bad.body.code).toBe('VALIDATION_ERROR');

    const res = await request(app).patch(`/api/v2/stocktakes/${stocktakeId}/items/route-item-d`).send({ countedStock: 17 }).expect(200);
    expect(res.body.data).toMatchObject({ systemStock: 20, countedStock: 17, difference: -3 });
  });

  it('lock → complete 全链路后库存写回并生成 ADJUST 流水', async () => {
    insertItem('route-item-e', 'RT-E', '物品E', 10);
    insertItem('route-item-f', 'RT-F', '物品F', 6);
    const created = await request(app).post('/api/v2/stocktakes').send({ number: 'PD-ROUTE-007' }).expect(201);
    const stocktakeId = String(created.body.data.id);
    await request(app).patch(`/api/v2/stocktakes/${stocktakeId}/items/route-item-e`).send({ countedStock: 12 }).expect(200);
    await request(app).patch(`/api/v2/stocktakes/${stocktakeId}/items/route-item-f`).send({ countedStock: 4 }).expect(200);

    const locked = await request(app).post(`/api/v2/stocktakes/${stocktakeId}/lock`).expect(200);
    expect(locked.body.data).toEqual({ id: stocktakeId, status: 'LOCKED' });

    const completed = await request(app).post(`/api/v2/stocktakes/${stocktakeId}/complete`).expect(200);
    expect(completed.body.data).toMatchObject({ id: stocktakeId, status: 'COMPLETED', adjustedCount: 2 });

    const e = db.prepare('SELECT stock FROM InventoryItem WHERE id = ?').get('route-item-e') as { stock: number };
    const f = db.prepare('SELECT stock FROM InventoryItem WHERE id = ?').get('route-item-f') as { stock: number };
    expect(e.stock).toBe(12);
    expect(f.stock).toBe(4);

    const txs = db.prepare(
      'SELECT itemId, type, quantity, beforeStock, afterStock FROM InventoryTransaction ORDER BY itemId',
    ).all() as Array<Record<string, unknown>>;
    expect(txs).toEqual([
      { itemId: 'route-item-e', type: 'ADJUST', quantity: 2, beforeStock: 10, afterStock: 12 },
      { itemId: 'route-item-f', type: 'ADJUST', quantity: -2, beforeStock: 6, afterStock: 4 },
    ]);
    const stocktake = db.prepare('SELECT status, completedById FROM Stocktake WHERE id = ?').get(stocktakeId) as Record<string, unknown>;
    expect(stocktake).toEqual({ status: 'COMPLETED', completedById: 'user-admin-001' });
  });

  it('cancel 可取消进行中盘点单', async () => {
    const created = await request(app).post('/api/v2/stocktakes').send({ number: 'PD-ROUTE-008' }).expect(201);
    const stocktakeId = String(created.body.data.id);
    const res = await request(app).post(`/api/v2/stocktakes/${stocktakeId}/cancel`).expect(200);
    expect(res.body.data).toEqual({ id: stocktakeId, status: 'CANCELLED' });
    expect((db.prepare('SELECT status FROM Stocktake WHERE id = ?').get(stocktakeId) as { status: string }).status).toBe('CANCELLED');
  });

  it('错误路径：不存在 id → 404；状态非法 → 409', async () => {
    const missing = await request(app).post('/api/v2/stocktakes/st-missing/lock').expect(404);
    expect(missing.body.code).toBe('NOT_FOUND');

    const created = await request(app).post('/api/v2/stocktakes').send({ number: 'PD-ROUTE-009' }).expect(201);
    const stocktakeId = String(created.body.data.id);
    // IN_PROGRESS 直接 complete → 409
    const illegal = await request(app).post(`/api/v2/stocktakes/${stocktakeId}/complete`).expect(409);
    expect(illegal.body.code).toBe('CONFLICT');
    // 重复 lock → 409
    await request(app).post(`/api/v2/stocktakes/${stocktakeId}/lock`).expect(200);
    await request(app).post(`/api/v2/stocktakes/${stocktakeId}/lock`).expect(409);
    // LOCKED 录入 → 409
    await request(app).patch(`/api/v2/stocktakes/${stocktakeId}/items/inventory-demo-001`).send({ countedStock: 5 }).expect(409);
  });
});
