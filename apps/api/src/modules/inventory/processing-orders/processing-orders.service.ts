import { BusinessNotFoundException, BusinessValidationException } from '@common/errors';
import { Injectable } from '@nestjs/common';

import { DbService } from "../../../db/db.service";
import { ProcessingOrder } from "@dental/shared";
import { BaseService } from "../../../common/services/base.service";
import * as crypto from "node:crypto";
import { UpdateBuilder } from "../../../common/utils/db/sql-builder";
import { ClinicContextService } from "../../../common/services/clinic-context.service";
import { BUSINESS_CODE_MAX_RETRIES } from "../../../config/constants";
import { PAGINATION } from "../../../common/constants/pagination";
import { AuditLogType } from "../../../common/constants";
import { yuanToCents, centsToYuan } from "../../../common/utils/format/money.utils";

@Injectable()
export class ProcessingOrdersService extends BaseService<ProcessingOrder> {
  constructor(dbService: DbService, clinicContext: ClinicContextService) {
    // P0 修复：添加 moneyFields=['totalFee']，使 BaseService.findOne/findMany 自动转换（分→元）
    super(dbService, clinicContext, 'ProcessingOrder', ['teethNumbers'], [], [
      { table: 'ProcessingOrderItem', foreignKey: 'orderId' },
      { table: 'ProcessingFlowLog', foreignKey: 'orderId' },
    ], true, [], undefined, undefined, ['totalFee']);
  }

  async findMany(params: { patientId?: string; status?: string; factoryId?: string; page?: number; pageSize?: number }) {
    const { patientId, status, factoryId, page = 1, pageSize = PAGINATION.DEFAULT_PAGE_SIZE_MEDIUM } = params;
    const filters: Record<string, unknown> = {};
    if (patientId) filters.patientId = patientId;
    if (status) filters.status = status;
    if (factoryId) filters.factoryId = factoryId;
    return super.findMany({ filters, page, pageSize });
  }

  /**
   * P0 修复：INSERT 包入事务 + 补全审计日志
   * 原先 INSERT 未在事务中且完全缺失审计日志。
   */
  async create(dto: { patientId: string; factoryId?: string; visitId?: string; doctorId?: string; shade?: string; teethNumbers?: string[]; totalFee?: number; remark?: string }) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const clinicId = this.clinicContext.getClinicId();
    const MAX_RETRIES = BUSINESS_CODE_MAX_RETRIES;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const number = "PO" + Date.now() + crypto.randomBytes(2).toString('hex') + (attempt > 0 ? `-${attempt}` : "");

