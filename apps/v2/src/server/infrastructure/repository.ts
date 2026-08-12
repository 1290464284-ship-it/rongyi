import type Database from 'better-sqlite3';
import { resourceRegistry } from '../../domain/resources';
import { ConflictError, NotFoundError, ValidationError } from './errors';
import type {
  AppContext,
  IRepository,
  Page,
  RepositoryQuery,
  ResourceDefinition,
  ResourceField,
} from '../../domain/contracts';
import { maskSensitiveFields } from './security';
import { tenantAnd, tenantParams, tenantWhere } from './tenant';
import { buildFtsQuery, refreshPatientChildSearchRows, removeSearchRowsByRecordIds } from './search-index';
import { trackResourceWrite } from './write-tracking';

export interface RelationLabelJoin {
  select: string;
  join: string;
}

/**
 * 为 relation 字段生成 LEFT JOIN 片段：目标表 + labelField 全部来自资源元数据白名单
 * （resources.ts 中 relation.resource → 目标表、relation.labelField → 标签列），
 * 不拼接任何用户输入，杜绝 SQL 注入面。目标行须未软删除且与主行同诊所。
 * 输出形如：`rel0.name AS patientIdLabel` / `LEFT JOIN Patient rel0 ON rel0.id = t.patientId ...`。
 */
export function buildRelationLabelJoins(
  resource: ResourceDefinition,
  hasDeletedAt?: (table: string) => boolean,
  hasClinicId?: (table: string) => boolean,
): RelationLabelJoin[] {
  const joins: RelationLabelJoin[] = [];
  let index = 0;
  for (const field of resource.fields) {
    if (field.type !== 'relation' || !field.relation) continue;
    const target = resourceRegistry.get(field.relation.resource);
    if (!target) continue;
    const alias = `rel${index}`;
    index += 1;
    const deletedClause = hasDeletedAt?.(target.table) === false ? '' : ` AND ${alias}.deletedAt IS NULL`;
    const clinicClause = hasClinicId?.(target.table) === false ? '' : ` AND ${alias}.clinicId = t.clinicId`;
    joins.push({
      select: `${alias}.${field.relation.labelField} AS ${field.name}Label`,
      join: `LEFT JOIN ${target.table} ${alias} ON ${alias}.id = t.${field.relation.foreignKey}${deletedClause}${clinicClause}`,
    });
  }
  return joins;
}

function serialize(field: ResourceField, value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (field.type === 'json') {
    return typeof value === 'string' ? value : JSON.stringify(value);
  }
  if (field.type === 'boolean') {
    // B-L4：字符串 '1'（表单/CSV/同步客户端）与布尔 true 等价；与 validation.ts 一致。
    return value === true || value === 1 || value === 'true' || value === '1' ? 1 : 0;
  }
  return value;
}

function deserialize(field: ResourceField, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (field.type === 'json') {
    try {
      return JSON.parse(String(value));
    } catch {
      return String(value);
    }
  }
  if (field.type === 'boolean') return Number(value) === 1;
  return value;
}

export class SqliteRepository implements IRepository<Record<string, unknown>> {
  private readonly columns: Set<string>;
  private readonly emitSyncChange: boolean;

  constructor(
    private readonly db: Database.Database,
    private readonly resource: ResourceDefinition,
    options: { emitSyncChange?: boolean } = {},
  ) {
    this.emitSyncChange = options.emitSyncChange ?? true;
    this.columns = new Set(
      (this.db.prepare(`PRAGMA table_info(${this.resource.table})`).all() as Array<{ name: string }>)
        .map((column) => column.name),
    );
  }

  async findById(id: string, context: AppContext): Promise<Record<string, unknown> | null> {
    return this.findByIdSync(id, context);
  }

