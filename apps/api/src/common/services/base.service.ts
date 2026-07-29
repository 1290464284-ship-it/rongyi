import { Injectable, ForbiddenException, ConflictException } from '@nestjs/common';
import { BusinessValidationException, BusinessNotFoundException } from '@common/errors';
import * as crypto from 'node:crypto';
import { DbService } from '../../db/db.service';
import { IDatabase } from '../../db/db.interface';
import { Pagination, BaseEntity } from '@dental/shared';
import { sanitizeData } from '../utils/security/sanitize-config';
import { AppLogger } from './logger.service';
import { ClinicContextService } from './clinic-context.service';
import { MAX_PAGE_SIZE } from '../constants/pagination';
import { UNIQUE_CONSTRAINT_MAX_RETRIES } from '../../config/constants';
import { yuanToCents, centsToYuan } from '../utils/format/money.utils';
import { validateTableName, validateColumnName } from '../utils/db/validate-name';
import { buildClinicFilter, buildClinicFilterOptional } from '../utils/db/clinic-filter';
// 架构重构：从 BaseService 上帝类拆分出的 5 个职责单一服务
import { AuditLogService } from './audit-log.service';
import { CodeGenerator } from './code-generator.service';
import { SoftDeleteManager } from './soft-delete-manager.service';
import { PaginationService } from './pagination.service';
import { BaseRepository } from '../repositories/base.repository';

export { MAX_PAGE_SIZE };

/** BaseService 构造函数 Options 对象，替代原先的位置参数 */
export interface ServiceOptions {
  tableName: string;
  jsonFields?: string[];
  searchFields?: string[];
  cascadeTables?: { table: string; foreignKey: string }[];
  hasSoftDelete?: boolean;
  uniqueFields?: string[];
  codeField?: string;
  codePrefix?: string;
  moneyFields?: string[];
}

export interface QueryOptions {
  keyword?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'ASC' | 'DESC';
  filters?: Record<string, unknown>;
  /** 游标分页：传入上一页最后一条记录的 id，替代 OFFSET */
  cursor?: string;
  /** 是否包含已软删除的记录（默认 false） */
  includeDeleted?: boolean;
  /** 是否跳过 clinicId 过滤（默认 false，即自动过滤） */
  skipClinicFilter?: boolean;
}

@Injectable()
export class BaseService<T extends BaseEntity> {
  protected logger: AppLogger;
  /** 查询时返回的字段列表，为空则使用 SELECT * */
  protected selectFields: string[] = [];
  /** 排序字段白名单，子类可设置以严格限制可排序的列；未设置则仅做格式校验 */
  protected allowedSortFields?: Set<string>;
  /** 过滤字段白名单，子类可设置以严格限制可过滤的列；未设置则仅做格式校验 */
  protected allowedFilterFields?: Set<string>;

  // ============================================================================
  // 架构重构：BaseService 上帝类拆分
  // 将原 BaseService 承担的多项职责拆分到独立的协作服务中。
  // 采用"内部实例化"策略而非 Nest DI 注入，原因：
  //   1. BaseService 是抽象基类，子类通过 super(dbService, clinicContext, ...) 调用
  //      若改为 DI 注入需修改 28 个子类的构造函数与 super() 调用，风险过高
  //   2. 这些服务均无状态（除运行时参数外），实例化多次无副作用
  //   3. BaseService 的 public/protected API 完全不变，子类零修改即可继续工作
  // 委托模式：BaseService 的方法体改为委托给协作服务调用
  // ============================================================================
  protected readonly auditLogService: AuditLogService;
  protected readonly codeGenerator: CodeGenerator;
  protected readonly softDeleteManager: SoftDeleteManager;
  protected readonly paginationService: PaginationService;
  protected readonly baseRepository: BaseRepository;

