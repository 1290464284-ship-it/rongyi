import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { DbService } from "../../../db/db.service";
import { endOfDay, startOfDay, parseDate } from "../../../common/utils/date";
import * as crypto from "crypto";
import { UpdateBuilder } from "../../../common/utils/sql-builder";

@Injectable()
export class AppointmentsService {
  constructor(private dbService: DbService) {}

  async findMany(params: { doctorId?: string; patientId?: string; status?: string; startDate?: string; endDate?: string; page?: number; pageSize?: number }) {
    const { doctorId, patientId, status, startDate, endDate, page = 1, pageSize: rawPageSize = 50 } = params;
    const pageSize = Math.min(200, Math.max(1, rawPageSize));
    let query = "SELECT id, patientId, doctorId, chairId, startTime, endTime, status, type, remark, visitId, createdAt, updatedAt FROM Appointment WHERE deletedAt IS NULL";
    let countQuery = "SELECT COUNT(*) as count FROM Appointment WHERE deletedAt IS NULL";
    const qp: unknown[] = [];
    const cp: unknown[] = [];
    if (doctorId) { query += " AND doctorId = ?"; countQuery += " AND doctorId = ?"; qp.push(doctorId); cp.push(doctorId); }
    if (patientId) { query += " AND patientId = ?"; countQuery += " AND patientId = ?"; qp.push(patientId); cp.push(patientId); }
    if (status) { query += " AND status = ?"; countQuery += " AND status = ?"; qp.push(status); cp.push(status); }
    if (startDate) { query += " AND startTime >= ?"; countQuery += " AND startTime >= ?"; qp.push(startOfDay(startDate)); cp.push(startOfDay(startDate)); }
    if (endDate) { query += " AND startTime <= ?"; countQuery += " AND startTime <= ?"; qp.push(endOfDay(endDate)); cp.push(endOfDay(endDate)); }
    query += " ORDER BY startTime ASC LIMIT ? OFFSET ?";
    qp.push(pageSize, (page - 1) * pageSize);
    const items = this.dbService.prepare(query).all(...qp) as Array<Record<string, unknown>>;
    const total = (this.dbService.prepare(countQuery).get(...cp) as { count: number })?.count || 0;
    
    if (items.length > 0 && !patientId) {
      const patientIds = [...new Set(items.map(a => a.patientId as string).filter(Boolean))];
      if (patientIds.length > 0) {
        const placeholders = patientIds.map(() => '?').join(',');
        const patients = this.dbService.prepare(`SELECT id, name, phone FROM Patient WHERE id IN (${placeholders}) AND deletedAt IS NULL`).all(...patientIds) as Array<Record<string, unknown>>;
        const patientMap = new Map<string, Record<string, unknown>>();
        for (const p of patients) {
          patientMap.set(p.id as string, p);
        }
        const itemsWithPatient = items.map(apt => ({
          ...apt,
          patient: patientMap.get(apt.patientId as string) || null,
        }));
        return { items: itemsWithPatient, total, page, pageSize };
      }
    }
    
    return { items, total, page, pageSize };
  }

  async findOne(id: string) {
    const a = this.dbService.prepare("SELECT * FROM Appointment WHERE id = ? AND deletedAt IS NULL").get(id);
    if (!a) throw new NotFoundException("预约不存在");
    return a;
  }

  async create(dto: { patientId: string; doctorId: string; chairId?: string; startTime: string; endTime: string; type: string; remark?: string }) {
    const startParsed = parseDate(dto.startTime);
    const endParsed = parseDate(dto.endTime);
    if (!startParsed || !endParsed) throw new BadRequestException("无效的日期格式");
    const startTime = startParsed.toISOString();
    const endTime = endParsed.toISOString();
    if (endParsed <= startParsed) throw new BadRequestException("结束时间必须晚于开始时间");

    // 冲突检测 + 插入必须在同一事务内，防止竞态条件
    return this.dbService.transaction((db) => {
      // P1 修复（预约冲突检测不全）：原代码仅检测医生冲突，遗漏患者和椅位冲突
      const doctorConflict = db.prepare(
        "SELECT id FROM Appointment WHERE doctorId = ? AND status IN ('BOOKED','ARRIVED','IN_CHAIR') AND startTime < ? AND endTime > ? AND deletedAt IS NULL"
      ).get(dto.doctorId, endTime, startTime);
      if (doctorConflict) throw new BadRequestException("该时间段医生已有预约");

      const patientConflict = db.prepare(
        "SELECT id FROM Appointment WHERE patientId = ? AND status IN ('BOOKED','ARRIVED','IN_CHAIR') AND startTime < ? AND endTime > ? AND deletedAt IS NULL"
      ).get(dto.patientId, endTime, startTime);
      if (patientConflict) throw new BadRequestException("该时间段患者已有其他预约");

      if (dto.chairId) {
        const chairConflict = db.prepare(
          "SELECT id FROM Appointment WHERE chairId = ? AND status IN ('BOOKED','ARRIVED','IN_CHAIR') AND startTime < ? AND endTime > ? AND deletedAt IS NULL"
        ).get(dto.chairId, endTime, startTime);
        if (chairConflict) throw new BadRequestException("该时间段牙椅已被占用");
      }

      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      db.prepare("INSERT INTO Appointment (id, patientId, doctorId, chairId, startTime, endTime, type, remark, status, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?)")
        .run(id, dto.patientId, dto.doctorId, dto.chairId || null, startTime, endTime, dto.type, dto.remark || null, "BOOKED", now, now);
      return db.prepare("SELECT * FROM Appointment WHERE id = ? AND deletedAt IS NULL").get(id);
    });
  }

