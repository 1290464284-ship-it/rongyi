import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { DbService } from "../../../db/db.service";
import * as crypto from "crypto";
import { UpdateBuilder } from "../../../common/utils/sql-builder";
import { sanitizeData } from "../../../common/utils/sanitize-config";

interface RecordModifyRequest {
  id: string;
  recordId: string;
  applicantId: string | null;
  reason: string;
  status: string;
  reviewerId: string | null;
  reviewRemark: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

interface PhraseDto {
  name?: string;
  category?: string;
  content?: string;
}

interface TemplateDto {
  name?: string;
  category?: string;
  chiefComplaint?: string;
  presentIllness?: string;
  pastHistory?: string;
  examination?: string;
  diagnosis?: string;
  treatmentPlan?: string;
}

interface ModifyRequestDto {
  recordId?: string;
  applicantId?: string;
  reason?: string;
}

interface MedicalRecord {
  id: string;
  isLocked: number;
  lockedAt: string | null;
  lockedBy: string | null;
}

@Injectable()
export class MedicalRecordsService {
  constructor(private dbService: DbService) {}

  async findMany(params: { patientId?: string; visitId?: string; page?: number; pageSize?: number }) {
    const { patientId, visitId, page = 1, pageSize = 50 } = params;
    let query = "SELECT id, patientId, visitId, doctorId, chiefComplaint, diagnosis, isLocked, createdAt, updatedAt FROM MedicalRecord WHERE deletedAt IS NULL";
    const qp: unknown[] = [];
    if (patientId) { query += " AND patientId = ?"; qp.push(patientId); }
    if (visitId) { query += " AND visitId = ?"; qp.push(visitId); }
    query += " ORDER BY createdAt DESC LIMIT ? OFFSET ?";
    qp.push(pageSize, (page - 1) * pageSize);
    const items = this.dbService.prepare(query).all(...qp);
    let countQuery = "SELECT COUNT(*) as count FROM MedicalRecord WHERE deletedAt IS NULL";
    const countParams: unknown[] = [];
    if (patientId) { countQuery += " AND patientId = ?"; countParams.push(patientId); }
    if (visitId) { countQuery += " AND visitId = ?"; countParams.push(visitId); }
    const total = (this.dbService.prepare(countQuery).get(...countParams) as { count: number })?.count || 0;
    return { items, total, page, pageSize };
  }

  async findOne(id: string) {
    const mr = this.dbService.prepare("SELECT id, patientId, visitId, doctorId, chiefComplaint, presentIllness, pastHistory, allergyHistory, examination, diagnosis, treatmentPlan, teethInvolved, images, isLocked, lockedAt, lockedBy, createdAt, updatedAt FROM MedicalRecord WHERE id = ? AND deletedAt IS NULL").get(id);
    if (!mr) throw new NotFoundException("病历不存在");
    return mr;
  }

  async create(dto: { patientId: string; visitId?: string; doctorId: string; chiefComplaint?: string; presentIllness?: string; pastHistory?: string; allergyHistory?: string; examination?: string; diagnosis?: string; treatmentPlan?: string; teethInvolved?: string[]; images?: string[] }) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const safeDto = sanitizeData('MedicalRecord', dto as Record<string, unknown>);
    this.dbService.prepare("INSERT INTO MedicalRecord (id, patientId, visitId, doctorId, chiefComplaint, presentIllness, pastHistory, allergyHistory, examination, diagnosis, treatmentPlan, teethInvolved, images, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(id, safeDto.patientId, safeDto.visitId || null, safeDto.doctorId, safeDto.chiefComplaint || null, safeDto.presentIllness || null, safeDto.pastHistory || null, safeDto.allergyHistory || null, safeDto.examination || null, safeDto.diagnosis || null, safeDto.treatmentPlan || null, JSON.stringify(dto.teethInvolved || []), JSON.stringify(dto.images || []), now, now);
    return this.findOne(id);
  }

  async remove(id: string) {
    await this.findOne(id);
    const now = new Date().toISOString();
    this.dbService.prepare("UPDATE MedicalRecord SET deletedAt = ?, updatedAt = ? WHERE id = ?").run(now, now, id);
  }