  /** sync 批事务专用同步读取；async 公共方法委托本方法，避免 SQL 逻辑双写。 */
  findByIdSync(id: string, context: AppContext): Record<string, unknown> | null {
    /* v8 ignore start -- all registry tables include clinicId today; false branch is defensive for future schemas. */
    const tenantClause = this.hasClinicColumn() ? tenantAnd(context.clinicId) : '';
    const params = [id, ...(this.hasClinicColumn() ? tenantParams(context.clinicId) : [])];
    /* v8 ignore stop */
    const deletedClause = this.hasDeletedAtColumn() ? ' AND deletedAt IS NULL' : '';
    const rows = this.queryRows(
      `SELECT * FROM ${this.resource.table} WHERE id = ?${deletedClause}${tenantClause}`,
      params,
    );
    if (rows.length === 0) return null;
    return this.mapRow(rows[0]);
  }

  async findMany(query: RepositoryQuery, context: AppContext): Promise<Page<Record<string, unknown>>> {
    const rawPage = typeof query.page === 'number' && Number.isFinite(query.page) ? query.page : 1;
    const rawPageSize = typeof query.pageSize === 'number' && Number.isFinite(query.pageSize) ? query.pageSize : 20;
    const page = Math.max(1, Math.floor(rawPage));
    const pageSize = Math.min(200, Math.max(1, Math.floor(rawPageSize)));
    const search = typeof query.search === 'string' ? query.search.trim() : '';
    if (typeof query.search === 'string' && search === '') {
      // 显式传入纯空格搜索时不退化为“未过滤第一页”，避免用户误以为在搜索。
      return { items: [], total: 0, page, pageSize };
    }
    const where: string[] = this.hasDeletedAtColumn() ? ['t.deletedAt IS NULL'] : ['1 = 1'];
    const params: unknown[] = [];
    const cursor = typeof query.cursor === 'string' && query.cursor !== '' ? query.cursor : null;

    /* v8 ignore start -- all registry tables include clinicId today; false branch is defensive for future schemas. */
    if (this.hasClinicColumn()) {
      const tenant = tenantAnd(context.clinicId, 't.clinicId');
      if (tenant) {
        where.push(tenant.slice(' AND '.length));
        params.push(...tenantParams(context.clinicId));
      }
    }
    /* v8 ignore stop */

    for (const [key, value] of Object.entries(query.filters ?? {})) {
      const field = this.field(key);
      if (!field) throw new ValidationError(`Unknown filter field: ${key}`);
      if ((Array.isArray(value) || (typeof value === 'object' && value !== null)) && field.type !== 'json') {
        throw new ValidationError(`Filter value for ${key} must be a scalar`);
      }
      where.push(`t.${key} = ?`);
      params.push(serialize(field, value));
    }

    if (search && this.resource.searchIndexResource) {
      const ftsQuery = buildFtsQuery(search);
      if (ftsQuery) {
        // SearchIndex 是独立于主表的 FTS 表，外层 WHERE 的 clinicId 过滤不作用于该子查询；
        // 必须显式追加 clinicId 条件，否则跨诊所记录会进入 IN 列表（R2-P2-04）。
        // 复用 tenantAnd 生成条件（而非字面量），与上方主表过滤保持一致。
        const ftsTenant = tenantAnd(context.clinicId);
        where.push(`t.id IN (SELECT recordId FROM SearchIndex WHERE SearchIndex MATCH ? AND resource = ?${ftsTenant})`);
        params.push(ftsQuery, this.resource.searchIndexResource);
        if (ftsTenant) params.push(...tenantParams(context.clinicId));
      }
    } else if (search && (this.resource.searchableFields?.length ?? 0) > 0) {
      const searchClauses = this.resource.searchableFields!.map((field) => `t.${field} LIKE ? ESCAPE '\\'`);
      where.push(`(${searchClauses.join(' OR ')})`);
      const escaped = search.replace(/[\\%_]/g, '\\$&');
      for (let i = 0; i < searchClauses.length; i += 1) params.push(`%${escaped}%`);
    }

    // relation 字段 LEFT JOIN 目标表取 labelField，作为 `<field>Label` 附加列返回；
    // 无关联目标/表缺失时 LEFT JOIN 安全回退为 NULL label（前端回退显示原 UUID）。
    const labelJoins = buildRelationLabelJoins(
      this.resource,
      (table) => this.tableHasColumn(table, 'deletedAt'),
      (table) => this.tableHasColumn(table, 'clinicId'),
    );
    const labelSelect = labelJoins.length > 0 ? `, ${labelJoins.map((join) => join.select).join(', ')}` : '';
    const labelJoinSql = labelJoins.map((join) => join.join).join(' ');

    // keyset 模式：id 游标按 id ASC 拉取；createdAt|id 复合游标按
    // createdAt DESC + id DESC 拉取。首屏（无 cursor）也会在可 keyset
    // 的默认排序下返回 nextCursor，让前端直接进入游标路径，避免深分页
    // offset 扫描。total 仍按过滤集整体统计（不含游标条件）。
    const whereSql = where.join(' AND ');
    const totalRow = this.db.prepare(`SELECT COUNT(*) AS total FROM ${this.resource.table} t WHERE ${whereSql}`).get(...params) as { total: number };
    let sortField = query.sortBy && this.field(query.sortBy) ? query.sortBy : this.resource.defaultSort?.field ?? 'createdAt';
    let sortOrder = query.sortOrder === 'ASC' ? 'ASC' : 'DESC';
    let rowParams = params;
    let rowWhere = whereSql;
    let keysetOrder = false;
    if (cursor && cursor.includes('|')) {
      const separator = cursor.lastIndexOf('|');
      const cursorTime = cursor.slice(0, separator);
      const cursorId = cursor.slice(separator + 1);
      rowWhere = `${whereSql} AND (t.createdAt < ? OR (t.createdAt = ? AND t.id < ?))`;
      rowParams = [...params, cursorTime, cursorTime, cursorId];
      sortField = 'createdAt';
      sortOrder = 'DESC';
      keysetOrder = true;
    } else if (cursor) {
      rowWhere = `${whereSql} AND t.id > ?`;
      rowParams = [...params, cursor];
      sortField = 'id';
      sortOrder = 'ASC';
      keysetOrder = true;
    } else if ((sortField === 'id' && sortOrder === 'ASC') || (sortField === 'createdAt' && sortOrder === 'DESC')) {
      keysetOrder = true;
    }
    const offset = cursor ? 0 : (page - 1) * pageSize;
    const orderSql = sortField === 'createdAt' && sortOrder === 'DESC'
      ? 'ORDER BY t.createdAt DESC, t.id DESC'
      : `ORDER BY t.${sortField} ${sortOrder}`;
    const fetchSize = keysetOrder ? pageSize + 1 : pageSize;
    const rows = this.queryRows(
      `SELECT t.*${labelSelect} FROM ${this.resource.table} t ${labelJoinSql}
       WHERE ${rowWhere}
       ${orderSql}
       LIMIT ? OFFSET ?`,
      [...rowParams, fetchSize, offset],
    );
    const pageRows = rows.slice(0, pageSize);

    let nextCursor: string | undefined;
    if (keysetOrder && rows.length > pageSize) {
      if (sortField === 'createdAt' && sortOrder === 'DESC') {
        const last = pageRows[pageRows.length - 1] as Record<string, unknown>;
        nextCursor = `${String(last.createdAt ?? '')}|${String(last.id ?? '')}`;
      } else {
        nextCursor = String((pageRows[pageRows.length - 1] as Record<string, unknown>).id ?? '');
      }
    }
    return {
      items: pageRows.map((row) => this.mapRow(row)),
      total: totalRow.total,
      page,
      pageSize,
      nextCursor,
    };
  }

