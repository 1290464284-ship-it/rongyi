import { BusinessNotFoundException, BusinessValidationException } from '@common/errors';
import { Injectable } from '@nestjs/common';

import { DbService } from "../../../db/db.service";
import { BaseService } from "../../../common/services/base.service";
import { MedicalRecord } from "@dental/shared";
import * as crypto from "node:crypto";
import { UpdateBuilder } from "../../../common/utils/db/sql-builder";
import { sanitizeData } from "../../../common/utils/security/sanitize-config";
import { ClinicContextService } from "../../../common/services/clinic-context.service";
import { MAX_PAGE_SIZE, PAGINATION } from "../../../common/constants/pagination";
import { ModifyRequestStatus, AuditLogType } from "../../../common/constants";
import { CacheService } from "../../../common/services/cache.service";
import {
  CACHE_PREFIXES,
  DICTIONARY_CACHE_KEYS,
  buildDictionaryCacheKey,
} from "../../../common/constants/cache-keys";
import { MEDICAL_RECORD_DICTIONARY_CACHE_TTL_MS } from "../../../config/constants";

export interface RecordModifyRequest {
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

const MEDICAL_RECORD_LIST_FIELDS = "id, patientId, visitId, doctorId, chiefComplaint, diagnosis, isLocked, createdAt, updatedAt";

@Injectable()
export class MedicalRecordsService extends BaseService<MedicalRecord> {
  constructor(
    dbService: DbService,
    clinicContext: ClinicContextService,
    private cache: CacheService,
  ) {
    super(dbService, clinicContext, { tableName: 'MedicalRecord', jsonFields: ['teethInvolved', 'images'] });
    this.selectFields = MEDICAL_RECORD_LIST_FIELDS.split(',').map(s => s.trim()).filter(Boolean);
  }

  async queryRecords(options: { patientId?: string; visitId?: string; page?: number; pageSize?: number }) {
    const { patientId, visitId, page = 1, pageSize = PAGINATION.DEFAULT_PAGE_SIZE } = options;
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    let query = `SELECT ${MEDICAL_RECORD_LIST_FIELDS} FROM MedicalRecord WHERE deletedAt IS NULL${clinicClause}`;
    let countQuery = `SELECT COUNT(*) as count FROM MedicalRecord WHERE deletedAt IS NULL${clinicClause}`;
    const qp: unknown[] = [...clinicParams];
    const cp: unknown[] = [...clinicParams];
    
    if (patientId) {
      query += " AND patientId = ?";
      countQuery += " AND patientId = ?";
      qp.push(patientId);
      cp.push(patientId);
    }
    if (visitId) {
      query += " AND visitId = ?";
      countQuery += " AND visitId = ?";
      qp.push(visitId);
      cp.push(visitId);
    }
    
    query += " ORDER BY createdAt DESC LIMIT ? OFFSET ?";
    qp.push(pageSize, (page - 1) * pageSize);
    
    const items = this.dbService.prepare(query).all(...qp) as Array<Record<string, unknown>>;
    const total = (this.dbService.prepare(countQuery).get(...cp) as { count: number })?.count || 0;

    // N+1 查询优化：批量查询患者和医生信息
    if (items.length > 0 && !patientId) {
      const patientIds = [...new Set(items.map(r => r.patientId as string).filter(Boolean))];
      const doctorIds = [...new Set(items.map(r => r.doctorId as string).filter(Boolean))];
      
      const patientMap = new Map<string, Record<string, unknown>>();
      if (patientIds.length > 0) {
        const placeholders = patientIds.map(() => '?').join(',');
        const patients = this.dbService.prepare(`SELECT id, name, phone FROM Patient WHERE id IN (${placeholders}) AND deletedAt IS NULL${clinicClause}`).all(...patientIds, ...clinicParams) as Array<Record<string, unknown>>;
        patients.forEach(p => patientMap.set(p.id as string, p));
      }
      
      const doctorMap = new Map<string, Record<string, unknown>>();
      if (doctorIds.length > 0) {
        const placeholders = doctorIds.map(() => '?').join(',');
        const doctors = this.dbService.prepare(`SELECT id, name, role FROM User WHERE id IN (${placeholders}) AND active = 1 AND deletedAt IS NULL${clinicClause}`).all(...doctorIds, ...clinicParams) as Array<Record<string, unknown>>;
        doctors.forEach(d => doctorMap.set(d.id as string, d));
      }
      
      const itemsWithRelations = items.map(r => ({
        ...r,
        patient: patientMap.get(r.patientId as string) || null,
        doctor: doctorMap.get(r.doctorId as string) || null,
      }));
      return { items: itemsWithRelations, total, page, pageSize };
    }

    return { items, total, page, pageSize };
  }

