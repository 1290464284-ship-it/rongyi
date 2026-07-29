import { Injectable } from '@nestjs/common';
import { BaseService, QueryOptions } from "../../../common/services/base.service";
import { ClinicContextService } from "../../../common/services/clinic-context.service";
import { buildClinicFilter } from "../../../common/utils/db/clinic-filter";
import { sanitizeData } from "../../../common/utils/security/sanitize-config";
import { MAX_PAGE_SIZE, PAGINATION } from "../../../common/constants/pagination";
import { DbService } from "../../../db/db.service";

export interface FollowUp {
  id: string;
  patientId: string;
  planDate: string;
  content?: string;
  status: string;
  assigneeId?: string;
  result?: string;
  completedAt?: string;
  clinicId?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

/**
 * 迁移说明：
 * 1. complete/remove/update 从直接使用 db.prepare 迁移到使用 super.update
 * 2. listResults/listItems/listTemplates/listAutoRules 使用 BaseRepository 查询关联表
 * 3. 审计日志记录保留原有逻辑（业务特殊性）
 */
@Injectable()
export class FollowUpsService extends BaseService<FollowUp> {

  constructor(dbService: DbService, clinicContext: ClinicContextService) {
    super(dbService, clinicContext, { tableName: "FollowUp" });
  }

  async findMany(params: { patientId?: string; status?: string; assigneeId?: string; page?: number; pageSize?: number }) {
    const { patientId, status, assigneeId, page = 1, pageSize = PAGINATION.DEFAULT_PAGE_SIZE_MEDIUM } = params;
    const filters: Record<string, unknown> = {};
    if (patientId) filters.patientId = patientId;
    if (status) filters.status = status;
    if (assigneeId) filters.assigneeId = assigneeId;
    const options: QueryOptions = {
      page,
      pageSize,
      sortBy: "planDate",
      sortOrder: "ASC",
      filters,
    };
    return super.findMany(options);
  }

  async create(dto: { patientId: string; planDate: string; content?: string; assigneeId?: string }) {
    return super.create({
      ...dto,
      status: "PENDING",
    });
  }

  async complete(id: string, result?: string) {
    const existing = await this.findOne(id);
    const safeResult = sanitizeData('FollowUp', { result });
    const now = new Date().toISOString();
    const clinicId = this.clinicContext.getClinicId();
    const { clause: clinicClause, params: clinicParams } = buildClinicFilter(clinicId);
    // 迁移：使用事务内调用 BaseRepository.update + 审计日志
    return this.dbService.transaction((db) => {
      this.baseRepository.update(
        db,
        this.tableName,
        ['status = ?', 'result = ?', 'completedAt = ?', 'updatedAt = ?'],
        ['COMPLETED', safeResult.result || null, now, now],
        id,
        clinicClause,
        clinicParams,
      );
      this.logAudit(db, "FOLLOWUP_COMPLETE", id, "FollowUp", { beforeData: { status: existing.status }, afterData: { status: 'COMPLETED', result: safeResult.result } });
      const clinicCondition = clinicClause.replace(/^\s*AND\s+/i, '');
      return this.baseRepository.findById<FollowUp>(db, this.tableName, '*', id, clinicCondition ? ['deletedAt IS NULL', clinicCondition] : ['deletedAt IS NULL'], clinicParams);
    });
  }

  async remove(id: string): Promise<void> {
    // 迁移：使用 super.update 更新状态 + softDelete 处理删除标记
    await super.update(id, {
      status: 'CANCELLED',
    });
    await this.softDelete(id);
    this.logAudit(this.dbService, "FOLLOWUP_REMOVE", id, "FollowUp");
  }