        this.dbService.transaction((db) => {
          // P0 修复：totalFee 存入 cents（schema 为 INTEGER），原先是 yuan 直接存入
          const totalFeeCents = yuanToCents(dto.totalFee || 0);
          db.prepare("INSERT INTO ProcessingOrder (id, number, patientId, visitId, factoryId, doctorId, shade, teethNumbers, totalFee, status, remark, clinicId, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
            .run(id, number, dto.patientId, dto.visitId || null, dto.factoryId || null, dto.doctorId || null, dto.shade || null, JSON.stringify(dto.teethNumbers || []), totalFeeCents, "SENT", dto.remark || null, clinicId || null, now, now);

          this.logAudit(db, AuditLogType.PROCESSING_ORDER_CREATE, id, "ProcessingOrder", {
            afterData: { number, patientId: dto.patientId, factoryId: dto.factoryId, doctorId: dto.doctorId, totalFee: totalFeeCents, status: "SENT" },
          });
        });

        return this.findOne(id);
      } catch (e: unknown) {
        lastError = e instanceof Error ? e : new Error(String(e));
        if (e instanceof Error && e.message.includes("UNIQUE constraint failed: ProcessingOrder.number")) {
          continue;
        }
        throw e;
      }
    }
    throw lastError || new BusinessValidationException("创建加工单失败，请重试");
  }

  private static readonly VALID_STATUS_TRANSITIONS: Record<string, string[]> = {
    PENDING: ['SENT', 'CANCELLED'],
    SENT: ['IN_PROGRESS', 'CANCELLED'],
    IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
    COMPLETED: ['RECEIVED'],
    RECEIVED: [],
    CANCELLED: [],
  };

  async updateStatus(id: string, status: string) {
    const order = await this.findOne(id);
    const currentStatus = order.status;
    const validNextStatuses = ProcessingOrdersService.VALID_STATUS_TRANSITIONS[currentStatus];
    if (!validNextStatuses?.includes(status)) {
      throw new BusinessValidationException('非法的状态转换');
    }
    const now = new Date().toISOString();
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    return this.dbService.transaction((db) => {
      const result = db.prepare(
        `UPDATE ProcessingOrder SET status = ?, updatedAt = ? WHERE id = ? AND status = ? AND deletedAt IS NULL${clinicClause}`
      ).run(status, now, id, currentStatus, ...clinicParams);
      if (result.changes === 0) {
        throw new BusinessValidationException('状态已变更，请刷新后重试（可能存在并发操作）');
      }
      this.logAudit(db, AuditLogType.PROCESSING_ORDER_STATUS_UPDATE, id, "ProcessingOrder", { beforeData: { status: currentStatus }, afterData: { status } });
      const row = db.prepare(`SELECT id, number, patientId, visitId, factoryId, doctorId, shade, teethNumbers, totalFee, status, chargeId, sentAt, expectedAt, receivedAt, deliveredAt, remark, creatorId, clinicId, createdAt, updatedAt, deletedAt FROM ProcessingOrder WHERE id = ? AND deletedAt IS NULL${clinicClause}`).get(id, ...clinicParams) as Record<string, unknown> | undefined;
      // P0 修复：自定义 SQL 读取的 totalFee 为 cents，需手动转回 yuan
      if (row && typeof row.totalFee === 'number') {
        row.totalFee = centsToYuan(row.totalFee);
      }
      return row;
    });
  }

  async update(id: string, dto: { factoryId?: string; shade?: string; teethNumbers?: string[]; totalFee?: number; remark?: string }): Promise<ProcessingOrder> {
    const _existing = await this.findOne(id);
    const now = new Date().toISOString();
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    return this.dbService.transaction((db) => {
      const updates: string[] = ['updatedAt = ?'];
      const params: unknown[] = [now];
      if (dto.factoryId !== undefined) { updates.push('factoryId = ?'); params.push(dto.factoryId || null); }
      if (dto.shade !== undefined) { updates.push('shade = ?'); params.push(dto.shade); }
      if (dto.teethNumbers !== undefined) { updates.push('teethNumbers = ?'); params.push(JSON.stringify(dto.teethNumbers)); }
      if (dto.totalFee !== undefined) { updates.push('totalFee = ?'); params.push(yuanToCents(dto.totalFee)); }
      if (dto.remark !== undefined) { updates.push('remark = ?'); params.push(dto.remark); }
      params.push(id, ...clinicParams);
      db.prepare(`UPDATE ProcessingOrder SET ${updates.join(', ')} WHERE id = ? AND deletedAt IS NULL${clinicClause}`).run(...params);
      this.logAudit(db, AuditLogType.PROCESSING_ORDER_UPDATE, id, "ProcessingOrder", { afterData: { shade: dto.shade, totalFee: dto.totalFee, factoryId: dto.factoryId } });
      const updated = db.prepare(`SELECT id, number, patientId, visitId, factoryId, doctorId, shade, teethNumbers, totalFee, status, chargeId, sentAt, expectedAt, receivedAt, deliveredAt, remark, creatorId, clinicId, createdAt, updatedAt, deletedAt FROM ProcessingOrder WHERE id = ? AND deletedAt IS NULL${clinicClause}`).get(id, ...clinicParams) as Record<string, unknown> | undefined;
      // P0 修复：自定义 SQL 读取的 totalFee 为 cents，需手动转回 yuan
      if (updated && typeof updated.totalFee === 'number') {
        updated.totalFee = centsToYuan(updated.totalFee);
      }
      return updated as ProcessingOrder;
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.softDelete(id);
    this.logAudit(this.dbService, AuditLogType.PROCESSING_ORDER_REMOVE, id, "ProcessingOrder");
    return { id };
  }

  async stats() {
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    const row = this.dbService.prepare(`SELECT COUNT(*) as total, COUNT(CASE WHEN status = 'RECEIVED' THEN 1 END) as completed, COUNT(CASE WHEN status IN ('SENT','IN_PROGRESS') THEN 1 END) as pending FROM ProcessingOrder WHERE deletedAt IS NULL${clinicClause}`).get(...clinicParams) as { total: number; completed: number; pending: number } | undefined;
    return { total: row?.total ?? 0, completed: row?.completed ?? 0, pending: row?.pending ?? 0 };
  }

  async addFlowLog(orderId: string, dto: { status: string; remark?: string; operatorId?: string }) {
    const order = await this.findOne(orderId);
    const currentStatus = order.status;
    const validNextStatuses = ProcessingOrdersService.VALID_STATUS_TRANSITIONS[currentStatus];
    if (!validNextStatuses?.includes(dto.status)) {
      throw new BusinessValidationException('非法的状态转换');
    }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const clinicId = this.clinicContext.getClinicId();
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    this.dbService.transaction((db) => {
      db.prepare("INSERT INTO ProcessingFlowLog (id, orderId, status, remark, operatorId, clinicId, createdAt) VALUES (?,?,?,?,?,?,?)")
        .run(id, orderId, dto.status, dto.remark || null, dto.operatorId || null, clinicId || null, now);
      // P1 修复：CAS 保护，防止并发状态流转导致状态被覆盖
      // WHERE status = currentStatus 确保读取的 currentStatus 未被并发修改
      const updateResult = db.prepare(
        `UPDATE ProcessingOrder SET status = ?, updatedAt = ? WHERE id = ? AND deletedAt IS NULL AND status = ?${clinicClause}`,
      ).run(dto.status, now, orderId, currentStatus, ...clinicParams);
      if (updateResult.changes === 0) {
        throw new BusinessValidationException('订单状态已被修改，请刷新后重试');
      }
      this.logAudit(db, AuditLogType.PROCESSING_FLOW_LOG, orderId, "ProcessingOrder", { beforeData: { status: currentStatus }, afterData: { status: dto.status, remark: dto.remark } });
    });
    return { id, orderId, status: dto.status };
  }

  async linkCharge(orderId: string, chargeId: string) {
    await this.findOne(orderId);
    const result = await super.update(orderId, { chargeId });
    this.logAudit(this.dbService, AuditLogType.PROCESSING_ORDER_LINK_CHARGE, orderId, "ProcessingOrder", { afterData: { chargeId } });
    return result;
  }

  // === ProcessingProduct methods ===
  async listProducts(factoryId?: string, page = 1, pageSize = PAGINATION.DEFAULT_PAGE_SIZE_XLARGE) {
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    const offset = (page - 1) * pageSize;
    if (factoryId) { return this.dbService.prepare(`SELECT id, factoryId, name, category, price, remark, clinicId, createdAt FROM ProcessingProduct WHERE factoryId = ? AND deletedAt IS NULL${clinicClause} ORDER BY name LIMIT ? OFFSET ?`).all(factoryId, ...clinicParams, pageSize, offset); }
    return this.dbService.prepare(`SELECT id, factoryId, name, category, price, remark, clinicId, createdAt FROM ProcessingProduct WHERE deletedAt IS NULL${clinicClause} ORDER BY name LIMIT ? OFFSET ?`).all(...clinicParams, pageSize, offset);
  }

  async createProduct(dto: { factoryId: string; name: string; category?: string; price?: number; remark?: string }) {
    if (!dto.factoryId || !dto.name) throw new BusinessValidationException("工厂ID和产品名称不能为空");
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const clinicId = this.clinicContext.getClinicId();
    this.dbService.prepare("INSERT INTO ProcessingProduct (id, factoryId, name, category, price, remark, clinicId, createdAt) VALUES (?,?,?,?,?,?,?,?)")
      .run(id, dto.factoryId, dto.name, dto.category || null, dto.price || 0, dto.remark || null, clinicId || null, now);
    this.logAudit(this.dbService, AuditLogType.PROCESSING_PRODUCT_CREATE, id, "ProcessingProduct", { afterData: { factoryId: dto.factoryId, name: dto.name } });
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    return this.dbService.prepare(`SELECT id, factoryId, name, category, price, remark, clinicId, createdAt FROM ProcessingProduct WHERE id = ?${clinicClause}`).get(id, ...clinicParams);
  }

  async updateProduct(id: string, dto: { name?: string; category?: string; price?: number; remark?: string }) {
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    const builder = new UpdateBuilder("ProcessingProduct");
    builder.set("name", dto.name);
    builder.set("category", dto.category);
    builder.set("price", dto.price);
    builder.set("remark", dto.remark);
    const result = builder.buildWithCustomWhere(`id = ? AND deletedAt IS NULL${clinicClause}`, [id, ...clinicParams]);
    if (result) {
      this.dbService.prepare(result.sql).run(...result.params);
    }
    this.logAudit(this.dbService, AuditLogType.PROCESSING_PRODUCT_UPDATE, id, "ProcessingProduct", { afterData: { name: dto.name, price: dto.price } });
    return this.dbService.prepare(`SELECT id, factoryId, name, category, price, remark, clinicId, createdAt FROM ProcessingProduct WHERE id = ?${clinicClause}`).get(id, ...clinicParams);
  }

  async deleteProduct(id: string) {
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    const existing = this.dbService.prepare(`SELECT id FROM ProcessingProduct WHERE id = ? AND deletedAt IS NULL${clinicClause}`).get(id, ...clinicParams);
    if (!existing) throw new BusinessNotFoundException("产品不存在");
    const now = new Date().toISOString();
    this.dbService.prepare(`UPDATE ProcessingProduct SET deletedAt = ? WHERE id = ?${clinicClause}`).run(now, id, ...clinicParams);
    this.logAudit(this.dbService, AuditLogType.PROCESSING_PRODUCT_DELETE, id, "ProcessingProduct");
    return { id };
  }

  // === ProcessingFactory methods ===
  async listFactories(page = 1, pageSize = PAGINATION.DEFAULT_PAGE_SIZE_XLARGE) {
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    const offset = (page - 1) * pageSize;
    return this.dbService.prepare(`SELECT id, name, contactPerson, phone, address, remark, status, clinicId, createdAt, updatedAt, deletedAt FROM ProcessingFactory WHERE deletedAt IS NULL${clinicClause} ORDER BY name LIMIT ? OFFSET ?`).all(...clinicParams, pageSize, offset);
  }

  async createFactory(dto: { name: string; contactPerson?: string; phone?: string; address?: string; remark?: string }) {
    if (!dto.name) throw new BusinessValidationException("工厂名称不能为空");
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const clinicId = this.clinicContext.getClinicId();
    this.dbService.prepare("INSERT INTO ProcessingFactory (id, name, contactPerson, phone, address, remark, status, clinicId, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run(id, dto.name, dto.contactPerson || null, dto.phone || null, dto.address || null, dto.remark || null, 'ACTIVE', clinicId || null, now, now);
    this.logAudit(this.dbService, AuditLogType.PROCESSING_FACTORY_CREATE, id, "ProcessingFactory", { afterData: { name: dto.name } });
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    return this.dbService.prepare(`SELECT id, name, contactPerson, phone, address, remark, status, clinicId, createdAt, updatedAt, deletedAt FROM ProcessingFactory WHERE id = ?${clinicClause}`).get(id, ...clinicParams);
  }

  async updateFactory(id: string, dto: { name?: string; contactPerson?: string; phone?: string; address?: string; remark?: string; status?: string }) {
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    const builder = new UpdateBuilder("ProcessingFactory");
    builder.set("name", dto.name);
    builder.set("contactPerson", dto.contactPerson);
    builder.set("phone", dto.phone);
    builder.set("address", dto.address);
    builder.set("remark", dto.remark);
    builder.set("status", dto.status);
    builder.setUpdatedAt();
    const result = builder.buildWithCustomWhere(`id = ? AND deletedAt IS NULL${clinicClause}`, [id, ...clinicParams]);
    if (result) {
      this.dbService.prepare(result.sql).run(...result.params);
    }
    this.logAudit(this.dbService, AuditLogType.PROCESSING_FACTORY_UPDATE, id, "ProcessingFactory", { afterData: { name: dto.name, status: dto.status } });
    return this.dbService.prepare(`SELECT id, name, contactPerson, phone, address, remark, status, clinicId, createdAt, updatedAt, deletedAt FROM ProcessingFactory WHERE id = ? AND deletedAt IS NULL${clinicClause}`).get(id, ...clinicParams);
  }

  async deleteFactory(id: string) {
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    const existing = this.dbService.prepare(`SELECT id FROM ProcessingFactory WHERE id = ? AND deletedAt IS NULL${clinicClause}`).get(id, ...clinicParams);
    if (!existing) throw new BusinessNotFoundException("工厂不存在");
    const now = new Date().toISOString();
    this.dbService.prepare(`UPDATE ProcessingFactory SET deletedAt = ?, updatedAt = ? WHERE id = ? AND deletedAt IS NULL${clinicClause}`).run(now, now, id, ...clinicParams);
    this.logAudit(this.dbService, AuditLogType.PROCESSING_FACTORY_DELETE, id, "ProcessingFactory");
    return { id };
  }

}
