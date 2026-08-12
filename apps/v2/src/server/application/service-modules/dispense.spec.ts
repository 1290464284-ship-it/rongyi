// L-04 索引：DispenseService 发药单全量测试：create/dispense/returnItems/
// update-delete/列表详情/租户隔离。麻药登记已拆到 narcotic-registry.spec.ts。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { ConflictError, NotFoundError, ValidationError } from '../../infrastructure/errors';
import type { AppContext } from '../../../domain/contracts';
import { DispenseService } from './dispense';

describe('DispenseService', () => {
  let db: Database.Database;
  let dataDir: string;
  let context: AppContext;
  const now = '2026-08-05T10:00:00.000Z';

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-dispense-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
    context = {
      userId: 'user-admin-001',
      clinicId: 'clinic-v2-001',
      role: 'BOSS',
      traceId: 'trace',
      now: () => new Date(now),
    };
    // 共享批次管理物品（供不校验绝对库存的测试使用）：stock=50，批次 batch-001 remaining=10
    db.prepare(
      `INSERT INTO InventoryItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, category, unit, stock, minStock, price, spec, batchManaged
       ) VALUES (?, 'clinic-v2-001', ?, ?, NULL, 'MAT-B1', 'Batch Material', 'CONSUMABLE', 'box', 50, 5, 3000, '500g', 1)`,
    ).run('inventory-batch-001', now, now);
    db.prepare(
      `INSERT INTO InventoryBatch (
         id, itemId, batchNo, expiryDate, initialQuantity, remainingQuantity,
         supplierId, purchaseOrderId, active, clinicId, createdAt, updatedAt, deletedAt
       ) VALUES (?, ?, 'B-2026-01', '2027-01-01', 10, 10, NULL, NULL, 1, 'clinic-v2-001', ?, ?, NULL)`,
    ).run('batch-001', 'inventory-batch-001', now, now);
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  function service(): DispenseService {
    return new DispenseService(db);
  }

  function stockOf(itemId: string): number {
    const row = db.prepare('SELECT stock FROM InventoryItem WHERE id = ?').get(itemId) as { stock: number };
    return Number(row.stock);
  }

  function batchRemaining(batchId: string): number {
    const row = db.prepare('SELECT remainingQuantity FROM InventoryBatch WHERE id = ?').get(batchId) as { remainingQuantity: number };
    return Number(row.remainingQuantity);
  }

  /** 为单个测试插入独立库存物品，避免测试间库存互相影响。 */
  function insertItem(id: string, stock: number, batchManaged: number): void {
    db.prepare(
      `INSERT INTO InventoryItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, category, unit, stock, minStock, price, spec, batchManaged
       ) VALUES (?, 'clinic-v2-001', ?, ?, NULL, ?, 'Test Material', 'CONSUMABLE', 'box', ?, 5, 100, NULL, ?)`,
    ).run(id, now, now, `CODE-${id}`, stock, batchManaged);
  }

  /** 为单个测试插入独立批次（剩余量 = 初始量）。 */
  function insertBatch(batchId: string, itemId: string, remaining: number): void {
    db.prepare(
      `INSERT INTO InventoryBatch (
         id, itemId, batchNo, expiryDate, initialQuantity, remainingQuantity,
         supplierId, purchaseOrderId, active, clinicId, createdAt, updatedAt, deletedAt
       ) VALUES (?, ?, ?, '2027-01-01', ?, ?, NULL, NULL, 1, 'clinic-v2-001', ?, ?, NULL)`,
    ).run(batchId, itemId, `B-${batchId}`, remaining, remaining, now, now);
  }

  function firstItemId(dispenseId: string): string {
    const row = db.prepare('SELECT id FROM DispenseItem WHERE dispenseId = ? ORDER BY createdAt ASC LIMIT 1').get(dispenseId) as { id: string };
    return row.id;
  }

  describe('create', () => {
    it('persists a PENDING dispense with DispenseItem rows copying name/spec from InventoryItem', () => {
      const result = service().create({
        number: 'PF-001',
        patientId: 'patient-demo-001',
        doctorId: 'user-admin-001',
        note: '正畸复诊发药',
        items: [
          { itemId: 'inventory-demo-001', quantity: 3 },
          { itemId: 'inventory-demo-001', quantity: 2, batchId: 'b-extra' },
          { itemId: 'inventory-batch-001', quantity: 4, batchId: 'batch-001' },
        ],
      }, context);
      expect(result).toMatchObject({ number: 'PF-001', status: 'PENDING' });
      expect(result.items).toBe(3);

      const dispense = db.prepare('SELECT * FROM Dispense WHERE id = ?').get(String(result.id)) as Record<string, unknown>;
      expect(dispense.number).toBe('PF-001');
      expect(dispense.patientId).toBe('patient-demo-001');
      expect(dispense.doctorId).toBe('user-admin-001');
      expect(dispense.status).toBe('PENDING');
      expect(dispense.clinicId).toBe('clinic-v2-001');
      expect(dispense.note).toBe('正畸复诊发药');

      const items = db.prepare(
        'SELECT itemId, batchId, name, spec, quantity, returnedQuantity FROM DispenseItem WHERE dispenseId = ? ORDER BY itemId, batchId',
      ).all(String(result.id)) as Array<{ itemId: string; batchId: string | null; name: string; spec: string | null; quantity: number; returnedQuantity: number }>;
      expect(items).toHaveLength(3);
      expect(items[0]).toEqual({
        itemId: 'inventory-batch-001',
        batchId: 'batch-001',
        name: 'Batch Material',
        spec: '500g',
        quantity: 4,
        returnedQuantity: 0,
      });
      expect(items[1]).toEqual({
        itemId: 'inventory-demo-001',
        batchId: null,
        name: 'Dental Material',
        spec: null,
        quantity: 3,
        returnedQuantity: 0,
      });
      expect(items[2]).toEqual({
        itemId: 'inventory-demo-001',
        batchId: 'b-extra',
        name: 'Dental Material',
        spec: null,
        quantity: 2,
        returnedQuantity: 0,
      });
    });

    it('merges duplicate (itemId, batchId) rows and rejects unknown patients', () => {
      const result = service().create({
        number: 'PF-002',
        patientId: 'patient-demo-001',
        items: [
          { itemId: 'inventory-demo-001', quantity: 2 },
          { itemId: 'inventory-demo-001', quantity: 3 },
        ],
      }, context);
      expect(result.items).toBe(1);
      const rows = db.prepare(
        'SELECT quantity FROM DispenseItem WHERE dispenseId = ?',
      ).all(String(result.id)) as Array<{ quantity: number }>;
      expect(rows).toEqual([{ quantity: 5 }]);

      expect(() => service().create({
        number: 'PF-003',
        patientId: 'patient-missing',
        items: [{ itemId: 'inventory-demo-001', quantity: 1 }],
      }, context)).toThrow(NotFoundError);
    });

    it('rejects missing number, empty items, non-positive or non-integer quantities, and unknown items', () => {
      const base = {
        patientId: 'patient-demo-001',
        items: [{ itemId: 'inventory-demo-001', quantity: 1 }],
      };
      expect(() => service().create({ ...base, number: '  ' }, context)).toThrow(ValidationError);
      expect(() => service().create({ ...base, number: 'PF-004', items: [] }, context)).toThrow(ValidationError);
      expect(() => service().create({ ...base, number: 'PF-004', items: [{ itemId: 'inventory-demo-001', quantity: 0 }] }, context)).toThrow(ValidationError);
      expect(() => service().create({ ...base, number: 'PF-004', items: [{ itemId: 'inventory-demo-001', quantity: 1.5 }] }, context)).toThrow(ValidationError);
      expect(() => service().create({ ...base, number: 'PF-004', items: [{ itemId: 'inventory-missing', quantity: 1 }] }, context)).toThrow(NotFoundError);
    });
  });

  describe('dispense', () => {
    it('dispenses non-batch items: stock deduction, OUT transaction, status/pharmacistId/dispensedAt', async () => {
      insertItem('disp-item-100', 100, 0);
      const created = service().create({
        number: 'PF-100',
        patientId: 'patient-demo-001',
        items: [{ itemId: 'disp-item-100', quantity: 10 }],
      }, context);
      const result = await service().dispense(String(created.id), context);
      expect(result.status).toBe('DISPENSED');
      expect(result.dispensedAt).toBe(now);
      expect(result.items).toEqual([{ itemId: 'disp-item-100', name: 'Test Material', quantity: 10, batchId: null }]);

      expect(stockOf('disp-item-100')).toBe(90);
      const txn = db.prepare(
        `SELECT beforeStock, afterStock, type, remark, operatorId FROM InventoryTransaction
         WHERE itemId = 'disp-item-100' AND type = 'OUT'`,
      ).get() as { beforeStock: number; afterStock: number; type: string; remark: string; operatorId: string };
      expect(txn).toBeDefined();
      expect(txn.beforeStock).toBe(100);
      expect(txn.afterStock).toBe(90);
      expect(txn.remark).toBe('药房发药');
      expect(txn.operatorId).toBe('user-admin-001');

      const dispense = db.prepare('SELECT status, pharmacistId, dispensedAt FROM Dispense WHERE id = ?').get(String(created.id)) as Record<string, unknown>;
      expect(dispense.status).toBe('DISPENSED');
      expect(dispense.pharmacistId).toBe('user-admin-001');
      expect(dispense.dispensedAt).toBe(now);
    });

    it('rejects dispensing an already dispensed order with ConflictError', async () => {
      insertItem('disp-item-101', 100, 0);
      const created = service().create({
        number: 'PF-101',
        patientId: 'patient-demo-001',
        items: [{ itemId: 'disp-item-101', quantity: 1 }],
      }, context);
      await service().dispense(String(created.id), context);
      await expect(service().dispense(String(created.id), context)).rejects.toThrow(ConflictError);
    });

    it('rejects batch-managed items without a batchId', async () => {
      insertItem('disp-batch-110', 50, 1);
      insertBatch('disp-batch-110-b', 'disp-batch-110', 10);
      const created = service().create({
        number: 'PF-110',
        patientId: 'patient-demo-001',
        items: [{ itemId: 'disp-batch-110', quantity: 4 }],
      }, context);
      await expect(service().dispense(String(created.id), context)).rejects.toThrow(ValidationError);
      await expect(service().dispense(String(created.id), context)).rejects.toThrow('批次管理物品必须指定批次');
      // 未发药：库存与批次均未变化
      expect(stockOf('disp-batch-110')).toBe(50);
      expect(batchRemaining('disp-batch-110-b')).toBe(10);
    });

    it('dispenses batch-managed items: batch deduction + stock deduction + batchId persisted', async () => {
      insertItem('disp-batch-111', 50, 1);
      insertBatch('disp-batch-111-b', 'disp-batch-111', 10);
      const created = service().create({
        number: 'PF-111',
        patientId: 'patient-demo-001',
        items: [{ itemId: 'disp-batch-111', quantity: 4 }],
      }, context);
      const di = db.prepare('SELECT id FROM DispenseItem WHERE dispenseId = ?').get(String(created.id)) as { id: string };
      const result = await service().dispense(String(created.id), context, {
        items: [{ dispenseItemId: di.id, batchId: 'disp-batch-111-b' }],
      });
      expect(result.status).toBe('DISPENSED');
      const resultItems = result.items as Array<Record<string, unknown>>;
      expect(resultItems[0]).toEqual({ itemId: 'disp-batch-111', name: 'Test Material', quantity: 4, batchId: 'disp-batch-111-b' });

      expect(batchRemaining('disp-batch-111-b')).toBe(6);
      expect(stockOf('disp-batch-111')).toBe(46);
      const diRow = db.prepare('SELECT batchId FROM DispenseItem WHERE id = ?').get(di.id) as { batchId: string | null };
      expect(diRow.batchId).toBe('disp-batch-111-b');
      const txn = db.prepare(
        `SELECT type, quantity, beforeStock, afterStock FROM InventoryTransaction
         WHERE itemId = 'disp-batch-111' AND type = 'OUT'`,
      ).get() as Record<string, unknown>;
      expect(txn).toBeDefined();
      expect(txn.beforeStock).toBe(50);
      expect(txn.afterStock).toBe(46);
    });

    it('rejects insufficient batch quantity with ConflictError and no partial deduction', async () => {
      insertItem('disp-batch-112', 50, 1);
      insertBatch('disp-batch-112-b', 'disp-batch-112', 10);
      const created = service().create({
        number: 'PF-112',
        patientId: 'patient-demo-001',
        items: [{ itemId: 'disp-batch-112', quantity: 12 }],
      }, context);
      const di = db.prepare('SELECT id FROM DispenseItem WHERE dispenseId = ?').get(String(created.id)) as { id: string };
      await expect(service().dispense(String(created.id), context, {
        items: [{ dispenseItemId: di.id, batchId: 'disp-batch-112-b' }],
      })).rejects.toThrow(ConflictError);
      expect(batchRemaining('disp-batch-112-b')).toBe(10);
      expect(stockOf('disp-batch-112')).toBe(50);
      const dispense = db.prepare('SELECT status FROM Dispense WHERE id = ?').get(String(created.id)) as { status: string };
      expect(dispense.status).toBe('PENDING');
      const outCount = db.prepare(
        "SELECT COUNT(*) AS count FROM InventoryTransaction WHERE itemId = 'disp-batch-112' AND type = 'OUT'",
      ).get() as { count: number };
      expect(outCount.count).toBe(0);
    });

    it('rejects batch assignments referencing a batch that does not belong to the item', async () => {
      insertItem('disp-batch-113', 50, 1);
      insertBatch('disp-batch-113-b', 'disp-batch-113', 10);
      const created = service().create({
        number: 'PF-113',
        patientId: 'patient-demo-001',
        items: [{ itemId: 'disp-batch-113', quantity: 2 }],
      }, context);
      const di = db.prepare('SELECT id FROM DispenseItem WHERE dispenseId = ?').get(String(created.id)) as { id: string };
      await expect(service().dispense(String(created.id), context, {
        items: [{ dispenseItemId: di.id, batchId: 'not-a-batch' }],
      })).rejects.toThrow(ConflictError);
      expect(stockOf('disp-batch-113')).toBe(50);
    });

    it('rejects unknown or already returned dispenses', async () => {
      await expect(service().dispense('dispense-missing', context)).rejects.toThrow(NotFoundError);
      insertItem('disp-item-114', 100, 0);
      const created = service().create({
        number: 'PF-114',
        patientId: 'patient-demo-001',
        items: [{ itemId: 'disp-item-114', quantity: 2 }],
      }, context);
      await service().dispense(String(created.id), context);
      await service().returnItems(String(created.id), {
        items: [{ dispenseItemId: firstItemId(String(created.id)), quantity: 2 }],
      }, context);
      await expect(service().dispense(String(created.id), context)).rejects.toThrow(ConflictError);
    });
  });

  describe('returnItems', () => {
    it('partially returns items: PARTIAL status, returnedQuantity, stock and batch replenishment', async () => {
      insertItem('ret-batch-200', 50, 1);
      insertBatch('ret-batch-200-b', 'ret-batch-200', 10);
      insertItem('ret-plain-200', 100, 0);
      const created = service().create({
        number: 'PF-200',
        patientId: 'patient-demo-001',
        items: [
          { itemId: 'ret-batch-200', quantity: 4 },
          { itemId: 'ret-plain-200', quantity: 5 },
        ],
      }, context);
      const [batchDi, plainDi] = db.prepare(
        'SELECT id FROM DispenseItem WHERE dispenseId = ? ORDER BY itemId',
      ).all(String(created.id)) as Array<{ id: string }>;
      await service().dispense(String(created.id), context, {
        items: [{ dispenseItemId: batchDi.id, batchId: 'ret-batch-200-b' }],
      });
      // 发药后：batch remaining 10->6，stock 50->46；plain stock 100->95
      expect(batchRemaining('ret-batch-200-b')).toBe(6);
      expect(stockOf('ret-batch-200')).toBe(46);
      expect(stockOf('ret-plain-200')).toBe(95);

      const result = await service().returnItems(String(created.id), {
        items: [
          { dispenseItemId: batchDi.id, quantity: 1 },
          { dispenseItemId: plainDi.id, quantity: 2 },
        ],
      }, context);
      expect(result.status).toBe('PARTIAL');
      expect(result.returnedAt).toBeNull();
      expect(result.items).toEqual([
        { dispenseItemId: batchDi.id, itemId: 'ret-batch-200', quantity: 1, batchId: 'ret-batch-200-b' },
        { dispenseItemId: plainDi.id, itemId: 'ret-plain-200', quantity: 2, batchId: null },
      ]);

      expect(batchRemaining('ret-batch-200-b')).toBe(7);
      expect(stockOf('ret-batch-200')).toBe(47);
      expect(stockOf('ret-plain-200')).toBe(97);
      const batchDiRow = db.prepare('SELECT returnedQuantity FROM DispenseItem WHERE id = ?').get(batchDi.id) as { returnedQuantity: number };
      expect(batchDiRow.returnedQuantity).toBe(1);
      const dispense = db.prepare('SELECT status, returnedAt FROM Dispense WHERE id = ?').get(String(created.id)) as Record<string, unknown>;
      expect(dispense.status).toBe('PARTIAL');
      expect(dispense.returnedAt).toBeNull();
      const inTxn = db.prepare(
        `SELECT type, quantity, beforeStock, afterStock, remark FROM InventoryTransaction
         WHERE itemId = 'ret-batch-200' AND type = 'IN'`,
      ).get() as Record<string, unknown>;
      expect(inTxn).toBeDefined();
      expect(inTxn.beforeStock).toBe(46);
      expect(inTxn.afterStock).toBe(47);
      expect(inTxn.remark).toBe('药房退药');
    });

    it('fully returns an order: RETURNED status + returnedAt', async () => {
      insertItem('ret-plain-201', 100, 0);
      const created = service().create({
        number: 'PF-201',
        patientId: 'patient-demo-001',
        items: [{ itemId: 'ret-plain-201', quantity: 5 }],
      }, context);
      await service().dispense(String(created.id), context);
      const di = db.prepare('SELECT id FROM DispenseItem WHERE dispenseId = ?').get(String(created.id)) as { id: string };
      const result = await service().returnItems(String(created.id), {
        items: [{ dispenseItemId: di.id, quantity: 5 }],
      }, context);
      expect(result.status).toBe('RETURNED');
      expect(result.returnedAt).toBe(now);
      const dispense = db.prepare('SELECT status, returnedAt FROM Dispense WHERE id = ?').get(String(created.id)) as Record<string, unknown>;
      expect(dispense.status).toBe('RETURNED');
      expect(dispense.returnedAt).toBe(now);
      expect(stockOf('ret-plain-201')).toBe(100);
    });

    it('rolls back the return when the referenced batch was deleted after dispense', async () => {
      insertItem('ret-batch-203', 50, 1);
      insertBatch('ret-batch-203-b', 'ret-batch-203', 10);
      const created = service().create({
        number: 'PF-203',
        patientId: 'patient-demo-001',
        items: [{ itemId: 'ret-batch-203', quantity: 4 }],
      }, context);
      const di = db.prepare('SELECT id FROM DispenseItem WHERE dispenseId = ?').get(String(created.id)) as { id: string };
      await service().dispense(String(created.id), context, {
        items: [{ dispenseItemId: di.id, batchId: 'ret-batch-203-b' }],
      });
      expect(stockOf('ret-batch-203')).toBe(46);

      // 模拟另一进程在发药后删除了该批次（remaining=0 时允许删除）。
      db.prepare('UPDATE InventoryBatch SET deletedAt = ? WHERE id = ?').run(now, 'ret-batch-203-b');

      await expect(service().returnItems(String(created.id), {
        items: [{ dispenseItemId: di.id, quantity: 1 }],
      }, context)).rejects.toThrow(ConflictError);
      expect(stockOf('ret-batch-203')).toBe(46);
      const diRow = db.prepare('SELECT returnedQuantity FROM DispenseItem WHERE id = ?').get(di.id) as { returnedQuantity: number };
      expect(diRow.returnedQuantity).toBe(0);
    });

    it('rejects over-return, unknown items, invalid quantities, and returns on PENDING orders', async () => {
      insertItem('ret-plain-202', 100, 0);
      const created = service().create({
        number: 'PF-202',
        patientId: 'patient-demo-001',
        items: [{ itemId: 'ret-plain-202', quantity: 5 }],
      }, context);
      const di = db.prepare('SELECT id FROM DispenseItem WHERE dispenseId = ?').get(String(created.id)) as { id: string };

      // PENDING 不能退药
      await expect(service().returnItems(String(created.id), {
        items: [{ dispenseItemId: di.id, quantity: 1 }],
      }, context)).rejects.toThrow(ConflictError);

      await service().dispense(String(created.id), context);
      // 超量退药
      await expect(service().returnItems(String(created.id), {
        items: [{ dispenseItemId: di.id, quantity: 6 }],
      }, context)).rejects.toThrow(ValidationError);
      // 非正整数
      await expect(service().returnItems(String(created.id), {
        items: [{ dispenseItemId: di.id, quantity: 0 }],
      }, context)).rejects.toThrow(ValidationError);
      // 超出数量上界
      await expect(service().returnItems(String(created.id), {
        items: [{ dispenseItemId: di.id, quantity: 1_000_000_001 }],
      }, context)).rejects.toThrow(ValidationError);
      // 明细不属于该发药单
      await expect(service().returnItems(String(created.id), {
        items: [{ dispenseItemId: 'di-missing', quantity: 1 }],
      }, context)).rejects.toThrow(NotFoundError);
      // 发药单不存在
      await expect(service().returnItems('dispense-missing', {
        items: [{ dispenseItemId: di.id, quantity: 1 }],
      }, context)).rejects.toThrow(NotFoundError);
    });
  });

  describe('update/delete dispense', () => {
    it('updates a PENDING dispense: reconciles items (update by id, insert new, soft-delete removed)', () => {
      insertItem('upd-plain-400', 100, 0);
      insertItem('upd-plain-401', 100, 0);
      const created = service().create({
        number: 'PF-400',
        patientId: 'patient-demo-001',
        note: '旧备注',
        items: [
          { itemId: 'upd-plain-400', quantity: 2 },
          { itemId: 'upd-plain-401', quantity: 3 },
        ],
      }, context);
      const rows = db.prepare(
        'SELECT id, itemId, quantity FROM DispenseItem WHERE dispenseId = ? AND deletedAt IS NULL ORDER BY createdAt ASC',
      ).all(String(created.id)) as Array<{ id: string; itemId: string; quantity: number }>;
      const [first, second] = rows;

      const result = service().updateDispense(String(created.id), {
        number: 'PF-400-U',
        patientId: 'patient-demo-001',
        note: '新备注',
        items: [
          { id: first.id, itemId: 'upd-plain-400', quantity: 5 },
          { itemId: 'upd-plain-401', quantity: 1, batchId: 'b-upd' },
        ],
      }, context);
      expect(result).toMatchObject({ id: String(created.id), number: 'PF-400-U', status: 'PENDING', items: 2 });

      const dispense = db.prepare('SELECT number, note, status FROM Dispense WHERE id = ?').get(String(created.id)) as Record<string, unknown>;
      expect(dispense.number).toBe('PF-400-U');
      expect(dispense.note).toBe('新备注');
      expect(dispense.status).toBe('PENDING');

      // first 行更新数量；second 行被软删；新行插入
      const firstRow = db.prepare('SELECT quantity, deletedAt FROM DispenseItem WHERE id = ?').get(first.id) as Record<string, unknown>;
      expect(firstRow.quantity).toBe(5);
      expect(firstRow.deletedAt).toBeNull();
      const secondRow = db.prepare('SELECT deletedAt FROM DispenseItem WHERE id = ?').get(second.id) as Record<string, unknown>;
      expect(secondRow.deletedAt).not.toBeNull();
      const active = db.prepare(
        'SELECT itemId, quantity, batchId, deletedAt FROM DispenseItem WHERE dispenseId = ? AND deletedAt IS NULL ORDER BY createdAt ASC',
      ).all(String(created.id)) as Array<{ itemId: string; quantity: number; batchId: string | null; deletedAt: string | null }>;
      expect(active).toEqual([
        { itemId: 'upd-plain-400', quantity: 5, batchId: null, deletedAt: null },
        { itemId: 'upd-plain-401', quantity: 1, batchId: 'b-upd', deletedAt: null },
      ]);
      // 库存未被改动（PENDING 编辑不扣库存）
      expect(stockOf('upd-plain-400')).toBe(100);
      expect(stockOf('upd-plain-401')).toBe(100);
    });

    it('rejects editing non-PENDING dispenses with ConflictError', async () => {
      insertItem('upd-plain-402', 100, 0);
      const created = service().create({
        number: 'PF-402',
        patientId: 'patient-demo-001',
        items: [{ itemId: 'upd-plain-402', quantity: 2 }],
      }, context);
      await service().dispense(String(created.id), context);
      expect(() => service().updateDispense(String(created.id), {
        number: 'PF-402-U',
        patientId: 'patient-demo-001',
        items: [{ itemId: 'upd-plain-402', quantity: 3 }],
      }, context)).toThrow(ConflictError);
      expect(() => service().updateDispense(String(created.id), {
        number: 'PF-402-U',
        patientId: 'patient-demo-001',
        items: [{ itemId: 'upd-plain-402', quantity: 3 }],
      }, context)).toThrow('仅待发药的发药单可编辑');
    });

    it('validates update input: number, patient, quantities, items, and item ownership', () => {
      insertItem('upd-plain-403', 100, 0);
      const created = service().create({
        number: 'PF-403',
        patientId: 'patient-demo-001',
        items: [{ itemId: 'upd-plain-403', quantity: 2 }],
      }, context);
      const di = db.prepare('SELECT id FROM DispenseItem WHERE dispenseId = ?').get(String(created.id)) as { id: string };
      const base = { patientId: 'patient-demo-001', items: [{ id: di.id, itemId: 'upd-plain-403', quantity: 2 }] };

      expect(() => service().updateDispense(String(created.id), { ...base, number: '  ' }, context)).toThrow(ValidationError);
      expect(() => service().updateDispense(String(created.id), { ...base, number: 'PF-403', patientId: 'patient-missing' }, context)).toThrow(NotFoundError);
      expect(() => service().updateDispense(String(created.id), {
        ...base, number: 'PF-403', items: [{ id: di.id, itemId: 'upd-plain-403', quantity: 0 }],
      }, context)).toThrow(ValidationError);
      expect(() => service().updateDispense(String(created.id), {
        ...base, number: 'PF-403', items: [{ id: di.id, itemId: 'item-missing', quantity: 1 }],
      }, context)).toThrow(NotFoundError);
      expect(() => service().updateDispense(String(created.id), {
        ...base, number: 'PF-403', items: [{ id: 'di-other', itemId: 'upd-plain-403', quantity: 1 }],
      }, context)).toThrow(NotFoundError);
      expect(() => service().updateDispense('dispense-missing', {
        number: 'PF-403', patientId: 'patient-demo-001', items: [{ itemId: 'upd-plain-403', quantity: 1 }],
      }, context)).toThrow(NotFoundError);
    });

    it('soft-deletes a PENDING dispense and its items; rejects others', () => {
      insertItem('upd-plain-404', 100, 0);
      const created = service().create({
        number: 'PF-404',
        patientId: 'patient-demo-001',
        items: [{ itemId: 'upd-plain-404', quantity: 2 }],
      }, context);
      const result = service().deleteDispense(String(created.id), context);
      expect(result).toEqual({ id: String(created.id), deleted: true });

      const dispense = db.prepare('SELECT deletedAt FROM Dispense WHERE id = ?').get(String(created.id)) as Record<string, unknown>;
      expect(dispense.deletedAt).not.toBeNull();
      const items = db.prepare('SELECT deletedAt FROM DispenseItem WHERE dispenseId = ?').all(String(created.id)) as Array<{ deletedAt: string | null }>;
      expect(items.every((row) => row.deletedAt !== null)).toBe(true);
      const listed = (service().list(context) as Array<Record<string, unknown>>).map((row) => String(row.id));
      expect(listed).not.toContain(String(created.id));
      expect(() => service().detail(String(created.id), context)).toThrow(NotFoundError);
      expect(() => service().deleteDispense('dispense-missing', context)).toThrow(NotFoundError);
    });

    it('rejects deleting non-PENDING dispenses with ConflictError', async () => {
      insertItem('upd-plain-405', 100, 0);
      const created = service().create({
        number: 'PF-405',
        patientId: 'patient-demo-001',
        items: [{ itemId: 'upd-plain-405', quantity: 2 }],
      }, context);
      await service().dispense(String(created.id), context);
      expect(() => service().deleteDispense(String(created.id), context)).toThrow(ConflictError);
      expect(() => service().deleteDispense(String(created.id), context)).toThrow('仅待发药的发药单可删除');
    });
  });

  describe('list/detail', () => {
    it('lists dispenses with patient/pharmacist names and itemsCount, and filters by status', async () => {
      insertItem('list-item-300', 100, 0);
      const created = service().create({
        number: 'PF-300',
        patientId: 'patient-demo-001',
        items: [{ itemId: 'list-item-300', quantity: 2 }],
      }, context);
      await service().dispense(String(created.id), context);

      const all = service().list(context) as Array<Record<string, unknown>>;
      const row = all.find((entry) => entry.id === created.id);
      expect(row).toBeDefined();
      expect(row?.number).toBe('PF-300');
      expect(row?.patientName).toBe('Demo Patient');
      expect(row?.patientPhone).toBe('13800000000');
      expect(row?.pharmacistName).toBe('System Administrator');
      expect(row?.itemsCount).toBe(1);

      const pending = service().list(context, { status: 'PENDING' }) as Array<Record<string, unknown>>;
      expect(pending.map((entry) => entry.id)).not.toContain(created.id);
      const dispensed = service().list(context, { status: 'DISPENSED' }) as Array<Record<string, unknown>>;
      expect(dispensed.map((entry) => entry.id)).toContain(created.id);
      expect(() => service().list(context, { status: 'BOGUS' })).toThrow(ValidationError);
    });

    it('returns detail with items; missing dispense throws NotFoundError', async () => {
      const created = service().create({
        number: 'PF-301',
        patientId: 'patient-demo-001',
        items: [{ itemId: 'inventory-demo-001', quantity: 2 }],
      }, context);
      const detail = service().detail(String(created.id), context);
      expect(detail.number).toBe('PF-301');
      expect(detail.status).toBe('PENDING');
      const items = detail.items as Array<Record<string, unknown>>;
      expect(items).toHaveLength(1);
      expect(items[0].name).toBe('Dental Material');
      expect(items[0].itemCode).toBe('MAT-001');
      expect(items[0].quantity).toBe(2);
      expect(items[0].returnedQuantity).toBe(0);
      expect(() => service().detail('dispense-missing', context)).toThrow(NotFoundError);
    });
  });

  describe('tenant isolation', () => {
    it('excludes other-clinic dispenses from list and detail', async () => {
      db.prepare(
        `INSERT INTO Dispense (
           id, number, chargeId, prescriptionId, patientId, doctorId, pharmacistId,
           status, dispensedAt, returnedAt, note, clinicId, createdAt, updatedAt, deletedAt
         ) VALUES (?, 'PF-OTHER', NULL, NULL, 'patient-demo-001', NULL, NULL,
                   'PENDING', NULL, NULL, NULL, 'clinic-other', ?, ?, NULL)`,
      ).run('dispense-other-001', now, now);

      const ids = (service().list(context) as Array<Record<string, unknown>>).map((entry) => String(entry.id));
      expect(ids).not.toContain('dispense-other-001');
      expect(() => service().detail('dispense-other-001', context)).toThrow(NotFoundError);
      await expect(service().dispense('dispense-other-001', context)).rejects.toThrow(NotFoundError);

      // 他租户上下文（clinic-other）能看到自己的单子
      const otherContext: AppContext = {
        userId: 'user-other-001',
        clinicId: 'clinic-other',
        role: 'BOSS',
        traceId: 'trace-other',
        now: () => new Date(now),
      };
      const otherIds = (service().list(otherContext) as Array<Record<string, unknown>>).map((entry) => String(entry.id));
      expect(otherIds).toContain('dispense-other-001');
    });
  });

  describe('validation coverage', () => {
    it('rejects missing prescriptions, malformed doctors, and oversized quantities', () => {
      const base = {
        patientId: 'patient-demo-001',
        items: [{ itemId: 'inventory-demo-001', quantity: 1 }],
      };
      expect(() => service().create({ ...base, number: 'PF-500', prescriptionId: 'missing-pres' }, context)).toThrow(NotFoundError);
      expect(() => service().create({ ...base, number: 'PF-501', doctorId: 123 as unknown as string }, context)).toThrow(NotFoundError);
      expect(() => service().create({
        ...base,
        number: 'PF-502',
        items: [{ itemId: 'inventory-demo-001', quantity: 1_000_000_001 }],
      }, context)).toThrow(ValidationError);
      expect(() => service().create({
        ...base,
        number: 'PF-503',
        items: [
          { itemId: 'inventory-demo-001', quantity: 600_000_000 },
          { itemId: 'inventory-demo-001', quantity: 600_000_000 },
        ],
      }, context)).toThrow(ValidationError);
    });

    it('rejects invalid pagination and update shapes', () => {
      expect(() => service().list(context, { page: 0 })).toThrow(ValidationError);
      expect(() => service().list(context, { pageSize: 0 })).toThrow(ValidationError);

      const created = service().create({
        number: 'PF-504',
        patientId: 'patient-demo-001',
        items: [{ itemId: 'inventory-demo-001', quantity: 1 }],
      }, context);
      expect(() => service().updateDispense(String(created.id), {
        number: 'PF-504-U',
        patientId: '',
        items: [],
      }, context)).toThrow(ValidationError);

      const manyItems = Array.from({ length: 201 }, () => ({ itemId: 'inventory-demo-001', quantity: 1 }));
      expect(() => service().updateDispense(String(created.id), {
        number: 'PF-504-U',
        patientId: 'patient-demo-001',
        items: manyItems,
      }, context)).toThrow(ValidationError);

      expect(() => service().updateDispense(String(created.id), {
        number: 'PF-504-U',
        patientId: 'patient-demo-001',
        items: [{ quantity: 1 } as unknown as { itemId: string; quantity: number }],
      }, context)).toThrow(ValidationError);

      expect(() => service().updateDispense(String(created.id), {
        number: 'PF-504-U',
        patientId: 'patient-demo-001',
        items: [
          { itemId: 'inventory-demo-001', quantity: 600_000_000 },
          { itemId: 'inventory-demo-001', quantity: 600_000_000 },
        ],
      }, context)).toThrow(ValidationError);
    });

    it('reports duplicate dispense numbers as conflicts', () => {
      service().create({
        number: 'PF-505',
        patientId: 'patient-demo-001',
        items: [{ itemId: 'inventory-demo-001', quantity: 1 }],
      }, context);
      expect(() => service().create({
        number: 'PF-505',
        patientId: 'patient-demo-001',
        items: [{ itemId: 'inventory-demo-001', quantity: 1 }],
      }, context)).toThrow(ConflictError);
    });

    it('rejects malformed dispense assignments and return inputs', async () => {
      insertItem('validation-assign-item', 100, 0);
      const created = service().create({
        number: 'PF-506',
        patientId: 'patient-demo-001',
        items: [{ itemId: 'validation-assign-item', quantity: 2 }],
      }, context);
      await expect(service().dispense(String(created.id), context, { items: 'bad' as never })).rejects.toThrow(ValidationError);
      await service().dispense(String(created.id), context);

      await expect(service().returnItems(String(created.id), { items: [] }, context)).rejects.toThrow(ValidationError);
      await expect(service().returnItems(String(created.id), {
        items: [{ quantity: 1 } as never],
      }, context)).rejects.toThrow(ValidationError);
      await expect(service().returnItems(String(created.id), {
        items: [{ dispenseItemId: firstItemId(String(created.id)), quantity: 1_000_000_001 }],
      }, context)).rejects.toThrow(ValidationError);
    });

    it('rejects insufficient stock and empty item lists during dispense', async () => {
      insertItem('validation-no-stock', 0, 0);
      const noStock = service().create({
        number: 'PF-507',
        patientId: 'patient-demo-001',
        items: [{ itemId: 'validation-no-stock', quantity: 1 }],
      }, context);
      await expect(service().dispense(String(noStock.id), context)).rejects.toThrow(ConflictError);

      insertItem('validation-empty-item', 100, 0);
      const empty = service().create({
        number: 'PF-508',
        patientId: 'patient-demo-001',
        items: [{ itemId: 'validation-empty-item', quantity: 1 }],
      }, context);
      db.prepare('UPDATE DispenseItem SET deletedAt = ? WHERE dispenseId = ?').run(now, String(empty.id));
      await expect(service().dispense(String(empty.id), context)).rejects.toThrow(ValidationError);
    });
  });
});
