import { BusinessNotFoundException, BusinessValidationException } from '@common/errors';
import { Injectable } from '@nestjs/common';

import { DbService } from "../../../db/db.service";
import { BaseService } from "../../../common/services/base.service";
import * as crypto from "node:crypto";
import { yuanToCents, centsToYuan, multiplyCents, sumCents } from "../../../common/utils/format/money.utils";
import { ClinicContextService } from "../../../common/services/clinic-context.service";
import { BUSINESS_CODE_MAX_RETRIES } from "../../../config/constants";
import { AuditLogType } from "../../../common/constants";

export interface PurchaseOrder {
  id: string;
  number: string;
  supplierId: string | null;
  totalAmount: number;
  status: string;
  operatorId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  clinicId?: string | null;
}

export interface UserInfo {
  id?: string;
  name?: string;
}

@Injectable()
export class PurchaseOrdersService extends BaseService<PurchaseOrder> {
  constructor(dbService: DbService, clinicContext: ClinicContextService) {
    // P0 修复：添加 moneyFields 配置，使 BaseService.findOne/findMany 自动转换 totalAmount（分→元）
    super(dbService, clinicContext, 'PurchaseOrder', [], [], [
      { table: 'PurchaseOrderItem', foreignKey: 'orderId' },
    ], true, [], undefined, undefined, ['totalAmount']);
  }

  async findMany(params: { supplierId?: string; status?: string; page?: number; pageSize?: number }) {
    const { supplierId, status, page = 1, pageSize = 50 } = params;
    const filters: Record<string, unknown> = {};
    if (supplierId) filters.supplierId = supplierId;
    if (status) filters.status = status;
    return super.findMany({ filters, page, pageSize });
  }

  async createOrder(dto: { supplierId: string; items: Array<{ itemId?: string; name: string; spec?: string; quantity: number; unitPrice: number }> }, user?: UserInfo) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    // P0 修复：schema 中 totalAmount/unitPrice/subtotal 均为 INTEGER（分），
    // 原先错误地调用 centsToYuan 将分转回元后存入 INTEGER 列，导致元/分混淆。
    // 正确做法：存入 cents 值，由 BaseService.moneyFields 在读取时自动转回元。
    const totalAmount = sumCents(dto.items.map(i => multiplyCents(yuanToCents(i.unitPrice), i.quantity)));
    const clinicId = this.clinicContext.getClinicId();
    const MAX_RETRIES = BUSINESS_CODE_MAX_RETRIES;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const number = "PO" + Date.now() + crypto.randomBytes(2).toString('hex') + (attempt > 0 ? `-${attempt}` : "");

        this.dbService.transaction((db) => {
          db.prepare("INSERT INTO PurchaseOrder (id, number, supplierId, totalAmount, status, operatorId, clinicId, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?)")
            .run(id, number, dto.supplierId, totalAmount, "PENDING", user?.id || null, clinicId || null, now, now);

          if (dto.items.length > 0) {
            const placeholders = dto.items.map(() => "(?,?,?,?,?,?,?,?,?)").join(", ");
            const values: unknown[] = [];
            for (const item of dto.items) {
              // P0 修复：unitPrice 和 subtotal 均存入 cents（INTEGER 列）
              const unitPriceCents = yuanToCents(item.unitPrice);
              const subtotalCents = multiplyCents(unitPriceCents, item.quantity);
              values.push(crypto.randomUUID(), id, item.itemId || null, item.name, item.spec || null, item.quantity, unitPriceCents, subtotalCents, clinicId || null);
            }
            db.prepare(`INSERT INTO PurchaseOrderItem (id, orderId, itemId, name, spec, quantity, unitPrice, subtotal, clinicId) VALUES ${placeholders}`).run(...values);
          }
        });

        this.logAudit(this.dbService, AuditLogType.PURCHASE_ORDER_CREATE, id, "PurchaseOrder", { afterData: { supplierId: dto.supplierId, totalAmount, itemCount: dto.items.length } });

