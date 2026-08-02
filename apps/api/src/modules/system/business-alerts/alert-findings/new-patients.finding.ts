import { IDatabase } from '../../../../db/db.interface';
import { AppLogger } from '../../../../common/services/logger.service';
import { buildClinicFilter } from '../../../../common/utils/db/clinic-filter';
import {
  FindingItem,
  classifySeverity,
} from '../thresholds';

const logger = new AppLogger('NewPatientsFinding');

export interface NewPatientsContext {
  runMonth: string;
  prevMonth: string;
  warn: number;
  critical: number;
}

export function computeNewPatientsFinding(
  db: IDatabase,
  clinicId: string,
  ctx: NewPatientsContext,
): FindingItem | null {
  try {
    const { clause, params } = buildClinicFilter(clinicId);

    const sql = `
      SELECT
        COALESCE(SUM(CASE WHEN strftime('%Y-%m', p.createdAt) = ? THEN 1 END), 0) as monthCount,
        COALESCE(SUM(CASE WHEN strftime('%Y-%m', p.createdAt) = ? THEN 1 END), 0) as prevCount,
        COUNT(*) as totalPatients
      FROM Patient p
      WHERE p.deletedAt IS NULL
        AND (strftime('%Y-%m', p.createdAt) = ? OR strftime('%Y-%m', p.createdAt) = ?)
        ${clause}
    `;

    const row = db.prepare(sql).get(
      ctx.runMonth, ctx.prevMonth,
      ctx.runMonth, ctx.prevMonth,
      ...params,
    ) as { monthCount: number; prevCount: number; totalPatients: number } | undefined;

    if (!row) return null;

    const current = row.monthCount;
    const baseline = row.prevCount;
    const dataPoints = current + baseline;

    if (baseline === 0) {
      logger.warn(`[NewPatients] skip: baseline=0 (上月新增为0) clinic=${clinicId}`);
      return null;
    }

    const dropPercent = ((current - baseline) / baseline) * 100;
    if (isNaN(dropPercent) || !isFinite(dropPercent)) {
      logger.warn(`[NewPatients] skip: invalid dropPercent current=${current} baseline=${baseline}`);
      return null;
    }

    let severity = classifySeverity(Math.abs(dropPercent), ctx.warn, ctx.critical);
    if (dataPoints < 10 && severity !== 'INFO') {
      severity = severity === 'CRITICAL' ? 'WARN' : 'INFO';
      logger.warn(`[NewPatients] downgrade severity: dataPoints=${dataPoints} < 10 clinic=${clinicId}`);
    }

    const dropPct = Math.abs(Math.round(dropPercent));
    const suggestion = severity !== 'INFO'
      ? `新增患者环比${dropPercent < 0 ? '下降' : '上升'} ${dropPct}%，建议：新增渠道/地推/老客转介绍 + 优化预约流程减少 NO_SHOW`
      : `新增患者环比 ${dropPercent >= 0 ? '+' : ''}${dropPct}%，关注后续走势`;

    return {
      alertType: 'NEW_PATIENTS',
      severity,
      metricName: 'new-patients',
      currentValue: current,
      baselineValue: baseline,
      deviationPercent: Math.round(dropPercent * 100) / 100,
      message: `${ctx.runMonth} 新增 ${current} 人，${ctx.prevMonth} 新增 ${baseline} 人，环比 ${dropPercent >= 0 ? '+' : ''}${Math.round(dropPercent)}%`,
      suggestion,
      occurredAt: new Date().toISOString(),
    };
  } catch (err: unknown) {
    logger.warn('[NewPatients] compute error:', err instanceof Error ? err.message : String(err));
    return null;
  }
}
