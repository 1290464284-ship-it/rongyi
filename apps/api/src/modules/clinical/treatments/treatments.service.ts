import { BusinessNotFoundException, BusinessValidationException } from '@common/errors';
import { Injectable } from '@nestjs/common';

import { DbService } from "../../../db/db.service";
import { BaseService } from "../../../common/services/base.service";
import { Treatment, TreatmentStatus, TreatmentCatalog } from "@dental/shared";
import * as crypto from "node:crypto";
import { ClinicContextService } from "../../../common/services/clinic-context.service";
import { PAGINATION } from "../../../common/constants/pagination";
import { AuditLogType } from "../../../common/constants";
import { CreateTreatmentCatalogDto, UpdateTreatmentCatalogDto } from "./dto/create-treatment.dto";
import { CacheService } from "../../../common/services/cache.service";
import {
  CACHE_PREFIXES,
  DICTIONARY_CACHE_KEYS,
  buildDictionaryCacheKey,
} from "../../../common/constants/cache-keys";
import { TREATMENT_CATALOG_CACHE_TTL_MS } from "../../../config/constants";
import { yuanToCents, centsToYuan } from "../../../common/utils/format/money.utils";

interface CreateTreatmentDto {
  patientId: string;
  visitId?: string;
  doctorId: string;
  code: string;
  name: string;
  category: string;
  price: number;
  quantity?: number;
  teethNumbers?: number[];
  remark?: string;
}

@Injectable()
export class TreatmentsService extends BaseService<Treatment> {

  constructor(
    dbService: DbService,
    clinicContext: ClinicContextService,
    private cache: CacheService,
  ) {
    // P0 修复：添加 moneyFields=['price']，使 BaseService.findOne/findMany 自动转换（分→元）
    super(dbService, clinicContext, { tableName: "Treatment", jsonFields: ["teethNumbers"], searchFields: ["name"], moneyFields: ['price'] });
  }

  async findMany(params: { patientId?: string; visitId?: string; toothNumber?: number; status?: TreatmentStatus; page?: number; pageSize?: number }) {
    const { patientId, visitId, toothNumber, status, page = 1, pageSize = PAGINATION.DEFAULT_PAGE_SIZE_MEDIUM } = params;
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    let query = `SELECT id, patientId, visitId, doctorId, code, name, category, price, quantity, teethNumbers, status, plannedDate, completedDate, remark, createdAt, updatedAt FROM Treatment WHERE deletedAt IS NULL${clinicClause}`;
    let countQuery = `SELECT COUNT(*) as count FROM Treatment WHERE deletedAt IS NULL${clinicClause}`;
    const qp: unknown[] = [...clinicParams];
    const cp: unknown[] = [...clinicParams];
    if (patientId) { query += " AND patientId = ?"; countQuery += " AND patientId = ?"; qp.push(patientId); cp.push(patientId); }
    if (visitId) { query += " AND visitId = ?"; countQuery += " AND visitId = ?"; qp.push(visitId); cp.push(visitId); }
    if (toothNumber) {
      query += " AND EXISTS (SELECT 1 FROM JSON_EACH(teethNumbers) WHERE value = ?)";
      countQuery += " AND EXISTS (SELECT 1 FROM JSON_EACH(teethNumbers) WHERE value = ?)";
      qp.push(toothNumber); cp.push(toothNumber);
    }
    if (status) { query += " AND status = ?"; countQuery += " AND status = ?"; qp.push(status); cp.push(status); }
    query += " ORDER BY createdAt DESC LIMIT ? OFFSET ?";
    qp.push(pageSize, (page - 1) * pageSize);
    const items = this.dbService.prepare(query).all(...qp) as Treatment[];
    this.parseJsonFields(items);
    // P0 修复：自定义 SQL 查询的 price 为 cents，需手动转回 yuan
    items.forEach(item => {
      if (typeof item.price === 'number') {
        (item as unknown as Record<string, unknown>).price = centsToYuan(item.price);
      }
    });
    const total = (this.dbService.prepare(countQuery).get(...cp) as { count: number })?.count || 0;

    // N+1 鏌ヨ浼樺寲锛氭壒閲忔煡璇㈡偅鑰呭拰鍖荤敓淇℃伅
    if (items.length > 0 && !patientId) {
      const patientIds = [...new Set(items.map(t => t.patientId).filter(Boolean))];
      const doctorIds = [...new Set(items.map(t => t.doctorId).filter(Boolean))];
      
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
      
      const itemsWithRelations = items.map(t => ({
        ...t,
        patient: patientMap.get(t.patientId) || null,
        doctor: doctorMap.get(t.doctorId) || null,
      }));
      return { items: itemsWithRelations, total, page, pageSize };
    }

    return { items, total, page, pageSize };
  }

