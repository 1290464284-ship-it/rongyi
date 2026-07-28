import { Injectable } from '@nestjs/common';

import { SqlExecutor } from '../../../../common/repositories/base.repository';
import { InventoryItem } from '@dental/shared';

export interface CreateInventoryItemData {
  id: string;
  code: string;
  name: string;
  spec?: string | null;
  category: string;
  unit: string;
  stock: number;
  minStock: number;
  price: number;
  supplierId?: string | null;
  expireDate?: string | null;
  location?: string | null;
  remark?: string | null;
  clinicId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryTransactionData {
  id: string;
  itemId: string;
  type: string;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  supplierId?: string | null;
  operatorId?: string | null;
  operatorName?: string | null;
  remark?: string | null;
  clinicId?: string | null;
  createdAt: string;
}

export interface ListInventoryOptions {
  clinicClause: string;
  clinicParams: unknown[];
  keyword?: string;
  category?: string;
  page: number;
  pageSize: number;
}

export interface ListInventoryTransactionsOptions {
  clinicClause: string;
  clinicParams: unknown[];
  itemId?: string;
  limit: number;
  offset: number;
}

@Injectable()
export class InventoryRepository {
  private readonly tableName = 'InventoryItem';
  private readonly transactionTableName = 'InventoryTransaction';

