import { Injectable } from '@nestjs/common';
import { DbService } from "../../../db/db.service";
import { IDatabase } from "../../../db/db.interface";
import { ClinicContextService } from "../../../common/services/clinic-context.service";
import { BusinessValidationException } from '@common/errors';
import { AuditLogType } from "../../../common/constants";
import { AuditLogService } from "../../../common/services/audit-log.service";
import { CacheService } from "../../../common/services/cache.service";
import {
  CACHE_PREFIXES,
  DICTIONARY_CACHE_KEYS,
  buildDictionaryCacheKey,
} from "../../../common/constants/cache-keys";
import { DRUG_CATALOG_CACHE_TTL_MS } from "../../../config/constants";
import { PAGINATION } from "../../../common/constants/pagination";
import { buildClinicFilter } from "../../../common/utils/db/clinic-filter";

interface DrugItem {
  code: string;
  name: string;
  stock: number;
}

@Injectable()
export class DrugCatalogService {
  constructor(
    private dbService: DbService,
    private clinicContext: ClinicContextService,
    private auditLogService: AuditLogService,
    private cache: CacheService,
  ) {}

  /**
   * 查询药品目录（带缓存）
   * 读多写少场景，缓存 30 分钟，库存扣减/目录变更时自动失效
   */
  async findCatalog(page = 1, pageSize: number = PAGINATION.DEFAULT_PAGE_SIZE_XLARGE) {
    const clinicId = this.clinicContext.getClinicId();
    const cacheKey = `${buildDictionaryCacheKey(DICTIONARY_CACHE_KEYS.DRUG_CATALOG, clinicId ?? '')}:p${page}:s${pageSize}`;
    // P0 修复：使用 getOrSet 提供缓存击穿保护 + buildClinicFilter 强制校验 clinicId
    // 原先 if (clinicId) 模式在 clinicId 缺失时会跳过过滤导致跨租户数据泄露
    return this.cache.getOrSet<unknown[]>(cacheKey, () => {
      const { clause: clinicClause, params: clinicParams } = buildClinicFilter(clinicId);
      return this.dbService.prepare(
        `SELECT id, code, name, spec, category, price, unit, stock, remark, clinicId, createdAt FROM DrugCatalog WHERE 1=1${clinicClause} ORDER BY code LIMIT ? OFFSET ?`,
      ).all(...clinicParams, pageSize, (page - 1) * pageSize);
    }, DRUG_CATALOG_CACHE_TTL_MS);
  }

  /**
   * 失效当前诊所的药品目录缓存
   */
  private invalidateCatalogCache(clinicId: string | null): void {
    if (!clinicId) return;
    this.cache.delPattern(`${CACHE_PREFIXES.DICTIONARY}${DICTIONARY_CACHE_KEYS.DRUG_CATALOG}:${clinicId}:`);
  }

  /**
   * 批量扣减药品库存（事务内调用）
   * @param items 要扣减的药品列表
   * @param db 可选的事务数据库连接，传入则在当前事务内执行
   */
  deductStock(items: Array<{ drugCode: string; drugName: string; quantity: number }>, db?: IDatabase) {
    if (items.length === 0) return;

    const executor = db || this.dbService;
    const clinicId = this.clinicContext.getClinicId();
    // P0 修复：使用 buildClinicFilter 强制校验 clinicId（缺失时抛错），
    // 原先条件性过滤在 clinicId 缺失时会跳过导致跨租户数据操作
    const { clause: clinicClause, params: clinicParams } = buildClinicFilter(clinicId);
    const drugCodes = items.map(item => item.drugCode);
    const placeholders = drugCodes.map(() => '?').join(',');
    const drugs = executor.prepare(
      `SELECT code, name, stock FROM DrugCatalog WHERE code IN (${placeholders})${clinicClause}`,
    ).all(...drugCodes, ...clinicParams) as DrugItem[];
    const drugMap = new Map(drugs.map(d => [d.code, d]));

    // 校验库存
    for (const item of items) {
      if (item.quantity <= 0 || !Number.isFinite(item.quantity)) {
        throw new BusinessValidationException(`药品 ${item.drugName} 数量必须大于0`);
      }
      const drug = drugMap.get(item.drugCode);
      if (drug) {
        if (drug.stock < item.quantity) {
          throw new BusinessValidationException(`药品 ${item.drugName} (${item.drugCode}) 库存不足，当前库存：${drug.stock}`);
        }
      }
    }

    // 扣减库存（CAS 保护：WHERE stock >= ? 防止并发扣减为负）
    const stmt = executor.prepare(
      "UPDATE DrugCatalog SET stock = stock - ? WHERE code = ? AND clinicId = ? AND stock >= ?",
    );
    for (const item of items) {
      const updateResult = stmt.run(item.quantity, item.drugCode, clinicId, item.quantity);
      if (updateResult.changes === 0) {
        throw new BusinessValidationException(`药品 ${item.drugName} (${item.drugCode}) 库存不足`);
      }
    }

    // 为每个药品单独记录审计日志，保持事务一致性
    for (const item of items) {
      this.auditLogService.logAudit(executor, AuditLogType.DRUG_STOCK_DEDUCT, item.drugCode, "DrugCatalog", clinicId, {
        afterData: { drugCode: item.drugCode, drugName: item.drugName, quantity: item.quantity },
      });
    }

    // 库存变更后失效药品目录缓存
    this.invalidateCatalogCache(clinicId);
  }
}