  /**
   * P4-3: 失效当前诊所的病历字典缓存（常用语 / 模板）
   * 增删改后调用，使用 delPattern 清除所有变体
   */
  private invalidateDictionaryCache(category: string, clinicId: string | null): void {
    if (!clinicId) return;
    this.cache.delPattern(`${CACHE_PREFIXES.DICTIONARY}${category}:${clinicId}`);
  }

  async create(dto: Partial<MedicalRecord>): Promise<MedicalRecord> {
    const createDto = dto;
    return super.create({
      patientId: createDto.patientId,
      visitId: createDto.visitId,
      doctorId: createDto.doctorId,
      chiefComplaint: createDto.chiefComplaint,
      presentIllness: createDto.presentIllness,
      pastHistory: createDto.pastHistory,
      allergyHistory: createDto.allergyHistory,
      examination: createDto.examination,
      diagnosis: createDto.diagnosis,
      treatmentPlan: createDto.treatmentPlan,
      teethInvolved: createDto.teethInvolved,
      images: createDto.images,
    });
  }

  async update(id: string, dto: { chiefComplaint?: string; presentIllness?: string; pastHistory?: string; examination?: string; diagnosis?: string; treatmentPlan?: string }): Promise<MedicalRecord> {
    const record = await this.findOne(id);
    if (record.isLocked) {
      throw new BusinessValidationException("病历已锁定，无法直接修改；请提交修改申请并经审批后解锁");
    }
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    const now = new Date().toISOString();
    this.dbService.transaction((db) => {
      const updates: string[] = ['updatedAt = ?'];
      const params: unknown[] = [now];
      if (dto.chiefComplaint !== undefined) { updates.push('chiefComplaint = ?'); params.push(dto.chiefComplaint); }
      if (dto.presentIllness !== undefined) { updates.push('presentIllness = ?'); params.push(dto.presentIllness); }
      if (dto.pastHistory !== undefined) { updates.push('pastHistory = ?'); params.push(dto.pastHistory); }
      if (dto.examination !== undefined) { updates.push('examination = ?'); params.push(dto.examination); }
      if (dto.diagnosis !== undefined) { updates.push('diagnosis = ?'); params.push(dto.diagnosis); }
      if (dto.treatmentPlan !== undefined) { updates.push('treatmentPlan = ?'); params.push(dto.treatmentPlan); }
      params.push(id, ...clinicParams);
      // P1 修复：UPDATE 必须带 clinicClause，防止跨诊所篡改病历（多租户数据隔离）
      db.prepare(`UPDATE MedicalRecord SET ${updates.join(', ')} WHERE id = ? AND deletedAt IS NULL${clinicClause}`).run(...params);
      this.logAudit(db, AuditLogType.MEDICAL_RECORD_UPDATE, id, "MedicalRecord", { afterData: { chiefComplaint: dto.chiefComplaint, diagnosis: dto.diagnosis, treatmentPlan: dto.treatmentPlan } });
      return db.prepare(`SELECT id, patientId, visitId, doctorId, templateId, chiefComplaint, presentIllness, pastHistory, allergyHistory, examination, diagnosis, treatmentPlan, teethInvolved, images, signature, isLocked, lockedAt, lockedBy, modifyRequestId, clinicId, createdAt, updatedAt, deletedAt FROM MedicalRecord WHERE id = ? AND deletedAt IS NULL${clinicClause}`).get(id, ...clinicParams);
    });
    return this.findOne(id);
  }

