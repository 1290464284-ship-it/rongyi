import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { DbService } from "../../../db/db.service";
import { Registration } from "@dental/shared";
import { RegistrationStatus } from "../../../common/types/enums";
import * as crypto from "crypto";
import { UpdateBuilder } from "../../../common/utils/sql-builder";

const REG_FIELDS = "id, patientId, doctorId, type, status, visitId, appointmentId, triageNote, chiefComplaint, registeredBy, registeredAt, triagedAt, startedAt, completedAt, createdAt, updatedAt";

/**
 * 挂号状态机：定义每个状态允许流转到的下一状态
 * REGISTERED  → TRIAGED | IN_PROGRESS | CANCELLED
 * TRIAGED     → IN_PROGRESS | CANCELLED
 * IN_PROGRESS → COMPLETED | CANCELLED
 * COMPLETED   → （终态）
 * CANCELLED   → （终态）
 */
const ALLOWED_TRANSITIONS: Record<string, readonly string[]> = {
  REGISTERED: ["TRIAGED", "IN_PROGRESS", "CANCELLED"],
  TRIAGED: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

function assertTransition(current: string, next: string, action: string) {
  const allowed = ALLOWED_TRANSITIONS[current];
  if (!allowed || !allowed.includes(next)) {
    throw new BadRequestException(`挂号状态不可从 ${current} 流转到 ${next}（操作：${action}）`);
  }
}

@Injectable()
export class RegistrationsService {
  constructor(private dbService: DbService) {}

  async findMany(params: { patientId?: string; status?: RegistrationStatus; startDate?: string; endDate?: string; page?: number; pageSize?: number }) {
    const { patientId, status, startDate, endDate, page = 1, pageSize = 50 } = params;
    let query = `SELECT ${REG_FIELDS} FROM Registration WHERE deletedAt IS NULL`;
    const qp: unknown[] = [];
    if (patientId) { query += " AND patientId = ?"; qp.push(patientId); }
    if (status) { query += " AND status = ?"; qp.push(status); }
    if (startDate) { query += " AND registeredAt >= ?"; qp.push(startDate); }
    if (endDate) { query += " AND registeredAt <= ?"; qp.push(endDate); }
    query += " ORDER BY registeredAt DESC LIMIT ? OFFSET ?";
    qp.push(pageSize, (page - 1) * pageSize);
    const items = this.dbService.prepare(query).all(...qp) as Registration[];
    let countQuery = "SELECT COUNT(*) as count FROM Registration WHERE deletedAt IS NULL";
    const countParams: unknown[] = [];
    if (patientId) { countQuery += " AND patientId = ?"; countParams.push(patientId); }
    if (status) { countQuery += " AND status = ?"; countParams.push(status); }
    if (startDate) { countQuery += " AND registeredAt >= ?"; countParams.push(startDate); }
    if (endDate) { countQuery += " AND registeredAt <= ?"; countParams.push(endDate); }
    const total = (this.dbService.prepare(countQuery).get(...countParams) as { count: number })?.count || 0;
    return { items, total, page, pageSize };
  }

  async findOne(id: string) {
    const r = this.dbService.prepare(`SELECT ${REG_FIELDS} FROM Registration WHERE id = ? AND deletedAt IS NULL`).get(id);
    if (!r) throw new NotFoundException("挂号记录不存在");
    return r;
  }

  async create(dto: { patientId: string; doctorId?: string; type: string; chiefComplaint?: string }) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.dbService.prepare(
      "INSERT INTO Registration (id, patientId, doctorId, type, status, chiefComplaint, registeredAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, 'REGISTERED', ?, ?, ?, ?)"
    ).run(id, dto.patientId, dto.doctorId || null, dto.type, dto.chiefComplaint || null, now, now, now);
    return this.findOne(id);
  }

  /**
   * 通用状态更新（受状态机约束）
   */
  async updateStatus(id: string, status: string) {
    const r = (await this.findOne(id)) as Registration;
    assertTransition(r.status, status, "updateStatus");
    const now = new Date().toISOString();
    this.dbService.prepare("UPDATE Registration SET status = ?, updatedAt = ? WHERE id = ?").run(status, now, id);
    return this.findOne(id);
  }

  /**
   * P0.5 修复：开始就诊
   *   - 状态机校验：仅 REGISTERED / TRIAGED 可开始
   *   - 在同一事务内创建 Visit 记录（若挂号关联预约且预约已有 Visit，则复用）
   *   - 回填 Registration.visitId + Registration.status = IN_PROGRESS + startedAt
   *   - 若关联预约，同步回填 Appointment.visitId
   *   - 幂等：若 visitId 已存在，直接返回
   *   - 修复 bug：原代码 status="IN_VISIT" 与枚举 IN_PROGRESS 不一致
   */
  async startVisit(id: string) {
    const reg = (await this.findOne(id)) as Registration;
    // 状态机校验
    if (reg.status !== "REGISTERED" && reg.status !== "TRIAGED") {
      throw new BadRequestException(`当前挂号状态为 ${reg.status}，无法开始就诊（仅 REGISTERED/TRIAGED 可开始）`);
    }
    // 幂等：已开始过则直接返回
    if (reg.visitId) {
      return this.findOne(id);
    }

    return this.dbService.transaction((db) => {
      const now = new Date().toISOString();
      let visitId = "";

      if (reg.appointmentId) {
        // 关联预约：Visit.appointmentId 有 UNIQUE 约束，需先查复用
        const existingVisit = db.prepare(
          "SELECT id FROM Visit WHERE appointmentId = ? AND deletedAt IS NULL"
        ).get(reg.appointmentId) as { id: string } | undefined;
        if (existingVisit) {
          visitId = existingVisit.id;
        } else {
          visitId = crypto.randomUUID();
          db.prepare(
            "INSERT INTO Visit (id, patientId, appointmentId, doctorId, startTime, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
          ).run(visitId, reg.patientId, reg.appointmentId, reg.doctorId || null, now, "IN_PROGRESS", now, now);
        }
        // 回填 Appointment.visitId（双向关联）
        db.prepare("UPDATE Appointment SET visitId = ?, updatedAt = ? WHERE id = ?").run(visitId, now, reg.appointmentId);
      } else {
        // 无预约：直接创建 Visit
        visitId = crypto.randomUUID();
        db.prepare(
          "INSERT INTO Visit (id, patientId, doctorId, startTime, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).run(visitId, reg.patientId, reg.doctorId || null, now, "IN_PROGRESS", now, now);
      }

      // 回填 Registration.visitId + 状态流转
      db.prepare(
        "UPDATE Registration SET status = ?, visitId = ?, startedAt = ?, updatedAt = ? WHERE id = ?"
      ).run(RegistrationStatus.IN_PROGRESS, visitId, now, now, id);

      return db.prepare(`SELECT ${REG_FIELDS} FROM Registration WHERE id = ?`).get(id) as Registration;
    });
  }

  /**
   * 完成就诊：状态机校验（仅 IN_PROGRESS → COMPLETED）
   */
  async complete(id: string) {
    const r = (await this.findOne(id)) as Registration;
    assertTransition(r.status, "COMPLETED", "complete");
    const now = new Date().toISOString();
    this.dbService.prepare(
      "UPDATE Registration SET status = ?, completedAt = ?, updatedAt = ? WHERE id = ?"
    ).run("COMPLETED", now, now, id);
    return this.findOne(id);
  }

  async findAll(params?: { page?: number; pageSize?: number }) {
    const { page = 1, pageSize = 50 } = params || {};
    const query = `SELECT ${REG_FIELDS} FROM Registration WHERE deletedAt IS NULL ORDER BY registeredAt DESC LIMIT ? OFFSET ?`;
    const items = this.dbService.prepare(query).all(pageSize, (page - 1) * pageSize);
    const total = (this.dbService.prepare("SELECT COUNT(*) as count FROM Registration WHERE deletedAt IS NULL").get() as { count: number })?.count || 0;
    return { items, total, page, pageSize };
  }

  async update(id: string, dto: { doctorId?: string; type?: string; chiefComplaint?: string }) {
    await this.findOne(id);
    const builder = new UpdateBuilder("Registration");
    builder.set("doctorId", dto.doctorId);
    builder.set("type", dto.type);
    builder.set("chiefComplaint", dto.chiefComplaint);
    builder.setUpdatedAt();
    const result = builder.build(id);
    if (result) {
      this.dbService.prepare(result.sql).run(...result.params);
    }
    return this.findOne(id);
  }

  /**
   * 分诊：状态机校验（仅 REGISTERED → TRIAGED）
   */
  async triage(id: string, dto: { triageNote?: string | null; chiefComplaint?: string | null }) {
    const r = (await this.findOne(id)) as Registration;
    assertTransition(r.status, "TRIAGED", "triage");
    const triageNote = dto?.triageNote || null;
    const chiefComplaint = dto?.chiefComplaint || null;
    const now = new Date().toISOString();
    this.dbService.prepare(
      "UPDATE Registration SET status = ?, triageNote = ?, chiefComplaint = ?, triagedAt = ?, updatedAt = ? WHERE id = ?"
    ).run("TRIAGED", triageNote, chiefComplaint, now, now, id);
    return this.findOne(id);
  }

  /**
   * 取消：状态机校验（COMPLETED / CANCELLED 不可取消）
   */
  async cancel(id: string) {
    const r = (await this.findOne(id)) as Registration;
    assertTransition(r.status, "CANCELLED", "cancel");
    const now = new Date().toISOString();
    this.dbService.prepare(
      "UPDATE Registration SET status = ?, updatedAt = ? WHERE id = ?"
    ).run("CANCELLED", now, id);
    return this.findOne(id);
  }
}
