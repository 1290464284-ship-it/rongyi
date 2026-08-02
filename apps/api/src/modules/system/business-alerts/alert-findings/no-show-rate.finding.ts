import { IDatabase } from '../../../../db/db.interface';
import { AppLogger } from '../../../../common/services/logger.service';
import { buildClinicFilter } from '../../../../common/utils/db/clinic-filter';
import {
  FindingItem,
  classifySeverity,
} from '../thresholds';

const logger = new AppLogger('NoShowRateFinding');

export interface NoShowRateContext {
  runMonth: string;
  warn: number;
  critical: number;
}

const NO_SHOW_STATUSES = ['NO_SHOW', 'CANCELLED_LATE', 'UNANSWERED'];
const COUNTED_STATUSES = ['COMPLETED', 'NO_SHOW', 'CANCELLED_LATE', 'UNANSWERED', 'LATE', 'CANCELLED'];

export function computeNoShowRateFinding(
  db: IDatabase,
  clinicId: string,
  ctx: NoShowRateContext,
): FindingItem | null {
  try {
    const { clause, params } = buildClinicFilter(clinicId);
    const apptClinicClause = clause.replace('clinicId', 'a.clinicId');

    const placeholdersNoShow = NO_SHOW_STATUSES.map(() => '?').join(',');
    const placeholdersCounted = COUNTED_STATUSES.map(() => '?').join(',');

    const sql = `
      SELECT
        COALESCE(SUM(CASE WHEN a.status IN (${placeholdersNoShow}) THEN 1 END), 0) as noShowCount,
        COALESCE(SUM(CASE WHEN a.status IN (${placeholdersCounted}) THEN 1 END), 0) as totalCount
      FROM Appointment a
      WHERE a.deletedAt IS NULL
        AND strftime('%Y-%m', a.startTime) = ?
        ${apptClinicClause}
    `;

    const row = db.prepare(sql).get(
      ...NO_SHOW_STATUSES,
      ...COUNTED_STATUSES,
      ctx.runMonth,
      ...params,
    ) as { noShowCount: number; totalCount: number } | undefined;

    if (!row || row.totalCount === 0) {
      return null;
    }

    const rate = (row.noShowCount / row.totalCount) * 100;
    if (isNaN(rate) || !isFinite(rate)) {
      logger.warn(`[NoShowRate] skip: invalid rate noShow=${row.noShowCount} total=${row.totalCount}`);
      return null;
    }

    const severity = classifySeverity(rate, ctx.warn, ctx.critical);
    const ratePct = Math.round(rate * 10) / 10;

    const suggestion = severity !== 'INFO'
      ? `失约率 ${ratePct}%，建议：提前 2h 短信/微信提醒；优化预约时间选择与日程安排`
      : `失约率 ${ratePct}%，处于正常范围`;

    return {
      alertType: 'NO_SHOW_RATE',
      severity,
      metricName: 'no-show-rate',
      currentValue: row.noShowCount,
      baselineValue: row.totalCount,
      deviationPercent: ratePct,
      message: `${ctx.runMonth} 失约 ${row.noShowCount}/${row.totalCount}，失约率 ${ratePct}%`,
      suggestion,
      occurredAt: new Date().toISOString(),
    };
  } catch (err: unknown) {
    logger.warn('[NoShowRate] compute error:', err instanceof Error ? err.message : String(err));
    return null;
  }
}
