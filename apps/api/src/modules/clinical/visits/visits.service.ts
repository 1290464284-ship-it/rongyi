import { BusinessValidationException } from '@common/errors';
import { Injectable } from '@nestjs/common';

import { DbService } from "../../../db/db.service";
import { BaseService } from "../../../common/services/base.service";
import { Visit, VisitStatus } from "@dental/shared";
import * as crypto from "node:crypto";
import { ClinicContextService } from "../../../common/services/clinic-context.service";
import { PAGINATION } from "../../../common/constants/pagination";
import { CreateVisitDto } from "./dto/create-visit.dto";

@Injectable()
export class VisitsService extends BaseService<Visit> {
  constructor(dbService: DbService, clinicContext: ClinicContextService) {
    super(dbService, clinicContext, "Visit", [], ["chiefComplaint"]);
  }

  async findMany(params: { patientId?: string; status?: VisitStatus; doctorId?: string; page?: number; pageSize?: number }) {
    const { patientId, status, doctorId, page = 1, pageSize = PAGINATION.DEFAULT_PAGE_SIZE_MEDIUM } = params;
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    let query = `SELECT id, patientId, appointmentId, doctorId, chiefComplaint, diagnosis, treatmentPlan, startTime, endTime, status, createdAt, updatedAt FROM Visit WHERE deletedAt IS NULL${clinicClause}`;
    let countQuery = `SELECT COUNT(*) as count FROM Visit WHERE deletedAt IS NULL${clinicClause}`;
    const qp: unknown[] = [...clinicParams];
    const cp: unknown[] = [...clinicParams];
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
    const createDto = dto as CreateVisitDto;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const clinicId = this.clinicContext.getClinicId();
    this.dbService.prepare("INSERT INTO Visit (id, patientId, appointmentId, doctorId, chiefComplaint, diagnosis, startTime, status, clinicId, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .run(id, createDto.patientId, createDto.appointmentId || null, createDto.doctorId, createDto.chiefComplaint || null, createDto.diagnosis || null, now, "IN_PROGRESS", clinicId || null, now, now);
    this.logAudit(this.dbService, "VISIT_CREATE", id, "Visit", { afterData: { patientId: createDto.patientId, doctorId: createDto.doctorId } });
    return super.findOne(id);
  }

  /**
   * 同步版本：在事务内创建就诊记录（供 RegistrationsService.startVisit 调用）
   * @param dto 就诊信息
   * @param db 可选的事务数据库连接，传入则在当前事务内执行
   * @returns 新创建的就诊记录 ID
   */
  createSync(dto: { patientId: string; appointmentId?: string; doctorId?: string }, db?: { prepare: (sql: string) => { run: (...args: unknown[]) => unknown } }): string {
    const executor = db || this.dbService;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const clinicId = this.clinicContext.getClinicId();
    executor.prepare("INSERT INTO Visit (id, patientId, appointmentId, doctorId, startTime, status, clinicId, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(id, dto.patientId, dto.appointmentId || null, dto.doctorId || null, now, "IN_PROGRESS", clinicId || null, now, now);
    return id;
  }

  // P1 修复（就诊状态机无流转校验）：定义合法状态转换
  private static readonly ALLOWED_TRANSITIONS: Record<string, readonly string[]> = {
    IN_PROGRESS: ["COMPLETED", "CANCELLED"],
    COMPLETED: [],
    CANCELLED: [],
  };

  async complete(id: string, dto: { diagnosis?: string; remark?: string }) {
    const visit = await super.findOne(id);
    // P1 修复：complete() 不检查状态，已完成/已取消的就诊可被再次完成
    // Note: VisitStatus 是 type alias 而非 enum，无法用 VisitStatus.IN_PROGRESS 引用
    if (visit.status !== "IN_PROGRESS") {
      throw new BusinessValidationException(`当前就诊状态为 ${visit.status}，仅 IN_PROGRESS 可完成就诊`);
    }
    const now = new Date().toISOString();
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    const updates: string[] = ["status = ?", "updatedAt = ?"];
    const params: unknown[] = ["COMPLETED", now];
    if (dto.diagnosis !== undefined) { updates.push("diagnosis = ?"); params.push(dto.diagnosis); }
    updates.push("endTime = ?");
    params.push(now);
    params.push(id, 'IN_PROGRESS', ...clinicParams);
    const result = this.dbService.prepare(`UPDATE Visit SET ${updates.join(', ')} WHERE id = ? AND status = ?${clinicClause}`).run(...params);
    if (result.changes === 0) {
      throw new BusinessValidationException('就诊状态已变更，请刷新后重试（可能存在并发操作）');
    }
    this.logAudit(this.dbService, "VISIT_COMPLETE", id, "Visit", { afterData: { diagnosis: dto.diagnosis } });
    return super.findOne(id);
  }

  async update(id: string, dto: Partial<Visit> & { status?: string }) {
    const existing = await super.findOne(id);
    if (dto.status && dto.status !== existing.status) {
      const allowed = VisitsService.ALLOWED_TRANSITIONS[existing.status] || [];
      if (!allowed.includes(dto.status)) {
        throw new BusinessValidationException(`就诊状态不可从 ${existing.status} 流转到 ${dto.status}`);
      }
    }
    return super.update(id, dto);
  }
}