  protected tableName: string;
  protected jsonFields: string[];
  protected searchFields: string[];
  protected cascadeTables: { table: string; foreignKey: string }[];
  protected hasSoftDelete: boolean;
  protected uniqueFields: string[];
  protected codeField?: string;
  protected codePrefix?: string;
  protected moneyFields: string[];

  constructor(
    protected dbService: DbService,
    protected clinicContext: ClinicContextService,
    options: ServiceOptions,
  ) {
    this.tableName = options.tableName;
    this.jsonFields = options.jsonFields ?? [];
    this.searchFields = options.searchFields ?? [];
    this.cascadeTables = options.cascadeTables ?? [];
    this.hasSoftDelete = options.hasSoftDelete ?? true;
    this.uniqueFields = options.uniqueFields ?? [];
    this.codeField = options.codeField;
    this.codePrefix = options.codePrefix;
    this.moneyFields = options.moneyFields ?? [];
    this.logger = new AppLogger(this.constructor.name);
    if (!validateTableName(this.tableName)) {
      throw new BusinessValidationException(`无效的表名: ${this.tableName}`);
    }
    this.jsonFields.forEach(field => {
      if (!validateColumnName(field)) {
        throw new BusinessValidationException(`无效的 JSON 字段名: ${field}`);
      }
    });
    this.searchFields.forEach(field => {
      if (!validateColumnName(field)) {
        throw new BusinessValidationException(`无效的搜索字段名: ${field}`);
      }
    });
    this.cascadeTables.forEach(({ table, foreignKey }) => {
      if (!validateTableName(table)) {
        throw new BusinessValidationException(`无效的级联表名: ${table}`);
      }
      if (!validateColumnName(foreignKey)) {
        throw new BusinessValidationException(`无效的级联外键: ${foreignKey}`);
      }
    });
    this.moneyFields.forEach(field => {
      if (!validateColumnName(field)) {
        throw new BusinessValidationException(`无效的金额字段名: ${field}`);
      }
    });

    // 架构重构：实例化拆分出的协作服务（无状态，构造函数注入依赖即可）
    // 使用内部实例化而非 Nest DI，避免修改 28 个子类的 super() 调用
    this.auditLogService = new AuditLogService();
    this.codeGenerator = new CodeGenerator();
    this.softDeleteManager = new SoftDeleteManager();
    this.paginationService = new PaginationService();
    this.baseRepository = new BaseRepository();
  }

  /** 获取 SELECT 字段列表，如果 selectFields 为空则返回 * */
  protected getSelectColumns(): string {
    if (this.selectFields.length === 0) return '*';
    return this.selectFields.filter(f => validateColumnName(f)).join(', ');
  }

  /**
   * 构建诊所隔离 SQL 片段，供子类复用
   * @param prefix SQL 前缀，默认 ' AND '（用于拼接到已有 WHERE 条件后）
   * @param skipClinicFilter 是否跳过诊所过滤（仅用于 BOSS 等跨诊所场景，需自行鉴权）
   * @returns clause 为空时表示无诊所上下文，params 为空数组
   */
  protected buildClinicClause(prefix: string = ' AND ', skipClinicFilter = false): { clause: string; params: unknown[] } {
    const clinicId = this.clinicContext.getClinicId();
    const result = skipClinicFilter
      ? buildClinicFilterOptional(clinicId)
      : buildClinicFilter(clinicId);
    if (!result.clause) {
      return { clause: '', params: [] };
    }
    const condition = result.clause.replace(/^\s*AND\s+/i, '');
    return { clause: prefix + condition, params: result.params };
  }

