import type Database from 'better-sqlite3';
import { ValidationError } from '../../infrastructure/errors';
import { tenantAnd, tenantParams } from '../../infrastructure/tenant';
import type { AppContext } from '../../../domain/contracts';

export const INVENTORY_REPORT_TYPES = [
  'IN',
  'OUT',
  'DISPENSE_RETURN',
  'RETURN_SUPPLIER',
  'LOSS',
  'STOCKTAKE',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'SUMMARY',
] as const;

export type InventoryReportType = (typeof INVENTORY_REPORT_TYPES)[number];

export interface InventoryReportQuery {
  from?: string;
  to?: string;
  itemId?: string;
  supplierId?: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 分类规则：除 SUMMARY 外的每个报表类型对应一组 InventoryTransaction
 * type + referenceType 条件。
 */
const CLASSIFICATIONS: Record<Exclude<InventoryReportType, 'SUMMARY'>, string> = {
  IN: "t.type = 'IN' AND (t.referenceType IS NULL OR t.referenceType NOT IN ('TRANSFER', 'DISPENSE_RETURN'))",
  OUT: "t.type = 'OUT' AND (t.referenceType IS NULL OR t.referenceType NOT IN ('RETURN_SUPPLIER', 'LOSS', 'TRANSFER'))",
  DISPENSE_RETURN: "t.type = 'IN' AND t.referenceType = 'DISPENSE_RETURN'",
  RETURN_SUPPLIER: "t.type = 'OUT' AND t.referenceType = 'RETURN_SUPPLIER'",
  LOSS: "t.type = 'OUT' AND t.referenceType = 'LOSS'",
  STOCKTAKE: "t.type = 'ADJUST' AND t.referenceType = 'STOCKTAKE'",
  TRANSFER_OUT: "t.type = 'OUT' AND t.referenceType = 'TRANSFER'",
  TRANSFER_IN: "t.type = 'IN' AND t.referenceType = 'TRANSFER'",
};

/**
 * 库存明细报表：按类型查询 InventoryTransaction 流水（JOIN InventoryItem
 * 带出物料名称/规格/分类/单位），SUMMARY 按物料聚合进出调整量。
 * from/to 为 YYYY-MM-DD，按 createdAt 的 ISO 字符串区间过滤。
 */
export class InventoryReportService {
  constructor(private readonly db: Database.Database) {}

  report(type: string, query: InventoryReportQuery, context: AppContext): Record<string, unknown> {
    if (!INVENTORY_REPORT_TYPES.includes(type as InventoryReportType)) {
      throw new ValidationError(`不支持的报表类型：${type}`);
    }
    validateRange(query.from, query.to);
    if (type === 'SUMMARY') return this.summary(query, context);
    return this.detail(type as Exclude<InventoryReportType, 'SUMMARY'>, query, context);
  }