        return this.findOne(id);
      } catch (e: unknown) {
        lastError = e instanceof Error ? e : new Error(String(e));
        if (e instanceof Error && e.message.includes("UNIQUE constraint failed: PurchaseOrder.number")) {
          continue;
        }
        throw e;
      }
    }
    throw lastError || new BusinessValidationException("创建采购单失败，请重试");
  }

  private static readonly VALID_STATUS_TRANSITIONS: Record<string, string[]> = {
    PENDING: ['PARTIAL', 'RECEIVED', 'CANCELLED'],
    PARTIAL: ['RECEIVED', 'CANCELLED'],
    RECEIVED: [],
    CANCELLED: [],
  };

  async updateStatus(id: string, status: string) {
    const order = await this.findOne(id);
    const currentStatus = order.status;
    const validNextStatuses = PurchaseOrdersService.VALID_STATUS_TRANSITIONS[currentStatus];
    if (!validNextStatuses?.includes(status)) {
      throw new BusinessValidationException('非法的状态转换');
    }
    const now = new Date().toISOString();
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    // P0 修复：将 UPDATE 与 logAudit 包入事务，保证业务写入与审计日志原子提交
    // 原先完全没有 logAudit 调用，状态流转无审计记录，违反合规要求
    this.dbService.transaction((db) => {
      const r = db.prepare(
        `UPDATE PurchaseOrder SET status = ?, updatedAt = ? WHERE id = ? AND status = ? AND deletedAt IS NULL${clinicClause}`
      ).run(status, now, id, currentStatus, ...clinicParams);
      if (r.changes === 0) {
        throw new BusinessValidationException('状态已变更，请刷新后重试（可能存在并发操作）');
      }
      this.logAudit(db, AuditLogType.PURCHASE_ORDER_RECEIVE, id, 'PurchaseOrder', {
        beforeData: { status: currentStatus },
        afterData: { status },
      });
      return r;
    });
    return this.findOne(id);
  }

  async receive(id: string, user?: UserInfo) {
    const po = await this.findOne(id);
    if (po.status === 'RECEIVED') throw new BusinessValidationException('采购单已收货，不可重复操作');
    if (po.status !== 'PENDING' && po.status !== 'PARTIAL') throw new BusinessValidationException('当前状态不可收货');

    const now = new Date().toISOString();
    const clinicId = this.clinicContext.getClinicId();
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();

    const result = this.dbService.transaction((db) => {
      // D2-3: 软删除过滤 + clinicId 过滤
      const currentPo = db.prepare(`SELECT id, number, supplierId, totalAmount, status, operatorId, remark, clinicId, createdAt, updatedAt, deletedAt FROM PurchaseOrder WHERE id = ? AND deletedAt IS NULL${clinicClause}`).get(id, ...clinicParams) as PurchaseOrder | undefined;
      if (!currentPo) throw new BusinessNotFoundException("采购单不存在");
      if (currentPo.status === 'RECEIVED') throw new BusinessValidationException('采购单已收货，不可重复操作');
      if (currentPo.status !== 'PENDING' && currentPo.status !== 'PARTIAL') throw new BusinessValidationException('当前状态不可收货');

      const items = db.prepare(`SELECT id, orderId, itemId, name, spec, quantity, unitPrice, subtotal, clinicId, createdAt, updatedAt, deletedAt FROM PurchaseOrderItem WHERE orderId = ?${clinicClause}`).all(id, ...clinicParams) as Array<{ id: string; itemId: string | null; name: string; quantity: number; unitPrice: number }>;

      const itemIds = items.filter(i => i.itemId).map(i => i.itemId);
      const inventoryMap = new Map<string, Record<string, unknown>>();
      if (itemIds.length > 0) {
        const placeholders = itemIds.map(() => '?').join(',');
        const inventoryItems = db.prepare(`SELECT id, code, name, spec, category, unit, stock, minStock, price, supplierId, expireDate, location, remark, clinicId, createdAt, updatedAt, deletedAt FROM InventoryItem WHERE id IN (${placeholders}) AND deletedAt IS NULL${clinicClause}`).all(...itemIds, ...clinicParams) as Array<Record<string, unknown>>;
        inventoryItems.forEach(item => inventoryMap.set(item.id as string, item));
      }

      // Batch update: single UPDATE with CASE expression instead of N individual UPDATEs
      const itemsToUpdate = items.filter(item => item.itemId && inventoryMap.has(item.itemId));
      const txValues: unknown[] = [];
      const txPlaceholders: string[] = [];

      if (itemsToUpdate.length > 0) {
        const caseParts: string[] = [];
        const updateParams: unknown[] = [];
        const updateIds: string[] = [];
        for (const item of itemsToUpdate) {
          caseParts.push(`WHEN ? THEN ?`);
          updateParams.push(item.itemId, item.quantity);
          updateIds.push(item.itemId);
        }
        const idPlaceholders = updateIds.map(() => '?').join(',');
        const updateResult = db.prepare(
          `UPDATE InventoryItem SET stock = stock + CASE id ${caseParts.join(' ')} END, updatedAt = ? WHERE id IN (${idPlaceholders}) AND deletedAt IS NULL${clinicClause}`
        ).run(...updateParams, now, ...updateIds, ...clinicParams);
        if (updateResult.changes !== itemsToUpdate.length) {
          throw new BusinessValidationException('部分库存项不存在或已删除，无法入库');
        }

        for (const item of itemsToUpdate) {
          txPlaceholders.push("(?,?,?,?,?,?,?,?,?,?,?,?,?)");
          // P0 修复：item.unitPrice 已是 cents（ INTEGER 列），直接用于 InventoryTransaction（同为 INTEGER）
          const txTotalCents = multiplyCents(item.unitPrice, item.quantity);
          txValues.push(
            crypto.randomUUID(), item.itemId, 'IN', item.quantity, item.unitPrice,
            txTotalCents, po.supplierId, id, user?.id || null,
            user?.name || null, '采购入库', clinicId || null, now
          );
        }
      }

      if (txPlaceholders.length > 0) {
        db.prepare(`INSERT INTO InventoryTransaction (id, itemId, type, quantity, unitPrice, totalAmount, supplierId, purchaseOrderId, operatorId, operatorName, remark, clinicId, createdAt) VALUES ${txPlaceholders.join(', ')}`).run(...txValues);
      }

      // D2-3: 软删除过滤 + clinicId 过滤
      const updateResult = db.prepare(`UPDATE PurchaseOrder SET status = 'RECEIVED', updatedAt = ? WHERE id = ? AND deletedAt IS NULL AND status IN ('PENDING', 'PARTIAL')${clinicClause}`).run(now, id, ...clinicParams);
      if (updateResult.changes === 0) {
        throw new BusinessValidationException('采购单状态已变更，请刷新后重试');
      }

      this.logAudit(db, AuditLogType.PURCHASE_ORDER_RECEIVE, id, "PurchaseOrder", { beforeData: { status: po.status }, afterData: { status: "RECEIVED" } });

      const received = db.prepare(`SELECT id, number, supplierId, totalAmount, status, operatorId, remark, clinicId, createdAt, updatedAt, deletedAt FROM PurchaseOrder WHERE id = ? AND deletedAt IS NULL${clinicClause}`).get(id, ...clinicParams) as Record<string, unknown> | undefined;
      // P0 修复：自定义 SQL 读取的 totalAmount 为 cents，需手动转回 yuan
      if (received && typeof received.totalAmount === 'number') {
        received.totalAmount = centsToYuan(received.totalAmount);
      }
      return received;
    });
    return result;
  }

  async cancel(id: string) {
    const po = await this.findOne(id);
    if (po.status === 'RECEIVED') throw new BusinessValidationException('已收货的采购单不可取消，请先做退货处理');
    if (po.status === 'CANCELLED') throw new BusinessValidationException('采购单已取消');

    const now = new Date().toISOString();
    const clinicId = this.clinicContext.getClinicId();
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();

    const result = this.dbService.transaction((db) => {
      // Atomic status update with TOCTOU guard — only succeeds if status is still valid
      const statusResult = db.prepare(
        `UPDATE PurchaseOrder SET status = 'CANCELLED', updatedAt = ? WHERE id = ? AND status IN ('PARTIAL', 'PENDING') AND deletedAt IS NULL${clinicClause}`
      ).run(now, id, ...clinicParams);
      if (statusResult.changes === 0) {
        throw new BusinessValidationException('采购单状态已变更，请刷新后重试（可能存在并发操作）');
      }

      // If PO was PARTIAL (partially received), reverse the received inventory
      if (po.status === 'PARTIAL') {
        const items = db.prepare(`SELECT id, orderId, itemId, name, spec, quantity, unitPrice, subtotal, clinicId, createdAt, updatedAt, deletedAt FROM PurchaseOrderItem WHERE orderId = ?${clinicClause}`).all(id, ...clinicParams) as Array<{ id: string; itemId: string | null; name: string; quantity: number; unitPrice: number }>;
        const itemsToReverse = items.filter(item => item.itemId);

        if (itemsToReverse.length > 0) {
          // Pre-check: verify all items have sufficient stock in a single query
          const checkIds = itemsToReverse.map(i => i.itemId);
          const checkPh = checkIds.map(() => '?').join(',');
          const stockRows = db.prepare(
            `SELECT id, stock FROM InventoryItem WHERE id IN (${checkPh}) AND deletedAt IS NULL${clinicClause}`
          ).all(...checkIds, ...clinicParams) as Array<{ id: string; stock: number }>;
          const stockMap = new Map(stockRows.map(r => [r.id, r.stock]));
          for (const item of itemsToReverse) {
            const stock = stockMap.get(item.itemId);
            if (stock === undefined || stock < item.quantity) {
              throw new BusinessValidationException(`库存反转失败（物料：${item.name}），库存不足或物料不存在`);
            }
          }

          // Batch UPDATE with CASE expression
          const caseParts: string[] = [];
          const updateParams: unknown[] = [];
          const updateIds: string[] = [];
          for (const item of itemsToReverse) {
            caseParts.push(`WHEN ? THEN ?`);
            updateParams.push(item.itemId, item.quantity);
            updateIds.push(item.itemId);
          }
          const idPlaceholders = updateIds.map(() => '?').join(',');
          db.prepare(
            `UPDATE InventoryItem SET stock = stock - CASE id ${caseParts.join(' ')} END, updatedAt = ? WHERE id IN (${idPlaceholders}) AND deletedAt IS NULL`
          ).run(...updateParams, now, ...updateIds, ...clinicParams);

          // Batch INSERT InventoryTransaction
          const txPlaceholders: string[] = [];
          const txValues: unknown[] = [];
          for (const item of itemsToReverse) {
            txPlaceholders.push("(?,?,?,?,?,?,?,?,?,?,?)");
            // P0 修复：item.unitPrice 已是 cents，直接计算 totalAmount（cents）
            const txTotalCents = multiplyCents(item.unitPrice, item.quantity);
            txValues.push(
              crypto.randomUUID(), item.itemId, 'OUT', item.quantity, item.unitPrice,
              txTotalCents, id, null, '采购单取消退货', clinicId || null, now
            );
          }
          db.prepare(`INSERT INTO InventoryTransaction (id, itemId, type, quantity, unitPrice, totalAmount, purchaseOrderId, operatorId, remark, clinicId, createdAt) VALUES ${txPlaceholders.join(', ')}`).run(...txValues);
        }
      }

      this.logAudit(db, AuditLogType.PURCHASE_ORDER_CANCEL, id, "PurchaseOrder", { beforeData: { status: po.status }, afterData: { status: 'CANCELLED' } });

      const cancelled = db.prepare(`SELECT id, number, supplierId, totalAmount, status, operatorId, remark, clinicId, createdAt, updatedAt, deletedAt FROM PurchaseOrder WHERE id = ? AND deletedAt IS NULL${clinicClause}`).get(id, ...clinicParams) as Record<string, unknown> | undefined;
      // P0 修复：自定义 SQL 读取的 totalAmount 为 cents，需手动转回 yuan
      if (cancelled && typeof cancelled.totalAmount === 'number') {
        cancelled.totalAmount = centsToYuan(cancelled.totalAmount);
      }
      return cancelled;
    });

    return result;
  }

}