  // P1 修复（挂号状态机无流转校验）：定义合法预约状态转换
  private static readonly ALLOWED_TRANSITIONS: Record<string, readonly string[]> = {
    BOOKED: ["ARRIVED", "CANCELLED", "NO_SHOW"],
    ARRIVED: ["IN_CHAIR", "CANCELLED", "NO_SHOW"],
    IN_CHAIR: ["COMPLETED", "CANCELLED"],
    COMPLETED: [],
    CANCELLED: [],
    NO_SHOW: [],
  };

  async update(id: string, dto: { status?: string; type?: string; remark?: string; startTime?: string; endTime?: string; doctorId?: string; chairId?: string | null }) {
    const existing = await this.findOne(id) as Record<string, unknown>;
    // P1 修复：用完整状态机替换原先仅 IN_CHAIR→ARRIVED 的检查
    if (dto.status && dto.status !== (existing.status as string)) {
      const currentStatus = existing.status as string;
      const allowed = AppointmentsService.ALLOWED_TRANSITIONS[currentStatus] || [];
      if (!allowed.includes(dto.status)) {
        throw new BadRequestException(`预约状态不可从 ${currentStatus} 流转到 ${dto.status}`);
      }
    }
    const newDoctorId = dto.doctorId || (existing.doctorId as string);
    const newPatientId = existing.patientId as string;
    const newChairId = dto.chairId !== undefined ? dto.chairId : (existing.chairId as string | null);
    let newStart: string;
    let newEnd: string;
    if (dto.startTime) {
      const parsed = parseDate(dto.startTime);
      if (!parsed) throw new BadRequestException("无效的开始时间格式");
      newStart = parsed.toISOString();
    } else {
      newStart = existing.startTime as string;
    }
    if (dto.endTime) {
      const parsed = parseDate(dto.endTime);
      if (!parsed) throw new BadRequestException("无效的结束时间格式");
      newEnd = parsed.toISOString();
    } else {
      newEnd = existing.endTime as string;
    }
    if (new Date(newEnd) <= new Date(newStart)) throw new BadRequestException("结束时间必须晚于开始时间");

    const timeOrDoctorChanged = dto.startTime || dto.endTime || dto.doctorId || dto.chairId !== undefined;

    const result = this.dbService.transaction((db) => {
      if (timeOrDoctorChanged) {
        // P1 修复：update 也需检测患者和椅位冲突
        const doctorConflict = db.prepare(
          "SELECT id FROM Appointment WHERE doctorId = ? AND id != ? AND status IN ('BOOKED','ARRIVED','IN_CHAIR') AND startTime < ? AND endTime > ? AND deletedAt IS NULL"
        ).get(newDoctorId, id, newEnd, newStart);
        if (doctorConflict) throw new BadRequestException("该时间段医生已有预约");

        const patientConflict = db.prepare(
          "SELECT id FROM Appointment WHERE patientId = ? AND id != ? AND status IN ('BOOKED','ARRIVED','IN_CHAIR') AND startTime < ? AND endTime > ? AND deletedAt IS NULL"
        ).get(newPatientId, id, newEnd, newStart);
        if (patientConflict) throw new BadRequestException("该时间段患者已有其他预约");

        if (newChairId) {
          const chairConflict = db.prepare(
            "SELECT id FROM Appointment WHERE chairId = ? AND id != ? AND status IN ('BOOKED','ARRIVED','IN_CHAIR') AND startTime < ? AND endTime > ? AND deletedAt IS NULL"
          ).get(newChairId, id, newEnd, newStart);
          if (chairConflict) throw new BadRequestException("该时间段牙椅已被占用");
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
      const result = builder.build(id);
      if (result) {
        db.prepare(result.sql).run(...result.params);
      }
      return db.prepare("SELECT * FROM Appointment WHERE id = ? AND deletedAt IS NULL").get(id);
    });

    return result;
  }

  async remove(id: string) {
    await this.findOne(id);
    const now = new Date().toISOString();
    this.dbService.prepare("UPDATE Appointment SET deletedAt = ?, updatedAt = ? WHERE id = ?").run(now, now, id);
  }
}
