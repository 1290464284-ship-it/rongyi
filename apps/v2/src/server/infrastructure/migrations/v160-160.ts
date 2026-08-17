import type Database from 'better-sqlite3';

/**
 * S-2（2026-08-16）：为专用列表的 keyset 分页补齐 (clinicId, createdAt) 复合索引。
 * 游标模式直接走索引定位（createdAt DESC, id DESC），深分页不再退化全表扫描；
 * 这些表的单列 clinicId 索引已存在，复合索引不重复占用。
 */
export const migrations160 = [
  {
    version: 160,
    name: 'v2-keyset-composite-indexes',
    up(db: Database.Database): void {
      const indexes: Array<[string, string]> = [
        ['idx_v2_refund_clinic_created', 'Refund(clinicId, createdAt)'],
        ['idx_v2_stocktake_clinic_created', 'Stocktake(clinicId, createdAt)'],
        ['idx_v2_purchase_order_clinic_created', 'PurchaseOrder(clinicId, createdAt)'],
        ['idx_v2_follow_up_clinic_created', 'FollowUp(clinicId, createdAt)'],
      ];
      for (const [name, definition] of indexes) {
        db.exec(`CREATE INDEX IF NOT EXISTS ${name} ON ${definition}`);
      }
    },
  },
];
