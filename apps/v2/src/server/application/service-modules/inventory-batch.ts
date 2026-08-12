import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { ConflictError, NotFoundError, ValidationError } from '../../infrastructure/errors';
import { SystemClock } from '../../infrastructure/clock';
import { tenantAnd, tenantParams, tenantWhere } from '../../infrastructure/tenant';
import { addInventoryStock, deductInventoryStock, inventoryStockAfter, recordInventoryTransaction } from './inventory-ledger';
import type { AppContext } from '../../../domain/contracts';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface InventoryBatchRow {
  id: string;
  itemId: string;
  batchNo: string | null;
  productionDate: string | null;
  expiryDate: string | null;
  initialQuantity: number;
  remainingQuantity: number;
  supplierId: string | null;
  purchaseOrderId: string | null;
  active: number;
  clinicId: string | null;
  createdAt: string;
  updatedAt: string;
  itemName: string | null;
  itemCode: string | null;
  itemSpec: string | null;
}

export interface BatchCreateInput {
  itemId: string;
  batchNo?: string;
  productionDate?: string;
  expiryDate?: string;
  initialQuantity: number;
  supplierId?: string;
  purchaseOrderId?: string;
}

/** 编辑批次元信息：字段缺省表示不修改；空字符串/null 表示清空。数量不可在此修改（走 adjust）。 */
export interface BatchUpdateInput {
  batchNo?: string;
  productionDate?: string;
  expiryDate?: string;
  supplierId?: string;
}

/**
 * 批次管理 + 效期提醒。
 *
 * - 所有读写均按 context.clinicId 做租户过滤；
 * - create 可注入 lockGuard（盘点锁定守卫），由调用方集成时传入；
 * - FIFO 出库只扣批次剩余量，不直接改 InventoryItem.stock（库存流水由调用方落）。
 */
export class InventoryBatchService {
  constructor(
    private readonly db: Database.Database,
    private readonly lockGuard?: (itemId: string, clinicId?: string | null) => void,
  ) {}

  /** 该租户的启用批次（含 item name/code/spec），以及 days 天内到期的子集。 */
  list(context: AppContext, filter?: { itemId?: string; days?: number }): { batches: InventoryBatchRow[]; expiring: InventoryBatchRow[] } {
    const days = normalizeDays(filter?.days);
    const conditions = ['B.deletedAt IS NULL', 'B.active = 1'];
    const params: Array<string | number | null> = [];
    if (filter?.itemId) {
      conditions.push('B.itemId = ?');
      params.push(filter.itemId);
    }
    const tenant = tenantWhere(context.clinicId, 'B.clinicId');
    const sql = `
      SELECT B.id, B.itemId, B.batchNo, B.productionDate, B.expiryDate,
             B.initialQuantity, B.remainingQuantity, B.supplierId, B.purchaseOrderId,
             B.active, B.clinicId, B.createdAt, B.updatedAt,
             I.name AS itemName, I.code AS itemCode, I.spec AS itemSpec
      FROM InventoryBatch B
      INNER JOIN InventoryItem I ON I.id = B.itemId AND I.deletedAt IS NULL
      WHERE ${conditions.join(' AND ')}${tenant.sql ? ` AND ${tenant.sql}` : ''}
      ORDER BY B.expiryDate ASC, B.createdAt DESC
    `;
    const batches = this.db.prepare(sql).all(...params, ...tenant.params) as InventoryBatchRow[];
    const now = context.now();
    const today = new SystemClock().clinicDate(now);
    const cutoff = new SystemClock().clinicDate(new Date(now.getTime() + days * 86_400_000));
    const expiring = batches.filter((batch) => {
      const expiry = batch.expiryDate;
      if (!expiry) return false;
      return expiry >= today && expiry <= cutoff && Number(batch.remainingQuantity) > 0;
    });
    return { batches, expiring };
  }

