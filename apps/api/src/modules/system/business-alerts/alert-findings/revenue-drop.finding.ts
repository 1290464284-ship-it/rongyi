import { IDatabase } from '../../../../db/db.interface';
import { AppLogger } from '../../../../common/services/logger.service';
import { buildClinicFilter } from '../../../../common/utils/db/clinic-filter';
import {
  FindingItem,
  classifySeverity,
} from '../thresholds';

const logger = new AppLogger('RevenueDropFinding');

export interface RevenueDropContext {
  runMonth: string;
  prevMonth: string;
  warn: number;
  critical: number;
}

export function computeRevenueDropFinding(
  db: IDatabase,
  clinicId: string,
  ctx: RevenueDropContext,
): FindingItem | null {
  try {
    const { clause, params } = buildClinicFilter(clinicId);
    const chargeClinicClause = clause.replace('clinicId', 'c.clinicId');

    const sql = `
      SELECT
        COALESCE(SUM(CASE WHEN strftime('%Y-%m', c.paidAt) = ? THEN c.paidAmount END), 0) as monthRevenue,
        COALESCE(SUM(CASE WHEN strftime('%Y-%m', c.paidAt) = ? THEN c.paidAmount END), 0) as prevRevenue,
        COALESCE(SUM(CASE WHEN c.paidAt IS NOT NULL THEN 1 END), 0) as totalPaidCharges
      FROM Charge c
      WHERE c.deletedAt IS NULL
        AND (strftime('%Y-%m', c.paidAt) = ? OR strftime('%Y-%m', c.paidAt) = ?)
        ${chargeClinicClause}
    `;

    const row = db.prepare(sql).get(
      ctx.runMonth, ctx.prevMonth,
      ctx.runMonth, ctx.prevMonth,
      ...params,
    ) as { monthRevenue: number; prevRevenue: number; totalPaidCharges: number } | undefined;

    if (!row || row.totalPaidCharges < 30) {
      if (row && row.totalPaidCharges > 0) {
        logger.warn(`[RevenueDrop] skip: dataPoints=${row.totalPaidCharges} < 30 clinic=${clinicId}`);
      }
      return null;
    }

    const current = row.monthRevenue;
    const baseline = row.prevRevenue;

    if (baseline === 0) {
      logger.warn(`[RevenueDrop] skip: baseline=0 (上月营收为0) clinic=${clinicId}`);
      return null;
    }

    const deviationPercent = ((current - baseline) / baseline) * 100;
    if (isNaN(deviationPercent) || !isFinite(deviationPercent)) {
      logger.warn(`[RevenueDrop] skip: invalid deviation current=${current} baseline=${baseline}`);
      return null;
    }

    const severity = classifySeverity(Math.abs(deviationPercent), ctx.warn, ctx.critical);
    const dropPct = Math.abs(Math.round(deviationPercent));

    const suggestion = severity === 'CRITICAL'
      ? `营收大幅下跌 ${dropPct}%，建议：1. 检查本月价格/优惠策略 2. 加强预约跟进短信/电话 3. 重点回访高价值流失客户`
      : severity === 'WARN'
      ? `营收下跌 ${dropPct}%，建议：分析下跌原因（客单价/客流/项目）并制定针对性措施`
      : `营收环比 ${deviationPercent >= 0 ? '上涨' : '下跌'} ${dropPct}%，关注后续走势`;

    return {
      alertType: 'REVENUE_DROP',
      severity,
      metricName: 'monthly-revenue',
      currentValue: current,
      baselineValue: baseline,
      deviationPercent: Math.round(deviationPercent * 100) / 100,
      message: `${ctx.runMonth} 营收 ¥${current}，${ctx.prevMonth} 营收 ¥${baseline}，环比 ${deviationPercent >= 0 ? '+' : ''}${Math.round(deviationPercent)}%`,
      suggestion,
      occurredAt: new Date().toISOString(),
    };
  } catch (err: unknown) {
    logger.warn('[RevenueDrop] compute error:', err instanceof Error ? err.message : String(err));
    return null;
  }
}
