/**
 * 技耗分离分账统计。
 *
 * 口径：按 ChargeItem.costType（技=SERVICE 服务费，耗=MATERIAL 材料费）
 * 分组统计收费明细小计，仅纳入未删除、未取消的收费单明细。
 */
import type Database from 'better-sqlite3';
import { ValidationError } from '../../infrastructure/errors';
import { tenantAnd, tenantParams } from '../../infrastructure/tenant';
import type { AppContext } from '../../../domain/contracts';

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/;

function isValidDateString(value: string): boolean {
  const match = DATE_ONLY.exec(value);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }
  return ISO_DATE_TIME.test(value) && !Number.isNaN(Date.parse(value));
}

function normalizeDateFilter(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !isValidDateString(value)) {
    throw new ValidationError(`${field} 必须是合法的日期字符串（YYYY-MM-DD 或 ISO 格式）`);
  }
  return value;
}

interface CostShareRow {
  costType: string;
  category: string;
  total: number;
  itemCount: number;
  chargeCount: number;
}

interface CostShareSummary {
  SERVICE: { total: number; itemCount: number; chargeCount: number };
  MATERIAL: { total: number; itemCount: number; chargeCount: number };
  grandTotal: number;
}

export interface CostShareStats {
  rows: CostShareRow[];
  summary: CostShareSummary;
}

export class CostShareService {
  constructor(private readonly db: Database.Database) {}

  stats(input: { from?: string; to?: string }, context: AppContext): CostShareStats {
    const from = normalizeDateFilter(input.from, 'from');
    const to = normalizeDateFilter(input.to, 'to');

    let windowSql = '';
    const params: Array<string | number | null> = [];
    if (from) {
      windowSql += ' AND c.createdAt >= ?';
      params.push(from);
    }
    if (to) {
      windowSql += ' AND c.createdAt <= ?';
      params.push(to);
    }

    const rows = this.db.prepare(
      `SELECT ci.costType, ci.category,
              SUM(ci.subtotal) AS total,
              COUNT(*) AS itemCount,
              COUNT(DISTINCT ci.chargeId) AS chargeCount
       FROM ChargeItem ci
       JOIN Charge c ON c.id = ci.chargeId
       WHERE ci.deletedAt IS NULL
         AND c.deletedAt IS NULL
         AND c.status != 'CANCELLED'
         AND ci.costType IS NOT NULL
         ${windowSql}
         ${tenantAnd(context.clinicId, 'c.clinicId')}
       GROUP BY ci.costType, ci.category
       ORDER BY ci.costType ASC, total DESC`,
    ).all(...params, ...tenantParams(context.clinicId)) as CostShareRow[];

    const buckets: Record<string, { total: number; itemCount: number; chargeCount: number }> = {
      SERVICE: { total: 0, itemCount: 0, chargeCount: 0 },
      MATERIAL: { total: 0, itemCount: 0, chargeCount: 0 },
    };
    let grandTotal = 0;
    for (const row of rows) {
      const bucket = buckets[row.costType] ?? (buckets[row.costType] = { total: 0, itemCount: 0, chargeCount: 0 });
      bucket.total += Number(row.total);
      bucket.itemCount += Number(row.itemCount);
      bucket.chargeCount += Number(row.chargeCount);
      grandTotal += Number(row.total);
    }

    return {
      rows,
      summary: {
        SERVICE: buckets.SERVICE,
        MATERIAL: buckets.MATERIAL,
        grandTotal,
      },
    };
  }
}
