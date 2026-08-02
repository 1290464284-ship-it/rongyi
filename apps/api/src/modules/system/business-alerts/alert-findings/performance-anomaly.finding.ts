import { IDatabase } from '../../../../db/db.interface';
import { AppLogger } from '../../../../common/services/logger.service';
import { buildClinicFilter } from '../../../../common/utils/db/clinic-filter';
import {
  FindingItem,
  classifySeverity,
} from '../thresholds';

const logger = new AppLogger('PerformanceAnomalyFinding');

export interface PerformanceAnomalyContext {
  todayISO: string;
  warn: number;
  critical: number;
}

function isoDateMinusDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

export function computePerformanceAnomalyFindings(
  db: IDatabase,
  clinicId: string,
  ctx: PerformanceAnomalyContext,
): FindingItem[] {
  const results: FindingItem[] = [];
  try {
    const { clause, params } = buildClinicFilter(clinicId);
    const chargeClinicClause = clause.replace('clinicId', 'c.clinicId');

    const last30Start = isoDateMinusDays(ctx.todayISO, 30);
    const last120Start = isoDateMinusDays(ctx.todayISO, 120);
    const last30ExclusiveEnd = isoDateMinusDays(ctx.todayISO, 30);

    const sql = `
      SELECT
        c.doctorId,
        COALESCE(SUM(CASE WHEN c.paidAt >= ? AND c.paidAt < ? THEN c.paidAmount END), 0) as recent30Revenue,
        COALESCE(SUM(CASE WHEN c.paidAt >= ? AND c.paidAt < ? THEN c.paidAmount END), 0) as history90Revenue,
        COALESCE(SUM(CASE WHEN c.paidAt >= ? AND c.paidAt < ? THEN 1 END), 0) as history90Count,
        COALESCE(SUM(CASE WHEN c.paidAt >= ? AND c.paidAt < ? THEN 1 END), 0) as recent30Count
      FROM Charge c
      WHERE c.deletedAt IS NULL
        AND c.doctorId IS NOT NULL
        AND c.paidAt >= ? AND c.paidAt < ?
        ${chargeClinicClause}
      GROUP BY c.doctorId
    `;

    const rows = db.prepare(sql).all(
      last30Start, ctx.todayISO,
      last120Start, last30ExclusiveEnd,
      last120Start, last30ExclusiveEnd,
      last30Start, ctx.todayISO,
      last120Start, ctx.todayISO,
      ...params,
    ) as Array<{
      doctorId: string;
      recent30Revenue: number;
      history90Revenue: number;
      history90Count: number;
      recent30Count: number;
    }>;

    for (const row of rows) {
      if (row.history90Count < 30) {
        continue;
      }
      const historyMean = row.history90Revenue / 3;
      if (historyMean === 0) continue;

      const historyValues = Array(30).fill(historyMean / 10);
      const recent30Mean = row.recent30Revenue;
      const variance = historyValues.reduce((s, v) => s + Math.pow(v - historyMean / 3, 2), 0) / 30;
      const stddev = Math.sqrt(variance);
      if (stddev === 0) continue;

      const z = (recent30Mean - historyMean) / stddev;
      if (isNaN(z) || !isFinite(z)) continue;

      const zAbs = Math.abs(z);
      const severity = classifySeverity(zAbs, ctx.warn, ctx.critical);

      if (severity === 'INFO') continue;

      const zVal = Math.round(z * 10) / 10;
      const suggestion = severity === 'CRITICAL'
        ? `该医生本月业绩异常偏高 Z=${zVal}，建议：1. 复核避免录入串单 2. 优秀经验全诊所复用`
        : `该医生业绩 Z 值异常（Z=${zVal}），建议关注并分析原因`;

      results.push({
        alertType: 'PERFORMANCE_ANOMALY',
        severity,
        metricName: `doctor-${row.doctorId}`,
        currentValue: row.recent30Revenue,
        baselineValue: Math.round(historyMean),
        deviationPercent: zVal,
        message: `医生 ${row.doctorId} 近 30 天营收 ¥${row.recent30Revenue}，历史 μ≈¥${Math.round(historyMean)} σ≈¥${Math.round(stddev)}，Z=${zVal}`,
        suggestion,
        occurredAt: new Date().toISOString(),
      });
    }

    return results;
  } catch (err: unknown) {
    logger.warn('[PerformanceAnomaly] compute error:', err instanceof Error ? err.message : String(err));
    return [];
  }
}
