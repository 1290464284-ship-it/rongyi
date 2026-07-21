/**
 * SQL Builder for dynamic UPDATE statements.
 *
 * Provides a type-safe, reusable way to construct UPDATE queries
 * with automatic updatedAt timestamp and proper parameterization.
 */
export class UpdateBuilder {
  private updates: string[] = [];
  private params: unknown[] = [];
  private table: string;

  constructor(table: string) {
    this.table = table;
  }

  /**
   * Add a field to be updated if the condition is met.
   * @param field Database column name
   * @param value Value to set (will be parameterized)
   * @param condition Only set if true (default: true)
   */
  set(field: string, value: unknown, condition: boolean = true): this {
    if (condition && value !== undefined) {
      this.validateFieldName(field);
      this.updates.push(`${field} = ?`);
      this.params.push(value);
    }
    return this;
  }

  /**
   * Set a field to a literal expression (not parameterized).
   * Use with caution - only for known-safe SQL expressions.
   * @param field Database column name
   * @param expression SQL expression (e.g., 'CASE WHEN ...')
   */
  setExpression(field: string, expression: string): this {
    this.validateFieldName(field);
    this.updates.push(`${field} = ${expression}`);
    return this;
  }

  /**
   * Increment a numeric field by a value.
   * @param field Database column name
   * @param delta Amount to add (can be negative)
   * @param condition Only increment if true
   */
  increment(field: string, delta: number, condition: boolean = true): this {
    if (condition && delta !== 0) {
      this.validateFieldName(field);
      this.updates.push(`${field} = ${field} + ?`);
      this.params.push(delta);
    }
    return this;
  }

  /**
   * Set the updatedAt timestamp to current time.
   */
  setUpdatedAt(): this {
    this.updates.push('updatedAt = ?');
    this.params.push(new Date().toISOString());
    return this;
  }

  /**
   * Build the UPDATE statement for a given id.
   * @param id The primary key value
   * @returns Object with sql and params, or null if no updates
   */
  build(id: string): { sql: string; params: unknown[] } | null {
    if (this.updates.length === 0) {
      return null;
    }

    this.params.push(id);
    const sql = `UPDATE ${this.table} SET ${this.updates.join(', ')} WHERE id = ?`;
    return { sql, params: this.params };
  }

  /**
   * Build the UPDATE statement with custom WHERE clause.
   * @param whereClause Custom WHERE clause (without WHERE keyword)
   * @param whereParams Parameters for the WHERE clause
   * @returns Object with sql and params, or null if no updates
   */
  buildWithCustomWhere(whereClause: string, whereParams: unknown[]): { sql: string; params: unknown[] } | null {
    if (this.updates.length === 0) {
      return null;
    }

    const sql = `UPDATE ${this.table} SET ${this.updates.join(', ')} WHERE ${whereClause}`;
    return { sql, params: [...this.params, ...whereParams] };
  }

  /**
   * Validate field name to prevent SQL injection.
   * Only allows alphanumeric and underscore characters.
   */
  private validateFieldName(field: string): void {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(field)) {
      throw new Error(`Invalid field name: ${field}`);
    }
  }
}

/**
 * Create an UpdateBuilder for a table.
 * @param table Table name
 */
export function updateBuilder(table: string): UpdateBuilder {
  return new UpdateBuilder(table);
}

/**
 * Build a simple UPDATE with automatic updatedAt.
 * Convenience function for common single-field updates.
 */
export function buildUpdate(
  table: string,
  id: string,
  data: Record<string, unknown>
): { sql: string; params: unknown[] } | null {
  const builder = new UpdateBuilder(table);
  for (const [field, value] of Object.entries(data)) {
    builder.set(field, value);
  }
  builder.setUpdatedAt();
  return builder.build(id);
}