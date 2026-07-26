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
  remark?: string | null;
}

interface CreateTreatmentPlanDto {
  patientId: string;
  visitId?: string | null;
  doctorId: string;
  name: string;
  totalFee?: number;
  remark?: string | null;
  items: TreatmentPlanItemDto[];
}

@Injectable()
export class TreatmentPlansService extends BaseService<TreatmentPlan> {
  constructor(dbService: DbService, clinicContext: ClinicContextService) {
    super(dbService, clinicContext, "TreatmentPlan", [], ["name"], [
      { table: 'TreatmentPlanItem', foreignKey: 'planId' },
    ]);
  }

  async create(dto: Partial<TreatmentPlan>): Promise<TreatmentPlan> {
    const createDto = dto as unknown as CreateTreatmentPlanDto;
    if (!createDto.items || createDto.items.length === 0) {
      throw new BusinessValidationException('治疗计划明细不能为空');
    }

    // Validate FK: patientId must exist
    const patient = this.dbService.prepare(
      "SELECT id FROM Patient WHERE id = ? AND deletedAt IS NULL"
    ).get(createDto.patientId);
    if (!patient) {
      throw new BusinessNotFoundException('患者不存在');
    }

    // Validate FK: doctorId must exist
    const doctor = this.dbService.prepare(
      "SELECT id FROM User WHERE id = ? AND active = 1"
    ).get(createDto.doctorId);
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

  async updateStatus(id: string, dto: { status: string }) {
    const existing = await super.findOne(id) as TreatmentPlan & { status: string };
    const allowed = ALLOWED_TRANSITIONS[existing.status] || [];
    if (!allowed.includes(dto.status)) {
      throw new BusinessValidationException(`治疗计划状态不可从 ${existing.status} 流转到 ${dto.status}`);
    }
    const now = new Date().toISOString();
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    this.dbService.transaction((db) => {
      db.prepare(`UPDATE TreatmentPlan SET status = ?, updatedAt = ? WHERE id = ?${clinicClause}`).run(dto.status, now, id, ...clinicParams);
      this.logAudit(db, "TREATMENT_PLAN_STATUS_UPDATE", id, "TreatmentPlan", { beforeData: { status: existing.status }, afterData: { status: dto.status } });
    });
    return super.findOne(id);
  }

  async updateItemStatus(planId: string, itemId: string, dto: { status: string }) {
    const now = new Date().toISOString();
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    const item = this.dbService.prepare(`SELECT id, planId, code, name, category, price, quantity, teethNumbers, status, treatmentId, completedAt, remark, clinicId, updatedAt, deletedAt FROM TreatmentPlanItem WHERE id = ? AND planId = ? AND deletedAt IS NULL${clinicClause}`).get(itemId, planId, ...clinicParams) as Record<string, unknown> | undefined;
    const oldStatus = item?.status as string | undefined;
    return this.dbService.transaction((db) => {
      db.prepare(`UPDATE TreatmentPlanItem SET status = ?, updatedAt = ? WHERE id = ? AND planId = ? AND deletedAt IS NULL${clinicClause}`).run(dto.status, now, itemId, planId, ...clinicParams);
      this.logAudit(db, "TREATMENT_PLAN_ITEM_STATUS_UPDATE", itemId, "TreatmentPlanItem", { beforeData: oldStatus ? { status: oldStatus } : undefined, afterData: { status: dto.status } });
      const updatedItem = db.prepare(`SELECT id, planId, code, name, category, price, quantity, teethNumbers, status, treatmentId, completedAt, remark, clinicId, updatedAt, deletedAt FROM TreatmentPlanItem WHERE id = ? AND deletedAt IS NULL${clinicClause}`).get(itemId, ...clinicParams) as Record<string, unknown> | undefined;
      if (updatedItem) {
        updatedItem.teethNumbers = safeJsonArray(updatedItem.teethNumbers as string | null);
      }
      return updatedItem;
    });
  }
}
