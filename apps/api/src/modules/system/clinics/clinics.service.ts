import { BusinessConflictException, BusinessNotFoundException, BusinessException } from '@common/errors';
import { Injectable } from '@nestjs/common';

import { DbService } from '../../../db/db.service';
import { BaseService } from '../../../common/services/base.service';
import { ClinicContextService } from '../../../common/services/clinic-context.service';
import { CacheService } from '../../../common/services/cache.service';
import { CACHE_PREFIXES } from '../../../common/constants/cache-keys';
import { CLINIC_DETAIL_CACHE_TTL_MS } from '../../../config/constants';
import { AuditLogType } from '../../../common/constants';

export interface Clinic {
  id: string;
  name: string;
  code: string;
  address?: string;
  phone?: string;
  legalPerson?: string;
  businessLicense?: string;
  isActive: number;
  remark?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

/**
 * 迁移说明：
 * 1. findOne/findActive 从直接使用 db.prepare 迁移到使用 BaseRepository.findById
 * 2. create 中的 code 唯一性检查使用 BaseRepository 执行
 * 3. Clinic 表特殊：不需要 clinicId 过滤（管理端需查看所有诊所）
 */
@Injectable()
export class ClinicsService extends BaseService<Clinic> {

  constructor(
    dbService: DbService,
    clinicContext: ClinicContextService,
    private cache: CacheService,
  ) {
    super(dbService, clinicContext, { tableName: 'Clinic', searchFields: ['name', 'code'], uniqueFields: ['code'] });
  }

  async findMany(options: Parameters<BaseService<Clinic>['findMany']>[0] = {}) {
    return super.findMany({ ...options, skipClinicFilter: true });
  }

  async findOne(id: string): Promise<Clinic> {
    return this.cache.getOrSet(
      `${CACHE_PREFIXES.CLINIC}${id}`,
      async () => {
        const item = this.baseRepository.findById<Clinic>(
          this.dbService,
          this.tableName,
          '*',
          id,
          ['deletedAt IS NULL'],
        );
        if (!item) {
          throw new BusinessNotFoundException('诊所不存在');
        }
        return item;
      },
      CLINIC_DETAIL_CACHE_TTL_MS,
    );
  }

  async create(dto: Partial<Clinic>): Promise<Clinic> {
    const codeQuery = this.baseRepository.buildPaginatedQuery(
      this.tableName,
      'id',
      ' WHERE code = ? AND deletedAt IS NULL',
      [dto.code],
      'createdAt',
      'DESC',
      undefined,
      1,
      1,
    );
    const { items } = this.baseRepository.executePaginatedQuery<{ id: string }>(this.dbService, codeQuery);
    if (items.length > 0) {
      throw new BusinessConflictException(`诊所编码 "${dto.code}" 已存在`);
    }

    const result = await super.create(dto);
    this.logAudit(this.dbService, AuditLogType.CLINIC_CREATE, result.id, "Clinic", { afterData: { name: result.name, code: result.code } });
    this.invalidateClinicCache();
    return result;
  }

  async update(id: string, dto: Partial<Clinic>): Promise<Clinic> {
    const result = await super.update(id, dto);
    this.invalidateClinicCache(id);
    return result;
  }

  async remove(id: string): Promise<void> {
    await super.remove(id);
    this.invalidateClinicCache(id);
  }

  private invalidateClinicCache(id?: string): void {
    if (id) {
      this.cache.del(`${CACHE_PREFIXES.CLINIC}${id}`);
    }
    this.cache.delPattern(`${CACHE_PREFIXES.CLINIC}active:`);
  }

  /**
   * 获取当前用户的诊所信息
   */
  async getCurrentClinic(): Promise<Clinic | null> {
    const clinicId = this.clinicContext.getClinicId();
    if (!clinicId) return null;
    try {
      return await this.findOne(clinicId);
    } catch (err) {
      // P1 修复：仅捕获业务异常（诊所不存在等），其他异常（DB 错误等）应向上传播
      if (err instanceof BusinessException) {
        return null;
      }
      throw err;
    }
  }

  /**
   * 获取所有活跃诊所（供用户注册/切换时选择）
   */
  async findActive(): Promise<Clinic[]> {
    return this.cache.getOrSet(
      `${CACHE_PREFIXES.CLINIC}active:list`,
      () => {
        const builtQuery = this.baseRepository.buildPaginatedQuery(
          this.tableName,
          'id, name, code, address, phone',
          ' WHERE isActive = 1 AND deletedAt IS NULL',
          [],
          'name',
          'ASC',
          undefined,
          1000,
          1,
        );
        const { items } = this.baseRepository.executePaginatedQuery<Clinic>(this.dbService, builtQuery);
        return items;
      },
      CLINIC_DETAIL_CACHE_TTL_MS,
    );
  }
}
