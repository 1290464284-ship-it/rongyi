import { BusinessValidationException, BusinessNotFoundException } from '@common/errors';
import { Injectable } from '@nestjs/common';

import { DbService } from "../../../db/db.service";
import { Registration } from "@dental/shared";
import { RegistrationStatus } from "@dental/shared";
import { UpdateBuilder } from "../../../common/utils/db/sql-builder";
import { ClinicContextService } from "../../../common/services/clinic-context.service";
import { BaseService } from "../../../common/services/base.service";
import { UpdateRegistrationDto } from "./dto/update-registration.dto";
import { VisitsService } from "../visits/visits.service";
import { AppointmentsService } from "../../scheduling/appointments/appointments.service";
import { PAGINATION } from "../../../common/constants/pagination";
import { startOfDay, endOfDay } from "../../../common/utils/format/date";

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
  if (!allowed?.includes(next)) {
    throw new BusinessValidationException(`挂号状态不可从 ${current} 流转到 ${next}（操作：${action}）`);
  }
}

@Injectable()
export class RegistrationsService extends BaseService<Registration> {
  constructor(
    dbService: DbService,
    clinicContext: ClinicContextService,
    private visitsService: VisitsService,
    private appointmentsService: AppointmentsService,
  ) {
    super(dbService, clinicContext, { tableName: 'Registration' });
    this.selectFields = REG_FIELDS.split(',').map(s => s.trim()).filter(Boolean);
  }

  async findMany(params: { patientId?: string; status?: RegistrationStatus; startDate?: string; endDate?: string; page?: number; pageSize?: number }) {
    const { patientId, status, startDate, endDate, page = 1, pageSize = PAGINATION.DEFAULT_PAGE_SIZE_MEDIUM } = params;
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    let query = `SELECT ${this.selectFields.join(', ')} FROM Registration WHERE deletedAt IS NULL${clinicClause}`;
    const qp: unknown[] = [...clinicParams];
    if (patientId) { query += " AND patientId = ?"; qp.push(patientId); }
    if (status) { query += " AND status = ?"; qp.push(status); }
    if (startDate) { query += " AND registeredAt >= ?"; qp.push(startOfDay(startDate)); }
    if (endDate) { query += " AND registeredAt <= ?"; qp.push(endOfDay(endDate)); }
    query += " ORDER BY registeredAt DESC LIMIT ? OFFSET ?";
    qp.push(pageSize, (page - 1) * pageSize);
    const items = this.dbService.prepare(query).all(...qp) as Registration[];
    let countQuery = "SELECT COUNT(*) as count FROM Registration WHERE deletedAt IS NULL" + clinicClause;
    const countParams: unknown[] = [...clinicParams];
    if (patientId) { countQuery += " AND patientId = ?"; countParams.push(patientId); }
    if (status) { countQuery += " AND status = ?"; countParams.push(status); }
    if (startDate) { countQuery += " AND registeredAt >= ?"; countParams.push(startOfDay(startDate)); }
    if (endDate) { countQuery += " AND registeredAt <= ?"; countParams.push(endOfDay(endDate)); }
    const total = (this.dbService.prepare(countQuery).get(...countParams) as { count: number })?.count || 0;
    return { items, total, page, pageSize };
  }

  async create(dto: Partial<Registration>): Promise<Registration> {
    const createDto = dto;
    const now = new Date().toISOString();
    const result = await super.create({
      patientId: createDto.patientId,
      doctorId: createDto.doctorId,
      type: createDto.type,
      status: 'REGISTERED',
      chiefComplaint: createDto.chiefComplaint,
      registeredAt: now,
    });
    this.logAudit(this.dbService, "REGISTRATION_CREATE", (result).id, "Registration", { afterData: { patientId: createDto.patientId, doctorId: createDto.doctorId, type: createDto.type } });
    return result;
  }