  async create(dto: Partial<Treatment>): Promise<Treatment> {
    const createDto = dto as unknown as CreateTreatmentDto;

    // P1 修复：FK 校验必须带 clinicId 过滤，防止跨诊所引用其他诊所的患者/医生
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();

    // Validate FK: patientId must exist (within same clinic)
    const patient = this.dbService.prepare(
      `SELECT id FROM Patient WHERE id = ? AND deletedAt IS NULL${clinicClause}`
    ).get(createDto.patientId, ...clinicParams);
    if (!patient) {
      throw new BusinessNotFoundException('患者不存在');
    }

    // Validate FK: doctorId must exist (within same clinic)
    const doctor = this.dbService.prepare(
      `SELECT id FROM User WHERE id = ? AND active = 1 AND deletedAt IS NULL${clinicClause}`
    ).get(createDto.doctorId, ...clinicParams);
    if (!doctor) {
      throw new BusinessNotFoundException('医生不存在');
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const clinicId = this.clinicContext.getClinicId();
    // P0 修复：price 存入 cents（INTEGER），审计日志中也使用 cents
    const priceCents = yuanToCents(createDto.price);
    this.baseRepository.insert(this.dbService, 'Treatment', {
      id,
      patientId: createDto.patientId,
      visitId: createDto.visitId || null,
      doctorId: createDto.doctorId,
      code: createDto.code,
      name: createDto.name,
      category: createDto.category,
      price: priceCents,
      quantity: createDto.quantity || 1,
      teethNumbers: JSON.stringify(createDto.teethNumbers || []),
      remark: createDto.remark || null,
      status: TreatmentStatus.PLANNED,
      clinicId: clinicId || null,
      createdAt: now,
      updatedAt: now,
    });
    this.logAudit(this.dbService, AuditLogType.TREATMENT_CREATE, id, "Treatment", { afterData: { code: createDto.code, name: createDto.name, category: createDto.category, price: priceCents, status: TreatmentStatus.PLANNED } });
    return super.findOne(id);
  }

  // 娌荤枟鐘舵€佹満锛氬畾涔夊悎娉曠姸鎬佽浆鎹紝闃叉浠绘剰璺宠浆
  private static readonly ALLOWED_TRANSITIONS: Record<string, readonly string[]> = {
    PLANNED: ["IN_PROGRESS", "COMPLETED", "CANCELLED"],
    IN_PROGRESS: ["COMPLETED", "CANCELLED"],
    COMPLETED: [],
    CANCELLED: [],
  };

  async update(id: string, dto: Partial<Treatment> & { status?: string }) {
    const existing = await super.findOne(id);
    if (dto.status && dto.status !== existing.status) {
      const allowed = TreatmentsService.ALLOWED_TRANSITIONS[existing.status] || [];
      if (!allowed.includes(dto.status)) {
        throw new BusinessValidationException(`娌荤枟鐘舵€佷笉鍙粠 ${existing.status} 娴佽浆鍒?${dto.status}`);
      }
    }
    const result = await super.update(id, dto);
    this.logAudit(this.dbService, AuditLogType.TREATMENT_UPDATE, id, "Treatment", { beforeData: { status: existing.status, name: existing.name, price: existing.price }, afterData: { status: dto.status ?? existing.status, name: dto.name ?? existing.name, price: dto.price ?? existing.price } });
    return result;
  }

  async findCatalog(page = 1, pageSize: number = PAGINATION.DEFAULT_PAGE_SIZE_XLARGE) {
    // P4-2: 娌荤枟鐩綍涓哄瓧鍏哥被鏁版嵁锛堝彉鏇撮鐜囦綆銆佽棰戠巼楂橈級锛屾寜璇婃墍 + 鍒嗛〉缂撳瓨
    const clinicId = this.clinicContext.getClinicId();
    const cacheKey = `${buildDictionaryCacheKey(DICTIONARY_CACHE_KEYS.TREATMENT_CATALOG, clinicId ?? '')}:p${page}:s${pageSize}`;
    const cached = this.cache.get<unknown[]>(cacheKey);
    if (cached) return cached;

    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    const offset = (page - 1) * pageSize;
    const result = this.dbService.prepare(`SELECT id, code, name, category, price, remark, clinicId, createdAt FROM TreatmentCatalog WHERE deletedAt IS NULL${clinicClause} ORDER BY code LIMIT ? OFFSET ?`).all(...clinicParams, pageSize, offset) as Array<Record<string, unknown>>;
    // P0 修复：自定义 SQL 查询的 price 为 cents，需手动转回 yuan
    result.forEach(item => {
      if (typeof item.price === 'number') {
        item.price = centsToYuan(item.price);
      }
    });
    this.cache.set(cacheKey, result, TREATMENT_CATALOG_CACHE_TTL_MS);
    return result;
  }

  /**
   * P4-2: 澶辨晥褰撳墠璇婃墍鐨勬不鐤楃洰褰曠紦瀛橈紙澧炲垹鏀瑰悗璋冪敤锛?
   * 浣跨敤 delPattern 娓呴櫎鎵€鏈夊垎椤靛彉浣擄紙:p{page}:s{pageSize}锛?
   */
  private invalidateCatalogCache(clinicId: string | null): void {
    if (!clinicId) return;
    this.cache.delPattern(`${CACHE_PREFIXES.DICTIONARY}${DICTIONARY_CACHE_KEYS.TREATMENT_CATALOG}:${clinicId}:`);
  }

  async createCatalog(dto: CreateTreatmentCatalogDto) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const clinicId = this.clinicContext.getClinicId();
    this.baseRepository.insert(this.dbService, 'TreatmentCatalog', {
      id,
      code: dto.code,
      name: dto.name,
      category: dto.category,
      price: dto.price,
      remark: dto.remark || null,
      clinicId: clinicId || null,
      createdAt: now,
    });
    this.logAudit(this.dbService, AuditLogType.TREATMENT_CATALOG_CREATE, id, "TreatmentCatalog", { afterData: { code: dto.code, name: dto.name, category: dto.category, price: dto.price } });
    // P4-2: 鏂板鐩綍椤瑰悗澶辨晥缂撳瓨
    this.invalidateCatalogCache(clinicId);
    const { clause: createClause, params: clinicParams } = this.buildClinicClause();
    const createClinicCondition = createClause.replace(/^\s*AND\s+/i, '');
    return this.baseRepository.findById<TreatmentCatalog>(this.dbService, 'TreatmentCatalog', '*', id, createClinicCondition ? ['deletedAt IS NULL', createClinicCondition] : ['deletedAt IS NULL'], clinicParams);
  }

