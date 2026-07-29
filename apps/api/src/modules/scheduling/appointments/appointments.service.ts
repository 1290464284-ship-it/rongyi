import { BusinessValidationException } from '@common/errors';
import { Injectable } from '@nestjs/common';

import { DbService } from "../../../db/db.service";
import { IDatabase } from "../../../db/db.interface";
import { Appointment } from "@dental/shared";
import { BaseService, MAX_PAGE_SIZE } from "../../../common/services/base.service";
import { endOfDay, startOfDay, parseDate, validateDates } from "../../../common/utils/format/date";
import * as crypto from "node:crypto";
import { UpdateBuilder } from "../../../common/utils/db/sql-builder";
import { ClinicContextService } from "../../../common/services/clinic-context.service";
import { AppointmentStatus, AuditLogType } from "../../../common/constants";
import { EventBusService } from '../../../common/events/event-bus.service';
import { AppointmentCreatedEvent, AppointmentUpdatedEvent, AppointmentDeletedEvent } from '../../../common/events/domain-events';
import { maskPhone } from '../../../common/utils/security/mask';

@Injectable()
export class AppointmentsService extends BaseService<Appointment> {
  constructor(
    dbService: DbService,
    clinicContext: ClinicContextService,
    private eventBus: EventBusService,
  ) {
    super(dbService, clinicContext, { tableName: 'Appointment' });
  }

