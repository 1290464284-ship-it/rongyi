import { Injectable } from '@nestjs/common';
import { DbService } from "../../../db/db.service";
import { CacheService } from "../../../common/services/cache.service";
import { ClinicContextService } from "../../../common/services/clinic-context.service";
import { buildClinicFilter } from "../../../common/utils/db/clinic-filter";
import { STATS_INVENTORY_CACHE_TTL_MS } from "../../../config/constants";
import { STATS_CACHE_KEYS, buildStatsCacheKey } from "../../../common/constants/cache-keys";
import { InventoryStatusRow } from "./stats.interfaces";

@Injectable()
export class InventoryStatsService {
  constructor(
    private dbService: DbService,
    private cache: CacheService,
    private clinicContext: ClinicContextService,
  ) {}

  async getInventoryStatus() {
    const clinicId = this.clinicContext.getClinicId();
    const key = buildStatsCacheKey(STATS_CACHE_KEYS.INVENTORY, clinicId ?? '');
    return this.cache.getOrSet(key, () => {
      const { clause: clinicClause, params: clinicParams } = buildClinicFilter(clinicId);
      return this.dbService.prepare(`SELECT category, COUNT(*) as count, SUM(stock) as totalStock FROM InventoryItem WHERE deletedAt IS NULL${clinicClause} GROUP BY category`).all(...clinicParams) as InventoryStatusRow[];
    }, STATS_INVENTORY_CACHE_TTL_MS);
  }
}
