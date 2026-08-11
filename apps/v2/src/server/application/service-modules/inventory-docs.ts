import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { ConflictError, NotFoundError, ValidationError } from '../../infrastructure/errors';
import { tenantAnd, tenantParams } from '../../infrastructure/tenant';
import { addInventoryStock, deductInventoryStock, inventoryStockAfter, recordInventoryTransaction } from './inventory-ledger';
import { generateDocumentNumber } from './common';
import type { AppContext } from '../../../domain/contracts';

interface ReturnSupplierItemInput {
  itemId: string;
  quantity: number;
  unitPrice?: number;
  remark?: string;
}

export interface ReturnSupplierInput {
  supplierId: string;
  items: Array<ReturnSupplierItemInput>;
  remark?: string;
}

interface LossItemInput {
  itemId: string;
  quantity: number;
  remark?: string;
}

export interface LossInput {
  items: Array<LossItemInput>;
  remark?: string;
}

interface TransferItemInput {
  fromItemId: string;
  toItemId: string;
  quantity: number;
  remark?: string;
}

export interface TransferInput {
  items: Array<TransferItemInput>;
  remark?: string;
}

interface ItemStockRow {
  id: string;
  stock: number;
}

function positiveQuantity(value: unknown): number {
  const quantity = Number(value);
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new ValidationError('数量必须为正整数');
  }
  return quantity;
}

/**
 * 库存独立单据：退回厂商 / 库损 / 调拨。
 *
 * 三个入口都以事务方式完成：写 InventoryDoc + InventoryDocItem 单据，
 * 逐条落 InventoryTransaction 流水（referenceType 标识单据类型），并同步
 * InventoryItem.stock。所有 SQL 均按 context.clinicId 做租户过滤。
 */
export class InventoryDocService {
  constructor(
    private readonly db: Database.Database,
    private readonly lockGuard?: (itemId: string, clinicId?: string | null) => void,
  ) {}

  /** 退回厂商：校验供应商与每件物料库存，出库并落 RETURN_SUPPLIER 流水。 */
  createReturnSupplier(input: ReturnSupplierInput, context: AppContext): Record<string, unknown> {
    if (!input || typeof input.supplierId !== 'string' || input.supplierId.trim() === '') {
      throw new ValidationError('供应商不能为空');
    }
    const items = this.normalizeItems(input.items);
    const clinicId = context.clinicId;

    const supplier = this.db.prepare(
      `SELECT id FROM Supplier WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`,
    ).get(input.supplierId, ...tenantParams(clinicId));
    if (!supplier) throw new NotFoundError('供应商不存在');

    items.forEach((entry) => this.requireItemWithStock(entry.itemId, entry.quantity, context));
    const now = context.now().toISOString();
    const docId = randomUUID();
    const number = generateDocumentNumber('RTS');

    const run = this.db.transaction(() => {
      this.insertDoc(docId, number, 'RETURN_SUPPLIER', input.supplierId, now, input.remark, context);
      for (let index = 0; index < items.length; index += 1) {
        const entry = items[index];
        this.lockGuard?.(entry.itemId, context.clinicId);
        this.insertDocItem(docId, entry.itemId, null, entry.quantity, entry.unitPrice, entry.remark, context);
        deductInventoryStock(this.db, entry.itemId, entry.quantity, now, context.clinicId, `库存不足：${entry.itemId}`);
        const after = inventoryStockAfter(this.db, entry.itemId, context.clinicId);
        this.insertTransaction(entry.itemId, 'OUT', entry.quantity, after + entry.quantity, after, 'RETURN_SUPPLIER', docId, '退回厂商', context);
      }
    });
    run();
    return this.loadDoc(docId);
  }

  /** 库损：校验物料库存，出库并落 LOSS 流水。 */
  createLoss(input: LossInput, context: AppContext): Record<string, unknown> {
    const items = this.normalizeItems(input.items);
    items.forEach((entry) => this.requireItemWithStock(entry.itemId, entry.quantity, context));
    const now = context.now().toISOString();
    const docId = randomUUID();
    const number = generateDocumentNumber('LSS');

    const run = this.db.transaction(() => {
      this.insertDoc(docId, number, 'LOSS', null, now, input.remark, context);
      for (let index = 0; index < items.length; index += 1) {
        const entry = items[index];
        this.lockGuard?.(entry.itemId, context.clinicId);
        this.insertDocItem(docId, entry.itemId, null, entry.quantity, undefined, entry.remark, context);
        deductInventoryStock(this.db, entry.itemId, entry.quantity, now, context.clinicId, `库存不足：${entry.itemId}`);
        const after = inventoryStockAfter(this.db, entry.itemId, context.clinicId);
        this.insertTransaction(entry.itemId, 'OUT', entry.quantity, after + entry.quantity, after, 'LOSS', docId, '库损', context);
      }
    });
    run();
    return this.loadDoc(docId);
  }

