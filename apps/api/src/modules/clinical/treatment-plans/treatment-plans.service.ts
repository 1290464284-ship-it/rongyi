import { BadRequestException, Injectable } from "@nestjs/common";
import { DbService } from "../../../db/db.service";
import { BaseService } from "../../../common/services/base.service";
import { TreatmentPlan } from "@dental/shared";
import * as crypto from "crypto";

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
  constructor(dbService: DbService) {
    super(dbService, "TreatmentPlan", [], ["name"]);
  }

  async create(dto: Partial<TreatmentPlan>): Promise<TreatmentPlan> {
    const createDto = dto as unknown as CreateTreatmentPlanDto;
    if (!createDto.items || createDto.items.length === 0) {
      throw new BadRequestException('治疗计划明细不能为空');
    }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.dbService.transaction((db) => {
      db.prepare("INSERT INTO TreatmentPlan (id, patientId, visitId, doctorId, name, status, totalFee, remark, createdAt, updatedAt) VALUES (?,?,?,?,?,'DRAFT',?,?,?,?)")
        .run(id, createDto.patientId, createDto.visitId || null, createDto.doctorId, createDto.name, createDto.totalFee || 0, createDto.remark || null, now, now);
      for (const item of createDto.items) {
        db.prepare("INSERT INTO TreatmentPlanItem (id, planId, code, name, category, price, quantity, teethNumbers, status, remark) VALUES (?,?,?,?,?,?,?,?,?,?)")
          .run(crypto.randomUUID(), id, item.code, item.name, item.category, item.price, item.quantity || 1, JSON.stringify(item.teethNumbers || []), "PLANNED", item.remark || null);
      }
    });
    return super.findOne(id);
  }

  async updateStatus(id: string, dto: { status: string }) {
    await super.findOne(id);
    const now = new Date().toISOString();
    this.dbService.prepare("UPDATE TreatmentPlan SET status = ?, updatedAt = ? WHERE id = ?").run(dto.status, now, id);
    return super.findOne(id);
  }

  async updateItemStatus(planId: string, itemId: string, dto: { status: string }) {
    const now = new Date().toISOString();
    this.dbService.prepare("UPDATE TreatmentPlanItem SET status = ?, updatedAt = ? WHERE id = ? AND planId = ? AND deletedAt IS NULL").run(dto.status, now, itemId, planId);
    return this.dbService.prepare("SELECT * FROM TreatmentPlanItem WHERE id = ?").get(itemId);
  }
}