  async queryAppointments(params: { doctorId?: string; patientId?: string; status?: string; startDate?: string; endDate?: string; page?: number; pageSize?: number }) {
    const { doctorId, patientId, status, startDate, endDate, page = 1, pageSize: rawPageSize = 50 } = params;
    validateDates(startDate, endDate);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, rawPageSize));
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    let query = "SELECT id, patientId, doctorId, chairId, startTime, endTime, status, type, remark, visitId, createdAt, updatedAt FROM Appointment WHERE deletedAt IS NULL" + clinicClause;
    let countQuery = "SELECT COUNT(*) as count FROM Appointment WHERE deletedAt IS NULL" + clinicClause;
    const qp: unknown[] = [...clinicParams];
    const cp: unknown[] = [...clinicParams];
    if (doctorId) { query += " AND doctorId = ?"; countQuery += " AND doctorId = ?"; qp.push(doctorId); cp.push(doctorId); }
    if (patientId) { query += " AND patientId = ?"; countQuery += " AND patientId = ?"; qp.push(patientId); cp.push(patientId); }
    if (status) { query += " AND status = ?"; countQuery += " AND status = ?"; qp.push(status); cp.push(status); }
    if (startDate) { query += " AND startTime >= ?"; countQuery += " AND startTime >= ?"; qp.push(startOfDay(startDate)); cp.push(startOfDay(startDate)); }
    if (endDate) { query += " AND startTime <= ?"; countQuery += " AND startTime <= ?"; qp.push(endOfDay(endDate)); cp.push(endOfDay(endDate)); }
    query += " ORDER BY startTime ASC LIMIT ? OFFSET ?";
    qp.push(pageSize, (page - 1) * pageSize);
    const items = this.dbService.prepare(query).all(...qp) as Array<Record<string, unknown>>;
    const total = (this.dbService.prepare(countQuery).get(...cp) as { count: number })?.count || 0;

    if (items.length > 0) {
      const patientIds = [...new Set(items.map(a => a.patientId as string).filter(Boolean))];
      const doctorIds = [...new Set(items.map(a => a.doctorId as string).filter(Boolean))];
      
      const patientMap = new Map<string, Record<string, unknown>>();
      if (patientIds.length > 0) {
        const placeholders = patientIds.map(() => '?').join(',');
        const patients = this.dbService.prepare(`SELECT id, name, phone FROM Patient WHERE id IN (${placeholders}) AND deletedAt IS NULL${clinicClause}`).all(...patientIds, ...clinicParams) as Array<Record<string, unknown>>;
        patients.forEach(p => {
          const masked = maskPhone(p.phone as string);
          if (masked) p.phone = masked;
          patientMap.set(p.id as string, p);
        });
      }
      
      const doctorMap = new Map<string, Record<string, unknown>>();
      if (doctorIds.length > 0) {
        const placeholders = doctorIds.map(() => '?').join(',');
        const doctors = this.dbService.prepare(`SELECT id, name, role FROM User WHERE id IN (${placeholders}) AND active = 1 AND deletedAt IS NULL${clinicClause}`).all(...doctorIds, ...clinicParams) as Array<Record<string, unknown>>;
        doctors.forEach(d => doctorMap.set(d.id as string, d));
      }
      
      const itemsWithRelations = items.map(apt => ({
        ...apt,
        patient: patientMap.get(apt.patientId as string) || null,
        doctor: doctorMap.get(apt.doctorId as string) || null,
      }));
      return { items: itemsWithRelations, total, page, pageSize };
    }

    return { items, total, page, pageSize };
  }

  async create(dto: Partial<Appointment>): Promise<Appointment> {
    if (!dto.patientId || !dto.doctorId || !dto.startTime || !dto.endTime || !dto.type) {
      throw new BusinessValidationException("患者、医生、开始时间、结束时间和类型不能为空");
    }
    const startTime = parseDate(dto.startTime).toISOString();
    const endTime = parseDate(dto.endTime).toISOString();
    if (new Date(endTime) <= new Date(startTime)) throw new BusinessValidationException("结束时间必须晚于开始时间");

    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    const clinicId = this.clinicContext.getClinicId();

    // 冲突检测 + 插入必须在同一事务内，防止竞态条件
    const result = this.dbService.transaction((db) => {
      const conflictStatuses = AppointmentsService.CONFLICT_STATUSES;
      const doctorConflict = db.prepare(
        `SELECT id FROM Appointment WHERE doctorId = ? AND status IN (?,?,?) AND startTime < ? AND endTime > ? AND deletedAt IS NULL${clinicClause}`
      ).get(dto.doctorId, ...conflictStatuses, endTime, startTime, ...clinicParams);
      if (doctorConflict) throw new BusinessValidationException("该时间段医生已有预约");

      const patientConflict = db.prepare(
        `SELECT id FROM Appointment WHERE patientId = ? AND status IN (?,?,?) AND startTime < ? AND endTime > ? AND deletedAt IS NULL${clinicClause}`
      ).get(dto.patientId, ...conflictStatuses, endTime, startTime, ...clinicParams);
      if (patientConflict) throw new BusinessValidationException("该时间段患者已有其他预约");

      if (dto.chairId) {
        const chairConflict = db.prepare(
          `SELECT id FROM Appointment WHERE chairId = ? AND status IN (?,?,?) AND startTime < ? AND endTime > ? AND deletedAt IS NULL${clinicClause}`
        ).get(dto.chairId, ...conflictStatuses, endTime, startTime, ...clinicParams);
        if (chairConflict) throw new BusinessValidationException("该时间段牙椅已被占用");
      }

      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      db.prepare("INSERT INTO Appointment (id, patientId, doctorId, chairId, startTime, endTime, type, remark, status, clinicId, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
        .run(id, dto.patientId, dto.doctorId, dto.chairId || null, startTime, endTime, dto.type, dto.remark || null, AppointmentStatus.BOOKED, clinicId || null, now, now);
      this.logAudit(db, AuditLogType.APPOINTMENT_CREATE, id, "Appointment", { afterData: { patientId: dto.patientId, doctorId: dto.doctorId, startTime, endTime, type: dto.type, status: AppointmentStatus.BOOKED } });
      return db.prepare(`SELECT id, patientId, doctorId, chairId, startTime, endTime, status, type, remark, visitId, clinicId, createdAt, updatedAt FROM Appointment WHERE id = ? AND deletedAt IS NULL${clinicClause}`).get(id, ...clinicParams) as Appointment;
    });

    this.eventBus.emit(new AppointmentCreatedEvent(result.id, result.patientId, result.doctorId, this.clinicContext.getClinicId()));

    return result;
  }

  // 参与时段冲突检测的占用状态（IN 子句参数化使用，占位符数量须与之保持一致）
  private static readonly CONFLICT_STATUSES: readonly string[] = [
    AppointmentStatus.BOOKED,
    AppointmentStatus.ARRIVED,
    AppointmentStatus.IN_CHAIR,
  ];

  // P1 修复（挂号状态机无流转校验）：定义合法预约状态转换
  private static readonly ALLOWED_TRANSITIONS: Record<string, readonly string[]> = {
    [AppointmentStatus.BOOKED]: [AppointmentStatus.ARRIVED, AppointmentStatus.CANCELLED, AppointmentStatus.NO_SHOW],
    [AppointmentStatus.ARRIVED]: [AppointmentStatus.IN_CHAIR, AppointmentStatus.CANCELLED, AppointmentStatus.NO_SHOW],
    [AppointmentStatus.IN_CHAIR]: [AppointmentStatus.COMPLETED, AppointmentStatus.CANCELLED],
    [AppointmentStatus.COMPLETED]: [],
    [AppointmentStatus.CANCELLED]: [],
    [AppointmentStatus.NO_SHOW]: [],
  };

  async update(id: string, dto: Partial<Appointment>): Promise<Appointment> {
    const existing = await this.findOne(id);
    // P1 修复：用完整状态机替换原先仅 IN_CHAIR→ARRIVED 的检查
    if (dto.status && dto.status !== existing.status) {
      const currentStatus = existing.status;
      const allowed = AppointmentsService.ALLOWED_TRANSITIONS[currentStatus] || [];
      if (!allowed.includes(dto.status)) {
        throw new BusinessValidationException(`预约状态不可从 ${currentStatus} 流转到 ${dto.status}`);
      }
    }
    const newDoctorId = dto.doctorId || existing.doctorId;
    const newPatientId = existing.patientId;
    const newChairId = dto.chairId !== undefined ? dto.chairId : existing.chairId;
    let newStart: string;
    let newEnd: string;
    if (dto.startTime) {
      newStart = parseDate(dto.startTime).toISOString();
    } else {
      newStart = existing.startTime;
    }
    if (dto.endTime) {
      newEnd = parseDate(dto.endTime).toISOString();
    } else {
      newEnd = existing.endTime;
    }
    if (new Date(newEnd) <= new Date(newStart)) throw new BusinessValidationException("结束时间必须晚于开始时间");

    const timeOrDoctorChanged = dto.startTime || dto.endTime || dto.doctorId || dto.chairId !== undefined;

    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();

    const result = this.dbService.transaction((db) => {
      if (timeOrDoctorChanged) {
        // P1 修复：update 也需检测患者和椅位冲突
        const conflictStatuses = AppointmentsService.CONFLICT_STATUSES;
        const doctorConflict = db.prepare(
          `SELECT id FROM Appointment WHERE doctorId = ? AND id != ? AND status IN (?,?,?) AND startTime < ? AND endTime > ? AND deletedAt IS NULL${clinicClause}`
        ).get(newDoctorId, id, ...conflictStatuses, newEnd, newStart, ...clinicParams);
        if (doctorConflict) throw new BusinessValidationException("该时间段医生已有预约");

        const patientConflict = db.prepare(
          `SELECT id FROM Appointment WHERE patientId = ? AND id != ? AND status IN (?,?,?) AND startTime < ? AND endTime > ? AND deletedAt IS NULL${clinicClause}`
        ).get(newPatientId, id, ...conflictStatuses, newEnd, newStart, ...clinicParams);
        if (patientConflict) throw new BusinessValidationException("该时间段患者已有其他预约");

        if (newChairId) {
          const chairConflict = db.prepare(
            `SELECT id FROM Appointment WHERE chairId = ? AND id != ? AND status IN (?,?,?) AND startTime < ? AND endTime > ? AND deletedAt IS NULL${clinicClause}`
          ).get(newChairId, id, ...conflictStatuses, newEnd, newStart, ...clinicParams);
          if (chairConflict) throw new BusinessValidationException("该时间段牙椅已被占用");
        }
      }

      const builder = new UpdateBuilder("Appointment");
      builder.set("status", dto.status);
      builder.set("type", dto.type);
      builder.set("remark", dto.remark !== undefined ? (dto.remark || null) : undefined);
      builder.set("startTime", dto.startTime ? newStart : undefined);
      builder.set("endTime", dto.endTime ? newEnd : undefined);
      builder.set("doctorId", dto.doctorId);
      builder.set("chairId", dto.chairId !== undefined ? (dto.chairId || null) : undefined);
      builder.setUpdatedAt();
      // P0 修复：当变更 status 时加入 CAS 保护，防止并发状态覆盖
      const statusChanged = dto.status && dto.status !== (existing.status as string);
      const whereClause = statusChanged
        ? `id = ? AND deletedAt IS NULL AND status = ?${clinicClause}`
        : `id = ? AND deletedAt IS NULL${clinicClause}`;
      const whereParams = statusChanged
        ? [id, existing.status, ...clinicParams]
        : [id, ...clinicParams];
      const result = builder.buildWithCustomWhere(whereClause, whereParams);
      if (result) {
        const updateResult = db.prepare(result.sql).run(...result.params);
        if (statusChanged && updateResult.changes === 0) {
          throw new BusinessValidationException('预约状态已被修改，请刷新后重试');
        }
      }

      this.logAudit(db, AuditLogType.APPOINTMENT_UPDATE, id, "Appointment", { beforeData: { status: existing.status, startTime: existing.startTime, endTime: existing.endTime, doctorId: existing.doctorId }, afterData: { status: dto.status ?? existing.status, startTime: dto.startTime ? newStart : existing.startTime, endTime: dto.endTime ? newEnd : existing.endTime, doctorId: dto.doctorId ?? existing.doctorId } });

      return db.prepare(`SELECT id, patientId, doctorId, chairId, startTime, endTime, status, type, remark, visitId, clinicId, createdAt, updatedAt FROM Appointment WHERE id = ? AND deletedAt IS NULL${clinicClause}`).get(id, ...clinicParams) as Appointment;
    });

    this.eventBus.emit(new AppointmentUpdatedEvent(result.id, result.patientId, result.doctorId, this.clinicContext.getClinicId()));

    return result;
  }

  /**
   * P0 修复：UPDATE + 审计日志包入事务
   * 原先 UPDATE 和 logAudit 分离，审计写入失败会留下无审计的更新。
   */
  async linkVisit(appointmentId: string, visitId: string): Promise<Appointment> {
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    const now = new Date().toISOString();
    return this.dbService.transaction((db) => {
      const result = db.prepare(
        `UPDATE Appointment SET visitId = ?, updatedAt = ? WHERE id = ? AND deletedAt IS NULL${clinicClause}`
      ).run(visitId, now, appointmentId, ...clinicParams);
      if (result.changes === 0) {
        throw new BusinessValidationException('预约不存在或已被删除');
      }
      this.logAudit(db, "APPOINTMENT_LINK_VISIT", appointmentId, "Appointment", { afterData: { visitId } });
      return db.prepare(`SELECT id, patientId, doctorId, chairId, startTime, endTime, status, type, remark, visitId, clinicId, createdAt, updatedAt FROM Appointment WHERE id = ? AND deletedAt IS NULL${clinicClause}`).get(appointmentId, ...clinicParams) as Appointment;
    });
  }

  /**
   * 同步版本：在事务内回填 visitId（供 RegistrationsService.startVisit 调用）
   */
  linkVisitSync(appointmentId: string, visitId: string, db?: { prepare: (sql: string) => { run: (...args: unknown[]) => unknown } }): void {
    const executor = db || this.dbService;
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    const now = new Date().toISOString();
    executor.prepare(
      `UPDATE Appointment SET visitId = ?, updatedAt = ? WHERE id = ? AND deletedAt IS NULL${clinicClause}`
    ).run(visitId, now, appointmentId, ...clinicParams);
    this.logAudit(executor as unknown as IDatabase, "APPOINTMENT_LINK_VISIT", appointmentId, "Appointment", { afterData: { visitId } });
  }

  /**
   * P0 修复：softDelete + logAudit 包入事务
   * 原先 softDelete 和 logAudit 分离，审计写入失败会留下无审计的删除。
   * eventBus.emit 保持事务后发射（已提交的数据才通知）。
   */
  async remove(id: string) {
    const existing = await this.findOne(id);
    this.dbService.transaction((db) => {
      this.softDeleteSync(db, id);
      this.logAudit(db, AuditLogType.APPOINTMENT_REMOVE, id, "Appointment", { beforeData: { status: existing.status, patientId: existing.patientId, doctorId: existing.doctorId } });
    });

    this.eventBus.emit(new AppointmentDeletedEvent(existing.id, existing.patientId, existing.doctorId, this.clinicContext.getClinicId()));
  }

  /**
   * 同步版软删除（在已有事务内调用）
   */
  private softDeleteSync(db: IDatabase, id: string): void {
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    const now = new Date().toISOString();
    const result = db.prepare(
      `UPDATE Appointment SET deletedAt = ?, updatedAt = ? WHERE id = ? AND deletedAt IS NULL${clinicClause}`,
    ).run(now, now, id, ...clinicParams);
    if (result.changes === 0) {
      throw new BusinessValidationException('预约不存在或已被删除');
    }
  }
}
