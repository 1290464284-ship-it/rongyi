import { Injectable } from '@nestjs/common';
import { DbService } from "../../../db/db.service";
import { CacheService } from "../../../common/services/cache.service";
import { endOfDay } from "../../../common/utils/format/date";
import { ClinicContextService } from "../../../common/services/clinic-context.service";
import { buildClinicFilter } from "../../../common/utils/db/clinic-filter";
import { STATS_DOCTOR_WORKLOAD_CACHE_TTL_MS } from "../../../config/constants";
import { STATS_CACHE_KEYS, buildStatsCacheKey } from "../../../common/constants/cache-keys";
import { DoctorWorkloadRow } from "./stats.interfaces";

@Injectable()
export class DoctorStatsService {
  constructor(
    private dbService: DbService,
    private cache: CacheService,
    private clinicContext: ClinicContextService,
  ) {}

  async doctorWorkload(params: { startDate?: string; endDate?: string }) {
    const { startDate, endDate } = params;
    const clinicId = this.clinicContext.getClinicId();
    const key = buildStatsCacheKey(
      STATS_CACHE_KEYS.DOCTOR_WORKLOAD,
      clinicId ?? '',
      startDate || '',
      endDate || '',
    );
    return this.cache.getOrSet(key, () => {
      const clinicFilter = buildClinicFilter(clinicId);
      const clinicClause = clinicFilter.clause.replace('clinicId', 't.clinicId');
      const clinicParams = clinicFilter.params;
      const dateFilter = startDate && endDate ? "AND t.completedDate >= ? AND t.completedDate <= ?" : "";
      const qp: unknown[] = [];
      if (startDate && endDate) { qp.push(startDate, endOfDay(endDate)); }
      return this.dbService.prepare(
        `SELECT t.doctorId, u.name as doctorName, COUNT(t.id) as count, COALESCE(SUM(t.price * t.quantity),0) as amount FROM Treatment t LEFT JOIN User u ON t.doctorId = u.id WHERE t.deletedAt IS NULL ${dateFilter}${clinicClause} GROUP BY t.doctorId ORDER BY amount DESC`
      ).all(...qp, ...clinicParams) as DoctorWorkloadRow[];
    }, STATS_DOCTOR_WORKLOAD_CACHE_TTL_MS);
  }
}
