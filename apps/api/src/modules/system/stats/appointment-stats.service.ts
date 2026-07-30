import { Injectable } from '@nestjs/common';
import { DbService } from "../../../db/db.service";
import { CacheService } from "../../../common/services/cache.service";
import { endOfDay } from "../../../common/utils/format/date";
import { ClinicContextService } from "../../../common/services/clinic-context.service";
import { buildClinicFilter } from "../../../common/utils/db/clinic-filter";
import { STATS_APPOINTMENT_CACHE_TTL_MS } from "../../../config/constants";
import { STATS_CACHE_KEYS, buildStatsCacheKey } from "../../../common/constants/cache-keys";
import { DateCountRow, MonthCountRow, StatusCountRow } from "./stats.interfaces";
import { CLINIC_TZ_SQL_MODIFIER } from "@dental/shared";

@Injectable()
export class AppointmentStatsService {
  constructor(
    private dbService: DbService,
    private cache: CacheService,
    private clinicContext: ClinicContextService,
  ) {}

  async getAppointmentStats(params: { startDate?: string; endDate?: string }) {
    const { startDate, endDate } = params;
    const clinicId = this.clinicContext.getClinicId();
    const key = buildStatsCacheKey(
      STATS_CACHE_KEYS.APPOINTMENT,
      clinicId ?? '',
      startDate || '',
      endDate || '',
    );
    return this.cache.getOrSet(key, () => {
      const { clause: clinicClause, params: clinicParams } = buildClinicFilter(clinicId);
      const dateFilter = startDate && endDate ? "AND startTime >= ? AND startTime <= ?" : "";
      const qp: unknown[] = [];
      if (startDate && endDate) { qp.push(startDate, endOfDay(endDate)); }
      const byStatus = this.dbService.prepare(
        `SELECT status, COUNT(*) as count FROM Appointment WHERE deletedAt IS NULL ${dateFilter}${clinicClause} GROUP BY status`
      ).all(...qp, ...clinicParams) as StatusCountRow[];
      const total = byStatus.reduce((s: number, r) => s + r.count, 0);
      const statusItems = total === 0
        ? byStatus.map(r => ({ status: r.status, count: r.count, percentage: 0 }))
        : byStatus.map(r => ({ status: r.status, count: r.count, percentage: Math.round((r.count / total) * 100) }));
      const daily = this.dbService.prepare(
        `SELECT date(startTime, '${CLINIC_TZ_SQL_MODIFIER}') as date, COUNT(*) as count FROM Appointment WHERE deletedAt IS NULL ${dateFilter}${clinicClause} GROUP BY date ORDER BY date`
      ).all(...qp, ...clinicParams) as DateCountRow[];
      const monthly = this.dbService.prepare(
        `SELECT substr(startTime,1,7) as month, COUNT(*) as count FROM Appointment WHERE deletedAt IS NULL ${dateFilter}${clinicClause} GROUP BY month ORDER BY month`
      ).all(...qp, ...clinicParams) as MonthCountRow[];
      return { status: statusItems, daily, monthly };
    }, STATS_APPOINTMENT_CACHE_TTL_MS);
  }
}
