import { Injectable, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
import { DbService } from '../../db/db.service';
import { Pagination, BaseEntity } from '@dental/shared';
import { sanitizePlain, sanitizeHtml } from '../utils/sanitize';
import { sanitizeData } from '../utils/sanitize-config';
import { AppLogger } from './logger.service';
import { getCurrentClinicId } from './clinic-context.service';
import { MAX_PAGE_SIZE } from '../dto/pagination.dto';

export { MAX_PAGE_SIZE };

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

const TABLE_NAME_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const COLUMN_NAME_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function validateTableName(name: string): boolean {
  return TABLE_NAME_REGEX.test(name);
}

function validateColumnName(name: string): boolean {
  return COLUMN_NAME_REGEX.test(name);
}

function escapeLike(input: string): string {
  return input.replace(/[%_\\]/g, '\\$&');
}

@Injectable()
export class BaseService<T extends BaseEntity> {
  protected logger = new AppLogger(BaseService.name);
  /** 查询时返回的字段列表，为空则使用 SELECT * */
  protected selectFields: string[] = [];

  constructor(
    protected dbService: DbService,
    protected tableName: string,
    protected jsonFields: string[] = [],
    protected searchFields: string[] = [],
    protected cascadeTables: { table: string; foreignKey: string }[] = [],
    /** 表中是否有 deletedAt 列（软删除），默认 true */
    protected hasSoftDelete = true,
    /** 唯一约束字段列表，软删除时会给这些字段加后缀以避免冲突 */
    protected uniqueFields: string[] = [],
  ) {
    if (!validateTableName(tableName)) {
      throw new Error(`Invalid table name: ${tableName}`);
    }
    jsonFields.forEach(field => {
      if (!validateColumnName(field)) {
        throw new Error(`Invalid JSON field name: ${field}`);
      }
    });
    searchFields.forEach(field => {
      if (!validateColumnName(field)) {
        throw new Error(`Invalid search field name: ${field}`);
      }
    });
    cascadeTables.forEach(({ table, foreignKey }) => {
      if (!validateTableName(table)) {
        throw new Error(`Invalid cascade table name: ${table}`);
      }
      if (!validateColumnName(foreignKey)) {
        throw new Error(`Invalid cascade foreign key: ${foreignKey}`);
      }
    });
  }

  /** 获取 SELECT 字段列表，如果 selectFields 为空则返回 * */
  protected getSelectColumns(): string {
    if (this.selectFields.length === 0) return '*';
    return this.selectFields.filter(f => validateColumnName(f)).join(', ');
  }

  async create(dto: Partial<T>): Promise<T> {
    const MAX_RETRIES = 3;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const now = new Date().toISOString();
        const id = crypto.randomUUID();

        // Sanitize all text columns before inserting
        const safeDto = sanitizeData(this.tableName, dto as Record<string, unknown>) as Partial<T>;

        const data: Record<string, unknown> = { ...safeDto, id, createdAt: now, updatedAt: now };

        // P3: 多诊所扩展 — 自动注入当前用户的 clinicId（如果 DTO 中未指定且表有此列）
        if (data.clinicId === undefined) {
          const clinicId = getCurrentClinicId();
          if (clinicId) {
            data.clinicId = clinicId;
          }
        }

        this.jsonFields.forEach((field) => {
          if (data[field] !== undefined) {
            data[field] = JSON.stringify(data[field]);
          }
        });

        const keys = Object.keys(data);
        // 校验所有列名，防止 SQL 注入
        keys.forEach((k) => {
          if (!validateColumnName(k)) {
            throw new Error(`Invalid column name in create: ${k}`);
          }
        });
        const placeholders = keys.map(() => '?').join(', ');
        const values = keys.map((k) => data[k]);

        this.dbService.prepare(
          `INSERT INTO ${this.tableName} (${keys.join(', ')}) VALUES (${placeholders})`,
        ).run(...values);

        return this.findOne(id);
      } catch (err: unknown) {
        // UNIQUE constraint conflict → retry (e.g. code collision in generateCode)
        if (attempt < MAX_RETRIES && err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
          // Regenerate the code on retry if code field exists
          continue;
        }
        throw err;
      }
    }
    throw new Error(`Failed to create ${this.tableName} after ${MAX_RETRIES} attempts`);
  }

  async findMany(options: QueryOptions = {}): Promise<Pagination<T>> {
    const { keyword, page = 1, pageSize: rawPageSize = 20, sortBy = 'createdAt', sortOrder = 'DESC', cursor, includeDeleted = false, skipClinicFilter = false } = options;
    const pageSize = Math.min(rawPageSize, MAX_PAGE_SIZE);

    if (!validateColumnName(sortBy)) {
      throw new Error(`Invalid sort field: ${sortBy}`);
    }

    const validSortOrder = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    // 构建 WHERE 条件（复用于 COUNT 和 DATA 查询）
    const conditions: string[] = [];
    const params: unknown[] = [];

    // P3: 多诊所数据隔离 — 自动按当前用户的 clinicId 过滤
    if (!skipClinicFilter) {
      const clinicId = getCurrentClinicId();
      if (clinicId) {
        conditions.push('clinicId = ?');
        params.push(clinicId);
      }
    }

    // 软删除过滤：默认排除已删除记录
    if (this.hasSoftDelete && !includeDeleted) {
      conditions.push('deletedAt IS NULL');
    }

    if (keyword && this.searchFields.length > 0) {
      const escaped = escapeLike(keyword);
      const likeConditions = this.searchFields.map((f) => `${f} LIKE ? ESCAPE '\\'`);
      conditions.push(`(${likeConditions.join(' OR ')})`);
      params.push(...this.searchFields.map(() => `%${escaped}%`));
    }

    if (options.filters) {
      Object.entries(options.filters).forEach(([key, value]) => {
        if (!validateColumnName(key)) {
          throw new Error(`Invalid filter field: ${key}`);
        }
        if (value !== undefined && value !== null && value !== '') {
          conditions.push(`${key} = ?`);
          params.push(value);
        }
      });
    }

    const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';

    // 分离查询：先用独立 COUNT(*) 获取总数，避免窗口函数在大数据量下的性能问题
    const countQuery = `SELECT COUNT(*) as total FROM ${this.tableName}${whereClause}`;
    const countRow = this.dbService.prepare(countQuery).get(...params) as { total: number };
    const total = countRow.total;

    // 数据查询（不带窗口函数）
    let dataQuery = `SELECT ${this.getSelectColumns()} FROM ${this.tableName}${whereClause}`;
    const dataParams: unknown[] = [...params];

    // 游标分页：使用 id 作为游标，替代 OFFSET 提升大数据量性能
    if (cursor) {
      const whereOrAnd = conditions.length > 0 ? 'AND' : 'WHERE';
      const cursorOp = validSortOrder === 'ASC' ? '>' : '<';
      dataQuery += ` ${whereOrAnd} id ${cursorOp} ?`;
      dataParams.push(cursor);
    }

    dataQuery += ` ORDER BY ${sortBy} ${validSortOrder}, id ${validSortOrder} LIMIT ? OFFSET ?`;
    dataParams.push(pageSize, (page - 1) * pageSize);

    const items = this.dbService.prepare(dataQuery).all(...dataParams) as T[];

    this.parseJsonFields(items);

    return {
      items: items as unknown as T[],
      total,
      page,
      pageSize,
    };
  }

  async findOne(id: string): Promise<T> {
    const conditions: string[] = ['id = ?'];
    const params: unknown[] = [id];

    // P3: 多诊所数据隔离
    const clinicId = getCurrentClinicId();
    if (clinicId) {
      conditions.push('clinicId = ?');
      params.push(clinicId);
    }

    if (this.hasSoftDelete) {
      conditions.push('deletedAt IS NULL');
    }

    const item = this.dbService.prepare(
      `SELECT ${this.getSelectColumns()} FROM ${this.tableName} WHERE ${conditions.join(' AND ')}`,
    ).get(...params) as T;
    if (!item) {
      throw new NotFoundException(`${this.tableName}不存在`);
    }
    this.parseJsonFields([item]);
    return item;
  }

  async update(id: string, dto: Partial<T>): Promise<T> {
    await this.findOne(id);

    // Sanitize all text columns before updating
    const safeDto = sanitizeData(this.tableName, dto as Record<string, unknown>) as Partial<T>;

    const data: Record<string, unknown> = { ...safeDto, updatedAt: new Date().toISOString() };
    this.jsonFields.forEach((field) => {
      if (data[field] !== undefined) {
        data[field] = JSON.stringify(data[field]);
      }
    });

    const updates: string[] = [];
    const params: unknown[] = [];

    Object.entries(data).forEach(([key, value]) => {
      if (value !== undefined && key !== 'id') {
        // 校验列名，防止 SQL 注入（dto 可能包含未声明的字段）
        if (!validateColumnName(key)) {
          throw new Error(`Invalid column name in update: ${key}`);
        }
        updates.push(`${key} = ?`);
        params.push(value);
      }
    });

    if (updates.length === 0) {
      return this.findOne(id);
    }

    params.push(id);
    this.dbService.prepare(
      `UPDATE ${this.tableName} SET ${updates.join(', ')} WHERE id = ?`,
    ).run(...params);

    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    // 使用与 softDelete 相同的级联策略：同时清理关联表
    this.dbService.transaction((db) => {
      for (const { table, foreignKey } of this.cascadeTables) {
        db.prepare(`DELETE FROM ${table} WHERE ${foreignKey} = ?`).run(id);
      }
      db.prepare(`DELETE FROM ${this.tableName} WHERE id = ?`).run(id);
    });
  }

  async softDelete(id: string): Promise<void> {
    const existing = await this.findOne(id);
    const now = new Date().toISOString();

    this.dbService.transaction((db) => {
      const updates: string[] = ['deletedAt = ?', 'updatedAt = ?'];
      const params: unknown[] = [now, now];

      for (const field of this.uniqueFields) {
        if (!validateColumnName(field)) continue;
        const currentValue = (existing as Record<string, unknown>)[field];
        if (currentValue !== null && currentValue !== undefined) {
          const suffix = `_deleted_${id.slice(0, 8)}_${Date.now()}`;
          const newValue = String(currentValue) + suffix;
          updates.push(`${field} = ?`);
          params.push(newValue);
        }
      }

      params.push(id);
      db.prepare(`UPDATE ${this.tableName} SET ${updates.join(', ')} WHERE id = ?`).run(...params);

      for (const { table, foreignKey } of this.cascadeTables) {
        db.prepare(`UPDATE ${table} SET deletedAt = ?, updatedAt = ? WHERE ${foreignKey} = ? AND deletedAt IS NULL`).run(now, now, id);
      }
    });
  }

  protected parseJsonFields(items: T[]): void {
    items.forEach((item) => {
      this.jsonFields.forEach((field) => {
        const value = (item as Record<string, any>)[field];
        if (typeof value === 'string') {
          try {
            const parsed = JSON.parse(value);
            (item as Record<string, any>)[field] = parsed;
          } catch (err) {
            this.logger.warn(`Failed to parse JSON field '${field}' for table '${this.tableName}': ${(err as Error)?.message}`);
            (item as Record<string, any>)[field] = value;
          }
        } else if (value === null || value === undefined) {
          (item as Record<string, any>)[field] = [];
        }
      });
    });
  }

  /**
   * 生成业务编码：使用事务 + MAX(code) 提高并发安全性
   * 注意：调用方仍需对 INSERT 添加唯一约束重试以应对极端并发场景
   */
  protected generateCode(prefix: string): string {
    return this.dbService.transaction((db) => {
      const escapedPrefix = escapeLike(prefix);
      const row = db.prepare(
        `SELECT code FROM ${this.tableName} WHERE code LIKE ? ESCAPE '\\' ORDER BY code DESC LIMIT 1`
      ).get(`${escapedPrefix}%`) as { code: string } | undefined;

      let nextSeq = 1;
      if (row?.code) {
        const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = row.code.match(new RegExp(`^${escapedPrefix}(\\d+)$`));
        if (match) {
          nextSeq = parseInt(match[1], 10) + 1;
        }
      }
      return `${prefix}${String(nextSeq).padStart(6, '0')}`;
    });
  }

  protected batchResolve<TItem extends Record<string, unknown>, TResult extends Record<string, unknown>>(
    items: TItem[],
    key: string,
    targetTable: string,
    fields: string = 'id, name',
  ): Map<string, TResult> {
    // 校验 fields 中每个列名，防止 SQL 注入
    const fieldList = fields.split(',').map(f => f.trim()).filter(Boolean);
    for (const f of fieldList) {
      if (!validateColumnName(f)) {
        throw new Error(`Invalid field name in batchResolve: ${f}`);
      }
    }
    const ids = [...new Set(items.map(i => (i as Record<string, unknown>)[key]).filter(Boolean))];
    const map = new Map<string, TResult>();
    if (ids.length > 0) {
      const ph = ids.map(() => '?').join(',');
      const safeFields = fieldList.join(', ');
      const rows = this.dbService.prepare(`SELECT ${safeFields} FROM ${targetTable} WHERE id IN (${ph})`).all(...ids) as TResult[];
      rows.forEach(r => map.set((r as Record<string, unknown>).id as string, r));
    }
    return map;
  }

}