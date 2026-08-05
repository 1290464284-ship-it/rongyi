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
import { tenantAnd, tenantParams } from './tenant';
import { buildFtsQuery, upsertSearchRow, removeSearchRow, refreshPatientChildSearchRows } from './search-index';
import { recordSyncChange } from './sync-change';

function serialize(field: ResourceField, value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (field.type === 'json') {
    return typeof value === 'string' ? value : JSON.stringify(value);
  }
  if (field.type === 'boolean') {
    return value === true || value === 1 || value === 'true' ? 1 : 0;
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
    /* v8 ignore start -- all registry tables include clinicId today; false branch is defensive for future schemas. */
    const tenantClause = this.hasClinicColumn() ? tenantAnd(context.clinicId) : '';
    const params = [id, ...(this.hasClinicColumn() ? tenantParams(context.clinicId) : [])];
    /* v8 ignore stop */
    const rows = this.queryRows(
      `SELECT * FROM ${this.resource.table} WHERE id = ? AND deletedAt IS NULL${tenantClause}`,
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
    const where: string[] = ['deletedAt IS NULL'];
    const params: unknown[] = [];

    /* v8 ignore start -- all registry tables include clinicId today; false branch is defensive for future schemas. */
    if (this.hasClinicColumn()) {
      const tenant = tenantAnd(context.clinicId);
      if (tenant) {
        where.push(tenant.slice(' AND '.length));
        params.push(...tenantParams(context.clinicId));
      }
    }
    /* v8 ignore stop */

    for (const [key, value] of Object.entries(query.filters ?? {})) {
      const field = this.field(key);
      if (!field) throw new ValidationError(`Unknown filter field: ${key}`);
      where.push(`${key} = ?`);
      params.push(serialize(field, value));
    }

    if (query.search && this.resource.searchIndexResource) {
      const ftsQuery = buildFtsQuery(query.search);
      if (ftsQuery) {
        // SearchIndex 是独立于主表的 FTS 表，外层 WHERE 的 clinicId 过滤不作用于该子查询；
        // 必须显式追加 clinicId 条件，否则跨诊所记录会进入 IN 列表（R2-P2-04）。
        // 复用 tenantAnd 生成条件（而非字面量），与上方主表过滤保持一致。
        const ftsTenant = tenantAnd(context.clinicId);
        where.push(`id IN (SELECT recordId FROM SearchIndex WHERE SearchIndex MATCH ? AND resource = ?${ftsTenant})`);
        params.push(ftsQuery, this.resource.searchIndexResource);
        if (ftsTenant) params.push(...tenantParams(context.clinicId));
      }
    } else if (query.search && (this.resource.searchableFields?.length ?? 0) > 0) {
      const searchClauses = this.resource.searchableFields!.map((field) => `${field} LIKE ? ESCAPE '\\'`);
      where.push(`(${searchClauses.join(' OR ')})`);
      const escaped = query.search.replace(/[\\%_]/g, '\\$&');
      for (let i = 0; i < searchClauses.length; i += 1) params.push(`%${escaped}%`);
    }

    const whereSql = where.join(' AND ');
    const totalRow = this.db.prepare(`SELECT COUNT(*) AS total FROM ${this.resource.table} WHERE ${whereSql}`).get(...params) as { total: number };
    const sortField = query.sortBy && this.field(query.sortBy) ? query.sortBy : this.resource.defaultSort?.field ?? 'createdAt';
    const sortOrder = query.sortOrder === 'ASC' ? 'ASC' : 'DESC';
    const offset = (page - 1) * pageSize;
    const rows = this.queryRows(
      `SELECT * FROM ${this.resource.table}
       WHERE ${whereSql}
       ORDER BY ${sortField} ${sortOrder}
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    );

    return {
      items: rows.map((row) => this.mapRow(row)),
      total: totalRow.total,
      page,
      pageSize,
    };
  }

  async insert(entity: Record<string, unknown>, context: AppContext): Promise<void> {
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

    this.assertRelations(entity, context);
    const placeholders = columns.map(() => '?').join(', ');
    try {
      this.db.prepare(`INSERT INTO ${this.resource.table} (${columns.join(', ')}) VALUES (${placeholders})`).run(...values);
    } catch (error) {
      if (isUniqueConstraintError(error)) throw new ConflictError(`${this.resource.name} violates a unique field constraint`);
      throw error;
    }
    if (this.resource.searchIndexResource) upsertSearchRow(this.db, this.resource.searchIndexResource, id);
    if (this.emitSyncChange && context.clinicId) {
      recordSyncChange(this.db, { tableName: this.resource.table, recordId: id, operation: 'INSERT', clinicId: context.clinicId });
    }
  }

  async update(entity: Record<string, unknown>, context: AppContext): Promise<void> {
    const id = String(entity.id);
    const existing = await this.findById(id, context);
    if (!existing) throw new NotFoundError(`${this.resource.name} not found`);

    const sets: string[] = ['updatedAt = ?'];
    const values: unknown[] = [context.now().toISOString()];
    for (const field of this.resource.fields) {
      if (field.name in entity) {
        sets.push(`${field.name} = ?`);
        values.push(serialize(field, entity[field.name]));
      }
    }
    this.assertRelations(entity, context);
    values.push(id);
    /* v8 ignore start -- all registry tables include clinicId today; false branch is defensive for future schemas. */
    const clinicWhere = this.hasClinicColumn() ? tenantAnd(context.clinicId) : '';
    if (this.hasClinicColumn()) values.push(...tenantParams(context.clinicId));
    /* v8 ignore stop */
    try {
      this.db.prepare(`UPDATE ${this.resource.table} SET ${sets.join(', ')} WHERE id = ?${clinicWhere}`).run(...values);
    } catch (error) {
      if (isUniqueConstraintError(error)) throw new ConflictError(`${this.resource.name} violates a unique field constraint`);
      throw error;
    }
    if (this.resource.searchIndexResource) upsertSearchRow(this.db, this.resource.searchIndexResource, id);
    if (this.resource.name === 'patients') refreshPatientChildSearchRows(this.db, id);
    if (this.emitSyncChange && context.clinicId) {
      recordSyncChange(this.db, { tableName: this.resource.table, recordId: id, operation: 'UPDATE', clinicId: context.clinicId });
    }
  }

  async softDelete(id: string, context: AppContext): Promise<void> {
    if (this.resource.capabilities.softDelete) {
      const now = context.now().toISOString();
      /* v8 ignore start -- all registry tables include clinicId today; false branch is defensive for future schemas. */
      const params = [now, now, id, ...(this.hasClinicColumn() ? tenantParams(context.clinicId) : [])];
      const clinicWhere = this.hasClinicColumn() ? tenantAnd(context.clinicId) : '';
      /* v8 ignore stop */
      this.db.prepare(`UPDATE ${this.resource.table} SET deletedAt = ?, updatedAt = ? WHERE id = ?${clinicWhere}`).run(...params);
    } else {
      /* v8 ignore start -- all registry tables include clinicId today; false branch is defensive for future schemas. */
      const params = [id, ...(this.hasClinicColumn() ? tenantParams(context.clinicId) : [])];
      const clinicWhere = this.hasClinicColumn() ? tenantAnd(context.clinicId) : '';
      /* v8 ignore stop */
      this.db.prepare(`DELETE FROM ${this.resource.table} WHERE id = ?${clinicWhere}`).run(...params);
    }
    if (this.resource.searchIndexResource) removeSearchRow(this.db, this.resource.searchIndexResource, id);
    if (this.emitSyncChange && context.clinicId) {
      recordSyncChange(this.db, { tableName: this.resource.table, recordId: id, operation: 'DELETE', clinicId: context.clinicId });
    }
    if (this.resource.name === 'patients') {
      // 患者删除后其子记录（Appointment/Charge/FollowUp）索引行不再有意义，逐个清理。
      // 子表可能缺 patientId 列（精简/异构 schema），按实际列结构跳过。
      for (const childTable of ['Appointment', 'Charge', 'FollowUp']) {
        if (!this.tableHasColumn(childTable, 'patientId')) continue;
        const childRows = this.db.prepare(`SELECT id FROM ${childTable} WHERE patientId = ?`).all(id) as Array<{ id: string }>;
        for (const child of childRows) removeSearchRow(this.db, childTable, String(child.id));
      }
    }
  }

  private field(name: string): ResourceField | undefined {
    return this.resource.fields.find((field) => field.name === name);
  }

  private hasClinicColumn(): boolean {
    return this.columns.has('clinicId');
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
      const params = [String(entity[field.name]), ...tenantParams(context.clinicId)];
      const row = this.db.prepare(
        `SELECT id FROM ${target.table} WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
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
    result.deletedAt = row.deletedAt ?? null;
    return maskSensitiveFields(result);
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  const code = error instanceof Error ? String((error as { code?: unknown }).code ?? '') : '';
  const message = error instanceof Error ? error.message : '';
  return code.includes('UNIQUE') || message.includes('UNIQUE constraint failed');
}
