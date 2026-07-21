import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { DbService } from "../../../db/db.service";
import { BaseService } from "../../../common/services/base.service";
import { Treatment, TreatmentStatus, TreatmentCatalog } from "@dental/shared";
import * as crypto from "crypto";

interface CreateTreatmentDto {
  patientId: string;
  visitId?: string | null;
  doctorId: string;
  code: string;
  name: string;
  category: string;
  price: number;
  quantity?: number;
  teethNumbers?: number[];
  remark?: string | null;
}

@Injectable()
export class TreatmentsService extends BaseService<Treatment> {
  constructor(dbService: DbService) {
    super(dbService, "Treatment", [], ["name"]);
  }

  async findMany(params: { patientId?: string; visitId?: string; toothNumber?: number; status?: TreatmentStatus; page?: number; pageSize?: number }) {
    const { patientId, visitId, toothNumber, status, page = 1, pageSize = 50 } = params;
    let query = "SELECT id, patientId, visitId, doctorId, code, name, category, price, quantity, teethNumbers, status, plannedDate, completedDate, remark, createdAt, updatedAt FROM Treatment WHERE deletedAt IS NULL";
    let countQuery = "SELECT COUNT(*) as count FROM Treatment WHERE deletedAt IS NULL";
    const qp: unknown[] = [];
    const cp: unknown[] = [];
    if (patientId) { query += " AND patientId = ?"; countQuery += " AND patientId = ?"; qp.push(patientId); cp.push(patientId); }
    if (visitId) { query += " AND visitId = ?"; countQuery += " AND visitId = ?"; qp.push(visitId); cp.push(visitId); }
    if (toothNumber) {
      // P1 修复（牙位搜索假阳性）：原 `JSON_EXTRACT(teethNumbers, '$') LIKE '%1%'` 会匹配 11/21/31
      // 改用 JSON_EACH 精确匹配数组元素
      query += " AND EXISTS (SELECT 1 FROM JSON_EACH(teethNumbers) WHERE value = ?)";
      countQuery += " AND EXISTS (SELECT 1 FROM JSON_EACH(teethNumbers) WHERE value = ?)";
      qp.push(toothNumber); cp.push(toothNumber);
    }
    if (status) { query += " AND status = ?"; countQuery += " AND status = ?"; qp.push(status); cp.push(status); }
    query += " ORDER BY createdAt DESC LIMIT ? OFFSET ?";
    qp.push(pageSize, (page - 1) * pageSize);
    const items = this.dbService.prepare(query).all(...qp) as Treatment[];
    const total = (this.dbService.prepare(countQuery).get(...cp) as { count: number })?.count || 0;
    return { items, total, page, pageSize };
  }

  async create(dto: Partial<Treatment>): Promise<Treatment> {
    const createDto = dto as unknown as CreateTreatmentDto;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.dbService.prepare("INSERT INTO Treatment (id, patientId, visitId, doctorId, code, name, category, price, quantity, teethNumbers, remark, status, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,'PLANNED',?,?)")
      .run(id, createDto.patientId, createDto.visitId || null, createDto.doctorId, createDto.code, createDto.name, createDto.category, createDto.price, createDto.quantity || 1, JSON.stringify(createDto.teethNumbers || []), createDto.remark || null, now, now);
    return super.findOne(id);
  }

  // P1 修复（治疗状态机无流转校验）：定义合法状态转换，防止任意跳转
  private static readonly ALLOWED_TRANSITIONS: Record<string, readonly string[]> = {
    PLANNED: ["IN_PROGRESS", "COMPLETED", "CANCELLED"],
    IN_PROGRESS: ["COMPLETED", "CANCELLED"],
    COMPLETED: [],
    CANCELLED: [],
  };

  async update(id: string, dto: Partial<Treatment> & { status?: string }) {
    const existing = await super.findOne(id) as Treatment;
    if (dto.status && dto.status !== existing.status) {
      const allowed = TreatmentsService.ALLOWED_TRANSITIONS[existing.status] || [];
      if (!allowed.includes(dto.status)) {
        throw new BadRequestException(`治疗状态不可从 ${existing.status} 流转到 ${dto.status}`);
      }
    }
    return super.update(id, dto);
  }

  async findCatalog() { return this.dbService.prepare("SELECT * FROM TreatmentCatalog WHERE deletedAt IS NULL ORDER BY code").all(); }

  async createCatalog(dto: { code: string; name: string; category: string; price: number; remark?: string }) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.dbService.prepare("INSERT INTO TreatmentCatalog (id, code, name, category, price, remark) VALUES (?,?,?,?,?,?)")
      .run(id, dto.code, dto.name, dto.category, dto.price, dto.remark || null);
    return this.dbService.prepare("SELECT * FROM TreatmentCatalog WHERE id = ?").get(id);
  }

  async updateCatalog(id: string, dto: { name?: string; category?: string; price?: number; remark?: string }) {
    const updates: string[] = [];
    const params: unknown[] = [];
    if (dto.name !== undefined) { updates.push("name = ?"); params.push(dto.name); }
    if (dto.category !== undefined) { updates.push("category = ?"); params.push(dto.category); }
    if (dto.price !== undefined) { updates.push("price = ?"); params.push(dto.price); }
    if (dto.remark !== undefined) { updates.push("remark = ?"); params.push(dto.remark); }
    if (updates.length > 0) {
      params.push(id);
      this.dbService.prepare(`UPDATE TreatmentCatalog SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    }
    return this.dbService.prepare("SELECT * FROM TreatmentCatalog WHERE id = ?").get(id);
  }

  async deleteCatalog(id: string) {
    const existing = this.dbService.prepare("SELECT id FROM TreatmentCatalog WHERE id = ?").get(id);
    if (!existing) throw new NotFoundException("治疗项目不存在");
    this.dbService.prepare("DELETE FROM TreatmentCatalog WHERE id = ?").run(id);
    return { id };
  }
}