  async updateCatalog(id: string, dto: UpdateTreatmentCatalogDto) {
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    const clinicCondition = clinicClause.replace(/^\s*AND\s+/i, '');
    const existing = this.baseRepository.findById<TreatmentCatalog>(this.dbService, 'TreatmentCatalog', '*', id, clinicCondition ? ['deletedAt IS NULL', clinicCondition] : ['deletedAt IS NULL'], clinicParams);
    const updates: string[] = [];
    const params: unknown[] = [];
    if (dto.name !== undefined) { updates.push("name = ?"); params.push(dto.name); }
    if (dto.category !== undefined) { updates.push("category = ?"); params.push(dto.category); }
    if (dto.price !== undefined) { updates.push("price = ?"); params.push(dto.price); }
    if (dto.remark !== undefined) { updates.push("remark = ?"); params.push(dto.remark); }
    if (updates.length > 0) {
      this.baseRepository.update(this.dbService, 'TreatmentCatalog', updates, params, id, clinicClause, clinicParams);
      this.logAudit(this.dbService, AuditLogType.TREATMENT_CATALOG_UPDATE, id, "TreatmentCatalog", { beforeData: { name: existing?.name, category: existing?.category, price: existing?.price }, afterData: { name: dto.name ?? existing?.name, category: dto.category ?? existing?.category, price: dto.price ?? existing?.price } });
      // P4-2: 鏇存柊鐩綍椤瑰悗澶辨晥缂撳瓨
      const clinicId = this.clinicContext.getClinicId();
      this.invalidateCatalogCache(clinicId);
    }
    const clinicCondition2 = clinicClause.replace(/^\s*AND\s+/i, '');
    return this.baseRepository.findById<TreatmentCatalog>(this.dbService, 'TreatmentCatalog', '*', id, clinicCondition2 ? ['deletedAt IS NULL', clinicCondition2] : ['deletedAt IS NULL'], clinicParams);
  }

  async deleteCatalog(id: string) {
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    const clinicCondition3 = clinicClause.replace(/^\s*AND\s+/i, '');
    const existing = this.baseRepository.findById<TreatmentCatalog>(this.dbService, 'TreatmentCatalog', 'id', id, clinicCondition3 ? ['deletedAt IS NULL', clinicCondition3] : ['deletedAt IS NULL'], clinicParams);
    if (!existing) throw new BusinessNotFoundException("治疗项目不存在");
    const now = new Date().toISOString();
    const clinicId = this.clinicContext.getClinicId();
    this.baseRepository.update(this.dbService, 'TreatmentCatalog', ['deletedAt = ?', 'updatedAt = ?'], [now, now], id, clinicClause, clinicParams);
    this.logAudit(this.dbService, AuditLogType.TREATMENT_CATALOG_DELETE, id, "TreatmentCatalog");
    // P4-2: 鍒犻櫎鐩綍椤瑰悗澶辨晥缂撳瓨
    this.invalidateCatalogCache(clinicId);
    return { id };
  }
}
