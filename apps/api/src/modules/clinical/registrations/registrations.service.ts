import { BusinessValidationException } from '@common/errors';
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
    super(dbService, clinicContext, 'Registration');
    this.selectFields = REG_FIELDS.split(',').map(s => s.trim()).filter(Boolean);
  }

  async findMany(params: { patientId?: string; status?: RegistrationStatus; startDate?: string; endDate?: string; page?: number; pageSize?: number }) {
    const { patientId, status, startDate, endDate, page = 1, pageSize = PAGINATION.DEFAULT_PAGE_SIZE_MEDIUM } = params;
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    let query = `SELECT ${this.selectFields.join(', ')} FROM Registration WHERE deletedAt IS NULL${clinicClause}`;
    const qp: unknown[] = [...clinicParams];
    if (patientId) { query += " AND patientId = ?"; qp.push(patientId); }
    if (status) { query += " AND status = ?"; qp.push(status); }
    if (startDate) { query += " AND registeredAt >= ?"; qp.push(startDate); }
    if (endDate) { query += " AND registeredAt <= ?"; qp.push(endDate); }
    query += " ORDER BY registeredAt DESC LIMIT ? OFFSET ?";
    qp.push(pageSize, (page - 1) * pageSize);
    const items = this.dbService.prepare(query).all(...qp) as Registration[];
    let countQuery = "SELECT COUNT(*) as count FROM Registration WHERE deletedAt IS NULL" + clinicClause;
    const countParams: unknown[] = [...clinicParams];
    if (patientId) { countQuery += " AND patientId = ?"; countParams.push(patientId); }
    if (status) { countQuery += " AND status = ?"; countParams.push(status); }
    if (startDate) { countQuery += " AND registeredAt >= ?"; countParams.push(startDate); }
    if (endDate) { countQuery += " AND registeredAt <= ?"; countParams.push(endDate); }
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
   */
  async updateStatus(id: string, status: string) {
    const r = await this.findOne(id);
    assertTransition(r.status, status, "updateStatus");
    return this.update(id, { status } as Partial<Registration>);
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
    // 状态机校验
    if (reg.status !== "REGISTERED" && reg.status !== "TRIAGED") {
      throw new BusinessValidationException(`当前挂号状态为 ${reg.status}，无法开始就诊（仅 REGISTERED/TRIAGED 可开始）`);
    }
    // 幂等：已开始过则直接返回
    if (reg.visitId) {
      return this.findOne(id);
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
      db.prepare(
        `UPDATE Registration SET status = ?, visitId = ?, startedAt = ?, updatedAt = ? WHERE id = ? AND deletedAt IS NULL${clinicClause}`
      ).run(RegistrationStatus.IN_PROGRESS, visitId, now, now, id, ...clinicParams);

      this.logAudit(db, "REGISTRATION_START_VISIT", id, "Registration", { afterData: { visitId, status: RegistrationStatus.IN_PROGRESS } });

      return db.prepare(`SELECT ${this.selectFields.join(', ')} FROM Registration WHERE id = ? AND deletedAt IS NULL${clinicClause}`).get(id, ...clinicParams) as Registration;
    });
  }

  /**
   * 完成就诊：状态机校验（仅 IN_PROGRESS → COMPLETED）
   */
  async complete(id: string) {
    const r = await this.findOne(id);
    assertTransition(r.status, "COMPLETED", "complete");
    return this.update(id, { status: 'COMPLETED', completedAt: new Date().toISOString() });
  }

  async findAll(params?: { page?: number; pageSize?: number }) {
    const { page = 1, pageSize = PAGINATION.DEFAULT_PAGE_SIZE_MEDIUM } = params || {};
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    const query = `SELECT ${this.selectFields.join(', ')} FROM Registration WHERE deletedAt IS NULL${clinicClause} ORDER BY registeredAt DESC LIMIT ? OFFSET ?`;
    const items = this.dbService.prepare(query).all(...clinicParams, pageSize, (page - 1) * pageSize);
    const total = (this.dbService.prepare(`SELECT COUNT(*) as count FROM Registration WHERE deletedAt IS NULL${clinicClause}`).get(...clinicParams) as { count: number })?.count || 0;
    return { items, total, page, pageSize };
  }

  async update(id: string, dto: UpdateRegistrationDto | Partial<Registration>) {
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    const builder = new UpdateBuilder("Registration");

    for (const [key, value] of Object.entries(dto)) {
      if (key === 'id' || key === 'createdAt' || value === undefined) continue;
      builder.set(key, value);
    }

    builder.setUpdatedAt();
    const result = builder.buildWithCustomWhere(`id = ? AND deletedAt IS NULL${clinicClause}`, [id, ...clinicParams]);
    if (result) {
      this.dbService.prepare(result.sql).run(...result.params);
    }
    this.logAudit(this.dbService, "REGISTRATION_UPDATE", id, "Registration", { afterData: dto });
    return this.findOne(id);
  }

  /**
   * 分诊：状态机校验（仅 REGISTERED → TRIAGED）
   */
  async triage(id: string, dto: { triageNote?: string | null; chiefComplaint?: string | null }) {
    const r = await this.findOne(id);
    assertTransition(r.status, "TRIAGED", "triage");
    const triageNote = dto?.triageNote || null;
    const chiefComplaint = dto?.chiefComplaint || null;
    return this.update(id, { status: 'TRIAGED', triageNote, chiefComplaint, triagedAt: new Date().toISOString() });
  }

  /**
   * 取消：状态机校验（COMPLETED / CANCELLED 不可取消）
   */
  async cancel(id: string) {
    const r = await this.findOne(id);
    assertTransition(r.status, "CANCELLED", "cancel");
    const result = await this.update(id, { status: 'CANCELLED' });
    this.logAudit(this.dbService, "REGISTRATION_CANCEL", id, "Registration", { beforeData: { status: r.status }, afterData: { status: 'CANCELLED' } });
    return result;
  }
}
