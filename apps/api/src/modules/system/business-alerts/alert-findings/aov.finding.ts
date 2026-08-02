import { IDatabase } from '../../../../db/db.interface';
import { AppLogger } from '../../../../common/services/logger.service';
import { buildClinicFilter } from '../../../../common/utils/db/clinic-filter';
import {
  FindingItem,
  classifySeverity,
} from '../thresholds';

const logger = new AppLogger('AovFinding');

export interface AovContext {
  runMonth: string;
  prevMonth: string;
  warn: number;
  critical: number;
}

export function computeAovFinding(
  db: IDatabase,
  clinicId: string,
  ctx: AovContext,
): FindingItem | null {
  try {
    const { clause, params } = buildClinicFilter(clinicId);
    const chargeClinicClause = clause.replace('clinicId', 'c.clinicId');

    const sql = `
      SELECT
        COALESCE(SUM(CASE WHEN strftime('%Y-%m', c.paidAt) = ? THEN c.paidAmount END), 0) as monthRevenue,
        COALESCE(SUM(CASE WHEN strftime('%Y-%m', c.paidAt) = ? THEN 1 END), 0) as monthChargeCount,
        COALESCE(SUM(CASE WHEN strftime('%Y-%m', c.paidAt) = ? THEN c.paidAmount END), 0) as prevRevenue,
        COALESCE(SUM(CASE WHEN strftime('%Y-%m', c.paidAt) = ? THEN 1 END), 0) as prevChargeCount
      FROM Charge c
      WHERE c.deletedAt IS NULL
        AND c.paidAt IS NOT NULL
        AND (strftime('%Y-%m', c.paidAt) = ? OR strftime('%Y-%m', c.paidAt) = ?)
        ${chargeClinicClause}
    `;

    const row = db.prepare(sql).get(
      ctx.runMonth, ctx.runMonth,
      ctx.prevMonth, ctx.prevMonth,
      ctx.runMonth, ctx.prevMonth,
      ...params,
    ) as {
      monthRevenue: number; monthChargeCount: number;
      prevRevenue: number; prevChargeCount: number;
    } | undefined;

    if (!row) return null;

    if (row.monthChargeCount === 0 || row.prevChargeCount === 0) {
      logger.warn(`[AOV] skip: insufficient data monthCharges=${row.monthChargeCount} prevCharges=${row.prevChargeCount} clinic=${clinicId}`);
      return null;
    }

    const currentAov = row.monthRevenue / row.monthChargeCount;
    const baselineAov = row.prevRevenue / row.prevChargeCount;

    if (baselineAov === 0) {
      logger.warn(`[AOV] skip: baselineAov=0 clinic=${clinicId}`);
      return null;
    }

    const deviationPercent = ((currentAov - baselineAov) / baselineAov) * 100;
    if (isNaN(deviationPercent) || !isFinite(deviationPercent)) {
      logger.warn(`[AOV] skip: invalid deviation currentAov=${currentAov} baselineAov=${baselineAov}`);
      return null;
    }

    const severity = classifySeverity(Math.abs(deviationPercent), ctx.warn, ctx.critical);
    const dropPct = Math.abs(Math.round(deviationPercent));

    const suggestion = severity !== 'INFO'
      ? `客单价环比${deviationPercent < 0 ? '下跌' : '上涨'} ${dropPct}%，建议：提高联合方案推售、提高高价值种植/正畸项目转化`
      : `客单价环比 ${deviationPercent >= 0 ? '+' : ''}${dropPct}%，关注后续走势`;

    return {
      alertType: 'AOV',
      severity,
      metricName: 'aov',
      currentValue: Math.round(currentAov),
      baselineValue: Math.round(baselineAov),
      deviationPercent: Math.round(deviationPercent * 100) / 100,
      message: `${ctx.runMonth} 客单价 ¥${Math.round(currentAov)}（${row.monthChargeCount} 单），${ctx.prevMonth} 客单价 ¥${Math.round(baselineAov)}（${row.prevChargeCount} 单），环比 ${deviationPercent >= 0 ? '+' : ''}${Math.round(deviationPercent)}%`,
      suggestion,
      occurredAt: new Date().toISOString(),
    };
  } catch (err: unknown) {
    logger.warn('[AOV] compute error:', err instanceof Error ? err.message : String(err));
    return null;
  }
}