  /**
   * 通用状态更新（受状态机约束）
   * 直接构建 UPDATE SQL + CAS 保护，绕过通用 update 方法的 status 守卫
   * 防止读-写之间的 TOCTOU 竞态
   *
   * P1 修复：将 UPDATE + logAudit 包入事务，保证业务写入与审计日志原子提交。
   * 原先 logAudit 传入 this.dbService（非事务句柄），若审计写入失败，
   * UPDATE 已提交无法回滚，导致"状态已变更但审计缺失"的不一致。
   */
  async updateStatus(id: string, status: string) {
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    const now = new Date().toISOString();
    return this.dbService.transaction((db) => {
      const r = db.prepare(
        `SELECT ${this.selectFields.join(', ')} FROM Registration WHERE id = ? AND deletedAt IS NULL${clinicClause}`,
      ).get(id, ...clinicParams) as Registration | undefined;
      if (!r) throw new BusinessValidationException("挂号记录不存在");
      assertTransition(r.status, status, "updateStatus");
      const result = db.prepare(
        `UPDATE Registration SET status = ?, updatedAt = ? WHERE id = ? AND deletedAt IS NULL AND status = ?${clinicClause}`,
      ).run(status, now, id, r.status, ...clinicParams);
      if (result.changes === 0) {
        throw new BusinessValidationException("挂号状态已被修改，请刷新后重试");
      }
      this.logAudit(db, "REGISTRATION_UPDATE_STATUS", id, "Registration", { beforeData: { status: r.status }, afterData: { status } });
      return db.prepare(
        `SELECT ${this.selectFields.join(', ')} FROM Registration WHERE id = ? AND deletedAt IS NULL${clinicClause}`,
      ).get(id, ...clinicParams) as Registration;
    });
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
    const reg = await this.findOne(id);
    // 状态机校验（必须在幂等检查之前：已完成/已取消的挂号已有 visitId，
    // 若先做幂等检查会直接返回成功，导致状态机校验被跳过）
    // 但 IN_PROGRESS 状态 + 已有 visitId 是正常的幂等重入，允许返回
    if (reg.visitId) {
      if (reg.status === "IN_PROGRESS" || reg.status === "TRIAGED" || reg.status === "REGISTERED") {
        return this.findOne(id);
      }
      throw new BusinessValidationException(`当前挂号状态为 ${reg.status}，无法开始就诊（仅 REGISTERED/TRIAGED 可开始）`);
    }
    if (reg.status !== "REGISTERED" && reg.status !== "TRIAGED") {
      throw new BusinessValidationException(`当前挂号状态为 ${reg.status}，无法开始就诊（仅 REGISTERED/TRIAGED 可开始）`);
    }

    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();

    return this.dbService.transaction((db) => {
      const now = new Date().toISOString();
      let visitId!: string;

      if (reg.appointmentId) {
        // 关联预约：Visit.appointmentId 有 UNIQUE 约束，需先查复用
        const existingVisit = db.prepare(
          `SELECT id FROM Visit WHERE appointmentId = ? AND deletedAt IS NULL${clinicClause}`
        ).get(reg.appointmentId, ...clinicParams) as { id: string } | undefined;
        if (existingVisit) {
          visitId = existingVisit.id;
        } else {
          // 通过 VisitsService 创建就诊记录（包含业务逻辑和审计）
          visitId = this.visitsService.createSync({
            patientId: reg.patientId,
            appointmentId: reg.appointmentId,
            doctorId: reg.doctorId || undefined,
          }, db);
        }
        // 通过 AppointmentsService 回填 visitId（双向关联）
        this.appointmentsService.linkVisitSync(reg.appointmentId, visitId, db);
      } else {
        // 无预约：通过 VisitsService 创建就诊记录
        visitId = this.visitsService.createSync({
          patientId: reg.patientId,
          doctorId: reg.doctorId || undefined,
        }, db);
      }

      // 回填 Registration.visitId + 状态流转
      // WHERE status IN ('REGISTERED','TRIAGED') 防止读-写之间的 TOCTOU 竞态
      const result = db.prepare(
        `UPDATE Registration SET status = ?, visitId = ?, startedAt = ?, updatedAt = ? WHERE id = ? AND deletedAt IS NULL AND status IN ('REGISTERED', 'TRIAGED')${clinicClause}`
      ).run(RegistrationStatus.IN_PROGRESS, visitId, now, now, id, ...clinicParams);
      if (result.changes === 0) {
        throw new BusinessValidationException("挂号状态已被修改，请刷新后重试");
      }

      this.logAudit(db, "REGISTRATION_START_VISIT", id, "Registration", { afterData: { visitId, status: RegistrationStatus.IN_PROGRESS } });

      return db.prepare(`SELECT ${this.selectFields.join(', ')} FROM Registration WHERE id = ? AND deletedAt IS NULL${clinicClause}`).get(id, ...clinicParams) as Registration;
    });
  }