  /**
   * 创建新记录
   * @param dto 实体数据对象
   * @param options.skipClinicFilter 是否跳过诊所过滤（仅用于 BOSS 等跨诊所场景，需自行鉴权）
   * @returns 创建后的完整实体
   * @throws ForbiddenException 缺少诊所上下文时抛出
   * @throws ConflictException 唯一约束冲突重试失败后抛出
   * @throws BusinessValidationException 字段名校验失败时抛出
   * @description 自动处理：XSS 清洗、clinicId 注入、JSON 字段序列化、金额字段元转分、唯一约束冲突重试（code 字段）
   */
  async create(dto: Partial<T>, options: { skipClinicFilter?: boolean } = {}): Promise<T> {
    const { skipClinicFilter = false } = options;
    const MAX_RETRIES = UNIQUE_CONSTRAINT_MAX_RETRIES;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const now = new Date().toISOString();
        const id = crypto.randomUUID();

        const safeDto = sanitizeData(this.tableName, dto);

        const data: Record<string, unknown> = { ...safeDto, id, createdAt: now, updatedAt: now };

        // 多诊所扩展：自动注入当前用户的 clinicId（如果 DTO 中未指定且表有此列）
        if (data.clinicId === undefined) {
          const clinicId = this.clinicContext.getClinicId();
          if (clinicId) {
            data.clinicId = clinicId;
          } else if (!skipClinicFilter) {
            throw new ForbiddenException('缺少诊所信息，请重新登录');
          }
        }

        this.jsonFields.forEach((field) => {
          if (data[field] !== undefined) {
            data[field] = JSON.stringify(data[field]);
          }
        });

        this.moneyFields.forEach((field) => {
          if (data[field] !== undefined && data[field] !== null) {
            const val = Number(data[field]);
            if (Number.isFinite(val)) {
              data[field] = yuanToCents(val);
            }
          }
        });

        // 过滤掉 undefined 值（ValidationPipe transform:true 会使 DTO 所有声明属性
        // 成为自有属性，未赋值的为 undefined；插入 undefined 会触发 "no such column" 错误
        // 当表 schema 经过迁移重命名/删除列后，DTO 仍保留旧字段名）
        const keys = Object.keys(data).filter((k) => data[k] !== undefined);
        // 校验所有列名，防止 SQL 注入
        keys.forEach((k) => {
          if (!validateColumnName(k)) {
            throw new BusinessValidationException(`无效的字段名: ${k}`);
          }
        });
        // 重建只含有效键的 data 对象
        const filteredData: Record<string, unknown> = {};
        keys.forEach((k) => { filteredData[k] = data[k]; });

        // 架构重构：委托 BaseRepository 执行纯 SQL INSERT
        // 业务逻辑（XSS 清洗 / clinicId 注入 / JSON 序列化 / 金额转换 / 列名校验）仍由 BaseService 负责
        this.baseRepository.insert(this.dbService, this.tableName, filteredData);

        return this.findOne(id);
      } catch (err: unknown) {
        // UNIQUE constraint conflict → retry (e.g. code collision in generateCode)
        if (attempt < MAX_RETRIES && err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
          // 重试时重新生成 code 字段（若该表已配置 codeField/codePrefix）
          // 写回 dto 以便下一轮循环重新构造 data 时使用新 code
          // 注意：data/keys/values 作用域仅在 try 内，故必须回写到 dto 才能跨重试生效
          if (this.codeField && this.codePrefix) {
            (dto as Record<string, unknown>)[this.codeField] = this.generateCode(this.codePrefix);
          }
          continue;
        }
        throw err;
      }
    }
    throw new ConflictException(`创建${this.tableName}失败，已重试${MAX_RETRIES}次`);
  }

  /**
   * 分页查询列表
   * @param options 查询选项
   * @param options.keyword 关键词搜索（匹配 searchFields 配置的字段）
   * @param options.page 页码，默认 1
   * @param options.pageSize 每页条数，默认 20，最大不超过 MAX_PAGE_SIZE
   * @param options.sortBy 排序字段，默认 createdAt
   * @param options.sortOrder 排序方向，默认 DESC
   * @param options.cursor 游标分页标识（上一页最后一条记录的 id），替代 OFFSET 提升大数据量性能
   * @param options.includeDeleted 是否包含已软删除的记录，默认 false
   * @param options.skipClinicFilter 是否跳过诊所过滤，默认 false
   * @param options.filters 精确过滤条件，键为字段名，值为过滤值
   * @returns 分页结果，包含 items、total、page、pageSize
   * @throws ForbiddenException 缺少诊所上下文时抛出
   * @throws BusinessValidationException 排序字段或过滤字段不合法时抛出
   * @description 支持关键词模糊搜索、精确过滤、游标分页、软删除过滤、诊所数据隔离
   */
  async findMany(options: QueryOptions = {}): Promise<Pagination<T>> {
    const { keyword, page: rawPage, pageSize: rawPageSize, sortBy = 'createdAt', sortOrder = 'DESC', cursor, includeDeleted = false, skipClinicFilter = false } = options;

    const { page, pageSize } = this.paginationService.validatePagination(rawPage, rawPageSize);
    const { sortBy: validSortBy, sortOrder: validSortOrder } = this.paginationService.validateSort(sortBy, sortOrder);

    const { whereClause, params } = this.paginationService.buildWhereClause({
      keyword,
      searchFields: this.searchFields,
      filters: options.filters,
      allowedFilterFields: this.allowedFilterFields,
      clinicId: this.clinicContext.getClinicId() ?? undefined,
      skipClinicFilter,
      hasSoftDelete: this.hasSoftDelete,
      includeDeleted,
    });

    const builtQuery = this.baseRepository.buildPaginatedQuery(
      this.tableName,
      this.getSelectColumns(),
      whereClause,
      params,
      validSortBy,
      validSortOrder,
      cursor,
      pageSize,
      page,
    );
    const { items, total } = this.baseRepository.executePaginatedQuery<T>(this.dbService, builtQuery);

    this.parseJsonFields(items);
    this.parseMoneyFields(items);

    return {
      items,
      total,
      page,
      pageSize,
    };
  }

  async findOne(id: string, options: { skipClinicFilter?: boolean } = {}): Promise<T> {
    const { skipClinicFilter = false } = options;
    const conditions: string[] = ['id = ?'];
    const params: unknown[] = [id];

    // 多诊所数据隔离
    if (!skipClinicFilter) {
      const clinicId = this.clinicContext.getClinicId();
      if (clinicId) {
        conditions.push('clinicId = ?');
        params.push(clinicId);
      } else {
        throw new ForbiddenException('缺少诊所信息，请重新登录');
      }
    }

    if (this.hasSoftDelete) {
      conditions.push('deletedAt IS NULL');
    }

    // 架构重构：委托 BaseRepository 执行纯 SQL SELECT
    // 业务逻辑（诊所隔离 / 软删除过滤 / 列名校验）仍由 BaseService 负责
    // findOne 的 conditions 中第一项固定为 'id = ?'，因此把后续条件作为 extraConditions 传入
    const extraConditions = conditions.slice(1);
    const extraParams = params.slice(1);
    const item = this.baseRepository.findById<T>(
      this.dbService,
      this.tableName,
      this.getSelectColumns(),
      id,
      extraConditions,
      extraParams,
    );
    if (!item) {
      throw new BusinessNotFoundException(`${this.tableName}不存在`);
    }
    this.parseJsonFields([item]);
    this.parseMoneyFields([item]);
    return item;
  }

  /**
   * 更新记录
   * @param id 记录 ID
   * @param dto 更新数据对象
   * @returns 更新后的完整实体
   * @throws BusinessNotFoundException 记录不存在时抛出
   * @throws ForbiddenException 缺少诊所上下文时抛出
   * @throws BusinessValidationException 字段名不合法时抛出
   * @description 自动处理：XSS 清洗、JSON 字段序列化、金额字段元转分、updatedAt 自动更新、诊所数据隔离
   */
  async update(id: string, dto: Partial<T>): Promise<T> {
    await this.findOne(id);

    const safeDto = sanitizeData(this.tableName, dto);

    const data: Record<string, unknown> = { ...safeDto, updatedAt: new Date().toISOString() };
    this.jsonFields.forEach((field) => {
      if (data[field] !== undefined) {
        data[field] = JSON.stringify(data[field]);
      }
    });

    this.moneyFields.forEach((field) => {
      if (data[field] !== undefined && data[field] !== null) {
        const val = Number(data[field]);
        if (Number.isFinite(val)) {
          data[field] = yuanToCents(val);
        }
      }
    });

    const updates: string[] = [];
    const params: unknown[] = [];

    Object.entries(data).forEach(([key, value]) => {
      if (value !== undefined && key !== 'id') {
        // 校验列名，防止 SQL 注入（dto 可能包含未声明的字段）
        if (!validateColumnName(key)) {
          throw new BusinessValidationException('无效的字段名');
        }
        updates.push(`${key} = ?`);
        params.push(value);
      }
    });

    if (updates.length === 0) {
      return this.findOne(id);
    }

    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();

    // 架构重构：委托 BaseRepository 执行纯 SQL UPDATE
    // 业务逻辑（XSS 清洗 / JSON 序列化 / 金额转换 / 列名校验 / 诊所过滤）仍由 BaseService 负责
    // 注意：原实现将 id 放在 params 末尾，BaseRepository.update 内部会按 (params, id, clinicParams) 顺序拼参数
    this.baseRepository.update(
      this.dbService,
      this.tableName,
      updates,
      params,
      id,
      clinicClause,
      clinicParams,
    );

    // Re-read directly instead of calling findOne() again
    const softDeleteCondition = this.hasSoftDelete ? ' AND deletedAt IS NULL' : '';
    const updated = this.dbService.prepare(
      `SELECT ${this.getSelectColumns()} FROM ${this.tableName} WHERE id = ?${clinicClause}${softDeleteCondition}`,
    ).get(id, ...clinicParams) as T | undefined;
    if (!updated) {
      throw new BusinessNotFoundException(`${this.tableName}不存在`);
    }
    this.parseJsonFields([updated]);
    this.parseMoneyFields([updated]);
    return updated;
  }

  /**
   * 删除记录（已重定向至软删除，确保数据可恢复）。
   * 如需物理删除，由具体 service 子类显式覆写此方法。
   */
  async remove(id: string): Promise<unknown> {
    this.logger.log(`[SOFT_DELETE_REDIRECT] ${this.tableName}.remove(${id}) 已重定向至 softDelete`);
    await this.softDelete(id);
    return id;
  }

  /**
   * 软删除记录
   * @param id 记录 ID
   * @throws BusinessNotFoundException 记录不存在或已删除时抛出
   * @description 设置 deletedAt 标记为已删除，同时处理：
   *  1. 级联软删除关联表数据（cascadeTables 配置）
   *  2. 唯一字段加后缀避免冲突（uniqueFields 配置）
   *  3. 自动记录审计日志
   *  4. 诊所数据隔离
   */
  async softDelete(id: string): Promise<void> {
    // 架构重构：委托 SoftDeleteManager 执行完整软删除流程（含级联 + 唯一字段 + 审计）
    // 所有上下文通过 SoftDeleteContext 显式传入，避免协作服务访问 BaseService 内部状态
    const clinicId = this.clinicContext.getClinicId();
    const existing = this.softDeleteManager.softDelete(this.dbService, id, {
      tableName: this.tableName,
      cascadeTables: this.cascadeTables,
      uniqueFields: this.uniqueFields,
      hasSoftDelete: this.hasSoftDelete,
      selectColumns: this.getSelectColumns(),
      clinicClause: this.buildClinicClause(),
      clinicId,
    });
    // SoftDeleteManager 返回原始记录（未做 JSON / 金额解析），保留给调用方按需处理
    // 此处仅做 parse 以保持与原行为一致（虽然结果未使用，但保持调用约定）
    this.parseJsonFields([existing as T]);
    this.parseMoneyFields([existing as T]);
  }

  protected parseJsonFields(items: T[]): void {
    items.forEach((item) => {
      this.jsonFields.forEach((field) => {
        const record = item as Record<string, unknown>;
        const value = record[field];
        if (typeof value === 'string') {
          try {
            const parsed = JSON.parse(value) as unknown;
            record[field] = parsed;
          } catch (err: unknown) {
            this.logger.warn(`Failed to parse JSON field '${field}' for table '${this.tableName}': ${(err as Error)?.message}`);
            record[field] = value;
          }
        } else if (value === null || value === undefined) {
          record[field] = [];
        }
      });
    });
  }

  protected parseMoneyFields(items: T[]): void {
    items.forEach((item) => {
      this.moneyFields.forEach((field) => {
        const record = item as Record<string, unknown>;
        const value = record[field];
        if (typeof value === 'number' && Number.isFinite(value)) {
          record[field] = centsToYuan(value);
        }
      });
    });
  }

  /**
   * 生成业务编码：使用事务 + MAX(code) 提高并发安全性
   * 注意：调用方仍需对 INSERT 添加唯一约束重试以应对极端并发场景
   */
  protected generateCode(prefix: string): string {
    // 架构重构：委托 CodeGenerator 生成业务编码
    // 诊所过滤上下文由 BaseService 构造后显式传入
    return this.codeGenerator.generateCode(
      this.dbService,
      this.tableName,
      prefix,
      this.buildClinicClause(),
    );
  }

  /**
   * 批量关联查询：根据外键批量查询关联表数据，解决 N+1 查询问题
   * @param items 源数据列表
   * @param key 源数据中关联字段名（外键）
   * @param targetTable 目标关联表名
   * @param fields 需要查询的字段，逗号分隔，默认 'id, name'
   * @returns Map<id, 记录>，以目标表 id 为 key
   * @throws BusinessValidationException 字段名不合法时抛出
   * @example
   * // 查询患者列表对应的医生信息
   * const doctorMap = this.batchResolve(patients, 'doctorId', 'Doctor', 'id, name, title');
   * const doctor = doctorMap.get(patient.doctorId);
   */
  protected batchResolve<TItem extends Record<string, unknown>, TResult extends { id: string } & Record<string, unknown>>(
    items: TItem[],
    key: string,
    targetTable: string,
    fields: string = 'id, name',
  ): Map<string, TResult> {
    const fieldList = fields.split(',').map(f => f.trim()).filter(Boolean);
    for (const f of fieldList) {
      if (!validateColumnName(f)) {
        throw new BusinessValidationException('无效的字段名');
      }
    }
    const ids = [...new Set(items.map(i => i[key]).filter(Boolean))];
    const map = new Map<string, TResult>();
    if (ids.length > 0) {
      const safeFields = fieldList.join(', ');
      const rows = this.baseRepository.batchFindByIds<TResult>(this.dbService, ids, targetTable, safeFields);
      rows.forEach(r => map.set(r.id, r));
    }
    return map;
  }

  /**
   * 统一审计日志方法
   * 支持事务内（传 db）和事务外（传 dbService）两种使用方式
   * 自动生成 UUID、createdAt，自动获取 clinicId，自动 JSON 序列化 beforeData/afterData
   */
  protected logAudit(
    db: IDatabase,
    type: string,
    targetId: string,
    targetType: string,
    options?: {
      beforeData?: unknown;
      afterData?: unknown;
      remark?: string;
      operatorId?: string;
      operatorName?: string;
      amount?: number;
      ip?: string;
    },
  ): void {
    // 架构重构：委托 AuditLogService 执行审计日志写入 + 敏感数据脱敏
    // 诊所上下文由 BaseService 显式注入（保持 protected 方法签名不变）
    const clinicId = this.clinicContext.getClinicId();
    this.auditLogService.logAudit(db, type, targetId, targetType, clinicId, options);
  }

}