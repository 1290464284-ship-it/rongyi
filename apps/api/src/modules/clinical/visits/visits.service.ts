import { Injectable, BadRequestException } from "@nestjs/common";
import { DbService } from "../../../db/db.service";
import { BaseService } from "../../../common/services/base.service";
import { Visit, VisitStatus } from "@dental/shared";
import * as crypto from "crypto";

interface CreateVisitDto {
  patientId: string;
  appointmentId?: string | null;
  doctorId: string;
  chiefComplaint?: string | null;
  diagnosis?: string | null;
}

@Injectable()
export class VisitsService extends BaseService<Visit> {
  constructor(dbService: DbService) {
    super(dbService, "Visit", [], ["chiefComplaint"]);
  }

  async findMany(params: { patientId?: string; status?: VisitStatus; doctorId?: string; page?: number; pageSize?: number }) {
    const { patientId, status, doctorId, page = 1, pageSize = 50 } = params;
    let query = "SELECT id, patientId, appointmentId, doctorId, chiefComplaint, diagnosis, treatmentPlan, startTime, endTime, status, createdAt, updatedAt FROM Visit WHERE deletedAt IS NULL";
    let countQuery = "SELECT COUNT(*) as count FROM Visit WHERE deletedAt IS NULL";
    const qp: unknown[] = [];
    const cp: unknown[] = [];
    if (patientId) { query += " AND patientId = ?"; countQuery += " AND patientId = ?"; qp.push(patientId); cp.push(patientId); }
    if (status) { query += " AND status = ?"; countQuery += " AND status = ?"; qp.push(status); cp.push(status); }
    if (doctorId) { query += " AND doctorId = ?"; countQuery += " AND doctorId = ?"; qp.push(doctorId); cp.push(doctorId); }
    query += " ORDER BY createdAt DESC LIMIT ? OFFSET ?";
    qp.push(pageSize, (page - 1) * pageSize);
    const items = this.dbService.prepare(query).all(...qp) as Visit[];
    const total = (this.dbService.prepare(countQuery).get(...cp) as { count: number })?.count || 0;
    return { items, total, page, pageSize };
  }

  async create(dto: Partial<Visit>): Promise<Visit> {
    const createDto = dto as unknown as CreateVisitDto;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.dbService.prepare("INSERT INTO Visit (id, patientId, appointmentId, doctorId, chiefComplaint, diagnosis, startTime, status, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run(id, createDto.patientId, createDto.appointmentId || null, createDto.doctorId, createDto.chiefComplaint || null, createDto.diagnosis || null, now, "IN_PROGRESS", now, now);
    return super.findOne(id);
  }

  // P1 修复（就诊状态机无流转校验）：定义合法状态转换
  private static readonly ALLOWED_TRANSITIONS: Record<string, readonly string[]> = {
    IN_PROGRESS: ["COMPLETED", "CANCELLED"],
    COMPLETED: [],
    CANCELLED: [],
  };

  async complete(id: string, dto: { diagnosis?: string; remark?: string }) {
    const visit = await super.findOne(id) as Visit;
    // P1 修复：complete() 不检查状态，已完成/已取消的就诊可被再次完成
    // Note: VisitStatus 是 type alias 而非 enum，无法用 VisitStatus.IN_PROGRESS 引用
    if (visit.status !== "IN_PROGRESS") {
      throw new BadRequestException(`当前就诊状态为 ${visit.status}，仅 IN_PROGRESS 可完成就诊`);
    }
    const now = new Date().toISOString();
    const updates: string[] = ["status = ?", "updatedAt = ?"];
    const params: unknown[] = ["COMPLETED", now];
    if (dto.diagnosis !== undefined) { updates.push("diagnosis = ?"); params.push(dto.diagnosis); }
    updates.push("endTime = ?");
    params.push(now);
    params.push(id);
    this.dbService.prepare(`UPDATE Visit SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    return super.findOne(id);
  }

  async update(id: string, dto: Partial<Visit> & { status?: string }) {
    const existing = await super.findOne(id) as Visit;
    if (dto.status && dto.status !== existing.status) {
      const allowed = VisitsService.ALLOWED_TRANSITIONS[existing.status] || [];
      if (!allowed.includes(dto.status)) {
        throw new BadRequestException(`就诊状态不可从 ${existing.status} 流转到 ${dto.status}`);
      }
    }
    return super.update(id, dto);
  }
}