  async insert(entity: Record<string, unknown>, context: AppContext): Promise<void> {
    return this.insertSync(entity, context);
  }

  /** sync 批事务专用同步写入；async 公共方法委托本方法。 */
  insertSync(entity: Record<string, unknown>, context: AppContext): void {
    const now = context.now().toISOString();
    const id = String(entity.id);
    const columns = ['id', 'clinicId', 'createdAt', 'updatedAt', 'deletedAt'];
    const values: unknown[] = [id, context.clinicId ?? null, now, now, null];

    for (const field of this.resource.fields) {
      if (field.name in entity) {
        columns.push(field.name);
        values.push(serialize(field, entity[field.name]));
      } else if (field.default !== undefined) {
        columns.push(field.name);
        values.push(serialize(field, field.default));
      }
    }

    const placeholders = columns.map(() => '?').join(', ');
    try {
      this.runWrite(() => {
        this.assertRelations(entity, context);
        this.db.prepare(`INSERT INTO ${this.resource.table} (${columns.join(', ')}) VALUES (${placeholders})`).run(...values);
        trackResourceWrite(this.db, {
          tableName: this.resource.table,
          recordId: id,
          operation: 'INSERT',
          clinicId: context.clinicId,
          searchResource: this.resource.searchIndexResource ?? null,
          emitSyncChange: this.emitSyncChange,
        });
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) throw new ConflictError(`${this.resource.name} violates a unique field constraint`);
      throw error;
    }
  }

  async update(entity: Record<string, unknown>, context: AppContext): Promise<void> {
    return this.updateSync(entity, context);
  }

  /** sync 批事务专用同步更新；async 公共方法委托本方法。 */
  updateSync(entity: Record<string, unknown>, context: AppContext): void {
    const id = String(entity.id);

    const sets: string[] = ['updatedAt = ?'];
    const values: unknown[] = [context.now().toISOString()];
    for (const field of this.resource.fields) {
      if (field.name in entity) {
        sets.push(`${field.name} = ?`);
        values.push(serialize(field, entity[field.name]));
      }
    }
    // B-M5：条件 UPDATE（id + deletedAt IS NULL + 租户），changes===0 即目标行
    // 不存在/已删除/跨租户 → NotFoundError。相比先 findById 再 UPDATE 的
    // check-then-act 模式，消除并发删除窗口下"误报更新成功"的竞态。
    const whereParts = ['id = ?'];
    if (this.hasDeletedAtColumn()) whereParts.push('deletedAt IS NULL');
    values.push(id);
    /* v8 ignore start -- all registry tables include clinicId today; false branch is defensive for future schemas. */
    if (this.hasClinicColumn()) {
      const tenantClause = tenantWhere(context.clinicId).sql;
      if (tenantClause) {
        whereParts.push(tenantClause);
        values.push(...tenantParams(context.clinicId));
      }
    }
    /* v8 ignore stop */
    try {
      this.runWrite(() => {
        this.assertRelations(entity, context);
        const result = this.db.prepare(
          `UPDATE ${this.resource.table} SET ${sets.join(', ')} WHERE ${whereParts.join(' AND ')}`,
        ).run(...values);
        if (Number(result.changes) === 0) throw new NotFoundError(`${this.resource.name} not found`);
        trackResourceWrite(this.db, {
          tableName: this.resource.table,
          recordId: id,
          operation: 'UPDATE',
          clinicId: context.clinicId,
          searchResource: this.resource.searchIndexResource ?? null,
          emitSyncChange: this.emitSyncChange,
        });
        if (this.resource.name === 'patients') refreshPatientChildSearchRows(this.db, id);
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) throw new ConflictError(`${this.resource.name} violates a unique field constraint`);
      throw error;
    }
  }

  async softDelete(id: string, context: AppContext): Promise<void> {
    return this.softDeleteSync(id, context);
  }

  /** sync 批事务专用同步软删；async 公共方法委托本方法。 */
  softDeleteSync(id: string, context: AppContext): void {
    this.runWrite(() => {
    if (this.resource.capabilities.softDelete && this.hasDeletedAtColumn()) {
      const now = context.now().toISOString();
      /* v8 ignore start -- all registry tables include clinicId today; false branch is defensive for future schemas. */
      const params = [now, now, id, ...(this.hasClinicColumn() ? tenantParams(context.clinicId) : [])];
      const clinicWhere = this.hasClinicColumn() ? tenantAnd(context.clinicId) : '';
      /* v8 ignore stop */
      // B-M5：与 update 一致的守卫——目标行不存在/已删除/跨租户时 changes===0 → NotFound，
      // 避免对他人/已删记录"静默成功"。
      const result = this.db.prepare(
        `UPDATE ${this.resource.table} SET deletedAt = ?, updatedAt = ? WHERE id = ? AND deletedAt IS NULL${clinicWhere}`,
      ).run(...params);
      if (Number(result.changes) === 0) throw new NotFoundError(`${this.resource.name} not found`);
    } else {
      /* v8 ignore start -- all registry tables include clinicId today; false branch is defensive for future schemas. */
      const params = [id, ...(this.hasClinicColumn() ? tenantParams(context.clinicId) : [])];
      const clinicWhere = this.hasClinicColumn() ? tenantAnd(context.clinicId) : '';
      /* v8 ignore stop */
      const result = this.db.prepare(
        `DELETE FROM ${this.resource.table} WHERE id = ?${clinicWhere}`,
      ).run(...params);
      if (Number(result.changes) === 0) throw new NotFoundError(`${this.resource.name} not found`);
    }
    trackResourceWrite(this.db, {
      tableName: this.resource.table,
      recordId: id,
      operation: 'DELETE',
      clinicId: context.clinicId,
      searchResource: this.resource.searchIndexResource ?? null,
      emitSyncChange: this.emitSyncChange,
    });
    if (this.resource.name === 'patients') {
      // 患者删除后其子记录（Appointment/Charge/FollowUp）索引行不再有意义；
      // 一次查询 + 批量删除，避免大患者历史逐行触达 FTS 表。
      // 子表可能缺 patientId 列（精简/异构 schema），按实际列结构跳过。
      for (const childTable of ['Appointment', 'Charge', 'FollowUp']) {
        if (!this.tableHasColumn(childTable, 'patientId')) continue;
        const childRows = this.db.prepare(`SELECT id FROM ${childTable} WHERE patientId = ?`).all(id) as Array<{ id: string }>;
        removeSearchRowsByRecordIds(this.db, childTable, childRows.map((row) => String(row.id)));
      }
    }
    });
  }

  private field(name: string): ResourceField | undefined {
    return this.resource.fields.find((field) => field.name === name);
  }

  private runWrite<T>(fn: () => T): T {
    const tx = (this.db as unknown as { transaction?: <U>(cb: () => U) => () => U }).transaction;
    if (typeof tx === 'function') return tx.call(this.db, fn)() as T;
    return fn();
  }

  private hasClinicColumn(): boolean {
    return this.columns.has('clinicId');
  }

  private hasDeletedAtColumn(): boolean {
    return this.columns.has('deletedAt');
  }

  private tableHasColumn(table: string, column: string): boolean {
    const rows = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    return rows.some((row) => row.name === column);
  }

  private assertRelations(entity: Record<string, unknown>, context: AppContext): void {
    for (const field of this.resource.fields) {
      if (!field.relation || !(field.name in entity) || entity[field.name] === null || entity[field.name] === undefined) {
        continue;
      }
      const target = resourceRegistry.get(field.relation.resource);
      if (!target) continue;
      const targetHasClinic = this.tableHasColumn(target.table, 'clinicId');
      const params = [String(entity[field.name]), ...(targetHasClinic ? tenantParams(context.clinicId) : [])];
      const deletedClause = this.tableHasColumn(target.table, 'deletedAt') ? ' AND deletedAt IS NULL' : '';
      const row = this.db.prepare(
        `SELECT id FROM ${target.table} WHERE id = ?${deletedClause}${targetHasClinic ? tenantAnd(context.clinicId) : ''}`,
      ).get(...params) as { id: string } | undefined;
      if (!row) throw new NotFoundError(`${field.relation.resource} not found for ${field.name}`);
    }
  }

  private queryRows(sql: string, params: unknown[]): Array<Record<string, unknown>> {
    return this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  }

  private mapRow(row: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = { ...row };
    for (const field of this.resource.fields) {
      if (field.name in result) {
        result[field.name] = deserialize(field, result[field.name]);
      }
    }
    if (this.hasDeletedAtColumn()) result.deletedAt = row.deletedAt ?? null;
    return maskSensitiveFields(result);
  }
}

export function isUniqueConstraintError(error: unknown): boolean {
  const code = error instanceof Error ? String((error as { code?: unknown }).code ?? '') : '';
  const message = error instanceof Error ? error.message : '';
  return code.includes('UNIQUE') || message.includes('UNIQUE constraint failed');
}