  async update(id: string, dto: Partial<FollowUp>): Promise<FollowUp> {
    const existing = await this.findOne(id);
    const safeDto = sanitizeData('FollowUp', dto);
    const now = new Date().toISOString();
    const clinicId = this.clinicContext.getClinicId();
    const { clause: clinicClause, params: clinicParams } = buildClinicFilter(clinicId);
    // 迁移：使用事务内调用 BaseRepository.update + 审计日志
    // 动态构建更新字段，只更新传入的字段
    const updates: string[] = ['updatedAt = ?'];
    const params: unknown[] = [now];
    if (safeDto.status !== undefined) {
      updates.push('status = ?');
      params.push(safeDto.status);
    }
    if (safeDto.content !== undefined) {
      updates.push('content = ?');
      params.push(safeDto.content);
    }
    if (safeDto.planDate !== undefined) {
      updates.push('planDate = ?');
      params.push(safeDto.planDate);
    }
    if (safeDto.assigneeId !== undefined) {
      updates.push('assigneeId = ?');
      params.push(safeDto.assigneeId);
    }
    return this.dbService.transaction((db) => {
      this.baseRepository.update(
        db,
        this.tableName,
        updates,
        params,
        id,
        clinicClause,
        clinicParams,
      );
      this.logAudit(db, "FOLLOWUP_UPDATE", id, "FollowUp", { beforeData: { status: existing.status }, afterData: { status: safeDto.status } });
      const clinicCondition2 = clinicClause.replace(/^\s*AND\s+/i, '');
      return this.baseRepository.findById<FollowUp>(db, this.tableName, '*', id, clinicCondition2 ? ['deletedAt IS NULL', clinicCondition2] : ['deletedAt IS NULL'], clinicParams) as FollowUp;
    });
  }

  async listResults() {
    const { clause: clinicClause, params: clinicParams } = buildClinicFilter(this.clinicContext.getClinicId());
    const builtQuery = this.baseRepository.buildPaginatedQuery(
      'FollowUpResult',
      '*',
      ` WHERE 1=1${clinicClause}`,
      clinicParams,
      'category',
      'ASC',
      undefined,
      MAX_PAGE_SIZE,
      1,
    );
    const { items } = this.baseRepository.executePaginatedQuery(this.dbService, builtQuery);
    return items;
  }

  async listItems(templateId: string) {
    const { clause: clinicClause, params: clinicParams } = buildClinicFilter(this.clinicContext.getClinicId());
    const builtQuery = this.baseRepository.buildPaginatedQuery(
      'FollowUpItem',
      '*',
      ` WHERE templateId=?${clinicClause}`,
      [templateId, ...clinicParams],
      'sortOrder',
      'ASC',
      undefined,
      MAX_PAGE_SIZE,
      1,
    );
    const { items } = this.baseRepository.executePaginatedQuery(this.dbService, builtQuery);
    return items;
  }

  async listTemplates() {
    const { clause: clinicClause, params: clinicParams } = buildClinicFilter(this.clinicContext.getClinicId());
    const builtQuery = this.baseRepository.buildPaginatedQuery(
      'FollowUpTemplate',
      '*',
      ` WHERE 1=1${clinicClause}`,
      clinicParams,
      'createdAt',
      'DESC',
      undefined,
      MAX_PAGE_SIZE,
      1,
    );
    const { items } = this.baseRepository.executePaginatedQuery(this.dbService, builtQuery);
    return items;
  }

  async findAll(params?: { page?: number; pageSize?: number }) {
    const { page = 1, pageSize = PAGINATION.DEFAULT_PAGE_SIZE_MEDIUM } = params || {};
    return this.findMany({ page, pageSize });
  }

  async listAutoRules() {
    const { clause: clinicClause, params: clinicParams } = buildClinicFilter(this.clinicContext.getClinicId());
    const builtQuery = this.baseRepository.buildPaginatedQuery(
      'AutoFollowUpRule',
      '*',
      ` WHERE 1=1${clinicClause}`,
      clinicParams,
      'createdAt',
      'DESC',
      undefined,
      PAGINATION.DEFAULT_PAGE_SIZE_XLARGE,
      1,
    );
    const { items } = this.baseRepository.executePaginatedQuery(this.dbService, builtQuery);
    return items;
  }
}
