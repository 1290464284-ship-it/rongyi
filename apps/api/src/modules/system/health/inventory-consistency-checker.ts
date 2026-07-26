import { Injectable } from '@nestjs/common';
import { DbService } from '../../../db/db.service';
import { BaseConsistencyChecker } from './base-consistency-checker';
import { CheckDefinition, ConsistencyChecker, CheckResult } from './consistency-checker.interface';

@Injectable()
export class InventoryConsistencyChecker extends BaseConsistencyChecker implements ConsistencyChecker {
  readonly name = 'inventory';

  constructor(private dbService: DbService) {
    super();
  }

  getChecks(): CheckDefinition[] {
    return [
      {
        name: 'inventory_stock_balance',
        description: '库存余额与流水一致性检查',
        category: 'inventory',
        fn: () => this.checkInventoryStockBalance(),
      },
      {
        name: 'inventory_amount_positive',
        description: '库存金额正负检查',
        category: 'inventory',
        fn: () => this.checkInventoryAmountPositive(),
      },
      {
        name: 'inventory_transaction_item_exists',
        description: '库存流水对应库存项存在性检查',
        category: 'inventory',
        fn: () => this.checkInventoryTransactionItemExists(),
      },
    ];
  }

  private checkInventoryStockBalance(): CheckResult {
    return this.measureTime('inventory_stock_balance', () => {
      const rows = this.dbService.prepare(`
        SELECT ii.id, ii.code, ii.name, ii.stock,
               COALESCE(SUM(CASE WHEN it.type = 'IN' THEN it.quantity
                                 WHEN it.type = 'OUT' THEN -it.quantity
                                 WHEN it.type = 'ADJUST' THEN it.quantity
                                 ELSE 0 END), 0) as calculatedStock
        FROM InventoryItem ii
        LEFT JOIN InventoryTransaction it ON ii.id = it.itemId AND it.deletedAt IS NULL
        WHERE ii.deletedAt IS NULL
        GROUP BY ii.id
        HAVING ABS(ii.stock - calculatedStock) > 0.0001
      `).all() as Array<{
        id: string;
        code: string;
        name: string;
        stock: number;
        calculatedStock: number;
      }>;

      const issues = rows.map(row => ({
        id: row.id,
        type: 'inventory_stock_mismatch',
        description: `库存项 ${row.name} (${row.code}) 库存数量不一致`,
        details: {
          code: row.code,
          name: row.name,
          stock: row.stock,
          calculatedStock: row.calculatedStock,
          diff: row.stock - row.calculatedStock,
        },
      }));

      return {
        issues,
        message: issues.length === 0
          ? '所有库存项数量与流水记录一致'
          : `发现 ${issues.length} 个库存项数量不一致`,
      };
    });
  }

  private checkInventoryAmountPositive(): CheckResult {
    return this.measureTime('inventory_amount_positive', () => {
      const negativeStock = this.dbService.prepare(`
        SELECT id, code, name, stock
        FROM InventoryItem
        WHERE deletedAt IS NULL AND stock < 0
      `).all() as Array<{ id: string; code: string; name: string; stock: number }>;

      const negativePrice = this.dbService.prepare(`
        SELECT id, code, name, price
        FROM InventoryItem
        WHERE deletedAt IS NULL AND price < 0
      `).all() as Array<{ id: string; code: string; name: string; price: number }>;

      const issues: CheckResult['issues'] = [
        ...negativeStock.map(row => ({
          id: row.id,
          type: 'inventory_negative_stock',
          description: `库存项 ${row.name} (${row.code}) 库存数量为负`,
          details: { code: row.code, name: row.name, stock: row.stock },
        })),
        ...negativePrice.map(row => ({
          id: row.id,
          type: 'inventory_negative_price',
          description: `库存项 ${row.name} (${row.code}) 单价为负`,
          details: { code: row.code, name: row.name, price: row.price },
        })),
      ];

      return {
        issues,
        message: issues.length === 0
          ? '所有库存项金额均为非负数'
          : `发现 ${issues.length} 个库存项存在负值问题`,
      };
    });
  }

  private checkInventoryTransactionItemExists(): CheckResult {
    return this.measureTime('inventory_transaction_item_exists', () => {
      const rows = this.dbService.prepare(`
        SELECT it.id, it.itemId, it.type, it.quantity
        FROM InventoryTransaction it
        LEFT JOIN InventoryItem ii ON it.itemId = ii.id
        WHERE it.deletedAt IS NULL AND ii.id IS NULL
      `).all() as Array<{ id: string; itemId: string; type: string; quantity: number }>;

      const issues = rows.map(row => ({
        id: row.id,
        type: 'inventory_transaction_orphan',
        description: `库存流水引用了不存在的库存项`,
        details: { itemId: row.itemId, type: row.type, quantity: row.quantity },
      }));

      return {
        issues,
        message: issues.length === 0
          ? '所有库存流水对应的库存项均存在'
          : `发现 ${issues.length} 条库存流水引用不存在的库存项`,
      };
    });
  }
}
