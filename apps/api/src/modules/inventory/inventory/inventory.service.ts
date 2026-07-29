import { BusinessException, BusinessNotFoundException, BusinessValidationException, ErrorCode } from '@common/errors';
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
import { EventBusService } from '../../../common/events/event-bus.service';
import { InventoryStockChangedEvent } from '../../../common/events/domain-events';
import { InventoryRepository } from './repositories/inventory.repository';

@Injectable()
export class InventoryService extends BaseService<InventoryItem> {
  constructor(
    dbService: DbService,
    clinicContext: ClinicContextService,
    private idempotency: IdempotencyService,
    private eventBus: EventBusService,
    private inventoryRepository: InventoryRepository,
  ) {
    super(dbService, clinicContext, { tableName: "InventoryItem", searchFields: ["name","code"], cascadeTables: [{ table: "InventoryTransaction", foreignKey: "itemId" }], uniqueFields: ["code"] });
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
    params.push(new Date().toISOString());
    this.inventoryRepository.update(this.dbService, id, [...updates, 'updatedAt = ?'], params, clinicClause, clinicParams);
    this.logAudit(this.dbService, "INVENTORY_UPDATE", id, "InventoryItem", { beforeData: dto, afterData: dto });
    return super.findOne(id);
  }

  async findLowStockItems() {
    const { clause: clinicClause, params: clinicParams } = buildClinicFilter(this.clinicContext.getClinicId());
    return this.inventoryRepository.findLowStockItems(this.dbService, clinicClause, clinicParams);
  }
  async findTransactions(itemId?: string, { limit = PAGINATION.DEFAULT_PAGE_SIZE_LARGE, offset = 0 }: { limit?: number; offset?: number } = {}) {
    const { clause: clinicClause, params: clinicParams } = buildClinicFilter(this.clinicContext.getClinicId());
    return this.inventoryRepository.findTransactions(this.dbService, {
      clinicClause,
      clinicParams,
      itemId,
      limit,
      offset,
    });
  }

  async stockAction(dto: { itemId: string; type: string; quantity: number; unitPrice?: number; supplierId?: string; remark?: string; operatorId?: string; operatorName?: string; requestId?: string }) {
    // 类型校验：IN/OUT 要求 quantity > 0，ADJUST 允许 quantity >= 0（设为零库存）
    if (dto.type === 'IN' || dto.type === 'OUT') {
      if (!Number.isFinite(dto.quantity) || dto.quantity <= 0) {
        this.logger.warn({
          message: '库存操作失败：数量无效',
          itemId: dto.itemId,
          type: dto.type,
          quantity: dto.quantity,
          operatorId: dto.operatorId,
        });
        throw new BusinessValidationException("数量必须大于0");
      }
    } else if (dto.type === 'ADJUST') {
      if (!Number.isFinite(dto.quantity) || dto.quantity < 0) {
        this.logger.warn({
          message: '库存操作失败：调整数量无效',
          itemId: dto.itemId,
          type: dto.type,
          quantity: dto.quantity,
          operatorId: dto.operatorId,
        });
        throw new BusinessValidationException("调整数量不能为负");
      }
    } else {
      throw new BusinessValidationException("无效的库存操作类型");
    }
    const now = new Date().toISOString();

    const handler = (db: IDatabase) => {
      const clinicId = this.clinicContext.getClinicId();
      const { clause: clinicClause, params: clinicParams } = buildClinicFilter(clinicId);
      const item = this.inventoryRepository.findItemForStockAction(db, dto.itemId, clinicClause, clinicParams);
      if (!item) {
        this.logger.warn({
          message: '库存操作失败：库存项不存在',
          itemId: dto.itemId,
          type: dto.type,
          quantity: dto.quantity,
          operatorId: dto.operatorId,
        });
        throw new BusinessNotFoundException("库存项不存在");
      }

      let beforeStock = Number(item.stock) || 0;
      if (dto.type === 'IN') {
        const updateResult = this.inventoryRepository.incrementStock(db, dto.itemId, dto.quantity, now, clinicClause, clinicParams);
        if (updateResult.changes === 0) throw new BusinessValidationException("库存更新失败");
      } else if (dto.type === 'OUT') {
        const updateResult = this.inventoryRepository.decrementStock(db, dto.itemId, dto.quantity, now, clinicClause, clinicParams);
        if (updateResult.changes === 0) {
          this.logger.warn({
            message: '库存操作失败：库存不足',
            itemId: dto.itemId,
            type: dto.type,
            quantity: dto.quantity,
            currentStock: beforeStock,
            operatorId: dto.operatorId,
          });
          throw new BusinessValidationException("库存不足");
        }
      } else if (dto.type === 'ADJUST') {
        const currentStock = Number(item.stock) || 0;
        const updateResult = this.inventoryRepository.setStockWithOptimisticLock(db, dto.itemId, dto.quantity, now, currentStock, clinicClause, clinicParams);
        if (updateResult.changes === 0) {
          this.logger.warn({
            message: '库存操作失败：并发修改',
            itemId: dto.itemId,
            type: dto.type,
            quantity: dto.quantity,
            currentStock,
            operatorId: dto.operatorId,
          });
          throw new BusinessValidationException("库存并发修改，请刷新后重试");
        }
      }

      const updatedItem = this.inventoryRepository.getStock(db, dto.itemId, clinicClause, clinicParams);
      if (!updatedItem) throw new BusinessNotFoundException("库存项不存在");
      const newStock = Number(updatedItem.stock) || 0;

      const txId = crypto.randomUUID();
      this.inventoryRepository.createTransaction(db, {
        id: txId,
        itemId: dto.itemId,
        type: dto.type,
        quantity: dto.quantity,
        unitPrice: dto.unitPrice || 0,
        totalAmount: (dto.unitPrice || 0) * dto.quantity,
        supplierId: dto.supplierId || undefined,
        operatorId: dto.operatorId || undefined,
        operatorName: dto.operatorName || undefined,
        remark: dto.remark || undefined,
        clinicId: this.clinicContext.getClinicId() ?? undefined,
        createdAt: now,
      });
      this.logAudit(db, "STOCK_" + dto.type, dto.itemId, "InventoryItem", { beforeData: { stock: beforeStock }, afterData: { stock: newStock } });

      return { id: txId, stock: newStock };
    };

    const idempotencyKey = dto.requestId ? `stock_action:${dto.itemId}:${dto.requestId}` : null;
    const currentClinicId = this.clinicContext.getClinicId();
    try {
      let result;
      if (idempotencyKey) {
        result = this.idempotency.executeInTransaction(
          { key: idempotencyKey, type: 'STOCK_ACTION', processingMessage: '库存操作处理中，请稍后再试' },
          handler,
        );
      } else {
        result = this.dbService.transaction(handler);
      }
      this.eventBus.emit(new InventoryStockChangedEvent(dto.itemId, dto.type, dto.quantity, currentClinicId));
      return result;
    } catch (e: unknown) {
      if (e instanceof BusinessValidationException || e instanceof BusinessNotFoundException) {
        throw e;
      }
      const err = e instanceof Error ? e : new Error(String(e));
      this.logger.error(
        {
          message: `库存操作失败: ${err.message}`,
          itemId: dto.itemId,
          type: dto.type,
          quantity: dto.quantity,
          unitPrice: dto.unitPrice,
          supplierId: dto.supplierId,
          operatorId: dto.operatorId,
          operatorName: dto.operatorName,
          idempotencyKey,
        },
        err,
      );
      throw new BusinessException(ErrorCode.BUSINESS_OPERATION_FAILED, '库存操作失败');
    }
  }
}