  /**
   * 完成就诊：状态机校验（仅 IN_PROGRESS → COMPLETED）
   * 直接构建 UPDATE SQL + CAS 保护，防止并发完成导致的状态不一致
   *
   * P1 修复：将 UPDATE + logAudit 包入事务，保证业务写入与审计日志原子提交。
   */
  async complete(id: string) {
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    const now = new Date().toISOString();
    return this.dbService.transaction((db) => {
      const r = db.prepare(
        `SELECT ${this.selectFields.join(', ')} FROM Registration WHERE id = ? AND deletedAt IS NULL${clinicClause}`,
      ).get(id, ...clinicParams) as Registration | undefined;
      if (!r) throw new BusinessValidationException("挂号记录不存在");
      assertTransition(r.status, "COMPLETED", "complete");
      const result = db.prepare(
        `UPDATE Registration SET status = ?, completedAt = ?, updatedAt = ? WHERE id = ? AND deletedAt IS NULL AND status = ?${clinicClause}`,
      ).run('COMPLETED', now, now, id, r.status, ...clinicParams);
      if (result.changes === 0) {
        throw new BusinessValidationException("挂号状态已被修改，请刷新后重试");
      }
      this.logAudit(db, "REGISTRATION_COMPLETE", id, "Registration", { beforeData: { status: r.status }, afterData: { status: 'COMPLETED', completedAt: now } });
      return db.prepare(
        `SELECT ${this.selectFields.join(', ')} FROM Registration WHERE id = ? AND deletedAt IS NULL${clinicClause}`,
      ).get(id, ...clinicParams) as Registration;
    });
  }

  async findAll(params?: { page?: number; pageSize?: number }) {
    const { page = 1, pageSize = PAGINATION.DEFAULT_PAGE_SIZE_MEDIUM } = params || {};
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    const query = `SELECT ${this.selectFields.join(', ')} FROM Registration WHERE deletedAt IS NULL${clinicClause} ORDER BY registeredAt DESC LIMIT ? OFFSET ?`;
    const items = this.dbService.prepare(query).all(...clinicParams, pageSize, (page - 1) * pageSize);
    const total = (this.dbService.prepare(`SELECT COUNT(*) as count FROM Registration WHERE deletedAt IS NULL${clinicClause}`).get(...clinicParams) as { count: number })?.count || 0;
    return { items, total, page, pageSize };
  }

  /**
   * P1 修复：将 UPDATE + logAudit 包入事务，保证业务写入与审计日志原子提交。
   * 原先 logAudit 传入 this.dbService（非事务句柄），UPDATE 与审计不原子。
   */
  async update(id: string, dto: UpdateRegistrationDto | Partial<Registration>) {
    // 状态机守卫：禁止通过通用 update 直接修改 status 字段
    // status 必须走 updateStatus / triage / complete / cancel / startVisit 等专用方法
    // 这些方法会调用 assertTransition 做合法流转校验，并使用 CAS 防止 TOCTOU 竞态
    if ('status' in dto && dto.status !== undefined) {
      throw new BusinessValidationException("禁止通过 update 直接修改 status，请使用 updateStatus/triage/complete/cancel 等专用接口");
    }

    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    return this.dbService.transaction((db) => {
      // P0 修复：更新前检查记录是否存在，避免对不存在的记录写入审计日志
      const existing = db.prepare(
        `SELECT id FROM Registration WHERE id = ? AND deletedAt IS NULL${clinicClause}`,
      ).get(id, ...clinicParams);
      if (!existing) throw new BusinessNotFoundException("挂号记录不存在");

      const builder = new UpdateBuilder("Registration");

      for (const [key, value] of Object.entries(dto)) {
        if (key === 'id' || key === 'createdAt' || value === undefined) continue;
        builder.set(key, value);
      }

      builder.setUpdatedAt();
      const result = builder.buildWithCustomWhere(`id = ? AND deletedAt IS NULL${clinicClause}`, [id, ...clinicParams]);
      if (result) {
        db.prepare(result.sql).run(...result.params);
      }
      this.logAudit(db, "REGISTRATION_UPDATE", id, "Registration", { afterData: dto });
      return db.prepare(
        `SELECT ${this.selectFields.join(', ')} FROM Registration WHERE id = ? AND deletedAt IS NULL${clinicClause}`,
      ).get(id, ...clinicParams) as Registration;
    });
  }

