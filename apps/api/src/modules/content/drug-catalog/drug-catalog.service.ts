import { Injectable } from '@nestjs/common';
import { DbService } from "../../../db/db.service";
import { ClinicContextService } from "../../../common/services/clinic-context.service";
import { BusinessValidationException } from '@common/errors';
import { AuditLogType } from "../../../common/constants";
import { AuditLogService } from "../../../common/services/audit-log.service";

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
  ) {}

  /**
   * 批量扣减药品库存（事务内调用）
   * @param items 要扣减的药品列表
   * @param db 可选的事务数据库连接，传入则在当前事务内执行
   */
  deductStock(items: Array<{ drugCode: string; drugName: string; quantity: number }>, db?: { prepare: (sql: string) => { get: (...args: unknown[]) => unknown; all: (...args: unknown[]) => unknown[]; run: (...args: unknown[]) => { changes: number } } }) {
    if (items.length === 0) return;

    const executor = db || this.dbService;
    const drugCodes = items.map(item => item.drugCode);
    const placeholders = drugCodes.map(() => '?').join(',');
    const drugs = executor.prepare(`SELECT code, name, stock FROM DrugCatalog WHERE code IN (${placeholders})`).all(...drugCodes) as DrugItem[];
    const drugMap = new Map(drugs.map(d => [d.code, d]));

    // 校验库存
    for (const item of items) {
      const drug = drugMap.get(item.drugCode);
      if (drug) {
        if (drug.stock < item.quantity) {
          throw new BusinessValidationException(`药品 ${item.drugName} (${item.drugCode}) 库存不足，当前库存：${drug.stock}`);
        }
      }
    }

    // 扣减库存
    const stmt = executor.prepare("UPDATE DrugCatalog SET stock = stock - ? WHERE code = ? AND stock >= ?");
    for (const item of items) {
      const updateResult = stmt.run(item.quantity, item.drugCode, item.quantity);
      if (updateResult.changes === 0) {
        throw new BusinessValidationException(`药品 ${item.drugName} (${item.drugCode}) 库存不足`);
      }
    }

    const clinicId = this.clinicContext.getClinicId();
    this.auditLogService.logAudit(this.dbService, AuditLogType.DRUG_STOCK_DEDUCT, items[0].drugCode, "DrugCatalog", clinicId, {
      afterData: items.map(i => ({ drugCode: i.drugCode, quantity: i.quantity })),
    });
  }
}
