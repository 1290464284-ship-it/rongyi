import { Injectable } from '@nestjs/common';
import { DbService } from "../../../db/db.service";
import { CacheService } from "../../../common/services/cache.service";
import { ClinicContextService } from "../../../common/services/clinic-context.service";
import { centsToYuan } from "../../../common/utils/format/money.utils";
import { buildClinicFilter } from "../../../common/utils/db/clinic-filter";
import { STATS_MEMBER_CACHE_TTL_MS } from "../../../config/constants";
import { STATS_CACHE_KEYS, buildStatsCacheKey } from "../../../common/constants/cache-keys";
import { MonthCountRow, MemberLevelRow } from "./stats.interfaces";

@Injectable()
export class MemberStatsService {
  constructor(
    private dbService: DbService,
    private cache: CacheService,
    private clinicContext: ClinicContextService,
  ) {}

  async getMemberStats() {
    const clinicId = this.clinicContext.getClinicId();
    const key = buildStatsCacheKey(STATS_CACHE_KEYS.MEMBER, clinicId ?? '');
    return this.cache.getOrSet(key, () => {
      const { clause: clinicClause, params: clinicParams } = buildClinicFilter(clinicId);
      const summary = this.dbService.prepare(
        `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END) AS active,
        COALESCE(SUM(balance), 0) AS totalBalance,
        COALESCE(SUM(points), 0) AS totalPoints
      FROM MemberCard WHERE deletedAt IS NULL${clinicClause}`
      ).get(...clinicParams) as { total: number; active: number; totalBalance: number; totalPoints: number };
      const total = summary?.total || 0;
      const active = summary?.active || 0;
      const totalBalance = summary?.totalBalance || 0;
      const totalPoints = summary?.totalPoints || 0;
      const monthly = this.dbService.prepare(
        `SELECT substr(createdAt,1,7) as month, COUNT(*) as count FROM MemberCard WHERE deletedAt IS NULL${clinicClause} GROUP BY month ORDER BY month`
      ).all(...clinicParams) as MonthCountRow[];
      const levels = this.dbService.prepare(
        `SELECT level, COUNT(*) as count FROM MemberCard WHERE deletedAt IS NULL${clinicClause} GROUP BY level`
      ).all(...clinicParams) as MemberLevelRow[];
      const levelTotal = levels.reduce((s: number, l) => s + l.count, 0);
      const levelDistribution = levelTotal === 0
        ? levels.map(l => ({ level: l.level, count: l.count, percentage: 0 }))
        : levels.map(l => ({ level: l.level, count: l.count, percentage: Math.round((l.count / levelTotal) * 100) }));
      return { total, active, expired: total - active, totalMembers: total, totalBalance: String(centsToYuan(totalBalance)), totalPoints, monthly, levelDistribution };
    }, STATS_MEMBER_CACHE_TTL_MS);
  }
}