  /**
   * 分诊：状态机校验（仅 REGISTERED → TRIAGED）
   * 直接构建 UPDATE SQL + CAS 保护，防止并发分诊导致的状态不一致
   *
   * P1 修复：将 UPDATE + logAudit 包入事务，保证业务写入与审计日志原子提交。
   */
  async triage(id: string, dto: { triageNote?: string; chiefComplaint?: string }) {
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    const triageNote = dto?.triageNote || null;
    const chiefComplaint = dto?.chiefComplaint || null;
    const now = new Date().toISOString();
    return this.dbService.transaction((db) => {
      const r = db.prepare(
        `SELECT ${this.selectFields.join(', ')} FROM Registration WHERE id = ? AND deletedAt IS NULL${clinicClause}`,
      ).get(id, ...clinicParams) as Registration | undefined;
      if (!r) throw new BusinessValidationException("挂号记录不存在");
      assertTransition(r.status, "TRIAGED", "triage");
      const result = db.prepare(
        `UPDATE Registration SET status = ?, triageNote = ?, chiefComplaint = ?, triagedAt = ?, updatedAt = ? WHERE id = ? AND deletedAt IS NULL AND status = ?${clinicClause}`,
      ).run('TRIAGED', triageNote, chiefComplaint, now, now, id, r.status, ...clinicParams);
      if (result.changes === 0) {
        throw new BusinessValidationException("挂号状态已被修改，请刷新后重试");
      }
      this.logAudit(db, "REGISTRATION_TRIAGE", id, "Registration", { beforeData: { status: r.status }, afterData: { status: 'TRIAGED', triageNote, chiefComplaint } });
      return db.prepare(
        `SELECT ${this.selectFields.join(', ')} FROM Registration WHERE id = ? AND deletedAt IS NULL${clinicClause}`,
      ).get(id, ...clinicParams) as Registration;
    });
  }

  /**
   * 取消：状态机校验（COMPLETED / CANCELLED 不可取消）
   * 直接构建 UPDATE SQL + CAS 保护，防止并发取消导致的状态不一致
   *
   * P1 修复：将 UPDATE + logAudit 包入事务，保证业务写入与审计日志原子提交。
   */
  async cancel(id: string) {
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    const now = new Date().toISOString();
    return this.dbService.transaction((db) => {
      const r = db.prepare(
        `SELECT ${this.selectFields.join(', ')} FROM Registration WHERE id = ? AND deletedAt IS NULL${clinicClause}`,
      ).get(id, ...clinicParams) as Registration | undefined;
      if (!r) throw new BusinessValidationException("挂号记录不存在");
      assertTransition(r.status, "CANCELLED", "cancel");
      const result = db.prepare(
        `UPDATE Registration SET status = ?, updatedAt = ? WHERE id = ? AND deletedAt IS NULL AND status = ?${clinicClause}`,
      ).run('CANCELLED', now, id, r.status, ...clinicParams);
      if (result.changes === 0) {
        throw new BusinessValidationException("挂号状态已被修改，请刷新后重试");
      }
      this.logAudit(db, "REGISTRATION_CANCEL", id, "Registration", { beforeData: { status: r.status }, afterData: { status: 'CANCELLED' } });
      return db.prepare(
        `SELECT ${this.selectFields.join(', ')} FROM Registration WHERE id = ? AND deletedAt IS NULL${clinicClause}`,
      ).get(id, ...clinicParams) as Registration;
    });
  }
}
