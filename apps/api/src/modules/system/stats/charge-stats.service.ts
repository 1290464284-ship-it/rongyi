import { Injectable } from "@nestjs/common";
import { DbService } from "../../../db/db.service";
import { CacheService } from "../../../common/services/cache.service";
import { endOfDay } from "../../../common/utils/format/date";
import { ClinicContextService } from "../../../common/services/clinic-context.service";
import { centsToYuan } from "../../../common/utils/format/money.utils";
import { buildClinicFilter } from "../../../common/utils/db/clinic-filter";
import { STATS_CHARGE_CACHE_TTL_MS } from "../../../config/constants";
import { STATS_CACHE_KEYS, buildStatsCacheKey } from "../../../common/constants/cache-keys";
import { DateAmountRow } from "./stats.interfaces";

@Injectable()
export class ChargeStatsService {
  constructor(
    private dbService: DbService,
    private cache: CacheService,
    private clinicContext: ClinicContextService,
  ) {}

  async getChargeStats(params: { startDate?: string; endDate?: string }) {
    const { startDate, endDate } = params;
    const clinicId = this.clinicContext.getClinicId();
    const key = buildStatsCacheKey(
      STATS_CACHE_KEYS.CHARGE,
      clinicId,
      startDate || '',
      endDate || '',
    );
    return this.cache.getOrSet(key, () => {
      const { clause: clinicClause, params: clinicParams } = buildClinicFilter(clinicId);
      const dateFilter = startDate && endDate ? "AND paidAt >= ? AND paidAt <= ?" : "";
      const qp: unknown[] = [];
      if (startDate && endDate) { qp.push(startDate, endOfDay(endDate)); }
      const daily = (this.dbService.prepare(
        `SELECT date(paidAt) as date, COUNT(*) as count, COALESCE(SUM(paidAmount),0) as amount FROM Charge WHERE deletedAt IS NULL AND paidAt IS NOT NULL ${dateFilter}${clinicClause} GROUP BY date ORDER BY date`
      ).all(...qp, ...clinicParams) as DateAmountRow[]).map(r => ({ ...r, amount: centsToYuan(r.amount) }));
      const monthly = (this.dbService.prepare(
        `SELECT substr(paidAt,1,7) as month, COUNT(*) as count, COALESCE(SUM(paidAmount),0) as amount FROM Charge WHERE deletedAt IS NULL AND paidAt IS NOT NULL ${dateFilter}${clinicClause} GROUP BY month ORDER BY month`
      ).all(...qp, ...clinicParams) as DateAmountRow[]).map(r => ({ ...r, amount: centsToYuan(r.amount) }));
      return { daily, monthly };
    }, STATS_CHARGE_CACHE_TTL_MS);
  }
}
