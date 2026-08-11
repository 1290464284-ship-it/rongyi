// 采购单仓储（M-04：由 core.repositories.ts 拆分）
import type Database from 'better-sqlite3';
import { ConflictError } from '../errors';
import { tenantAnd } from '../tenant';
import { trackResourceWrite } from '../write-tracking';
import type {
  PurchaseOrderItemRecord,
  PurchaseOrderRecord,
  PurchaseOrderRepository,
} from '../../application/ports';

export class SqlitePurchaseOrderRepository implements PurchaseOrderRepository {
  constructor(private readonly db: Database.Database) {}

  findById(id: string, clinicId?: string | null): PurchaseOrderRecord | null {
    const params = clinicId ? [id, clinicId] : [id];
    return (this.db.prepare(`SELECT * FROM PurchaseOrder WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`).get(...params) as PurchaseOrderRecord | undefined) ?? null;
  }

  itemsByOrder(orderId: string, clinicId?: string | null): PurchaseOrderItemRecord[] {
    const params = clinicId ? [orderId, clinicId] : [orderId];
    return this.db.prepare(`SELECT * FROM PurchaseOrderItem WHERE orderId = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`).all(...params) as PurchaseOrderItemRecord[];
  }

  createOrder(input: PurchaseOrderRecord): void {
    this.db.prepare(
      `INSERT INTO PurchaseOrder (
         id, clinicId, createdAt, updatedAt, deletedAt,
         number, supplierId, totalAmount, status, reviewStatus
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
    ).run(input.id, input.clinicId ?? null, input.createdAt, input.updatedAt, input.number, input.supplierId ?? null, input.totalAmount, input.status, input.reviewStatus ?? 'PENDING');
    trackResourceWrite(this.db, { tableName: 'PurchaseOrder', recordId: input.id, operation: 'INSERT', clinicId: input.clinicId ?? null });
  }

  createItem(input: PurchaseOrderItemRecord): void {
    this.db.prepare(
      `INSERT INTO PurchaseOrderItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         orderId, itemId, name, quantity, unitPrice, subtotal
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
    ).run(input.id, input.clinicId ?? null, input.createdAt, input.updatedAt, input.orderId, input.itemId ?? null, input.name, input.quantity, input.unitPrice, input.subtotal);
  }

  markReceived(id: string, receivedAt: string, updatedAt: string, clinicId?: string | null): void {
    const params = clinicId ? [receivedAt, updatedAt, id, clinicId] : [receivedAt, updatedAt, id];
    const result = this.db.prepare(
      `UPDATE PurchaseOrder SET status = 'RECEIVED', receivedAt = ?, updatedAt = ?
       WHERE id = ? AND status = 'PENDING' AND deletedAt IS NULL${tenantAnd(clinicId)}`,
    ).run(...params);
    // 多实例并发收货时只有第一个能拿到 PENDING → RECEIVED 转移；
    // 第二个 changes = 0，在调用方事务内抛错即可整体回滚，避免重复入库。
    if (result.changes === 0) throw new ConflictError('Purchase order is not pending');
    trackResourceWrite(this.db, { tableName: 'PurchaseOrder', recordId: id, operation: 'UPDATE', clinicId: clinicId ?? null });
  }
}
