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

interface MedicalRecordPhraseEntity extends BaseEntity {
  name: string;
  category: string | null;
  content: string;
  clinicId: string | null;
  deletedAt: string | null;
}

interface PhraseDto {
  name?: string;
  category?: string;
  content?: string;
}

@Injectable()
export class MedicalRecordsPhraseService extends BaseService<MedicalRecordPhraseEntity> {
  constructor(
    dbService: DbService,
    clinicContext: ClinicContextService,
    private cache: CacheService,
  ) {
    super(dbService, clinicContext, 'MedicalRecordPhrase');
  }

  private invalidateDictionaryCache(category: string, clinicId: string | null): void {
    if (!clinicId) return;
    this.cache.delPattern(`${CACHE_PREFIXES.DICTIONARY}${category}:${clinicId}`);
  }

  async listPhrases(_userId?: string, _category?: string) {
    const clinicId = this.clinicContext.getClinicId();
    const cacheKey = buildDictionaryCacheKey(DICTIONARY_CACHE_KEYS.MEDICAL_RECORD_PHRASES, clinicId);
    const cached = this.cache.get<unknown[]>(cacheKey);
    if (cached) return cached;

    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    const whereSql = clinicClause ? `WHERE ${clinicClause.replace(/^\s*AND\s+/i, '')}` : '';
    const result = this.dbService.prepare(`SELECT id, name, category, content, createdAt FROM MedicalRecordPhrase ${whereSql} ORDER BY category LIMIT ${MAX_PAGE_SIZE}`).all(...clinicParams);
    this.cache.set(cacheKey, result, MEDICAL_RECORD_DICTIONARY_CACHE_TTL_MS);
    return result;
  }

  async createPhrase(dto: PhraseDto, _userId?: string) {
    const id = randomUUID();
    const now = new Date().toISOString();
    const clinicId = this.clinicContext.getClinicId();
    const safeDto = sanitizeData('MedicalRecordPhrase', dto);
    this.dbService.prepare("INSERT INTO MedicalRecordPhrase (id, name, category, content, clinicId, createdAt) VALUES (?,?,?,?,?,?)")
      .run(id, safeDto.name || safeDto.content || '', safeDto.category || null, safeDto.content || '', clinicId, now);
    this.logAudit(this.dbService, AuditLogType.MEDICAL_RECORD_PHRASE_CREATE, id, "MedicalRecordPhrase", { afterData: { name: safeDto.name, category: safeDto.category } });
    this.invalidateDictionaryCache(DICTIONARY_CACHE_KEYS.MEDICAL_RECORD_PHRASES, clinicId);
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
    this.invalidateDictionaryCache(DICTIONARY_CACHE_KEYS.MEDICAL_RECORD_PHRASES, this.clinicContext.getClinicId());
    return { id };
  }

  async deletePhrase(id: string, _userId?: string) {
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    const now = new Date().toISOString();
    this.dbService.prepare(`UPDATE MedicalRecordPhrase SET deletedAt = ? WHERE id = ?${clinicClause}`).run(now, id, ...clinicParams);
    this.logAudit(this.dbService, AuditLogType.MEDICAL_RECORD_PHRASE_DELETE, id, "MedicalRecordPhrase");
    this.invalidateDictionaryCache(DICTIONARY_CACHE_KEYS.MEDICAL_RECORD_PHRASES, this.clinicContext.getClinicId());
    return { id };
  }
}
