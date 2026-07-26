import { Injectable } from '@nestjs/common';
import { DbService } from '../../../db/db.service';
import { BaseService } from '../../../common/services/base.service';
import { ClinicContextService } from '../../../common/services/clinic-context.service';
import { CacheService } from '../../../common/services/cache.service';
import { sanitizeData } from '../../../common/utils/security/sanitize-config';
import { UpdateBuilder } from '../../../common/utils/db/sql-builder';
import { AuditLogType } from '../../../common/constants';
import {
  CACHE_PREFIXES,
  DICTIONARY_CACHE_KEYS,
  buildDictionaryCacheKey,
} from '../../../common/constants/cache-keys';
import { MEDICAL_RECORD_DICTIONARY_CACHE_TTL_MS } from '../../../config/constants';
import { MAX_PAGE_SIZE } from '../../../common/constants/pagination';
import { randomUUID } from 'node:crypto';
import { BaseEntity } from '@dental/shared';

interface MedicalRecordTemplateEntity extends BaseEntity {
  name: string;
  category: string | null;
  chiefComplaint: string | null;
  presentIllness: string | null;
  pastHistory: string | null;
  examination: string | null;
  diagnosis: string | null;
  treatmentPlan: string | null;
  clinicId: string | null;
  deletedAt: string | null;
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

@Injectable()
export class MedicalRecordsTemplateService extends BaseService<MedicalRecordTemplateEntity> {
  constructor(
    dbService: DbService,
    clinicContext: ClinicContextService,
    private cache: CacheService,
  ) {
    super(dbService, clinicContext, 'MedicalRecordTemplate');
  }

  private invalidateDictionaryCache(category: string, clinicId: string | null): void {
    if (!clinicId) return;
    this.cache.delPattern(`${CACHE_PREFIXES.DICTIONARY}${category}:${clinicId}`);
  }

  async listTemplates(_userId?: string, _category?: string) {
    const clinicId = this.clinicContext.getClinicId();
    const cacheKey = buildDictionaryCacheKey(DICTIONARY_CACHE_KEYS.MEDICAL_RECORD_TEMPLATES, clinicId);
    const cached = this.cache.get<unknown[]>(cacheKey);
    if (cached) return cached;

    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    const whereSql = clinicClause ? `WHERE ${clinicClause.replace(/^\s*AND\s+/i, '')}` : '';
    const result = this.dbService.prepare(`SELECT id, name, category, chiefComplaint, presentIllness, pastHistory, examination, diagnosis, treatmentPlan, createdAt FROM MedicalRecordTemplate ${whereSql} ORDER BY category LIMIT ${MAX_PAGE_SIZE}`).all(...clinicParams);
    this.cache.set(cacheKey, result, MEDICAL_RECORD_DICTIONARY_CACHE_TTL_MS);
    return result;
  }

  async createTemplate(dto: TemplateDto, _userId?: string) {
    const id = randomUUID();
    const now = new Date().toISOString();
    const clinicId = this.clinicContext.getClinicId();
    const safeDto = sanitizeData('MedicalRecordTemplate', dto);
    this.dbService.prepare("INSERT INTO MedicalRecordTemplate (id, name, category, chiefComplaint, presentIllness, pastHistory, examination, diagnosis, treatmentPlan, clinicId, createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .run(id, safeDto.name || '', safeDto.category || null, safeDto.chiefComplaint || null, safeDto.presentIllness || null, safeDto.pastHistory || null, safeDto.examination || null, safeDto.diagnosis || null, safeDto.treatmentPlan || null, clinicId, now);
    this.logAudit(this.dbService, AuditLogType.MEDICAL_RECORD_TEMPLATE_CREATE, id, "MedicalRecordTemplate", { afterData: { name: safeDto.name, category: safeDto.category } });
    this.invalidateDictionaryCache(DICTIONARY_CACHE_KEYS.MEDICAL_RECORD_TEMPLATES, clinicId);
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
    this.invalidateDictionaryCache(DICTIONARY_CACHE_KEYS.MEDICAL_RECORD_TEMPLATES, this.clinicContext.getClinicId());
    return { id };
  }

  async deleteTemplate(id: string, _userId?: string) {
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    const now = new Date().toISOString();
    this.dbService.prepare(`UPDATE MedicalRecordTemplate SET deletedAt = ? WHERE id = ?${clinicClause}`).run(now, id, ...clinicParams);
    this.logAudit(this.dbService, AuditLogType.MEDICAL_RECORD_TEMPLATE_DELETE, id, "MedicalRecordTemplate");
    this.invalidateDictionaryCache(DICTIONARY_CACHE_KEYS.MEDICAL_RECORD_TEMPLATES, this.clinicContext.getClinicId());
    return { id };
  }
}
