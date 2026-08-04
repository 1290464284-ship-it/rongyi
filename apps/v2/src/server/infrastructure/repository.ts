import type Database from 'better-sqlite3';
import { NotFoundError, ValidationError } from './errors';
import type {
  AppContext,
  IRepository,
  Page,
  RepositoryQuery,
  ResourceDefinition,
  ResourceField,
} from '../../domain/contracts';
import { maskSensitiveFields } from './security';

function serialize(field: ResourceField, value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (field.type === 'json') {
    return typeof value === 'string' ? value : JSON.stringify(value);
  }
  if (field.type === 'boolean') {
    return value ? 1 : 0;
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
  constructor(
    private readonly db: Database.Database,
    private readonly resource: ResourceDefinition,
  ) {}

  async findById(id: string, context: AppContext): Promise<Record<string, unknown> | null> {
    const rows = context.clinicId
      ? this.queryRows(
          `SELECT * FROM ${this.resource.table} WHERE id = ? AND clinicId = ? AND deletedAt IS NULL`,
          [id, context.clinicId],
        )
      : this.queryRows(
          `SELECT * FROM ${this.resource.table} WHERE id = ? AND deletedAt IS NULL`,
          [id],
        );
    if (rows.length === 0) return null;
    return this.mapRow(rows[0]);
  }

  async findMany(query: RepositoryQuery, context: AppContext): Promise<Page<Record<string, unknown>>> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 20));
    const where: string[] = ['deletedAt IS NULL'];
    const params: unknown[] = [];

    if (this.hasClinicColumn() && context.clinicId) {
      where.push('clinicId = ?');
      params.push(context.clinicId);
    }

    for (const [key, value] of Object.entries(query.filters ?? {})) {
      const field = this.field(key);
      if (!field) throw new ValidationError(`Unknown filter field: ${key}`);
      where.push(`${key} = ?`);
      params.push(serialize(field, value));
    }

    if (query.search && (this.resource.searchableFields?.length ?? 0) > 0) {
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
      }
    }

    const placeholders = columns.map(() => '?').join(', ');
    this.db.prepare(`INSERT INTO ${this.resource.table} (${columns.join(', ')}) VALUES (${placeholders})`).run(...values);
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
    values.push(id);
    const clinicWhere = context.clinicId ? ' AND clinicId = ?' : '';
    if (context.clinicId) values.push(context.clinicId);
    this.db.prepare(`UPDATE ${this.resource.table} SET ${sets.join(', ')} WHERE id = ?${clinicWhere}`).run(...values);
  }

  async softDelete(id: string, context: AppContext): Promise<void> {
    const now = context.now().toISOString();
    if (this.resource.capabilities.softDelete) {
      const params = context.clinicId ? [now, now, id, context.clinicId] : [now, now, id];
      const clinicWhere = context.clinicId ? ' AND clinicId = ?' : '';
      this.db.prepare(`UPDATE ${this.resource.table} SET deletedAt = ?, updatedAt = ? WHERE id = ?${clinicWhere}`).run(...params);
      return;
    }
    if (context.clinicId) {
      this.db.prepare(`DELETE FROM ${this.resource.table} WHERE id = ? AND clinicId = ?`).run(id, context.clinicId);
    } else {
      this.db.prepare(`DELETE FROM ${this.resource.table} WHERE id = ?`).run(id);
    }
  }

  private field(name: string): ResourceField | undefined {
    return this.resource.fields.find((field) => field.name === name);
  }

  private hasClinicColumn(): boolean {
    return true;
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
