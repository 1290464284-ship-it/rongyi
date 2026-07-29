import { BusinessNotFoundException, BusinessValidationException } from '@common/errors';
import { Injectable } from '@nestjs/common';

import { DbService } from "../../../db/db.service";
import { BaseService } from "../../../common/services/base.service";
import { TreatmentPlan } from "@dental/shared";
import * as crypto from "node:crypto";
import { ClinicContextService } from "../../../common/services/clinic-context.service";
import { safeJsonArray } from "../../../common/utils/format/json.utils";

const ALLOWED_TRANSITIONS: Record<string, readonly string[]> = {
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['APPROVED', 'REJECTED', 'CANCELLED'],
  REJECTED: ['DRAFT'],
  APPROVED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: ['DRAFT'],
};

interface TreatmentPlanItemDto {
  code: string;
  name: string;
  category: string;
  price: number;
  quantity?: number;
  teethNumbers?: number[];
  remark?: string;
}

interface CreateTreatmentPlanDto {
  patientId: string;
  visitId?: string;
  doctorId: string;
  name: string;
  totalFee?: number;
  remark?: string;
  items: TreatmentPlanItemDto[];
}

@Injectable()
export class TreatmentPlansService extends BaseService<TreatmentPlan> {
  constructor(dbService: DbService, clinicContext: ClinicContextService) {
    super(dbService, clinicContext, {
      tableName: "TreatmentPlan",
      searchFields: ["name"],
      cascadeTables: [{ table: 'TreatmentPlanItem', foreignKey: 'planId' }],
    });
  }

