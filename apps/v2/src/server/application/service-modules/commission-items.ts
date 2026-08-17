// 提成明细批量读取（从 commission.ts 拆出：批内 IN 查询 + 行类型，
// 避免 service-module 单文件超架构上限，同时保持职责清晰）。
import type Database from 'better-sqlite3';

/** ChargeItem 按 chargeId 批量查询的批大小，远低于 SQLite 参数变量上限（≈32766）。 */
const IN_BATCH_SIZE = 1000;

export interface CommissionItemRow {
  chargeId: string;
  category: string;
  costType: string;
  subtotal: number;
}

/** 按批（≤1000）查询 ChargeItem，避免大流水月超 SQLite 参数上限（too many SQL variables）与内存峰值。 */
export function loadChargeItems(db: Database.Database, chargeIds: string[]): CommissionItemRow[] {
  const items: CommissionItemRow[] = [];
  if (chargeIds.length === 0) return items;
  const base = `SELECT chargeId, category, COALESCE(costType, 'SERVICE') AS costType, subtotal
                FROM ChargeItem WHERE chargeId IN (PLACEHOLDERS) AND deletedAt IS NULL`;
  for (let index = 0; index < chargeIds.length; index += IN_BATCH_SIZE) {
    const batch = chargeIds.slice(index, index + IN_BATCH_SIZE);
    const sql = base.replace('PLACEHOLDERS', batch.map(() => '?').join(','));
    items.push(...(db.prepare(sql).all(...batch) as CommissionItemRow[]));
  }
  return items;
}
