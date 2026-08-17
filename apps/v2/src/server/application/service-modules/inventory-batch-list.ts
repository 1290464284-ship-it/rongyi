// 批次列表查询（从 inventory-batch.ts 拆出：保持 service-module 单文件 ≤ 架构上限，
// 同时把 OFFSET/limit 双模式分页逻辑收敛到一处）。
import type Database from 'better-sqlite3';
import { SystemClock } from '../../infrastructure/clock';
import { tenantWhere } from '../../infrastructure/tenant';
import type { AppContext } from '../../../domain/contracts';
import type { InventoryBatchRow } from './inventory-batch';

export interface InventoryBatchListFilter {
  itemId?: string;
  days?: number;
  limit?: number;
  page?: number;
  pageSize?: number;
}

export interface InventoryBatchListResult {
  batches: InventoryBatchRow[];
  expiring: InventoryBatchRow[];
  truncated: boolean;
  total?: number;
  page?: number;
  pageSize?: number;
}

export function normalizeDays(days: number | undefined): number {
  const value = Number(days);
  if (!Number.isFinite(value)) return 30;
  // 上限 1..3650：超大值会造成无效的全表范围扫描（与 workflow expiring 路由一致）
  return Math.min(Math.max(Math.floor(value), 1), 3650);
}

/**
 * 该租户的启用批次（含 item name/code/spec），以及 days 天内到期的子集。
 * W-1：page/pageSize 提供时走 OFFSET 分页（返回 total/truncated），否则走原有 limit 路径。
 */
export function listInventoryBatches(
  db: Database.Database,
  context: AppContext,
  filter?: InventoryBatchListFilter,
): InventoryBatchListResult {
  const days = normalizeDays(filter?.days);
  const hasOffset = Number.isFinite(Number(filter?.page)) || Number.isFinite(Number(filter?.pageSize));
  const page = Number.isFinite(Number(filter?.page)) && Number(filter!.page) >= 1
    ? Math.floor(Number(filter!.page))
    : 1;
  const pageSize = Number.isFinite(Number(filter?.pageSize)) && Number(filter!.pageSize) >= 1
    ? Math.min(200, Math.floor(Number(filter!.pageSize)))
    : 100;
  const limit = Number.isFinite(Number(filter?.limit)) && Number(filter!.limit) >= 1
    ? Math.min(5_000, Math.floor(Number(filter!.limit)))
    : 1_000;
  const conditions = ['B.deletedAt IS NULL', 'B.active = 1'];
  const params: Array<string | number | null> = [];
  if (filter?.itemId) {
    conditions.push('B.itemId = ?');
    params.push(filter.itemId);
  }
  const tenant = tenantWhere(context.clinicId, 'B.clinicId');
  const whereSql = `WHERE ${conditions.join(' AND ')}${tenant.sql ? ` AND ${tenant.sql}` : ''}`;
  const total = hasOffset
    ? Number((db.prepare(
        `SELECT COUNT(*) AS total FROM InventoryBatch B ${whereSql}`,
      ).get(...params, ...tenant.params) as { total: number }).total)
    : undefined;
  const sql = `
    SELECT B.id, B.itemId, B.batchNo, B.productionDate, B.expiryDate,
           B.initialQuantity, B.remainingQuantity, B.supplierId, B.purchaseOrderId,
           B.active, B.clinicId, B.createdAt, B.updatedAt,
           I.name AS itemName, I.code AS itemCode, I.spec AS itemSpec
    FROM InventoryBatch B
    INNER JOIN InventoryItem I ON I.id = B.itemId AND I.deletedAt IS NULL
    ${whereSql}
    ORDER BY B.expiryDate ASC, B.createdAt DESC
    ${hasOffset ? 'LIMIT ? OFFSET ?' : 'LIMIT ?'}
  `;
  const fetchParams = hasOffset
    ? [...params, ...tenant.params, pageSize, (page - 1) * pageSize]
    : [...params, ...tenant.params, limit];
  const batches = db.prepare(sql).all(...fetchParams) as InventoryBatchRow[];
  const now = context.now();
  const today = new SystemClock().clinicDate(now);
  const cutoff = new SystemClock().clinicDate(new Date(now.getTime() + days * 86_400_000));
  const expiring = db.prepare(
    `SELECT B.id, B.itemId, B.batchNo, B.productionDate, B.expiryDate,
            B.initialQuantity, B.remainingQuantity, B.supplierId, B.purchaseOrderId,
            B.active, B.clinicId, B.createdAt, B.updatedAt,
            I.name AS itemName, I.code AS itemCode, I.spec AS itemSpec
     FROM InventoryBatch B
     INNER JOIN InventoryItem I ON I.id = B.itemId AND I.deletedAt IS NULL
     WHERE B.deletedAt IS NULL AND B.active = 1
       AND B.expiryDate >= ? AND B.expiryDate <= ? AND B.remainingQuantity > 0${tenant.sql ? ` AND ${tenant.sql}` : ''}
     ORDER BY B.expiryDate ASC
     LIMIT ?`,
  ).all(today, cutoff, ...tenant.params, limit) as InventoryBatchRow[];
  if (hasOffset && total !== undefined) {
    return { batches, expiring, truncated: total > (page - 1) * pageSize + batches.length, total, page, pageSize };
  }
  return { batches, expiring, truncated: batches.length === limit };
}