  async reviewModifyRequest(id: string, dto: { status: string; reviewRemark?: string }, userId?: string) {
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    const req = this.dbService.prepare(`SELECT id, recordId, applicantId, reason, status, reviewerId, reviewRemark, reviewedAt, createdAt FROM RecordModifyRequest WHERE id = ?${clinicClause}`).get(id, ...clinicParams) as RecordModifyRequest | undefined;
    if (!req) throw new BusinessNotFoundException("修改请求不存在");
    if (dto.status !== ModifyRequestStatus.APPROVED && dto.status !== ModifyRequestStatus.REJECTED) throw new BusinessValidationException("状态必须为 APPROVED 或 REJECTED");
    const now = new Date().toISOString();
    // 审批状态更新 + 病历解锁必须原子化，避免审批通过但病历未解锁的不一致状态
    this.dbService.transaction((db) => {
      const result = db.prepare(
        `UPDATE RecordModifyRequest SET status = ?, reviewerId = ?, reviewRemark = ?, reviewedAt = ? WHERE id = ? AND status = '${ModifyRequestStatus.PENDING}'${clinicClause}`
      ).run(dto.status, userId || null, dto.reviewRemark || null, now, id, ...clinicParams);
      if (result.changes === 0) {
        throw new BusinessValidationException("该请求已被其他审批者处理");
      }
      if (dto.status === ModifyRequestStatus.APPROVED) {
        db.prepare(`UPDATE MedicalRecord SET isLocked = 0, lockedAt = NULL, lockedBy = NULL, updatedAt = ? WHERE id = ?${clinicClause}`)
          .run(now, req.recordId, ...clinicParams);
      }
      this.logAudit(db, AuditLogType.MODIFY_REQUEST_REVIEW, id, "RecordModifyRequest", { beforeData: { status: req.status }, afterData: { status: dto.status } });
    });
    return this.dbService.prepare(`SELECT id, recordId, applicantId, reason, status, reviewerId, reviewRemark, reviewedAt, createdAt FROM RecordModifyRequest WHERE id = ?${clinicClause}`).get(id, ...clinicParams) as RecordModifyRequest;
  }
  async listPhrases(_userId?: string, _category?: string) {
    // P4-3: 病历常用语为字典类数据（变更频率低、读频率高），按诊所缓存
    // 注意：当前实现未使用 _userId / _category 过滤，缓存键仅需 clinicId
    const clinicId = this.clinicContext.getClinicId();
    const cacheKey = buildDictionaryCacheKey(DICTIONARY_CACHE_KEYS.MEDICAL_RECORD_PHRASES, clinicId ?? '');
    // P0 修复：使用 getOrSet 提供缓存击穿保护（pending Promise 跟踪），
    // 避免高并发下多个请求同时穿透缓存击中 DB
    return this.cache.getOrSet<unknown[]>(cacheKey, () => {
      // P0 修复：使用 buildClinicClause 强制校验 clinicId（缺失时抛错），
      // 原先 if (clinicId) 模式在 clinicId 缺失时会跳过过滤导致跨租户数据泄露
      const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
      return this.dbService.prepare(
        `SELECT id, name, category, content, createdAt FROM MedicalRecordPhrase WHERE 1=1${clinicClause} ORDER BY category LIMIT ${MAX_PAGE_SIZE}`,
      ).all(...clinicParams);
    }, MEDICAL_RECORD_DICTIONARY_CACHE_TTL_MS);
  }
  async listModifyRequests(status?: string) {
    // P0 修复：使用 buildClinicClause 强制校验 clinicId（缺失时抛错），
    // 原先 if (clinicId) 模式在 clinicId 缺失时会跳过过滤导致跨租户数据泄露
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    const whereClauses: string[] = [`1=1${clinicClause}`];
    const params: unknown[] = [...clinicParams];
    if (status) {
      whereClauses.push('status = ?');
      params.push(status);
    }
    return this.dbService.prepare(
      `SELECT id, recordId, applicantId, reason, status, reviewerId, reviewRemark, reviewedAt, createdAt FROM RecordModifyRequest WHERE ${whereClauses.join(' AND ')} ORDER BY createdAt DESC LIMIT ${MAX_PAGE_SIZE}`,
    ).all(...params);
  }
  async listTemplates(_userId?: string, _category?: string) {
    // P4-3: 病历模板为字典类数据（变更频率低、读频率高），按诊所缓存
    // 注意：当前实现未使用 _userId / _category 过滤，缓存键仅需 clinicId
    const clinicId = this.clinicContext.getClinicId();
    const cacheKey = buildDictionaryCacheKey(DICTIONARY_CACHE_KEYS.MEDICAL_RECORD_TEMPLATES, clinicId ?? '');
    // P0 修复：使用 getOrSet 提供缓存击穿保护，原先 cache.get+cache.set 模式有击穿风险
    return this.cache.getOrSet<unknown[]>(cacheKey, () => {
      // P0 修复：使用 buildClinicClause 强制校验 clinicId（缺失时抛错），
      // 原先 if (clinicId) 模式在 clinicId 缺失时会跳过过滤导致跨租户数据泄露
      const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
      return this.dbService.prepare(
        `SELECT id, name, category, chiefComplaint, presentIllness, pastHistory, examination, diagnosis, treatmentPlan, createdAt FROM MedicalRecordTemplate WHERE 1=1${clinicClause} ORDER BY category LIMIT ${MAX_PAGE_SIZE}`,
      ).all(...clinicParams);
    }, MEDICAL_RECORD_DICTIONARY_CACHE_TTL_MS);
  }
  async createPhrase(dto: PhraseDto, _userId?: string) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const clinicId = this.clinicContext.getClinicId();
    const safeDto = sanitizeData('MedicalRecordPhrase', dto);
    this.dbService.prepare("INSERT INTO MedicalRecordPhrase (id, name, category, content, clinicId, createdAt) VALUES (?,?,?,?,?,?)")
      .run(id, safeDto.name || safeDto.content || '', safeDto.category || null, safeDto.content || '', clinicId, now);
    this.logAudit(this.dbService, AuditLogType.MEDICAL_RECORD_PHRASE_CREATE, id, "MedicalRecordPhrase", { afterData: { name: safeDto.name, category: safeDto.category } });
    // P4-3: 新增常用语后失效缓存
    this.invalidateDictionaryCache(DICTIONARY_CACHE_KEYS.MEDICAL_RECORD_PHRASES, clinicId);
    return { id };
  }
  async createModifyRequest(dto: ModifyRequestDto, userId?: string) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const clinicId = this.clinicContext.getClinicId();
    const safeDto = sanitizeData('RecordModifyRequest', dto);
    this.dbService.prepare("INSERT INTO RecordModifyRequest (id, recordId, applicantId, reason, status, clinicId, createdAt) VALUES (?,?,?,?,?,?,?)")
      .run(id, safeDto.recordId || null, safeDto.applicantId || userId || null, safeDto.reason || '', ModifyRequestStatus.PENDING, clinicId, now);
    this.logAudit(this.dbService, AuditLogType.MODIFY_REQUEST_CREATE, id, "RecordModifyRequest", { afterData: { recordId: safeDto.recordId, reason: safeDto.reason } });
    return { id };
  }
  async updatePhrase(id: string, dto: PhraseDto, _userId?: string) {
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    const safeDto = sanitizeData('MedicalRecordPhrase', dto);
    const builder = new UpdateBuilder("MedicalRecordPhrase");
    builder.set("content", safeDto.content);
    builder.set("category", safeDto.category);
    builder.set("name", safeDto.name);
    const result = builder.buildWithCustomWhere(`id = ?${clinicClause}`, [id, ...clinicParams]);
    if (result) {
      this.dbService.prepare(result.sql).run(...result.params);
    }
    this.logAudit(this.dbService, AuditLogType.MEDICAL_RECORD_PHRASE_UPDATE, id, "MedicalRecordPhrase", { afterData: { name: safeDto.name, category: safeDto.category } });
    // P4-3: 更新常用语后失效缓存
    this.invalidateDictionaryCache(DICTIONARY_CACHE_KEYS.MEDICAL_RECORD_PHRASES, this.clinicContext.getClinicId());
    return { id };
  }
  async deletePhrase(id: string, _userId?: string) {
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    const now = new Date().toISOString();
    this.dbService.prepare(`UPDATE MedicalRecordPhrase SET deletedAt = ? WHERE id = ?${clinicClause}`).run(now, id, ...clinicParams);
    this.logAudit(this.dbService, AuditLogType.MEDICAL_RECORD_PHRASE_DELETE, id, "MedicalRecordPhrase");
    // P4-3: 删除常用语后失效缓存
    this.invalidateDictionaryCache(DICTIONARY_CACHE_KEYS.MEDICAL_RECORD_PHRASES, this.clinicContext.getClinicId());
    return { id };
  }
  async deleteTemplate(id: string, _userId?: string) {
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    const now = new Date().toISOString();
    this.dbService.prepare(`UPDATE MedicalRecordTemplate SET deletedAt = ? WHERE id = ?${clinicClause}`).run(now, id, ...clinicParams);
    this.logAudit(this.dbService, AuditLogType.MEDICAL_RECORD_TEMPLATE_DELETE, id, "MedicalRecordTemplate");
    // P4-3: 删除模板后失效缓存
    this.invalidateDictionaryCache(DICTIONARY_CACHE_KEYS.MEDICAL_RECORD_TEMPLATES, this.clinicContext.getClinicId());
    return { id };
  }
  async updateTemplate(id: string, dto: TemplateDto, _userId?: string) {
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    const safeDto = sanitizeData('MedicalRecordTemplate', dto);
    const builder = new UpdateBuilder("MedicalRecordTemplate");
    builder.set("name", safeDto.name);
    builder.set("category", safeDto.category);
    builder.set("chiefComplaint", safeDto.chiefComplaint);
    builder.set("presentIllness", safeDto.presentIllness);
    builder.set("pastHistory", safeDto.pastHistory);
    builder.set("examination", safeDto.examination);
    builder.set("diagnosis", safeDto.diagnosis);
    builder.set("treatmentPlan", safeDto.treatmentPlan);
    const result = builder.buildWithCustomWhere(`id = ?${clinicClause}`, [id, ...clinicParams]);
    if (result) {
      this.dbService.prepare(result.sql).run(...result.params);
    }
    this.logAudit(this.dbService, AuditLogType.MEDICAL_RECORD_TEMPLATE_UPDATE, id, "MedicalRecordTemplate", { afterData: { name: safeDto.name, category: safeDto.category } });
    // P4-3: 更新模板后失效缓存
    this.invalidateDictionaryCache(DICTIONARY_CACHE_KEYS.MEDICAL_RECORD_TEMPLATES, this.clinicContext.getClinicId());
    return { id };
  }
  async createTemplate(dto: TemplateDto, _userId?: string) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const clinicId = this.clinicContext.getClinicId();
    const safeDto = sanitizeData('MedicalRecordTemplate', dto);
    this.dbService.prepare("INSERT INTO MedicalRecordTemplate (id, name, category, chiefComplaint, presentIllness, pastHistory, examination, diagnosis, treatmentPlan, clinicId, createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .run(id, safeDto.name || '', safeDto.category || null, safeDto.chiefComplaint || null, safeDto.presentIllness || null, safeDto.pastHistory || null, safeDto.examination || null, safeDto.diagnosis || null, safeDto.treatmentPlan || null, clinicId, now);
    this.logAudit(this.dbService, AuditLogType.MEDICAL_RECORD_TEMPLATE_CREATE, id, "MedicalRecordTemplate", { afterData: { name: safeDto.name, category: safeDto.category } });
    // P4-3: 新增模板后失效缓存
    this.invalidateDictionaryCache(DICTIONARY_CACHE_KEYS.MEDICAL_RECORD_TEMPLATES, clinicId);
    return { id };
  }
  async lock(id: string, userId?: string) {
    const record = await this.findOne(id);
    if (record.isLocked) throw new BusinessValidationException("病历已锁定");
    const now = new Date().toISOString();
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    return this.dbService.transaction((db) => {
      const result = db.prepare(`UPDATE MedicalRecord SET isLocked = 1, lockedAt = ?, lockedBy = ?, updatedAt = ? WHERE id = ? AND isLocked = 0${clinicClause}`)
        .run(now, userId || null, now, id, ...clinicParams);
      if (result.changes === 0) throw new BusinessValidationException("病历已被其他用户锁定");
      this.logAudit(db, AuditLogType.MEDICAL_RECORD_LOCK, id, "MedicalRecord", { beforeData: { isLocked: false }, afterData: { isLocked: true, lockedBy: userId || null } });
      const { clause: lockClinicClause, params: lockClinicParams } = this.buildClinicClause();
      return db.prepare(`SELECT id, patientId, visitId, doctorId, templateId, chiefComplaint, presentIllness, pastHistory, allergyHistory, examination, diagnosis, treatmentPlan, teethInvolved, images, signature, isLocked, lockedAt, lockedBy, modifyRequestId, clinicId, createdAt, updatedAt, deletedAt FROM MedicalRecord WHERE id = ? AND deletedAt IS NULL${lockClinicClause}`).get(id, ...lockClinicParams) as MedicalRecord;
    });
  }
}