  /** 调拨：来源扣减（TRANSFER 出库）、去向回补（TRANSFER 入库），同一单据两条流水。 */
  createTransfer(input: TransferInput, context: AppContext): Record<string, unknown> {
    if (!input || !Array.isArray(input.items) || input.items.length < 1 || input.items.length > 200) {
      throw new ValidationError('调拨明细需包含 1 至 200 条');
    }
    const items = input.items.map((entry) => {
      const fromItemId = typeof entry?.fromItemId === 'string' ? entry.fromItemId : '';
      const toItemId = typeof entry?.toItemId === 'string' ? entry.toItemId : '';
      if (!fromItemId || !toItemId) throw new ValidationError('调拨明细必须指定来源与去向物料');
      return {
        fromItemId,
        toItemId,
        quantity: positiveQuantity(entry.quantity),
        remark: typeof entry.remark === 'string' && entry.remark.trim() ? entry.remark.trim() : null,
      };
    });

    items.forEach((entry) => this.requireItemWithStock(entry.fromItemId, entry.quantity, context));
    items.forEach((entry) => this.requireItem(entry.toItemId, context));
    const now = context.now().toISOString();
    const docId = randomUUID();
    const number = generateDocumentNumber('TRF');

    const run = this.db.transaction(() => {
      this.insertDoc(docId, number, 'TRANSFER', null, now, input.remark, context);
      for (let index = 0; index < items.length; index += 1) {
        const entry = items[index];
        if (entry.fromItemId === entry.toItemId) {
          throw new ValidationError('Transfer source and destination must be different items');
        }
        this.lockGuard?.(entry.fromItemId, context.clinicId);
        this.lockGuard?.(entry.toItemId, context.clinicId);
        this.insertDocItem(docId, entry.fromItemId, entry.toItemId, entry.quantity, undefined, entry.remark, context);
        deductInventoryStock(this.db, entry.fromItemId, entry.quantity, now, context.clinicId, `库存不足：${entry.fromItemId}`);
        addInventoryStock(this.db, entry.toItemId, entry.quantity, now, context.clinicId);
        const fromAfter = inventoryStockAfter(this.db, entry.fromItemId, context.clinicId);
        const toAfter = inventoryStockAfter(this.db, entry.toItemId, context.clinicId);
        this.insertTransaction(entry.fromItemId, 'OUT', entry.quantity, fromAfter + entry.quantity, fromAfter, 'TRANSFER', docId, '调拨出库', context);
        this.insertTransaction(entry.toItemId, 'IN', entry.quantity, toAfter - entry.quantity, toAfter, 'TRANSFER', docId, '调拨入库', context);
      }
    });
    run();
    return this.loadDoc(docId);
  }

  private normalizeItems(items: Array<{ itemId: string; quantity: number; unitPrice?: number; remark?: string }>): Array<{
    itemId: string;
    quantity: number;
    unitPrice: number | null;
    remark: string | null;
  }> {
    if (!Array.isArray(items) || items.length < 1 || items.length > 200) {
      throw new ValidationError('单据明细需包含 1 至 200 条');
    }
    return items.map((entry) => {
      if (!entry || typeof entry.itemId !== 'string' || entry.itemId.trim() === '') {
        throw new ValidationError('明细必须指定物料');
      }
      return {
        itemId: entry.itemId,
        quantity: positiveQuantity(entry.quantity),
        unitPrice: typeof entry.unitPrice === 'number' && Number.isFinite(entry.unitPrice) ? entry.unitPrice : null,
        remark: typeof entry.remark === 'string' && entry.remark.trim() ? entry.remark.trim() : null,
      };
    });
  }

  private requireItem(itemId: string, context: AppContext): ItemStockRow {
    const row = this.db.prepare(
      `SELECT id, stock FROM InventoryItem WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).get(itemId, ...tenantParams(context.clinicId)) as ItemStockRow | undefined;
    if (!row) throw new NotFoundError('库存物料不存在');
    return row;
  }

  private requireItemWithStock(itemId: string, quantity: number, context: AppContext): ItemStockRow {
    const row = this.requireItem(itemId, context);
    if (Number(row.stock ?? 0) < quantity) {
      throw new ConflictError(`库存不足：${itemId} 当前库存 ${Number(row.stock ?? 0)}，需要 ${quantity}`);
    }
    return row;
  }

  private insertDoc(docId: string, number: string, type: string, supplierId: string | null, now: string, remark: string | undefined, context: AppContext): void {
    this.db.prepare(
      `INSERT INTO InventoryDoc (
         id, clinicId, createdAt, updatedAt, deletedAt, number, type,
         supplierId, status, operatorId, operatorName, completedAt, remark
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 'COMPLETED', ?, NULL, ?, ?)`,
    ).run(
      docId, context.clinicId ?? null, now, now, number, type,
      supplierId, context.userId, now,
      typeof remark === 'string' && remark.trim() ? remark.trim() : null,
    );
  }

  private insertDocItem(docId: string, itemId: string, toItemId: string | null, quantity: number, unitPrice: number | null | undefined, remark: string | null, context: AppContext): void {
    const now = context.now().toISOString();
    this.db.prepare(
      `INSERT INTO InventoryDocItem (
         id, clinicId, createdAt, updatedAt, deletedAt, docId, itemId,
         toItemId, quantity, unitPrice, remark
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(), context.clinicId ?? null, now, now,
      docId, itemId, toItemId, quantity, unitPrice ?? null, remark,
    );
  }

  private insertTransaction(itemId: string, type: 'IN' | 'OUT' | 'ADJUST', quantity: number, beforeStock: number, afterStock: number, referenceType: string, referenceId: string, remark: string, context: AppContext): void {
    const now = context.now().toISOString();
    recordInventoryTransaction(this.db, {
      id: randomUUID(),
      clinicId: context.clinicId ?? null,
      itemId,
      type,
      quantity,
      beforeStock,
      afterStock,
      operatorId: context.userId,
      remark,
      createdAt: now,
      updatedAt: now,
      referenceType,
      referenceId,
      batchId: null,
    });
  }

  private loadDoc(docId: string): Record<string, unknown> {
    const doc = this.db.prepare('SELECT * FROM InventoryDoc WHERE id = ?').get(docId) as Record<string, unknown>;
    const items = this.db.prepare(
      'SELECT * FROM InventoryDocItem WHERE docId = ? ORDER BY createdAt ASC',
    ).all(docId) as Array<Record<string, unknown>>;
    return { doc, items };
  }
}
