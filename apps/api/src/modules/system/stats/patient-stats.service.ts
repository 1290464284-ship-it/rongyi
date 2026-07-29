import { Injectable } from '@nestjs/common';
import { DbService } from "../../../db/db.service";
import { CacheService } from "../../../common/services/cache.service";
import { endOfDay } from "../../../common/utils/format/date";
import { ClinicContextService } from "../../../common/services/clinic-context.service";
import { buildClinicFilter } from "../../../common/utils/db/clinic-filter";
import {
  STATS_PATIENT_GROWTH_CACHE_TTL_MS,
  STATS_PATIENT_CACHE_TTL_MS,
} from "../../../config/constants";
import { STATS_CACHE_KEYS, buildStatsCacheKey } from "../../../common/constants/cache-keys";
import { DateCountRow, MonthCountRow } from "./stats.interfaces";

@Injectable()
export class PatientStatsService {
  constructor(
    private dbService: DbService,
    private cache: CacheService,
    private clinicContext: ClinicContextService,
  ) {}

  async getPatientGrowth(params: { startDate?: string; endDate?: string }) {
    const { startDate, endDate } = params;
    const clinicId = this.clinicContext.getClinicId();
    const key = buildStatsCacheKey(
      STATS_CACHE_KEYS.PATIENT_GROWTH,
      clinicId ?? '',
      startDate || '',
      endDate || '',
    );
    return this.cache.getOrSet(key, () => {
      const { clause: clinicClause, params: clinicParams } = buildClinicFilter(clinicId);
      const dateFilter = startDate && endDate ? `WHERE createdAt >= ? AND createdAt <= ? AND deletedAt IS NULL${clinicClause}` : `WHERE deletedAt IS NULL${clinicClause}`;
      const qp: unknown[] = [];
      if (startDate && endDate) { qp.push(startDate, endOfDay(endDate)); }
      const rows = this.dbService.prepare(
        `SELECT substr(createdAt,1,7) as month, COUNT(*) as count FROM Patient ${dateFilter} GROUP BY month ORDER BY month`
      ).all(...qp, ...clinicParams) as MonthCountRow[];
      let runningTotal = 0;
      return { items: rows.map(r => { runningTotal += r.count; return { date: r.month, count: r.count, total: runningTotal }; }) };
    }, STATS_PATIENT_GROWTH_CACHE_TTL_MS);
  }

  async getPatientStats(params: { startDate?: string; endDate?: string }) {
    const { startDate, endDate } = params;
    const clinicId = this.clinicContext.getClinicId();
    const key = buildStatsCacheKey(
      STATS_CACHE_KEYS.PATIENT,
      clinicId ?? '',
      startDate || '',
      endDate || '',
    );
    return this.cache.getOrSet(key, () => {
      const { clause: clinicClause, params: clinicParams } = buildClinicFilter(clinicId);
      const dateFilter = startDate && endDate ? `WHERE createdAt >= ? AND createdAt <= ? AND deletedAt IS NULL${clinicClause}` : `WHERE deletedAt IS NULL${clinicClause}`;
      const qp: unknown[] = [];
      if (startDate && endDate) { qp.push(startDate, endOfDay(endDate)); }
      const daily = this.dbService.prepare(
        `SELECT date(createdAt) as date, COUNT(*) as count FROM Patient ${dateFilter} GROUP BY date ORDER BY date`
      ).all(...qp, ...clinicParams) as DateCountRow[];
      const monthly = this.dbService.prepare(
        `SELECT substr(createdAt,1,7) as month, COUNT(*) as count FROM Patient ${dateFilter} GROUP BY month ORDER BY month`
      ).all(...qp, ...clinicParams) as MonthCountRow[];
      return { daily, monthly };
    }, STATS_PATIENT_CACHE_TTL_MS);
  }
}
