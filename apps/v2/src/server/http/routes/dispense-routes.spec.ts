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
import { registerDispenseRoutes } from './dispense-routes';

describe('dispense routes', () => {
  let db: Database.Database;
  let dataDir: string;
  let app: express.Express;
  const now = '2026-08-05T10:00:00.000Z';

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-dispense-routes-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
    // 批次管理物品：stock=50，批次 batch-001 remaining=10
    db.prepare(
      `INSERT INTO InventoryItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, category, unit, stock, minStock, price, spec, batchManaged
       ) VALUES (?, 'clinic-v2-001', ?, ?, NULL, 'MAT-R1', 'Route Batch Material', 'CONSUMABLE', 'box', 50, 5, 3000, '500g', 1)`,
    ).run('route-batch-item', now, now);
    db.prepare(
      `INSERT INTO InventoryBatch (
         id, itemId, batchNo, expiryDate, initialQuantity, remainingQuantity,
         supplierId, purchaseOrderId, active, clinicId, createdAt, updatedAt, deletedAt
       ) VALUES (?, ?, 'R-B-001', '2027-01-01', 10, 10, NULL, NULL, 1, 'clinic-v2-001', ?, ?, NULL)`,
    ).run('route-batch-001', 'route-batch-item', now, now);

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
    registerDispenseRoutes(app, db);
    app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      const appError = error instanceof AppError
        ? error
        : new AppError('INTERNAL_ERROR', error instanceof Error ? error.message : String(error), 500);
      res.status(appError.status).json({ success: false, code: appError.code, message: appError.message });
    });
    // 独立库存物品：避免各测试之间库存互相影响
    db.prepare(
      `INSERT INTO InventoryItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, category, unit, stock, minStock, price, spec, batchManaged
       ) VALUES (?, 'clinic-v2-001', ?, ?, NULL, 'PLAIN-R1', 'Route Plain Material', 'CONSUMABLE', 'box', 100, 5, 100, NULL, 0)`,
    ).run('route-plain-dispense', now, now);
    db.prepare(
      `INSERT INTO InventoryItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, category, unit, stock, minStock, price, spec, batchManaged
       ) VALUES (?, 'clinic-v2-001', ?, ?, NULL, 'PLAIN-R2', 'Route Return Material', 'CONSUMABLE', 'box', 100, 5, 100, NULL, 0)`,
    ).run('route-plain-return', now, now);
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  function stockOf(itemId: string): number {
    const row = db.prepare('SELECT stock FROM InventoryItem WHERE id = ?').get(itemId) as { stock: number };
    return Number(row.stock);
  }

  function batchRemaining(batchId: string): number {
    const row = db.prepare('SELECT remainingQuantity FROM InventoryBatch WHERE id = ?').get(batchId) as { remainingQuantity: number };
    return Number(row.remainingQuantity);
  }

  function createDispense(number: string, items: Array<{ itemId: string; quantity: number; batchId?: string }>): Promise<string> {
    return request(app)
      .post('/api/v2/dispenses')
      .send({ number, patientId: 'patient-demo-001', doctorId: 'user-admin-001', items })
      .expect(201)
      .then((res) => String(res.body.data.id));
  }

  it('POST /api/v2/dispenses creates a PENDING dispense and persists rows', async () => {
    const res = await request(app)
      .post('/api/v2/dispenses')
      .send({
        number: 'PF-ROUTE-1',
        patientId: 'patient-demo-001',
        doctorId: 'user-admin-001',
        note: '路由测试发药',
        items: [
          { itemId: 'inventory-demo-001', quantity: 3 },
          { itemId: 'inventory-demo-001', quantity: 2 },
          { itemId: 'route-batch-item', quantity: 4, batchId: 'route-batch-001' },
        ],
      })
      .expect(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({ number: 'PF-ROUTE-1', status: 'PENDING', items: 2 });

    const dispense = db.prepare('SELECT * FROM Dispense WHERE id = ?').get(String(res.body.data.id)) as Record<string, unknown>;
    expect(dispense.number).toBe('PF-ROUTE-1');
    expect(dispense.patientId).toBe('patient-demo-001');
    expect(dispense.doctorId).toBe('user-admin-001');
    expect(dispense.note).toBe('路由测试发药');
    expect(dispense.status).toBe('PENDING');
    expect(dispense.clinicId).toBe('clinic-v2-001');

    const items = db.prepare(
      'SELECT itemId, batchId, name, quantity FROM DispenseItem WHERE dispenseId = ? ORDER BY itemId, batchId',
    ).all(String(res.body.data.id)) as Array<{ itemId: string; batchId: string | null; name: string; quantity: number }>;
    expect(items).toEqual([
      { itemId: 'inventory-demo-001', batchId: null, name: 'Dental Material', quantity: 5 },
      { itemId: 'route-batch-item', batchId: 'route-batch-001', name: 'Route Batch Material', quantity: 4 },
    ]);
  });

  it('GET /api/v2/dispenses lists orders and filters by status', async () => {
    await createDispense('PF-LIST-1', [{ itemId: 'inventory-demo-001', quantity: 1 }]);
    const list = await request(app).get('/api/v2/dispenses').expect(200);
    expect(list.body.success).toBe(true);
    const rows = list.body.data as Array<Record<string, unknown>>;
    expect(rows.map((row) => row.number)).toEqual(expect.arrayContaining(['PF-LIST-1']));
    const row = rows.find((entry) => entry.number === 'PF-LIST-1');
    expect(row).toMatchObject({
      patientName: 'Demo Patient',
      status: 'PENDING',
      itemsCount: 1,
      pharmacistName: null,
    });

    const pending = await request(app).get('/api/v2/dispenses?status=PENDING').expect(200);
    expect((pending.body.data as Array<Record<string, unknown>>).every((entry) => entry.status === 'PENDING')).toBe(true);

    const invalid = await request(app).get('/api/v2/dispenses?status=BAD').expect(400);
    expect(invalid.body.success).toBe(false);
    expect(invalid.body.code).toBe('VALIDATION_ERROR');
    expect(invalid.body.message).toBe('发药单状态筛选无效');
  });

  it('GET /api/v2/dispenses/:id returns detail with items and 404 for missing', async () => {
    const id = await createDispense('PF-DETAIL-1', [{ itemId: 'inventory-demo-001', quantity: 2 }]);
    const res = await request(app).get(`/api/v2/dispenses/${id}`).expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({ number: 'PF-DETAIL-1', status: 'PENDING' });
    expect(res.body.data.items).toEqual([
      expect.objectContaining({ itemId: 'inventory-demo-001', name: 'Dental Material', quantity: 2, returnedQuantity: 0 }),
    ]);

    const missing = await request(app).get('/api/v2/dispenses/route-missing').expect(404);
    expect(missing.body.success).toBe(false);
    expect(missing.body.code).toBe('NOT_FOUND');
    expect(missing.body.message).toBe('发药单不存在');
  });

  it('POST /api/v2/dispenses/:id/dispense deducts stock and marks DISPENSED', async () => {
    const id = await createDispense('PF-DISPENSE-1', [{ itemId: 'route-plain-dispense', quantity: 10 }]);
    expect(stockOf('route-plain-dispense')).toBe(100);
    const res = await request(app).post(`/api/v2/dispenses/${id}/dispense`).send({}).expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({ id, status: 'DISPENSED', dispensedAt: now });
    expect(res.body.data.items).toEqual([
      expect.objectContaining({ itemId: 'route-plain-dispense', quantity: 10, batchId: null }),
    ]);

    expect(stockOf('route-plain-dispense')).toBe(90);
    const dispense = db.prepare('SELECT status, pharmacistId, dispensedAt FROM Dispense WHERE id = ?').get(id) as Record<string, unknown>;
    expect(dispense.status).toBe('DISPENSED');
    expect(dispense.pharmacistId).toBe('user-admin-001');
    expect(dispense.dispensedAt).toBe(now);
  });

  it('POST /api/v2/dispenses/:id/dispense handles batch-managed items and rejects a second dispense', async () => {
    const id = await createDispense('PF-BATCH-1', [
      { itemId: 'route-batch-item', quantity: 4, batchId: 'route-batch-001' },
    ]);
    const res = await request(app).post(`/api/v2/dispenses/${id}/dispense`).send({}).expect(200);
    expect(res.body.data.status).toBe('DISPENSED');
    expect(res.body.data.items).toEqual([
      expect.objectContaining({ itemId: 'route-batch-item', quantity: 4, batchId: 'route-batch-001' }),
    ]);
    expect(batchRemaining('route-batch-001')).toBe(6);
    expect(stockOf('route-batch-item')).toBe(46);

    const row = db.prepare('SELECT batchId FROM DispenseItem WHERE dispenseId = ?').get(id) as { batchId: string | null };
    expect(row.batchId).toBe('route-batch-001');

    const again = await request(app).post(`/api/v2/dispenses/${id}/dispense`).send({}).expect(409);
    expect(again.body.success).toBe(false);
    expect(again.body.code).toBe('CONFLICT');
    expect(again.body.message).toBe('仅待发药或部分发药的发药单可发药');
  });

  it('POST /api/v2/dispenses/:id/return restores stock and computes PARTIAL/RETURNED status', async () => {
    const id = await createDispense('PF-RETURN-1', [{ itemId: 'route-plain-return', quantity: 5 }]);
    await request(app).post(`/api/v2/dispenses/${id}/dispense`).send({}).expect(200);
    expect(stockOf('route-plain-return')).toBe(95);
    const detail = (await request(app).get(`/api/v2/dispenses/${id}`).expect(200)).body.data;
    const diId = String(detail.items[0].id);

    // 超量退药：400
    const over = await request(app)
      .post(`/api/v2/dispenses/${id}/return`)
      .send({ items: [{ dispenseItemId: diId, quantity: 6 }] })
      .expect(400);
    expect(over.body.code).toBe('VALIDATION_ERROR');
    expect(over.body.message).toBe('退回数量不能超过未退数量');

    const partial = await request(app)
      .post(`/api/v2/dispenses/${id}/return`)
      .send({ items: [{ dispenseItemId: diId, quantity: 2 }] })
      .expect(200);
    expect(partial.body.data.status).toBe('PARTIAL');
    expect(partial.body.data.returnedAt).toBeNull();
    expect(stockOf('route-plain-return')).toBe(97);
    const partialRow = db.prepare('SELECT status FROM Dispense WHERE id = ?').get(id) as { status: string };
    expect(partialRow.status).toBe('PARTIAL');

    const full = await request(app)
      .post(`/api/v2/dispenses/${id}/return`)
      .send({ items: [{ dispenseItemId: diId, quantity: 3 }] })
      .expect(200);
    expect(full.body.data.status).toBe('RETURNED');
    expect(full.body.data.returnedAt).toBe(now);
    expect(stockOf('route-plain-return')).toBe(100);
    const itemRow = db.prepare('SELECT returnedQuantity FROM DispenseItem WHERE dispenseId = ?').get(id) as { returnedQuantity: number };
    expect(itemRow.returnedQuantity).toBe(5);

    // 已全部退完（RETURNED）后再退：409 状态冲突
    const afterFull = await request(app)
      .post(`/api/v2/dispenses/${id}/return`)
      .send({ items: [{ dispenseItemId: diId, quantity: 1 }] })
      .expect(409);
    expect(afterFull.body.code).toBe('CONFLICT');
    expect(afterFull.body.message).toBe('仅已发药或部分发药的发药单可退药');
  });

  it('POST /api/v2/narcotic-registry creates a record; GET lists and filters by date', async () => {
    const res = await request(app)
      .post('/api/v2/narcotic-registry')
      .send({
        recordDate: '2026-08-05',
        patientId: 'patient-demo-001',
        doctorId: 'user-admin-001',
        itemId: 'inventory-demo-001',
        batchNo: 'N-001',
        quantity: 1,
        usage: '局部麻醉',
        balanceBefore: 20,
        balanceAfter: 19,
        remark: '路由测试',
      })
      .expect(201);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.data.id).toBe('string');

    const list = await request(app).get('/api/v2/narcotic-registry').expect(200);
    expect(list.body.success).toBe(true);
    const rows = list.body.data as Array<Record<string, unknown>>;
    expect(rows.some((row) => row.batchNo === 'N-001')).toBe(true);
    const row = rows.find((entry) => entry.batchNo === 'N-001');
    expect(row).toMatchObject({
      recordDate: '2026-08-05',
      patientName: 'Demo Patient',
      doctorName: 'System Administrator',
      pharmacistName: 'System Administrator',
      itemName: 'Dental Material',
      quantity: 1,
      usage: '局部麻醉',
      balanceBefore: 20,
      balanceAfter: 19,
      remark: '路由测试',
    });

    const filtered = await request(app).get('/api/v2/narcotic-registry?recordDate=2026-08-05').expect(200);
    expect((filtered.body.data as Array<Record<string, unknown>>).every((entry) => entry.recordDate === '2026-08-05')).toBe(true);
    const empty = await request(app).get('/api/v2/narcotic-registry?recordDate=2026-01-01').expect(200);
    expect(empty.body.data).toEqual([]);
  });

  it('POST /api/v2/narcotic-registry rejects missing items and empty dates', async () => {
    const missing = await request(app)
      .post('/api/v2/narcotic-registry')
      .send({ recordDate: '2026-08-05', itemId: 'route-missing', quantity: 1 })
      .expect(404);
    expect(missing.body.success).toBe(false);
    expect(missing.body.code).toBe('NOT_FOUND');
    expect(missing.body.message).toBe('Inventory item not found');

    const noDate = await request(app)
      .post('/api/v2/narcotic-registry')
      .send({ recordDate: '  ', itemId: 'inventory-demo-001', quantity: 1 })
      .expect(400);
    expect(noDate.body.code).toBe('VALIDATION_ERROR');
    expect(noDate.body.message).toBe('登记日期不能为空');
  });

  it('PATCH /api/v2/dispenses/:id updates a PENDING dispense and reconciles items', async () => {
    const id = await createDispense('PF-EDIT-1', [
      { itemId: 'inventory-demo-001', quantity: 2 },
      { itemId: 'route-plain-dispense', quantity: 3 },
    ]);
    const detail = (await request(app).get(`/api/v2/dispenses/${id}`).expect(200)).body.data;
    const keptId = String(detail.items[0].id);
    const droppedId = String(detail.items[1].id);

    const res = await request(app)
      .patch(`/api/v2/dispenses/${id}`)
      .send({
        number: 'PF-EDIT-1-U',
        patientId: 'patient-demo-001',
        note: '编辑后的备注',
        items: [
          { id: keptId, itemId: 'inventory-demo-001', quantity: 5 },
          { itemId: 'route-plain-dispense', quantity: 1 },
        ],
      })
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({ id, number: 'PF-EDIT-1-U', status: 'PENDING', items: 2 });

    const dispense = db.prepare('SELECT number, note FROM Dispense WHERE id = ?').get(id) as Record<string, unknown>;
    expect(dispense.number).toBe('PF-EDIT-1-U');
    expect(dispense.note).toBe('编辑后的备注');

    const kept = db.prepare('SELECT quantity, deletedAt FROM DispenseItem WHERE id = ?').get(keptId) as Record<string, unknown>;
    expect(kept.quantity).toBe(5);
    expect(kept.deletedAt).toBeNull();
    const dropped = db.prepare('SELECT deletedAt FROM DispenseItem WHERE id = ?').get(droppedId) as Record<string, unknown>;
    expect(dropped.deletedAt).not.toBeNull();
    const active = db.prepare(
      'SELECT itemId, quantity FROM DispenseItem WHERE dispenseId = ? AND deletedAt IS NULL ORDER BY createdAt ASC',
    ).all(id) as Array<{ itemId: string; quantity: number }>;
    expect(active).toEqual([
      { itemId: 'inventory-demo-001', quantity: 5 },
      { itemId: 'route-plain-dispense', quantity: 1 },
    ]);
  });

  it('PATCH /api/v2/dispenses/:id validates input and rejects non-PENDING edits', async () => {
    const id = await createDispense('PF-EDIT-2', [{ itemId: 'route-plain-dispense', quantity: 2 }]);
    const bad = await request(app)
      .patch(`/api/v2/dispenses/${id}`)
      .send({ number: '  ', patientId: 'patient-demo-001', items: [{ itemId: 'route-plain-dispense', quantity: 1 }] })
      .expect(400);
    expect(bad.body.code).toBe('VALIDATION_ERROR');
    expect(bad.body.message).toBe('发药单号不能为空');

    // 已发药的单不能编辑
    const dispensedId = await createDispense('PF-EDIT-3', [{ itemId: 'route-plain-dispense', quantity: 1 }]);
    await request(app).post(`/api/v2/dispenses/${dispensedId}/dispense`).send({}).expect(200);
    const conflict = await request(app)
      .patch(`/api/v2/dispenses/${dispensedId}`)
      .send({ number: 'PF-EDIT-3-U', patientId: 'patient-demo-001', items: [{ itemId: 'route-plain-dispense', quantity: 1 }] })
      .expect(409);
    expect(conflict.body.code).toBe('CONFLICT');
    expect(conflict.body.message).toBe('仅待发药的发药单可编辑');

    const missing = await request(app)
      .patch('/api/v2/dispenses/route-missing')
      .send({ number: 'PF-X', patientId: 'patient-demo-001', items: [{ itemId: 'route-plain-dispense', quantity: 1 }] })
      .expect(404);
    expect(missing.body.code).toBe('NOT_FOUND');
  });

  it('DELETE /api/v2/dispenses/:id soft-deletes a PENDING dispense and its items; rejects others', async () => {
    const id = await createDispense('PF-DEL-1', [{ itemId: 'route-plain-dispense', quantity: 2 }]);
    const res = await request(app).delete(`/api/v2/dispenses/${id}`).expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({ id, deleted: true });

    const dispense = db.prepare('SELECT deletedAt FROM Dispense WHERE id = ?').get(id) as Record<string, unknown>;
    expect(dispense.deletedAt).not.toBeNull();
    const items = db.prepare('SELECT deletedAt FROM DispenseItem WHERE dispenseId = ?').all(id) as Array<{ deletedAt: string | null }>;
    expect(items.every((row) => row.deletedAt !== null)).toBe(true);
    const list = await request(app).get('/api/v2/dispenses').expect(200);
    expect((list.body.data as Array<Record<string, unknown>>).map((row) => String(row.id))).not.toContain(id);
    await request(app).get(`/api/v2/dispenses/${id}`).expect(404);

    const dispensedId = await createDispense('PF-DEL-2', [{ itemId: 'route-plain-dispense', quantity: 1 }]);
    await request(app).post(`/api/v2/dispenses/${dispensedId}/dispense`).send({}).expect(200);
    const conflict = await request(app).delete(`/api/v2/dispenses/${dispensedId}`).expect(409);
    expect(conflict.body.code).toBe('CONFLICT');
    expect(conflict.body.message).toBe('仅待发药的发药单可删除');

    const missing = await request(app).delete('/api/v2/dispenses/route-missing').expect(404);
    expect(missing.body.code).toBe('NOT_FOUND');
  });

  it('PATCH /api/v2/narcotic-registry/:id updates editable fields', async () => {
    const created = await request(app)
      .post('/api/v2/narcotic-registry')
      .send({
        recordDate: '2026-08-05',
        patientId: 'patient-demo-001',
        doctorId: 'user-admin-001',
        itemId: 'inventory-demo-001',
        batchNo: 'N-001',
        quantity: 1,
        usage: '局部麻醉',
        balanceBefore: 20,
        balanceAfter: 19,
        remark: '旧备注',
      })
      .expect(201);
    const id = String(created.body.data.id);

    const res = await request(app)
      .patch(`/api/v2/narcotic-registry/${id}`)
      .send({
        recordDate: '2026-08-06',
        itemId: 'inventory-demo-001',
        batchNo: 'N-002',
        quantity: 2,
        usage: '静脉麻醉',
        balanceBefore: 19,
        balanceAfter: 17,
        remark: '新备注',
      })
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({ id });

    const row = db.prepare('SELECT * FROM NarcoticRegistry WHERE id = ?').get(id) as Record<string, unknown>;
    expect(row.recordDate).toBe('2026-08-06');
    expect(row.batchNo).toBe('N-002');
    expect(row.quantity).toBe(2);
    expect(row.usage).toBe('静脉麻醉');
    expect(row.balanceBefore).toBe(19);
    expect(row.balanceAfter).toBe(17);
    expect(row.remark).toBe('新备注');
    expect(row.patientId).toBe('patient-demo-001');
    expect(row.doctorId).toBe('user-admin-001');

    const list = await request(app).get('/api/v2/narcotic-registry').expect(200);
    const listed = (list.body.data as Array<Record<string, unknown>>).find((entry) => String(entry.id) === id);
    expect(listed?.batchNo).toBe('N-002');

    const bad = await request(app)
      .patch(`/api/v2/narcotic-registry/${id}`)
      .send({ recordDate: '  ', itemId: 'inventory-demo-001', quantity: 1 })
      .expect(400);
    expect(bad.body.code).toBe('VALIDATION_ERROR');
    expect(bad.body.message).toBe('登记日期不能为空');

    await request(app)
      .patch('/api/v2/narcotic-registry/route-missing')
      .send({ recordDate: '2026-08-06', itemId: 'inventory-demo-001', quantity: 1 })
      .expect(404);
  });

  it('DELETE /api/v2/narcotic-registry/:id soft-deletes the record', async () => {
    const created = await request(app)
      .post('/api/v2/narcotic-registry')
      .send({ recordDate: '2026-08-05', itemId: 'inventory-demo-001', quantity: 1 })
      .expect(201);
    const id = String(created.body.data.id);

    const res = await request(app).delete(`/api/v2/narcotic-registry/${id}`).expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({ id, deleted: true });

    const row = db.prepare('SELECT deletedAt FROM NarcoticRegistry WHERE id = ?').get(id) as Record<string, unknown>;
    expect(row.deletedAt).not.toBeNull();
    const list = await request(app).get('/api/v2/narcotic-registry').expect(200);
    expect((list.body.data as Array<Record<string, unknown>>).map((entry) => String(entry.id))).not.toContain(id);

    const missing = await request(app).delete('/api/v2/narcotic-registry/route-missing').expect(404);
    expect(missing.body.code).toBe('NOT_FOUND');
    expect(missing.body.message).toBe('麻药登记不存在');
  });
});