  create(db: SqlExecutor, data: CreateInventoryItemData): void {
    db.prepare(
      `INSERT INTO ${this.tableName} (id, code, name, spec, category, unit, stock, minStock, price, supplierId, expireDate, location, remark, clinicId, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      data.id,
      data.code,
      data.name,
      data.spec ?? null,
      data.category,
      data.unit,
      data.stock,
      data.minStock,
      data.price,
      data.supplierId ?? null,
      data.expireDate ?? null,
      data.location ?? null,
      data.remark ?? null,
      data.clinicId ?? null,
      data.createdAt,
      data.updatedAt,
    );
  }

  update(
    db: SqlExecutor,
    id: string,
    updates: string[],
    params: unknown[],
    clinicClause: string,
    clinicParams: unknown[],
  ): void {
    if (updates.length === 0) return;
    db.prepare(
      `UPDATE ${this.tableName} SET ${updates.join(', ')} WHERE id = ? AND deletedAt IS NULL${clinicClause}`,
    ).run(...params, id, ...clinicParams);
  }

  findById(
    db: SqlExecutor,
    id: string,
    clinicClause: string,
    clinicParams: unknown[],
  ): InventoryItem | undefined {
    return db.prepare(
      `SELECT id, code, name, spec, category, unit, stock, minStock, price, supplierId, expireDate, location, remark, clinicId, createdAt, updatedAt
       FROM ${this.tableName}
       WHERE id = ? AND deletedAt IS NULL${clinicClause}`,
    ).get(id, ...clinicParams) as InventoryItem | undefined;
  }

  findMany(
    db: SqlExecutor,
    options: ListInventoryOptions,
  ): { items: InventoryItem[]; total: number } {
    const { clinicClause, clinicParams, keyword, category, page, pageSize } = options;

    const conditions: string[] = ['deletedAt IS NULL'];
    const params: unknown[] = [];

    if (clinicClause) {
      const cleanClause = clinicClause.replace(/^\s*AND\s+/i, '');
      conditions.push(cleanClause);
      params.push(...clinicParams);
    }

    if (category) {
      conditions.push('category = ?');
      params.push(category);
    }

    if (keyword && keyword.trim()) {
      const escaped = keyword.replace(/[%_\\]/g, '\\$&');
      const pattern = `%${escaped}%`;
      conditions.push(`(name LIKE ? ESCAPE '\\' OR code LIKE ? ESCAPE '\\')`);
      params.push(pattern, pattern);
    }

    const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
    const countSql = `SELECT COUNT(*) as total FROM ${this.tableName}${whereClause}`;
    const total = (db.prepare(countSql).get(...params) as { total: number } | undefined)?.total || 0;

    const dataSql = `SELECT id, code, name, spec, category, unit, stock, minStock, price, supplierId, expireDate, location, remark, createdAt, updatedAt
                     FROM ${this.tableName}${whereClause}
                     ORDER BY createdAt DESC LIMIT ? OFFSET ?`;
    const dataParams = [...params, pageSize, (page - 1) * pageSize];
    const items = db.prepare(dataSql).all(...dataParams) as InventoryItem[];

    return { items, total };
  }

  delete(
    db: SqlExecutor,
    id: string,
    clinicClause: string,
    clinicParams: unknown[],
  ): void {
    db.prepare(
      `DELETE FROM ${this.tableName} WHERE id = ?${clinicClause}`,
    ).run(id, ...clinicParams);
  }

  findLowStockItems(
    db: SqlExecutor,
    clinicClause: string,
    clinicParams: unknown[],
  ): Array<Pick<InventoryItem, 'id' | 'code' | 'name' | 'spec' | 'category' | 'unit' | 'stock' | 'minStock' | 'price' | 'supplierId' | 'location'>> {
    return db.prepare(
      `SELECT id, code, name, spec, category, unit, stock, minStock, price, supplierId, location
       FROM ${this.tableName}
       WHERE deletedAt IS NULL AND stock <= minStock${clinicClause}
       ORDER BY stock ASC`,
    ).all(...clinicParams) as Array<Pick<InventoryItem, 'id' | 'code' | 'name' | 'spec' | 'category' | 'unit' | 'stock' | 'minStock' | 'price' | 'supplierId' | 'location'>>;
  }

  findTransactions(
    db: SqlExecutor,
    options: ListInventoryTransactionsOptions,
  ): Array<InventoryTransactionData & { createdAt: string }> {
    const { clinicClause, clinicParams, itemId, limit, offset } = options;

    if (itemId) {
      return db.prepare(
        `SELECT id, itemId, type, quantity, unitPrice, totalAmount, supplierId, operatorId, operatorName, remark, createdAt
         FROM ${this.transactionTableName}
         WHERE itemId = ?${clinicClause}
         ORDER BY createdAt DESC LIMIT ? OFFSET ?`,
      ).all(itemId, ...clinicParams, limit, offset) as Array<InventoryTransactionData & { createdAt: string }>;
    }

    return db.prepare(
      `SELECT id, itemId, type, quantity, unitPrice, totalAmount, supplierId, operatorId, operatorName, remark, createdAt
       FROM ${this.transactionTableName}
       WHERE 1=1${clinicClause}
       ORDER BY createdAt DESC LIMIT ? OFFSET ?`,
    ).all(...clinicParams, limit, offset) as Array<InventoryTransactionData & { createdAt: string }>;
  }

  findItemForStockAction(
    db: SqlExecutor,
    id: string,
    clinicClause: string,
    clinicParams: unknown[],
  ): { id: string; code: string; name: string; stock: number } | undefined {
    return db.prepare(
      `SELECT id, code, name, stock FROM ${this.tableName} WHERE id = ? AND deletedAt IS NULL${clinicClause}`,
    ).get(id, ...clinicParams) as { id: string; code: string; name: string; stock: number } | undefined;
  }

  incrementStock(
    db: SqlExecutor,
    id: string,
    quantity: number,
    now: string,
    clinicClause: string,
    clinicParams: unknown[],
  ): { changes: number } {
    return db.prepare(
      `UPDATE ${this.tableName} SET stock = stock + ?, updatedAt = ? WHERE id = ?${clinicClause}`,
    ).run(quantity, now, id, ...clinicParams);
  }

  decrementStock(
    db: SqlExecutor,
    id: string,
    quantity: number,
    now: string,
    clinicClause: string,
    clinicParams: unknown[],
  ): { changes: number } {
    return db.prepare(
      `UPDATE ${this.tableName} SET stock = stock - ?, updatedAt = ? WHERE id = ? AND stock >= ?${clinicClause}`,
    ).run(quantity, now, id, quantity, ...clinicParams);
  }

  setStockWithOptimisticLock(
    db: SqlExecutor,
    id: string,
    newStock: number,
    now: string,
    currentStock: number,
    clinicClause: string,
    clinicParams: unknown[],
  ): { changes: number } {
    return db.prepare(
      `UPDATE ${this.tableName} SET stock = ?, updatedAt = ? WHERE id = ? AND stock = ?${clinicClause}`,
    ).run(newStock, now, id, currentStock, ...clinicParams);
  }

  getStock(
    db: SqlExecutor,
    id: string,
    clinicClause: string,
    clinicParams: unknown[],
  ): { stock: number } | undefined {
    return db.prepare(
      `SELECT stock FROM ${this.tableName} WHERE id = ? AND deletedAt IS NULL${clinicClause}`,
    ).get(id, ...clinicParams) as { stock: number } | undefined;
  }

  createTransaction(db: SqlExecutor, data: InventoryTransactionData): void {
    db.prepare(
      `INSERT INTO ${this.transactionTableName} (id, itemId, type, quantity, unitPrice, totalAmount, supplierId, operatorId, operatorName, remark, clinicId, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      data.id,
      data.itemId,
      data.type,
      data.quantity,
      data.unitPrice,
      data.totalAmount,
      data.supplierId ?? null,
      data.operatorId ?? null,
      data.operatorName ?? null,
      data.remark ?? null,
      data.clinicId ?? null,
      data.createdAt,
    );
  }
}
