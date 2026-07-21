import { Injectable, NotFoundException, HttpException } from "@nestjs/common";
import { DbService } from "../../../db/db.service";
import * as crypto from "crypto";
import { UpdateBuilder } from "../../../common/utils/sql-builder";

@Injectable()
export class FirstExamsService {
  constructor(private dbService: DbService) {}

  async findMany(params: { patientId?: string; status?: string; page?: number; pageSize?: number }) {
    const { patientId, status, page = 1, pageSize = 50 } = params;
    let query = "SELECT id, patientId, doctorId, chiefComplaint, diagnosis, treatmentSuggestion, status, remark, createdAt, updatedAt FROM FirstExam WHERE deletedAt IS NULL";
    const qp: unknown[] = [];
    if (patientId) { query += " AND patientId = ?"; qp.push(patientId); }
    if (status) { query += " AND status = ?"; qp.push(status); }
    query += " ORDER BY createdAt DESC LIMIT ? OFFSET ?";
    qp.push(pageSize, (page - 1) * pageSize);
    const items = this.dbService.prepare(query).all(...qp);
    let countQuery = "SELECT COUNT(*) as count FROM FirstExam WHERE deletedAt IS NULL";
    const countParams: unknown[] = [];
    if (patientId) { countQuery += " AND patientId = ?"; countParams.push(patientId); }
    if (status) { countQuery += " AND status = ?"; countParams.push(status); }
    const total = (this.dbService.prepare(countQuery).get(...countParams) as { count: number })?.count || 0;
    return { items, total, page, pageSize };
  }

  async findOne(id: string) {
    const fe = this.dbService.prepare("SELECT id, patientId, doctorId, chiefComplaint, diagnosis, treatmentSuggestion, status, remark, createdAt, updatedAt FROM FirstExam WHERE id = ? AND deletedAt IS NULL").get(id);
    if (!fe) throw new NotFoundException("初诊记录不存在");
    return fe;
  }

  async create(dto: { patientId: string; doctorId?: string; chiefComplaint?: string; diagnosis?: string; treatmentSuggestion?: string; remark?: string }) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.dbService.prepare("INSERT INTO FirstExam (id, patientId, doctorId, chiefComplaint, diagnosis, treatmentSuggestion, status, remark, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run(id, dto.patientId, dto.doctorId || null, dto.chiefComplaint || null, dto.diagnosis || null, dto.treatmentSuggestion || null, "PENDING", dto.remark || null, now, now);
    return this.findOne(id);
  }

  async updateStatus(id: string, status: string) {
    await this.findOne(id);
    this.dbService.prepare("UPDATE FirstExam SET status = ?, updatedAt = ? WHERE id = ?").run(status, new Date().toISOString(), id);
    return this.findOne(id);
  }

  async stats() { const total = (this.dbService.prepare("SELECT COUNT(*) as c FROM FirstExam WHERE deletedAt IS NULL").get() as {c:number})?.c||0; return { total }; }
  async complete(id: string) { this.dbService.prepare("UPDATE FirstExam SET status=?,updatedAt=? WHERE id=?").run("COMPLETED",new Date().toISOString(),id); return this.findOne(id); }
  async findAll(params?: { page?: number; pageSize?: number }) {
    const { page = 1, pageSize = 50 } = params || {};
    const query = "SELECT id, patientId, doctorId, chiefComplaint, diagnosis, treatmentSuggestion, status, remark, createdAt, updatedAt FROM FirstExam WHERE deletedAt IS NULL ORDER BY createdAt DESC LIMIT ? OFFSET ?";
    const items = this.dbService.prepare(query).all(pageSize, (page - 1) * pageSize);
    const total = (this.dbService.prepare("SELECT COUNT(*) as count FROM FirstExam WHERE deletedAt IS NULL").get() as { count: number })?.count || 0;
    return { items, total, page, pageSize };
  }
  async remove(id: string) { await this.findOne(id); const n=new Date().toISOString(); this.dbService.prepare("UPDATE FirstExam SET deletedAt=?,updatedAt=? WHERE id=?").run(n,n,id); return {id}; }
  async createFollowUp(id: string, dto: { planDate?: string; content?: string; assigneeId?: string }) { 
    const now = new Date().toISOString(); 
    const fid = crypto.randomUUID(); 
    this.dbService.prepare("INSERT INTO FirstExamFollowUp (id, examId, planDate, content, assigneeId, createdAt) VALUES (?,?,?,?,?,?)")
      .run(fid, id, dto.planDate || null, dto.content || null, dto.assigneeId || null, now); 
    return { id: fid }; 
  }
  async getTrack(id: string) { return this.dbService.prepare("SELECT id, examId, content, createdAt FROM FirstExamTrack WHERE id=?").get(id); }
  async restart(id: string) { this.dbService.prepare("UPDATE FirstExam SET status=?,updatedAt=? WHERE id=?").run("PENDING",new Date().toISOString(),id); return this.findOne(id); }
  async listTracks(examId: string) { return this.dbService.prepare("SELECT id, examId, content, createdAt FROM FirstExamTrack WHERE examId=? AND deletedAt IS NULL ORDER BY createdAt DESC").all(examId); }
  async updateTooth(id: string, toothNumber: number, dto: { toothStatus?: string; diseases?: unknown; treatmentPlan?: string; remark?: string }) {
    const builder = new UpdateBuilder("FirstExamTooth");
    builder.set("toothStatus", dto.toothStatus);
    builder.set("diseases", dto.diseases !== undefined ? JSON.stringify(dto.diseases) : undefined);
    builder.set("treatmentPlan", dto.treatmentPlan);
    builder.set("remark", dto.remark);
    builder.setUpdatedAt();
    const result = builder.buildWithCustomWhere("examId = ? AND toothNumber = ?", [id, toothNumber]);
    if (result) {
      this.dbService.prepare(result.sql).run(...result.params);
    }
    return { id, toothNumber };
  }
  async updateTrack(_id: string, _dto: unknown) { throw new HttpException('此功能尚未实现', 501); }
  async update(id: string, dto: { chiefComplaint?: string; diagnosis?: string; treatmentSuggestion?: string; remark?: string }) {
    await this.findOne(id);
    const builder = new UpdateBuilder("FirstExam");
    builder.set("chiefComplaint", dto.chiefComplaint);
    builder.set("diagnosis", dto.diagnosis);
    builder.set("treatmentSuggestion", dto.treatmentSuggestion);
    builder.set("remark", dto.remark);
    builder.setUpdatedAt();
    const result = builder.build(id);
    if (result) {
      this.dbService.prepare(result.sql).run(...result.params);
    }
    return this.findOne(id);
  }
  async getTeeth(examId: string) { return this.dbService.prepare("SELECT id, examId, toothNumber, toothStatus, diseases, treatmentPlan, remark FROM FirstExamTooth WHERE examId = ? ORDER BY toothNumber").all(examId); }
  async batchUpdateTeeth(_examId: string, _teeth: unknown[]) { throw new HttpException('此功能尚未实现', 501); }
}