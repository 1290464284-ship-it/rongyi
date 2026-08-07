// 库存仓储（M-04：由 core.repositories.ts 拆分）
import type Database from 'better-sqlite3';
import { tenantAnd } from '../tenant';
import { recordSyncChange } from '../sync-change';
import type {
  InventoryItemRecord,
  InventoryRepository,
  InventoryTransactionRecord,
} from '../../application/ports';

export class SqliteInventoryRepository implements InventoryRepository {
  constructor(private readonly db: Database.Database) {}

  findItem(id: string, clinicId?: string | null): InventoryItemRecord | null {
    const params = clinicId ? [id, clinicId] : [id];
    return (this.db.prepare(`SELECT * FROM InventoryItem WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`).get(...params) as InventoryItemRecord | undefined) ?? null;
  }

  updateStock(id: string, stock: number, updatedAt: string, clinicId?: string | null): void {
    const params = clinicId ? [stock, updatedAt, id, clinicId] : [stock, updatedAt, id];
    this.db.prepare(`UPDATE InventoryItem SET stock = ?, updatedAt = ? WHERE id = ?${tenantAnd(clinicId)}`).run(...params);
    // P2-3：库存变更必须进入同步队列，否则离线端永远收不到库存更新
    if (clinicId) {
      recordSyncChange(this.db, { tableName: 'InventoryItem', recordId: id, operation: 'UPDATE', clinicId });
    }
  }

  createTransaction(record: InventoryTransactionRecord): void {
    this.db.prepare(
      `INSERT INTO InventoryTransaction (
         id, clinicId, createdAt, updatedAt, deletedAt,
         itemId, type, quantity, beforeStock, afterStock, operatorId, remark
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      record.id,
      record.clinicId ?? null,
      record.createdAt,
      record.updatedAt,
      record.itemId,
      record.type,
      record.quantity,
      record.beforeStock,
      record.afterStock,
      record.operatorId ?? null,
      record.remark ?? null,
    );
  }

  lowStock(clinicId?: string | null): InventoryItemRecord[] {
    const params = clinicId ? [clinicId] : [];
    return this.db.prepare(
      `SELECT * FROM InventoryItem WHERE deletedAt IS NULL AND stock <= minStock${tenantAnd(clinicId)} ORDER BY stock ASC LIMIT 100`,
    ).all(...params) as InventoryItemRecord[];
  }
}