  /** 新建批次：批次入库并同步增加物料库存，落一条 IN 流水（事务）。 */
  create(input: BatchCreateInput, context: AppContext): { id: string; batchNo: string | null; remainingQuantity: number; stockAfter: number } {
    this.lockGuard?.(input.itemId, context.clinicId);
    const quantity = Number(input.initialQuantity);
    if (!Number.isSafeInteger(quantity) || quantity < 0) {
      throw new ValidationError('入库数量必须为非负整数');
    }
    if (input.expiryDate !== undefined && input.expiryDate !== null && input.expiryDate !== '') {
      if (typeof input.expiryDate !== 'string' || !DATE_RE.test(input.expiryDate)) {
        throw new ValidationError('效期日期格式应为 YYYY-MM-DD');
      }
    }
    if (input.productionDate !== undefined && input.productionDate !== null && input.productionDate !== '') {
      if (typeof input.productionDate !== 'string' || !DATE_RE.test(input.productionDate)) {
        throw new ValidationError('生产日期格式应为 YYYY-MM-DD');
      }
    }
    const item = this.db.prepare(
      `SELECT id, name, batchManaged, stock FROM InventoryItem
       WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).get(input.itemId, ...tenantParams(context.clinicId)) as
      | { id: string; name: string; batchManaged: number; stock: number }
      | undefined;
    if (!item) throw new NotFoundError('Inventory item not found');
    const now = context.now().toISOString();
    const id = randomUUID();
    const batchNo = typeof input.batchNo === 'string' && input.batchNo.trim() ? input.batchNo.trim() : null;
    let stockAfter = Number(item.stock ?? 0);
    const run = this.db.transaction(() => {
      this.db.prepare(
        `INSERT INTO InventoryBatch (
           id, itemId, batchNo, productionDate, expiryDate, initialQuantity,
           remainingQuantity, supplierId, purchaseOrderId, active, clinicId,
           createdAt, updatedAt, deletedAt
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, NULL)`,
      ).run(
        id, input.itemId, batchNo,
        input.productionDate && input.productionDate !== '' ? input.productionDate : null,
        input.expiryDate && input.expiryDate !== '' ? input.expiryDate : null,
        quantity, quantity,
        input.supplierId ?? null, input.purchaseOrderId ?? null,
        context.clinicId ?? null, now, now,
      );
      if (quantity > 0) {
        addInventoryStock(this.db, input.itemId, quantity, now, context.clinicId);
        const afterRow = this.db.prepare(
          `SELECT stock FROM InventoryItem WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
        ).get(input.itemId, ...tenantParams(context.clinicId)) as { stock: number } | undefined;
        stockAfter = Number(afterRow?.stock ?? 0);
        const beforeStock = stockAfter - quantity;
        recordInventoryTransaction(this.db, {
          id: randomUUID(),
          clinicId: context.clinicId ?? null,
          itemId: input.itemId,
          type: 'IN',
          quantity,
          beforeStock,
          afterStock: stockAfter,
          operatorId: context.userId,
          remark: '批次入库',
          createdAt: now,
          updatedAt: now,
          batchId: id,
        });
      }
    });
    run();
    return { id, batchNo, remainingQuantity: quantity, stockAfter };
  }

  /** 修正批次剩余量（盘点/纠错），仅限 active 批次。 */
  adjust(id: string, input: { remainingQuantity: number; note?: string }, context: AppContext): { id: string; remainingQuantity: number } {
    const quantity = Number(input.remainingQuantity);
    if (!Number.isSafeInteger(quantity) || quantity < 0) {
      throw new ValidationError('剩余数量必须为非负整数');
    }
    const row = this.db.prepare(
      `SELECT id, itemId FROM InventoryBatch WHERE id = ? AND deletedAt IS NULL AND active = 1${tenantAnd(context.clinicId)}`,
    ).get(id, ...tenantParams(context.clinicId)) as { id: string; itemId: string } | undefined;
    if (!row) throw new NotFoundError('Inventory batch not found');
    this.lockGuard?.(row.itemId, context.clinicId);
    const now = context.now().toISOString();
    const result = this.db.prepare(
      `UPDATE InventoryBatch SET remainingQuantity = ?, updatedAt = ?
       WHERE id = ? AND deletedAt IS NULL AND active = 1${tenantAnd(context.clinicId)}`,
    ).run(quantity, now, id, ...tenantParams(context.clinicId));
    if (Number(result.changes) === 0) throw new NotFoundError('Inventory batch not found');
    return { id, remainingQuantity: quantity };
  }

  /**
   * 编辑批次元信息（batchNo/productionDate/expiryDate/supplierId）。
   * 字段缺省表示不修改；空字符串/null 表示清空。数量（initial/remaining）不可在此修改，走 adjust。
   */
  update(id: string, input: BatchUpdateInput, context: AppContext): {
    id: string;
    batchNo: string | null;
    productionDate: string | null;
    expiryDate: string | null;
    supplierId: string | null;
  } {
    if (input.expiryDate !== undefined && input.expiryDate !== null && input.expiryDate !== '') {
      if (typeof input.expiryDate !== 'string' || !DATE_RE.test(input.expiryDate)) {
        throw new ValidationError('效期日期格式应为 YYYY-MM-DD');
      }
    }
    if (input.productionDate !== undefined && input.productionDate !== null && input.productionDate !== '') {
      if (typeof input.productionDate !== 'string' || !DATE_RE.test(input.productionDate)) {
        throw new ValidationError('生产日期格式应为 YYYY-MM-DD');
      }
    }
    const row = this.db.prepare(
      `SELECT id, batchNo, productionDate, expiryDate, supplierId
       FROM InventoryBatch WHERE id = ? AND deletedAt IS NULL AND active = 1${tenantAnd(context.clinicId)}`,
    ).get(id, ...tenantParams(context.clinicId)) as
      | { id: string; batchNo: string | null; productionDate: string | null; expiryDate: string | null; supplierId: string | null }
      | undefined;
    if (!row) throw new NotFoundError('Inventory batch not found');
    const now = context.now().toISOString();
    const sets: string[] = [];
    const values: Array<string | null> = [];
    if (input.batchNo !== undefined) {
      sets.push('batchNo = ?');
      values.push(typeof input.batchNo === 'string' && input.batchNo.trim() ? input.batchNo.trim() : null);
    }
    if (input.productionDate !== undefined) {
      sets.push('productionDate = ?');
      values.push(input.productionDate && input.productionDate !== '' ? input.productionDate : null);
    }
    if (input.expiryDate !== undefined) {
      sets.push('expiryDate = ?');
      values.push(input.expiryDate && input.expiryDate !== '' ? input.expiryDate : null);
    }
    if (input.supplierId !== undefined) {
      sets.push('supplierId = ?');
      values.push(typeof input.supplierId === 'string' && input.supplierId.trim() ? input.supplierId.trim() : null);
    }
    sets.push('updatedAt = ?');
    values.push(now);
    const result = this.db.prepare(
      `UPDATE InventoryBatch SET ${sets.join(', ')}
       WHERE id = ? AND deletedAt IS NULL AND active = 1${tenantAnd(context.clinicId)}`,
    ).run(...values, id, ...tenantParams(context.clinicId));
    if (Number(result.changes) === 0) throw new NotFoundError('Inventory batch not found');
    return {
      id,
      batchNo: input.batchNo !== undefined
        ? (typeof input.batchNo === 'string' && input.batchNo.trim() ? input.batchNo.trim() : null)
        : row.batchNo,
      productionDate: input.productionDate !== undefined
        ? (input.productionDate && input.productionDate !== '' ? input.productionDate : null)
        : row.productionDate,
      expiryDate: input.expiryDate !== undefined
        ? (input.expiryDate && input.expiryDate !== '' ? input.expiryDate : null)
        : row.expiryDate,
      supplierId: input.supplierId !== undefined
        ? (typeof input.supplierId === 'string' && input.supplierId.trim() ? input.supplierId.trim() : null)
        : row.supplierId,
    };
  }

  /**
   * 软删批次：仅当剩余量为 0 时允许（deletedAt + active=0），避免破坏库存一致性。
   */
  remove(id: string, context: AppContext): { id: string } {
    const row = this.db.prepare(
      `SELECT id, remainingQuantity FROM InventoryBatch
       WHERE id = ? AND deletedAt IS NULL AND active = 1${tenantAnd(context.clinicId)}`,
    ).get(id, ...tenantParams(context.clinicId)) as { id: string; remainingQuantity: number } | undefined;
    if (!row) throw new NotFoundError('Inventory batch not found');
    if (Number(row.remainingQuantity) > 0) {
      throw new ConflictError('批次仍有剩余库存，不能删除');
    }
    const now = context.now().toISOString();
    const result = this.db.prepare(
      `UPDATE InventoryBatch SET deletedAt = ?, active = 0, updatedAt = ?
       WHERE id = ? AND deletedAt IS NULL AND active = 1${tenantAnd(context.clinicId)}`,
    ).run(now, now, id, ...tenantParams(context.clinicId));
    if (Number(result.changes) === 0) throw new NotFoundError('Inventory batch not found');
    return { id };
  }

  /** FIFO 出库：按效期从早到晚逐批扣减，超量整体回滚。 */
  consumeFifo(itemId: string, quantity: number, context: AppContext): { allocations: Array<{ batchId: string; quantity: number }>; itemId: string } {
    const qty = Number(quantity);
    if (!Number.isSafeInteger(qty) || qty <= 0) {
      throw new ValidationError('出库数量必须为正整数');
    }
    if (qty > 1_000_000_000) {
      throw new ValidationError('出库数量超出上限');
    }
    const item = this.db.prepare(
      `SELECT id, batchManaged FROM InventoryItem WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).get(itemId, ...tenantParams(context.clinicId)) as { id: string; batchManaged: number } | undefined;
    if (!item) throw new NotFoundError('Inventory item not found');
    if (Number(item.batchManaged) !== 1) {
      throw new ValidationError('该物料未启用批次管理');
    }
    const batches = this.db.prepare(
      `SELECT id, remainingQuantity FROM InventoryBatch
       WHERE itemId = ? AND deletedAt IS NULL AND active = 1 AND remainingQuantity > 0${tenantAnd(context.clinicId)}
       ORDER BY (expiryDate IS NULL OR expiryDate = '') ASC, expiryDate ASC, createdAt ASC`,
    ).all(itemId, ...tenantParams(context.clinicId)) as Array<{ id: string; remainingQuantity: number }>;
    const now = context.now().toISOString();
    let remaining = qty;
    const allocations: Array<{ batchId: string; quantity: number }> = [];
    const run = this.db.transaction(() => {
      this.lockGuard?.(itemId, context.clinicId);
      for (const batch of batches) {
        if (remaining <= 0) break;
        const fresh = this.db.prepare(
          `SELECT remainingQuantity FROM InventoryBatch
           WHERE id = ? AND itemId = ? AND deletedAt IS NULL AND active = 1${tenantAnd(context.clinicId)}`,
        ).get(batch.id, itemId, ...tenantParams(context.clinicId)) as { remainingQuantity: number } | undefined;
        if (!fresh) throw new ConflictError('批次不存在或不属于该物品');
        const available = Number(fresh.remainingQuantity ?? 0);
        if (available <= 0) continue;
        const take = Math.min(available, remaining);
        const result = this.db.prepare(
          `UPDATE InventoryBatch SET remainingQuantity = remainingQuantity - ?, updatedAt = ?
           WHERE id = ? AND itemId = ? AND deletedAt IS NULL AND active = 1 AND remainingQuantity >= ?${tenantAnd(context.clinicId)}`,
        ).run(take, now, batch.id, itemId, take, ...tenantParams(context.clinicId));
        if (result.changes === 0) throw new ConflictError('批次库存不足');
        allocations.push({ batchId: batch.id, quantity: take });
        remaining -= take;
      }
      if (remaining > 0) {
        throw new ConflictError('批次库存不足');
      }
      const beforeStock = inventoryStockAfter(this.db, itemId, context.clinicId);
      deductInventoryStock(this.db, itemId, qty, now, context.clinicId);
      const afterStock = inventoryStockAfter(this.db, itemId, context.clinicId);
      recordInventoryTransaction(this.db, {
        id: randomUUID(),
        clinicId: context.clinicId ?? null,
        itemId,
        type: 'OUT',
        quantity: qty,
        beforeStock,
        afterStock,
        operatorId: context.userId,
        remark: '批次 FIFO 出库',
        createdAt: now,
        updatedAt: now,
        referenceType: 'INVENTORY_BATCH',
        referenceId: allocations.map((allocation) => allocation.batchId).join(','),
        batchId: null,
      });
    });
    run();
    return { allocations, itemId };
  }

  /** 为 days 天内到期且有剩余量的批次生成效期提醒（按批次去重，重复调用不重复生成）。 */
  generateExpiryAlerts(days = 30, context: AppContext): { generated: number; total: number } {
    const normalizedDays = normalizeDays(days);
    const { expiring } = this.list(context, { days: normalizedDays });
    const now = context.now().toISOString();
    let generated = 0;
    const run = this.db.transaction(() => {
      for (const batch of expiring) {
        const batchId = batch.id;
        const existing = this.db.prepare(
          `SELECT 1 FROM BusinessAlert
           WHERE alertType = 'BATCH_EXPIRY' AND metricName = ? AND status = 'OPEN' AND deletedAt IS NULL${tenantAnd(context.clinicId)}
           LIMIT 1`,
        ).get(batchId, ...tenantParams(context.clinicId));
        if (existing) continue;
        const message = [
          `物料 ${batch.itemName ?? batch.itemCode ?? batch.itemId}`,
          batch.batchNo ? `批次 ${batch.batchNo}` : '无批次号',
          batch.expiryDate ? `将于 ${batch.expiryDate} 到期` : '无效期',
          `剩余 ${Number(batch.remainingQuantity)}`,
        ].join('，') + '。';
        this.db.prepare(
          `INSERT INTO BusinessAlert (
             id, clinicId, alertType, severity, metricName, currentValue,
             baselineValue, deviationPercent, message, suggestion, acknowledged,
             acknowledgedAt, acknowledgedBy, occurredAt, level, title, source,
             status, createdAt, updatedAt, deletedAt
           ) VALUES (?, ?, 'BATCH_EXPIRY', 'WARN', ?, 0, 0, 0, ?, NULL, 0, NULL, NULL, ?, 'WARNING', '批次临近效期', 'inventory-batch', 'OPEN', ?, ?, NULL)`,
        ).run(randomUUID(), context.clinicId ?? null, batchId, message, now, now, now);
        generated += 1;
      }
    });
    run();
    return { generated, total: expiring.length };
  }
}

function normalizeDays(days: number | undefined): number {
  const value = Number(days);
  if (!Number.isFinite(value)) return 30;
  // 上限 1..3650：超大值会造成无效的全表范围扫描（与 workflow expiring 路由一致）
  return Math.min(Math.max(Math.floor(value), 1), 3650);
}