  private detail(type: Exclude<InventoryReportType, 'SUMMARY'>, query: InventoryReportQuery, context: AppContext): Record<string, unknown> {
    const filters: string[] = [CLASSIFICATIONS[type]];
    const params: Array<string | number> = [];
    if (query.itemId) {
      filters.push('t.itemId = ?');
      params.push(query.itemId);
    }
    if (query.from) {
      filters.push('t.createdAt >= ?');
      params.push(`${query.from}T00:00:00.000Z`);
    }
    if (query.to) {
      filters.push('t.createdAt <= ?');
      params.push(`${query.to}T23:59:59.999Z`);
    }
    // JOIN 侧的 i.clinicId 占位符在 SQL 中最先出现，参数按 ? 顺序排列：
    // [i.clinicId, ...过滤参数, t.clinicId]
    const rows = this.db.prepare(`
      SELECT t.id, t.itemId, i.name AS itemName, i.spec, i.category, i.unit,
             t.type, t.quantity, t.beforeStock, t.afterStock, t.referenceType,
             t.referenceId, t.operatorId, t.remark, t.batchId, t.createdAt
      FROM InventoryTransaction t
      JOIN InventoryItem i ON i.id = t.itemId AND i.deletedAt IS NULL${tenantAnd(context.clinicId, 'i.clinicId')}
      WHERE t.deletedAt IS NULL AND ${filters.join(' AND ')}${tenantAnd(context.clinicId, 't.clinicId')}
      ORDER BY t.createdAt DESC
    `).all(...tenantParams(context.clinicId), ...params, ...tenantParams(context.clinicId)) as Array<Record<string, unknown>>;

    const items = rows.map((row) => ({
      id: row.id,
      itemId: row.itemId,
      itemName: row.itemName,
      spec: row.spec,
      category: row.category,
      unit: row.unit,
      type: row.type,
      quantity: row.quantity,
      beforeStock: row.beforeStock,
      afterStock: row.afterStock,
      referenceType: row.referenceType,
      referenceId: row.referenceId,
      operatorId: row.operatorId,
      remark: row.remark,
      batchId: row.batchId,
      createdAt: row.createdAt,
    }));
    return { type, from: query.from ?? null, to: query.to ?? null, total: items.length, items };
  }

  private summary(query: InventoryReportQuery, context: AppContext): Record<string, unknown> {
    const filters: string[] = [];
    const params: Array<string | number> = [];
    if (query.itemId) {
      filters.push('t.itemId = ?');
      params.push(query.itemId);
    }
    if (query.from) {
      filters.push('t.createdAt >= ?');
      params.push(`${query.from}T00:00:00.000Z`);
    }
    if (query.to) {
      filters.push('t.createdAt <= ?');
      params.push(`${query.to}T23:59:59.999Z`);
    }
    const whereClause = filters.length > 0 ? ` AND ${filters.join(' AND ')}` : '';
    // JOIN 侧的 i.clinicId 占位符在 SQL 中最先出现，参数按 ? 顺序排列：
    // [i.clinicId, ...过滤参数, t.clinicId]
    const rows = this.db.prepare(`
      SELECT i.id AS itemId, i.name, i.spec, i.category, i.unit, i.stock AS currentStock,
             COALESCE(SUM(CASE WHEN t.type = 'IN' THEN t.quantity ELSE 0 END), 0) AS inQuantity,
             COALESCE(SUM(CASE WHEN t.type = 'OUT' THEN t.quantity ELSE 0 END), 0) AS outQuantity,
             COALESCE(SUM(CASE WHEN t.type = 'ADJUST' THEN t.quantity ELSE 0 END), 0) AS adjustQuantity
      FROM InventoryTransaction t
      JOIN InventoryItem i ON i.id = t.itemId AND i.deletedAt IS NULL${tenantAnd(context.clinicId, 'i.clinicId')}
      WHERE t.deletedAt IS NULL${whereClause}${tenantAnd(context.clinicId, 't.clinicId')}
      GROUP BY i.id
      ORDER BY i.name ASC, i.id ASC
    `).all(...tenantParams(context.clinicId), ...params, ...tenantParams(context.clinicId)) as Array<Record<string, unknown>>;

    const items = rows.map((row) => ({
      itemId: row.itemId,
      name: row.name,
      spec: row.spec,
      category: row.category,
      unit: row.unit,
      currentStock: Number(row.currentStock ?? 0),
      inQuantity: Number(row.inQuantity ?? 0),
      outQuantity: Number(row.outQuantity ?? 0),
      adjustQuantity: Number(row.adjustQuantity ?? 0),
    }));
    return { type: 'SUMMARY', from: query.from ?? null, to: query.to ?? null, total: items.length, items };
  }
}

function validateRange(from: string | undefined, to: string | undefined): void {
  for (const [label, value] of [['from', from], ['to', to]] as const) {
    if (value !== undefined && value !== null && value !== '' && !DATE_RE.test(value)) {
      throw new ValidationError(`${label} 日期格式应为 YYYY-MM-DD`);
    }
  }
}
