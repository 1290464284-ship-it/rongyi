import type Database from 'better-sqlite3';
import { ConflictError } from '../../infrastructure/errors';
import { tenantAnd, tenantParams } from '../../infrastructure/tenant';
import { trackResourceWrite } from '../../infrastructure/write-tracking';
import { invalidateStatSnapshots } from '../../infrastructure/stats-aggregate';

/**
 * 库存增减的唯一入口：原子 UPDATE（OUT 带 `stock >= ?` 防并发扣成负数）、
 * 租户过滤、同步事件/搜索索引收口都在这一个函数内完成。
 * 调用方仍负责自己的事务边界与 InventoryTransaction 流水。
 */
export function deductInventoryStock(
  db: Database.Database,
  itemId: string,
  quantity: number,
  updatedAt: string,
  clinicId: string | null,
  insufficientMessage = 'Insufficient stock',
): void {
  const result = db.prepare(
    `UPDATE InventoryItem SET stock = stock - ?, updatedAt = ?
     WHERE id = ? AND deletedAt IS NULL AND stock >= ?${tenantAnd(clinicId)}`,
  ).run(quantity, updatedAt, itemId, quantity, ...tenantParams(clinicId));
  if (result.changes === 0) throw new ConflictError(insufficientMessage);
  trackResourceWrite(db, { tableName: 'InventoryItem', recordId: itemId, operation: 'UPDATE', clinicId, searchResource: null });
}

export function addInventoryStock(
  db: Database.Database,
  itemId: string,
  quantity: number,
  updatedAt: string,
  clinicId: string | null,
): void {
  db.prepare(
    `UPDATE InventoryItem SET stock = stock + ?, updatedAt = ?
     WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`,
  ).run(quantity, updatedAt, itemId, ...tenantParams(clinicId));
  trackResourceWrite(db, { tableName: 'InventoryItem', recordId: itemId, operation: 'UPDATE', clinicId, searchResource: null });
}

export function setInventoryStock(
  db: Database.Database,
  itemId: string,
  stock: number,
  updatedAt: string,
  clinicId: string | null,
): void {
  db.prepare(
    `UPDATE InventoryItem SET stock = ?, updatedAt = ?
     WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`,
  ).run(stock, updatedAt, itemId, ...tenantParams(clinicId));
  trackResourceWrite(db, { tableName: 'InventoryItem', recordId: itemId, operation: 'UPDATE', clinicId, searchResource: null });
}

export function inventoryStockAfter(db: Database.Database, itemId: string, clinicId: string | null): number {
  const row = db.prepare(
    `SELECT stock FROM InventoryItem WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`,
  ).get(itemId, ...tenantParams(clinicId)) as { stock: number } | undefined;
  return Number(row?.stock ?? 0);
}

export interface InventoryTransactionInput {
  id: string;
  clinicId: string | null;
  itemId: string;
  type: 'IN' | 'OUT' | 'ADJUST';
  quantity: number;
  beforeStock: number;
  afterStock: number;
  operatorId: string | null;
  remark: string | null;
  createdAt: string;
  updatedAt: string;
  referenceType?: string | null;
  referenceId?: string | null;
  batchId?: string | null;
}

export function recordInventoryTransaction(db: Database.Database, record: InventoryTransactionInput): void {
  db.prepare(
    `INSERT INTO InventoryTransaction (
       id, clinicId, createdAt, updatedAt, deletedAt,
       itemId, type, quantity, beforeStock, afterStock, operatorId, remark,
       referenceType, referenceId, batchId
     ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    record.id,
    record.clinicId,
    record.createdAt,
    record.updatedAt,
    record.itemId,
    record.type,
    record.quantity,
    record.beforeStock,
    record.afterStock,
    record.operatorId,
    record.remark,
    record.referenceType ?? null,
    record.referenceId ?? null,
    record.batchId ?? null,
  );
  invalidateStatSnapshots(db, 'InventoryTransaction', record.clinicId);
}