  async create(dto: Partial<TreatmentPlan>): Promise<TreatmentPlan> {
    const createDto = dto as unknown as CreateTreatmentPlanDto;
    if (!createDto.items || createDto.items.length === 0) {
      throw new BusinessValidationException('治疗计划明细不能为空');
    }

    // P1 修复：FK 校验必须带 clinicId 过滤，防止跨诊所引用其他诊所的患者/医生
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();

    // Validate FK: patientId must exist (within same clinic)
    const patient = this.dbService.prepare(
      `SELECT id FROM Patient WHERE id = ? AND deletedAt IS NULL${clinicClause}`
    ).get(createDto.patientId, ...clinicParams);
    if (!patient) {
      throw new BusinessNotFoundException('患者不存在');
    }

    // Validate FK: doctorId must exist (within same clinic)
    const doctor = this.dbService.prepare(
      `SELECT id FROM User WHERE id = ? AND active = 1 AND deletedAt IS NULL${clinicClause}`
    ).get(createDto.doctorId, ...clinicParams);
    if (!doctor) {
      throw new BusinessNotFoundException('医生不存在');
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const clinicId = this.clinicContext.getClinicId();
    this.dbService.transaction((db) => {
      db.prepare("INSERT INTO TreatmentPlan (id, patientId, visitId, doctorId, name, status, totalFee, remark, clinicId, createdAt, updatedAt) VALUES (?,?,?,?,?,'DRAFT',?,?,?,?,?)")
        .run(id, createDto.patientId, createDto.visitId || null, createDto.doctorId, createDto.name, createDto.totalFee || 0, createDto.remark || null, clinicId || null, now, now);

      const placeholders = createDto.items.map(() => "(?,?,?,?,?,?,?,?,?,?,?)").join(", ");
      const values: unknown[] = [];
      for (const item of createDto.items) {
        values.push(crypto.randomUUID(), id, item.code, item.name, item.category, item.price, item.quantity || 1, JSON.stringify(item.teethNumbers || []), "PLANNED", item.remark || null, clinicId || null);
      }
      db.prepare(`INSERT INTO TreatmentPlanItem (id, planId, code, name, category, price, quantity, teethNumbers, status, remark, clinicId) VALUES ${placeholders}`)
        .run(...values);
    });
    return super.findOne(id);
  }

  /**
   * P0 修复：CAS 保护 + 事务内读取
   * 原先在事务外读取 status，事务内 UPDATE 无 CAS 守卫，
   * 两个并发请求都读到 DRAFT 并通过状态机校验后都成功 UPDATE。
   * 现在：SELECT + 状态机校验 + UPDATE(CAS) + 审计 全部在同一事务内。
   */
  async updateStatus(id: string, dto: { status: string }) {
    const now = new Date().toISOString();
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    return this.dbService.transaction((db) => {
      const existing = db.prepare(
        `SELECT id, status FROM TreatmentPlan WHERE id = ? AND deletedAt IS NULL${clinicClause}`,
      ).get(id, ...clinicParams) as { status: string } | undefined;
      if (!existing) throw new BusinessNotFoundException('治疗计划不存在');
      const allowed = ALLOWED_TRANSITIONS[existing.status] || [];
      if (!allowed.includes(dto.status)) {
        throw new BusinessValidationException(`治疗计划状态不可从 ${existing.status} 流转到 ${dto.status}`);
      }
      const result = db.prepare(
        `UPDATE TreatmentPlan SET status = ?, updatedAt = ? WHERE id = ? AND deletedAt IS NULL AND status = ?${clinicClause}`,
      ).run(dto.status, now, id, existing.status, ...clinicParams);
      if (result.changes === 0) {
        throw new BusinessValidationException('治疗计划状态已被修改，请刷新后重试');
      }
      this.logAudit(db, "TREATMENT_PLAN_STATUS_UPDATE", id, "TreatmentPlan", { beforeData: { status: existing.status }, afterData: { status: dto.status } });
      return db.prepare(
        `SELECT id, patientId, visitId, doctorId, name, status, totalFee, remark, clinicId, createdAt, updatedAt FROM TreatmentPlan WHERE id = ? AND deletedAt IS NULL${clinicClause}`,
      ).get(id, ...clinicParams) as TreatmentPlan;
    });
  }

  /**
   * P0 修复：CAS 保护 + 事务内读取
   * 原先在事务外读取 item，事务内 UPDATE 无 CAS 守卫。
   */
  async updateItemStatus(planId: string, itemId: string, dto: { status: string }) {
    const now = new Date().toISOString();
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    return this.dbService.transaction((db) => {
      const item = db.prepare(
        `SELECT id, planId, code, name, category, price, quantity, teethNumbers, status, treatmentId, completedAt, remark, clinicId, updatedAt, deletedAt FROM TreatmentPlanItem WHERE id = ? AND planId = ? AND deletedAt IS NULL${clinicClause}`,
      ).get(itemId, planId, ...clinicParams) as Record<string, unknown> | undefined;
      if (!item) throw new BusinessNotFoundException('治疗计划明细不存在');
      const oldStatus = item.status as string;
      const result = db.prepare(
        `UPDATE TreatmentPlanItem SET status = ?, updatedAt = ? WHERE id = ? AND planId = ? AND deletedAt IS NULL AND status = ?${clinicClause}`,
      ).run(dto.status, now, itemId, planId, oldStatus, ...clinicParams);
      if (result.changes === 0) {
        throw new BusinessValidationException('明细状态已被修改，请刷新后重试');
      }
      this.logAudit(db, "TREATMENT_PLAN_ITEM_STATUS_UPDATE", itemId, "TreatmentPlanItem", { beforeData: { status: oldStatus }, afterData: { status: dto.status } });
      const updatedItem = db.prepare(
        `SELECT id, planId, code, name, category, price, quantity, teethNumbers, status, treatmentId, completedAt, remark, clinicId, updatedAt, deletedAt FROM TreatmentPlanItem WHERE id = ? AND deletedAt IS NULL${clinicClause}`,
      ).get(itemId, ...clinicParams) as Record<string, unknown> | undefined;
      if (updatedItem) {
        updatedItem.teethNumbers = safeJsonArray(updatedItem.teethNumbers as string | null);
      }
      return updatedItem;
    });
  }
}