  async reviewModifyRequest(id: string, dto: { status: string; reviewRemark?: string }, userId?: string) {
    const req = this.dbService.prepare("SELECT id, recordId, applicantId, reason, status, reviewerId, reviewRemark, reviewedAt, createdAt FROM RecordModifyRequest WHERE id = ?").get(id) as RecordModifyRequest | undefined;
    if (!req) throw new NotFoundException("修改请求不存在");
    if (!['APPROVED', 'REJECTED'].includes(dto.status)) throw new BadRequestException("状态必须为 APPROVED 或 REJECTED");
    const now = new Date().toISOString();
    // P1 修复（审批竞态）：用 WHERE status='PENDING' 原子更新，两审批者同时通过时只有一个 changes=1
    const result = this.dbService.prepare(
      "UPDATE RecordModifyRequest SET status = ?, reviewerId = ?, reviewRemark = ?, reviewedAt = ? WHERE id = ? AND status = 'PENDING'"
    ).run(dto.status, userId || null, dto.reviewRemark || null, now, id);
    if (result.changes === 0) {
      throw new BadRequestException("该请求已被其他审批者处理");
    }
    if (dto.status === 'APPROVED') {
      this.dbService.prepare("UPDATE MedicalRecord SET isLocked = 0, lockedAt = NULL, lockedBy = NULL, updatedAt = ? WHERE id = ?")
        .run(now, req.recordId);
    }
    return this.dbService.prepare("SELECT id, recordId, applicantId, reason, status, reviewerId, reviewRemark, reviewedAt, createdAt FROM RecordModifyRequest WHERE id = ?").get(id);
  }
  async listPhrases(_userId?: string, _category?: string) { return this.dbService.prepare("SELECT id, name, category, content, createdAt FROM MedicalRecordPhrase ORDER BY category LIMIT 200").all(); }
  async listModifyRequests(status?: string) {
    if (status) {
      return this.dbService.prepare("SELECT id, recordId, applicantId, reason, status, reviewerId, reviewRemark, reviewedAt, createdAt FROM RecordModifyRequest WHERE status = ? ORDER BY createdAt DESC LIMIT 200").all(status);
    }
    return this.dbService.prepare("SELECT id, recordId, applicantId, reason, status, reviewerId, reviewRemark, reviewedAt, createdAt FROM RecordModifyRequest ORDER BY createdAt DESC LIMIT 200").all();
  }
  async listTemplates(_userId?: string, _category?: string) { return this.dbService.prepare("SELECT id, name, category, chiefComplaint, presentIllness, pastHistory, examination, diagnosis, treatmentPlan, createdAt FROM MedicalRecordTemplate ORDER BY category LIMIT 200").all(); }
  async findAll(params?: { page?: number; pageSize?: number }) {
    const { page = 1, pageSize = 50 } = params || {};
    const query = "SELECT id, patientId, visitId, doctorId, chiefComplaint, diagnosis, isLocked, createdAt, updatedAt FROM MedicalRecord WHERE deletedAt IS NULL ORDER BY createdAt DESC LIMIT ? OFFSET ?";
    const items = this.dbService.prepare(query).all(pageSize, (page - 1) * pageSize);
    const total = (this.dbService.prepare("SELECT COUNT(*) as count FROM MedicalRecord WHERE deletedAt IS NULL").get() as { count: number })?.count || 0;
    return { items, total, page, pageSize };
  }
  async createPhrase(dto: PhraseDto, _userId?: string) { 
    const id = crypto.randomUUID(); 
    const now = new Date().toISOString(); 
    const safeDto = sanitizeData('MedicalRecordPhrase', dto as Record<string, unknown>);
    this.dbService.prepare("INSERT INTO MedicalRecordPhrase (id, name, category, content, createdAt) VALUES (?,?,?,?,?)")
      .run(id, safeDto.name || safeDto.content || '', safeDto.category || null, safeDto.content || '', now); 
    return { id }; 
  }
  async createModifyRequest(dto: ModifyRequestDto, userId?: string) { 
    const id = crypto.randomUUID(); 
    const now = new Date().toISOString(); 
    const safeDto = sanitizeData('RecordModifyRequest', dto as Record<string, unknown>);
    this.dbService.prepare("INSERT INTO RecordModifyRequest (id, recordId, applicantId, reason, status, createdAt) VALUES (?,?,?,?,?,?)")
      .run(id, safeDto.recordId || null, safeDto.applicantId || userId || null, safeDto.reason || '', 'PENDING', now); 
    return { id }; 
  }
  async updatePhrase(id: string, dto: PhraseDto, _userId?: string) {
    const safeDto = sanitizeData('MedicalRecordPhrase', dto as Record<string, unknown>);
    const builder = new UpdateBuilder("MedicalRecordPhrase");
    builder.set("content", safeDto.content as string | undefined);
    builder.set("category", safeDto.category as string | undefined);
    builder.set("name", safeDto.name as string | undefined);
    const result = builder.build(id);
    if (result) {
      this.dbService.prepare(result.sql).run(...result.params);
    }
    return { id };
  }
  async deletePhrase(id: string, _userId?: string) { this.dbService.prepare("DELETE FROM MedicalRecordPhrase WHERE id = ?").run(id); return { id }; }
  async deleteTemplate(id: string, _userId?: string) { this.dbService.prepare("DELETE FROM MedicalRecordTemplate WHERE id = ?").run(id); return { id }; }
  async updateTemplate(id: string, dto: TemplateDto, _userId?: string) {
    const safeDto = sanitizeData('MedicalRecordTemplate', dto as Record<string, unknown>);
    const builder = new UpdateBuilder("MedicalRecordTemplate");
    builder.set("name", safeDto.name as string | undefined);
    builder.set("category", safeDto.category as string | undefined);
    builder.set("chiefComplaint", safeDto.chiefComplaint as string | undefined);
    builder.set("presentIllness", safeDto.presentIllness as string | undefined);
    builder.set("pastHistory", safeDto.pastHistory as string | undefined);
    builder.set("examination", safeDto.examination as string | undefined);
    builder.set("diagnosis", safeDto.diagnosis as string | undefined);
    builder.set("treatmentPlan", safeDto.treatmentPlan as string | undefined);
    const result = builder.build(id);
    if (result) {
      this.dbService.prepare(result.sql).run(...result.params);
    }
    return { id };
  }
  async createTemplate(dto: TemplateDto, _userId?: string) { 
    const id = crypto.randomUUID(); 
    const now = new Date().toISOString(); 
    const safeDto = sanitizeData('MedicalRecordTemplate', dto as Record<string, unknown>);
    this.dbService.prepare("INSERT INTO MedicalRecordTemplate (id, name, category, chiefComplaint, presentIllness, pastHistory, examination, diagnosis, treatmentPlan, createdAt) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run(id, safeDto.name || '', safeDto.category || null, safeDto.chiefComplaint || null, safeDto.presentIllness || null, safeDto.pastHistory || null, safeDto.examination || null, safeDto.diagnosis || null, safeDto.treatmentPlan || null, now); 
    return { id }; 
  }
  async update(id: string, dto: { chiefComplaint?: string; presentIllness?: string; pastHistory?: string; examination?: string; diagnosis?: string; treatmentPlan?: string }) {
    const record = await this.findOne(id) as MedicalRecord;
    // P1 修复（锁定绕过）：lock() 实现了但 update() 不检查 isLocked，导致锁定形同虚设
    if (record.isLocked) {
      throw new BadRequestException("病历已锁定，无法直接修改；请提交修改申请并经审批后解锁");
    }
    const safeDto = sanitizeData('MedicalRecord', dto as Record<string, unknown>);
    const builder = new UpdateBuilder("MedicalRecord");
    builder.set("chiefComplaint", safeDto.chiefComplaint as string | undefined);
    builder.set("presentIllness", safeDto.presentIllness as string | undefined);
    builder.set("pastHistory", safeDto.pastHistory as string | undefined);
    builder.set("examination", safeDto.examination as string | undefined);
    builder.set("diagnosis", safeDto.diagnosis as string | undefined);
    builder.set("treatmentPlan", safeDto.treatmentPlan as string | undefined);
    builder.setUpdatedAt();
    const result = builder.build(id);
    if (result) {
      this.dbService.prepare(result.sql).run(...result.params);
    }
    return this.findOne(id);
  }
  async lock(id: string, userId?: string) {
    const record = await this.findOne(id) as MedicalRecord;
    if (record.isLocked) throw new BadRequestException("病历已锁定");
    const now = new Date().toISOString();
    const result = this.dbService.prepare("UPDATE MedicalRecord SET isLocked = 1, lockedAt = ?, lockedBy = ?, updatedAt = ? WHERE id = ? AND isLocked = 0")
      .run(now, userId || null, now, id);
    if (result.changes === 0) throw new BadRequestException("病历已被其他用户锁定");
    return this.findOne(id);
  }
}
