import type Database from 'better-sqlite3';
import type { Migration } from './index';

function createChildIndex(db: Database.Database, table: string, column: string): void {
  db.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_${column} ON "${table}"("${column}", deletedAt)`);
}

/**
 * 159：外键子列复合索引（审计 P2：按父 id 查询/外键检查此前全表扫）。
 * 覆盖所有已声明 FK 的子表 parentId 列，与 deletedAt 软删过滤组合。
 */
export const migrations159: Migration[] = [
  {
    version: 159,
    name: 'v2-child-fk-column-indexes',
    up(db) {
      createChildIndex(db, 'ChargeItem', 'chargeId');
      createChildIndex(db, 'PurchaseOrderItem', 'orderId');
      createChildIndex(db, 'ProcessingOrderItem', 'orderId');
      createChildIndex(db, 'TreatmentPlanItem', 'planId');
      createChildIndex(db, 'PrescriptionItem', 'prescriptionId');
      createChildIndex(db, 'InventoryReplenishmentSuggestion', 'inventoryId');
      createChildIndex(db, 'MemberCard', 'patientId');
    },
  },
];
