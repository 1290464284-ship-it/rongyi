import { BusinessNotFoundException, BusinessValidationException } from '@common/errors';
import { Injectable } from '@nestjs/common';

import { DbService } from "../../../db/db.service";
import { IDatabase } from "../../../db/db.interface";
import { BaseService } from "../../../common/services/base.service";
import { InventoryItem } from "@dental/shared";
import * as crypto from "node:crypto";
import { ClinicContextService } from "../../../common/services/clinic-context.service";
import { IdempotencyService } from "../../../common/services/idempotency.service";
import { buildClinicFilter } from "../../../common/utils/db/clinic-filter";
import { PAGINATION } from "../../../common/constants/pagination";
import { COLUMN_NAME_REGEX } from "../../../common/utils/db/validate-name";
import { StatsService } from '../../system/stats/stats.service';

@Injectable()
export class InventoryService extends BaseService<InventoryItem> {
  constructor(
    dbService: DbService,
    clinicContext: ClinicContextService,
    private idempotency: IdempotencyService,
    private statsService: StatsService,
  ) {
    super(dbService, clinicContext, "InventoryItem", [], ["name","code"], [{ table: "InventoryTransaction", foreignKey: "itemId" }], true, ["code"]);
  }

  async update(id: string, dto: Partial<{ code: string; name: string; spec: string; category: string; unit: string; stock: number; minStock: number; price: number; supplierId: string; expireDate: string; location: string; remark: string }>) {
    // P1 修复（库存 update 绕过流水）：禁止直接修改 stock，必须通过 stockAction API 留下交易记录
    if (dto.stock !== undefined) {
      throw new BusinessValidationException("禁止直接修改库存数量，请使用入库/出库/调整 API（stockAction）以留下交易流水");
    }
    const updates: string[] = [];
    const params: unknown[] = [];
    const fields: Record<string, unknown> = { ...dto };
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) {
        if (!COLUMN_NAME_REGEX.test(key)) throw new BusinessValidationException("无效的字段名");
        updates.push(`${key} = ?`);
        params.push(value);
      }
    }
    if (updates.length === 0) return super.findOne(id);
    const { clause: clinicClause, params: clinicParams } = buildClinicFilter(this.clinicContext.getClinicId());
    params.push(new Date().toISOString(), id, ...clinicParams);
    this.dbService.prepare(`UPDATE InventoryItem SET ${updates.join(', ')}, updatedAt = ? WHERE id = ? AND deletedAt IS NULL${clinicClause}`).run(...params);
    this.logAudit(this.dbService, "INVENTORY_UPDATE", id, "InventoryItem", { beforeData: dto, afterData: dto });
    return super.findOne(id);
  }

  async findLowStockItems() {
    const { clause: clinicClause, params: clinicParams } = buildClinicFilter(this.clinicContext.getClinicId());
    return this.dbService.prepare(`SELECT id, code, name, spec, category, unit, stock, minStock, price, supplierId, location FROM InventoryItem WHERE deletedAt IS NULL AND stock <= minStock${clinicClause} ORDER BY stock ASC`).all(...clinicParams);
  }
  async findTransactions(itemId?: string, { limit = PAGINATION.DEFAULT_PAGE_SIZE_LARGE, offset = 0 }: { limit?: number; offset?: number } = {}) {
    const { clause: clinicClause, params: clinicParams } = buildClinicFilter(this.clinicContext.getClinicId());
    if (itemId) return this.dbService.prepare(`SELECT id, itemId, type, quantity, unitPrice, totalAmount, supplierId, operatorId, operatorName, remark, createdAt FROM InventoryTransaction WHERE itemId=?${clinicClause} ORDER BY createdAt DESC LIMIT ? OFFSET ?`).all(itemId, ...clinicParams, limit, offset);
    return this.dbService.prepare(`SELECT id, itemId, type, quantity, unitPrice, totalAmount, supplierId, operatorId, operatorName, remark, createdAt FROM InventoryTransaction WHERE 1=1${clinicClause} ORDER BY createdAt DESC LIMIT ? OFFSET ?`).all(...clinicParams, limit, offset);
  }

  async stockAction(dto: { itemId: string; type: string; quantity: number; unitPrice?: number; supplierId?: string; remark?: string; operatorId?: string; operatorName?: string; requestId?: string }) {
    if (!Number.isFinite(dto.quantity) || dto.quantity <= 0) {
      throw new BusinessValidationException("数量必须大于0");
    }
    const now = new Date().toISOString();

    const handler = (db: IDatabase) => {
      const clinicId = this.clinicContext.getClinicId();
      const { clause: clinicClause, params: clinicParams } = buildClinicFilter(clinicId);
      const item = db.prepare(`SELECT id, code, name, stock FROM InventoryItem WHERE id = ? AND deletedAt IS NULL${clinicClause}`).get(dto.itemId, ...clinicParams) as Record<string, unknown> | undefined;
      if (!item) throw new BusinessNotFoundException("库存项不存在");

      let beforeStock = Number(item.stock) || 0;
      if (dto.type === 'IN') {
        const updateResult = db.prepare(`UPDATE InventoryItem SET stock = stock + ?, updatedAt = ? WHERE id = ?${clinicClause}`).run(dto.quantity, now, dto.itemId, ...clinicParams);
        if (updateResult.changes === 0) throw new BusinessValidationException("库存更新失败");
      } else if (dto.type === 'OUT') {
        const updateResult = db.prepare(`UPDATE InventoryItem SET stock = stock - ?, updatedAt = ? WHERE id = ? AND stock >= ?${clinicClause}`).run(dto.quantity, now, dto.itemId, dto.quantity, ...clinicParams);
        if (updateResult.changes === 0) throw new BusinessValidationException("库存不足");
      } else if (dto.type === 'ADJUST') {
        if (dto.quantity < 0) throw new BusinessValidationException("调整数量不能为负");
        const currentStock = Number(item.stock) || 0;
        const updateResult = db.prepare(`UPDATE InventoryItem SET stock = ?, updatedAt = ? WHERE id = ? AND stock = ?${clinicClause}`).run(dto.quantity, now, dto.itemId, currentStock, ...clinicParams);
        if (updateResult.changes === 0) throw new BusinessValidationException("库存并发修改，请刷新后重试");
      } else {
        throw new BusinessValidationException("无效的库存操作类型");
      }

      const updatedItem = db.prepare(`SELECT stock FROM InventoryItem WHERE id = ? AND deletedAt IS NULL${clinicClause}`).get(dto.itemId, ...clinicParams) as Record<string, unknown> | undefined;
      if (!updatedItem) throw new BusinessNotFoundException("库存项不存在");
      const newStock = Number(updatedItem.stock) || 0;

      const txId = crypto.randomUUID();
      db.prepare("INSERT INTO InventoryTransaction (id, itemId, type, quantity, unitPrice, totalAmount, supplierId, operatorId, operatorName, remark, clinicId, createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
        .run(txId, dto.itemId, dto.type, dto.quantity, dto.unitPrice || 0, (dto.unitPrice || 0) * dto.quantity, dto.supplierId || null, dto.operatorId || null, dto.operatorName || null, dto.remark || null, clinicId || null, now);
      this.logAudit(db, "STOCK_" + dto.type, dto.itemId, "InventoryItem", { beforeData: { stock: beforeStock }, afterData: { stock: newStock } });

      return { id: txId, stock: newStock };
    };

    const idempotencyKey = dto.requestId ? `stock_action:${dto.itemId}:${dto.requestId}` : null;
    if (idempotencyKey) {
      const result = await this.idempotency.executeInTransaction(
        { key: idempotencyKey, type: 'STOCK_ACTION', processingMessage: '库存操作处理中，请稍后再试' },
        handler,
      );
      this.statsService.invalidateStatsCache('dashboard');
      this.statsService.invalidateStatsCache('inventory');
      return result;
    }
    const result = this.dbService.transaction(handler);
    this.statsService.invalidateStatsCache('dashboard');
    this.statsService.invalidateStatsCache('inventory');
    return result;
  }
}
