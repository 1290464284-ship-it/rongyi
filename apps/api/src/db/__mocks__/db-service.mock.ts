/**
 * Mock implementation of DbService for unit testing.
 * Simulates better-sqlite3's synchronous API without requiring a real database.
 */
import { IDatabase, IStatement } from '../db.interface';
import { DbService } from '../db.service';

export type MockDbRow = Record<string, unknown>;

/**
 * 将 MockDbService 安全地转换为 DbService 类型，供测试中使用。
 * 消除测试文件中的 `db as any` 模式。
 */
export function asDbService(mock: MockDbService): DbService {
  return mock as unknown as DbService;
}

export class MockDbService implements IDatabase {
  readonly name = ':memory:';
  private tables: Map<string, Map<string, MockDbRow>> = new Map();
  private autoIncrement: Map<string, number> = new Map();
  private inTransaction = false;

  constructor() {
    // Initialize common tables with empty maps
    const tableNames = [
      'Clinic', 'User', 'Patient', 'Charge', 'ChargeItem', 'DebtRecord', 'DebtPayment',
      'Refund', 'MemberCard', 'MemberCardLog', 'MemberPointLog', 'InventoryItem',
      'InventoryTransaction', 'Prescription', 'PrescriptionItem', 'Appointment',
      'Registration', 'MedicalRecord', 'TreatmentPlan', 'TreatmentPlanItem',
      'Treatment', 'TreatmentCatalog', 'ProcessingOrder', 'PurchaseOrder',
      'Supplier', 'IdempotencyRecord', 'UsedRefreshToken', 'OperationLog',
      'Setting', 'FirstExam', 'FirstExamTooth', 'FirstExamFollowUp',
      'FirstExamTrack', 'FollowUpTemplate', 'FollowUpTemplateItem',
      'AutoFollowUpRule', 'FollowUpStatsCache', 'FollowUpAssignment',
      'ProcessingOrderTemplate', 'ProcessingOrderTemplateItem', 'WechatMessage',
      'Imaging', 'ToothRecord', 'Visit', 'Equipment', 'schema_migrations',
      'ChargeCombo', 'PaymentMethod', 'DebtPaymentRecord',
      'ProcessingOrderItem', 'ProcessingFlowLog', 'ProcessingProduct', 'ProcessingFactory',
    ];
    tableNames.forEach(name => this.tables.set(name, new Map()));
  }

  /**
   * Seed a table with test data
   */
  seed(table: string, rows: MockDbRow[]): void {
    const tableData = this.tables.get(table) || new Map<string, MockDbRow>();
    rows.forEach(row => {
      const id = (row.id as string | undefined) || this.generateId(table);
      tableData.set(id, { ...row, id });
    });
    this.tables.set(table, tableData);
  }

  /**
   * Clear all tables
   */
  clear(): void {
    this.tables.forEach(table => table.clear());
    this.autoIncrement.clear();
  }

  /**
   * Simulate prepare().get()
   */
  prepare(sql: string): IStatement {
    const self = this;
    return {
      get (...params: unknown[]) {
        return self.executeGet(sql, params);
      },
      all (...params: unknown[]) {
        return self.executeAll(sql, params);
      },
      run (...params: unknown[]) {
        return self.executeRun(sql, params);
      },
    };
  }

  /**
   * Execute arbitrary SQL (DDL, etc.)
   */
  exec(_sql: string): void {
    // For unit tests, we typically don't need real DDL execution
  }

  /**
   * Transaction support
   */
  transaction<T>(fn: (db: IDatabase) => T): T {
    this.inTransaction = true;
    try {
      return fn(this);
    } finally {
      this.inTransaction = false;
    }
  }

  pragma(_sql: string): unknown {
    return undefined;
  }

  close(): void {
    // mock 不持有真实连接
  }

  async backup(_destination: string): Promise<unknown> {
    return undefined;
  }

  /**
   * Get all rows from a table
   */
  getTableData(table: string): MockDbRow[] {
    const tableData = this.tables.get(table);
    if (!tableData) return [];
    return Array.from(tableData.values());
  }

  // --- Private helpers ---

  private executeGet(sql: string, params: unknown[]): unknown {
    const upperSql = sql.trim().toUpperCase();

    // SELECT by id（注意：必须精确匹配 WHERE id = ?，避免 clinicId = ? 等也被命中）
    if (upperSql.startsWith('SELECT') && /WHERE\s+ID\s*=\s*\?/i.test(sql)) {
      const tableMatch = sql.match(/FROM\s+(\w+)/i);
      if (tableMatch) {
        const table = tableMatch[1];
        // Find the param position for id = ? by scanning WHERE conditions left-to-right
        const whereStart = sql.toUpperCase().indexOf('WHERE');
        const whereClause = sql.substring(whereStart + 5);
        const conditions = whereClause.toUpperCase().split(' AND ');
        let paramIdx = 0;
        let idValue: string | undefined;
        for (const cond of conditions) {
          const trimmed = cond.trim();
          if (trimmed === 'ID = ?') {
            idValue = params[paramIdx] as string;
            break;
          }
          // Count ? in this condition to advance param index
          const qmarks = (trimmed.match(/\?/g) || []).length;
          paramIdx += qmarks;
        }
        if (idValue) {
          return this.tables.get(table)?.get(idValue);
        }
      }
    }

    // SELECT COUNT（同时返回 total 和 count 字段，兼容 as total / as count 两种别名）
    if (upperSql.startsWith('SELECT COUNT')) {
      const tableMatch = sql.match(/FROM\s+(\w+)/i);
      if (tableMatch) {
        const table = tableMatch[1];
        const tableData = this.tables.get(table);
        if (!tableData) return { total: 0, count: 0 };

        if (upperSql.includes('WHERE')) {
          const allRows = this.executeAll(sql, params);
          return { total: allRows.length, count: allRows.length };
        }

        return { total: tableData.size, count: tableData.size };
      }
    }

    // SELECT single column with WHERE
    // Only match if SELECT has exactly one column (no commas)
    const singleColumnMatch = sql.match(/SELECT\s+(\w+)\s+FROM/i);
    if (upperSql.startsWith('SELECT') && singleColumnMatch) {
      const column = singleColumnMatch[1];
      const tableMatch = sql.match(/FROM\s+(\w+)/i);
      const whereMatch = sql.match(/WHERE\s+(\w+)\s*=\s*\?/i);

      if (tableMatch) {
        const table = tableMatch[1];
        const whereColumn = whereMatch?.[1];
        const whereValue = params[0];

        const tableData = this.tables.get(table);
        if (tableData) {
          for (const row of tableData.values()) {
            if (whereColumn && row[whereColumn] === whereValue) {
              return { [column]: row[column] };
            }
          }
        }
      }
    }

    // Generic SELECT - return first row
    const results = this.executeAll(sql, params);
    return results[0];
  }

  private executeAll(sql: string, params: unknown[]): MockDbRow[] {
    const upperSql = sql.trim().toUpperCase();

    if (!upperSql.startsWith('SELECT')) {
      return [];
    }

    const tableMatch = sql.match(/FROM\s+(\w+)/i);
    if (!tableMatch) return [];

    const table = tableMatch[1];
    let rows = this.getTableData(table);

    // Handle WHERE clauses with sequential parameter matching
    if (upperSql.includes('WHERE')) {
      rows = this.applyWhereFilters(sql, params, rows);
    }

    // ORDER BY
    if (upperSql.includes('ORDER BY')) {
      const orderMatch = sql.match(/ORDER BY\s+(\w+)(?:\s+(ASC|DESC))?/i);
      if (orderMatch) {
        const column = orderMatch[1];
        const direction = (orderMatch[2] || 'ASC').toUpperCase();
        rows.sort((a, b) => {
          const aVal = a[column] as string | number;
          const bVal = b[column] as string | number;
          if (aVal < bVal) return direction === 'ASC' ? -1 : 1;
          if (aVal > bVal) return direction === 'ASC' ? 1 : -1;
          return 0;
        });
      }
    }

    // LIMIT and OFFSET — 支持字面量 (LIMIT 10) 和参数化占位符 (LIMIT ? OFFSET ?)
    const limitMatch = sql.match(/LIMIT\s+(\?|\d+)/i);
    const offsetMatch = sql.match(/OFFSET\s+(\?|\d+)/i);
    if (limitMatch) {
      let limit: number;
      let offset = 0;
      if (limitMatch[1] === '?') {
        // 参数化 LIMIT：统计 WHERE 子句中的 ? 数量以确定 LIMIT 参数在 params 中的位置
        const beforeLimit = sql.slice(0, Math.max(0, upperSql.indexOf('LIMIT')));
        const whereParamCount = (beforeLimit.match(/\?/g) || []).length;
        limit = Number(params[whereParamCount]) || 0;
        if (offsetMatch && offsetMatch[1] === '?') {
          offset = Number(params[whereParamCount + 1]) || 0;
        }
      } else {
        limit = parseInt(limitMatch[1], 10);
        offset = offsetMatch ? parseInt(offsetMatch[1], 10) : 0;
      }
      rows = rows.slice(offset, offset + limit);
    }

    return rows;
  }

  private applyWhereFilters(sql: string, params: unknown[], rows: MockDbRow[]): MockDbRow[] {
    const whereStart = sql.toUpperCase().indexOf('WHERE');
    if (whereStart === -1) return rows;

    const whereContentStart = whereStart + 5;
    const orderPos = sql.toUpperCase().indexOf(' ORDER ', whereContentStart);
    const limitPos = sql.toUpperCase().indexOf(' LIMIT ', whereContentStart);
    const offsetPos = sql.toUpperCase().indexOf(' OFFSET ', whereContentStart);

    let whereEnd = sql.length;
    if (orderPos !== -1) whereEnd = Math.min(whereEnd, orderPos);
    if (limitPos !== -1) whereEnd = Math.min(whereEnd, limitPos);
    if (offsetPos !== -1) whereEnd = Math.min(whereEnd, offsetPos);

    const whereClause = sql.substring(whereContentStart, whereEnd).trim();
    const conditions = this.splitWhereConditions(whereClause);
    let paramIndex = 0;

    for (const condition of conditions) {
      const trimmed = condition.trim();
      if (!trimmed) continue;

      // column = ?
      const eqMatch = trimmed.match(/^(\w+)\s*=\s*\?$/i);
      if (eqMatch) {
        const column = eqMatch[1];
        if (paramIndex < params.length) {
          const value = params[paramIndex++];
          rows = rows.filter(r => r[column] === value);
        }
        continue;
      }

      // column IS NULL
      const isNullMatch = trimmed.match(/^(\w+)\s+IS\s+NULL$/i);
      if (isNullMatch) {
        const column = isNullMatch[1];
        rows = rows.filter(r => r[column] === null || r[column] === undefined);
        continue;
      }

      // column IS NOT NULL
      const isNotNullMatch = trimmed.match(/^(\w+)\s+IS\s+NOT\s+NULL$/i);
      if (isNotNullMatch) {
        const column = isNotNullMatch[1];
        rows = rows.filter(r => r[column] !== null && r[column] !== undefined);
        continue;
      }

      // column LIKE ? ESCAPE '\'
      const likeMatch = trimmed.match(/^(\w+)\s+LIKE\s+\?\s+ESCAPE\s+'\\'$/i);
      if (likeMatch) {
        const column = likeMatch[1];
        if (paramIndex < params.length) {
          const pattern = params[paramIndex++] as string;
          rows = rows.filter(r => this.likeMatch(String(r[column] ?? ''), pattern));
        }
        continue;
      }

      // column IN (?, ?, ...) 或 column IN ('A', 'B', ...) — 支持参数化占位符和字面量
      const inMatch = trimmed.match(/^(\w+)\s+IN\s*\(([^)]+)\)$/i);
      if (inMatch) {
        const column = inMatch[1];
        const parts = inMatch[2].split(',').map(p => p.trim()).filter(Boolean);
        const values: unknown[] = [];
        for (const part of parts) {
          if (part === '?') {
            // 参数化占位符：从参数列表中取值
            if (paramIndex < params.length) {
              values.push(params[paramIndex++]);
            }
          } else {
            // 字面量值：去除引号并解析为数字或字符串
            const literal = part.replace(/^['"]|['"]$/g, '');
            const num = Number(literal);
            values.push(!isNaN(num) && literal !== '' ? num : literal);
          }
        }
        rows = rows.filter(r => values.includes(r[column]));
        continue;
      }

      // column != ? / column <> ?
      const neqMatch = trimmed.match(/^(\w+)\s*(?:!=|<>)\s*\?$/i);
      if (neqMatch) {
        const column = neqMatch[1];
        if (paramIndex < params.length) {
          const value = params[paramIndex++];
          rows = rows.filter(r => r[column] !== value);
        }
        continue;
      }

      // column > ?
      const gtMatch = trimmed.match(/^(\w+)\s*>\s*\?$/);
      if (gtMatch) {
        const column = gtMatch[1];
        if (paramIndex < params.length) {
          const value = params[paramIndex++];
          rows = rows.filter(r => {
            const colVal = r[column];
            if (colVal === null || colVal === undefined) return false;
            return (colVal as number | string) > (value as number | string);
          });
        }
        continue;
      }

      // column < ?
      const ltMatch = trimmed.match(/^(\w+)\s*<\s*\?$/);
      if (ltMatch) {
        const column = ltMatch[1];
        if (paramIndex < params.length) {
          const value = params[paramIndex++];
          rows = rows.filter(r => {
            const colVal = r[column];
            if (colVal === null || colVal === undefined) return false;
            return (colVal as number | string) < (value as number | string);
          });
        }
        continue;
      }

      // column >= ?
      const gteMatch = trimmed.match(/^(\w+)\s*>=\s*\?$/);
      if (gteMatch) {
        const column = gteMatch[1];
        if (paramIndex < params.length) {
          const value = params[paramIndex++];
          rows = rows.filter(r => {
            const colVal = r[column];
            if (colVal === null || colVal === undefined) return false;
            return (colVal as number | string) >= (value as number | string);
          });
        }
        continue;
      }

      // column <= ?
      const lteMatch = trimmed.match(/^(\w+)\s*<=\s*\?$/);
      if (lteMatch) {
        const column = lteMatch[1];
        if (paramIndex < params.length) {
          const value = params[paramIndex++];
          rows = rows.filter(r => {
            const colVal = r[column];
            if (colVal === null || colVal === undefined) return false;
            return (colVal as number | string) <= (value as number | string);
          });
        }
      }
    }

    return rows;
  }

  private splitWhereConditions(whereClause: string): string[] {
    const conditions: string[] = [];
    let depth = 0;
    let current = '';
    const upper = whereClause.toUpperCase();
    let i = 0;
    while (i < whereClause.length) {
      const char = whereClause[i];
      if (char === '(') depth++;
      else if (char === ')') depth--;

      if (depth === 0 && upper.slice(Math.max(0, i)).startsWith(' AND ')) {
        conditions.push(current);
        current = '';
        i += 5; // skip ' AND '
      } else {
        current += char;
        i++;
      }
    }
    conditions.push(current);
    return conditions.filter(Boolean);
  }

  private likeMatch(value: string, pattern: string): boolean {
    let regexStr = '^';
    for (const char of pattern) {
      if (char === '%') regexStr += '.*';
      else if (char === '_') regexStr += '.';
      else if (/[.*+?^${}()|[\]\\]/.test(char)) regexStr += '\\' + char;
      else regexStr += char;
    }
    regexStr += '$';
    const regex = new RegExp(regexStr, 'i');
    return regex.test(value);
  }

  private executeRun(sql: string, params: unknown[]): { changes: number; lastInsertRowid: string } {
    const upperSql = sql.trim().toUpperCase();

    // INSERT
    if (upperSql.startsWith('INSERT')) {
      return this.handleInsert(sql, params);
    }

    // UPDATE
    if (upperSql.startsWith('UPDATE')) {
      return this.handleUpdate(sql, params);
    }

    // DELETE
    if (upperSql.startsWith('DELETE')) {
      return this.handleDelete(sql, params);
    }

    return { changes: 0, lastInsertRowid: '' };
  }

  private handleInsert(sql: string, params: unknown[]): { changes: number; lastInsertRowid: string } {
    const tableMatch = sql.match(/INSERT\s+(?:OR\s+\w+\s+)?INTO\s+(\w+)/i);
    if (!tableMatch) return { changes: 0, lastInsertRowid: '' };

    const table = tableMatch[1];
    const tableData = this.tables.get(table) || new Map<string, MockDbRow>();

    const parenStart = sql.indexOf('(');
    const parenEnd = sql.indexOf(')', parenStart);
    if (parenStart === -1 || parenEnd === -1) return { changes: 0, lastInsertRowid: '' };
    const columns = sql.substring(parenStart + 1, parenEnd).split(',').map(c => c.trim());

    const valuesPart = sql.slice(Math.max(0, sql.toUpperCase().indexOf('VALUES') + 6)).trim();
    const rowGroups = this.splitValueGroups(valuesPart);

    let paramIdx = 0;
    let lastId = '';
    let inserted = 0;

    for (const group of rowGroups) {
      const valueTokens = group.split(',').map(v => v.trim());
      const values: unknown[] = [];

      for (const token of valueTokens) {
        if (token === '?') {
          values.push(params[paramIdx++]);
        } else {
          const num = Number(token);
          if (!isNaN(num) && token !== '') {
            values.push(num);
          } else {
            values.push(token.replace(/^['"]|['"]$/g, ''));
          }
        }
      }

      const row: MockDbRow = {};
      columns.forEach((col, idx) => {
        if (idx < values.length) {
          row[col] = values[idx];
        }
      });

      if (!row.id) {
        row.id = this.generateId(table);
      }

      // UsedRefreshToken.tokenHash 有 UNIQUE 约束，模拟重复插入冲突
      if (table === 'UsedRefreshToken') {
        const tokenHashValue = row.tokenHash as string | undefined;
        if (tokenHashValue) {
          for (const existing of tableData.values()) {
            if (existing.tokenHash === tokenHashValue) {
              throw new Error(`UNIQUE constraint failed: UsedRefreshToken.tokenHash`);
            }
          }
        }
      }

      tableData.set(String(row.id), row);
      lastId = String(row.id);
      inserted++;
    }

    this.tables.set(table, tableData);

    return { changes: inserted, lastInsertRowid: lastId };
  }

  private splitValueGroups(valuesPart: string): string[] {
    const groups: string[] = [];
    let depth = 0;
    let current = '';

    for (let i = 0; i < valuesPart.length; i++) {
      const char = valuesPart[i];
      if (char === '(') {
        if (depth > 0) current += char;
        depth++;
      } else if (char === ')') {
        depth--;
        if (depth === 0) {
          groups.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      } else if (depth > 0) {
        current += char;
      }
    }

    return groups.filter(Boolean);
  }

  private handleUpdate(sql: string, params: unknown[]): { changes: number; lastInsertRowid: string } {
    const tableMatch = sql.match(/UPDATE\s+(\w+)/i);
    if (!tableMatch) return { changes: 0, lastInsertRowid: '' };

    const table = tableMatch[1];
    const tableData = this.tables.get(table);
    if (!tableData) return { changes: 0, lastInsertRowid: '' };

    const wherePos = sql.toUpperCase().indexOf(' WHERE ');
    const setPos = sql.toUpperCase().indexOf('SET');
    if (setPos === -1) return { changes: 0, lastInsertRowid: '' };
    const setStart = setPos + 3;
    let setClause: string;
    if (wherePos !== -1) {
      setClause = sql.substring(setStart, wherePos).trim();
    } else {
      setClause = sql.slice(Math.max(0, setStart)).trim();
    }
    const setClauses = this.splitByCommaRespectingParens(setClause);

    // Count ? in SET clause
    let setParamCount = 0;
    for (const clause of setClauses) {
      setParamCount += (clause.match(/\?/g) || []).length;
    }

    // SET params come first, WHERE params come after
    const setParams = params.slice(0, setParamCount);
    const whereParams = params.slice(setParamCount);

    const upperSql = sql.trim().toUpperCase();
    const allRows = this.getTableData(table);
    const rowsToUpdate = upperSql.includes('WHERE')
      ? this.applyWhereFilters(sql, whereParams, allRows)
      : allRows;

    if (rowsToUpdate.length === 0) return { changes: 0, lastInsertRowid: '' };

    for (const row of rowsToUpdate) {
      let paramIdx = 0;
      let updatedAtExplicitlySet = false;

      for (const clause of setClauses) {
        const colMatch = clause.match(/^(\w+)\s*=/);
        if (colMatch) {
          const col = colMatch[1];
          if (col.toLowerCase() === 'updatedat') updatedAtExplicitlySet = true;

          // column = COALESCE(column, 0) + 1 style — 必须在 column + ? 之前检查
          if (clause.toUpperCase().includes('COALESCE') && clause.includes('+')) {
            const parenStart = clause.indexOf('(');
            const parenEnd = clause.indexOf(')', parenStart);
            const commaPos = clause.indexOf(',', parenStart);
            if (parenStart !== -1 && parenEnd !== -1 && commaPos !== -1) {
              const sourceCol = clause.substring(parenStart + 1, commaPos).trim();
              const defaultValStr = clause.substring(commaPos + 1, parenEnd).trim();
              const defaultVal = parseInt(defaultValStr, 10) || 0;
              const plusPos = clause.indexOf('+', parenEnd);
              if (plusPos !== -1) {
                const delta = parseInt(clause.slice(Math.max(0, plusPos + 1)).trim(), 10) || 0;
                const current = (row[sourceCol] as number | undefined) ?? defaultVal;
                row[col] = current + delta;
              }
            }
          } else if (/CASE\s+\w+\s+WHEN/i.test(clause)) {
            // Simple CASE: column = column [+/-] CASE <caseOnCol> WHEN ? THEN ? ... END
            const simpleCaseMatch = clause.match(/^(\w+)\s*=\s*(\w+)\s*([+-])\s*CASE\s+(\w+)\s+WHEN/i);
            if (simpleCaseMatch) {
              const col = simpleCaseMatch[1];
              const sourceCol = simpleCaseMatch[2];
              const operator = simpleCaseMatch[3];
              const caseOnCol = simpleCaseMatch[4];
              const whenThenPairs = (clause.match(/WHEN\s*\?\s+THEN\s*\?/gi) || []).length;
              let delta = 0;
              for (let p = 0; p < whenThenPairs; p++) {
                const whenVal = setParams[paramIdx];
                const thenVal = setParams[paramIdx + 1] as number;
                paramIdx += 2;
                if (String(row[caseOnCol]) === String(whenVal)) {
                  delta = thenVal;
                }
              }
              const current = (row[sourceCol] as number | undefined) || 0;
              row[col] = operator === '+' ? current + delta : current - delta;
            }
          } else if (clause.toUpperCase().includes('CASE WHEN')) {
            const result = this.evaluateCaseExpression(clause, row);
            row[col] = result;
          } else {
            // column = column + <expr> style（算术累加）
            // 支持两种形式：column = column + ? （参数化）和 column = column + 1 （字面量）
            const plusIndex = clause.indexOf('+');
            if (plusIndex !== -1 && clause.includes('=')) {
              const eqIndex = clause.indexOf('=');
              const sourceExpr = clause.substring(eqIndex + 1, plusIndex).trim();
              const sourceCol = sourceExpr;
              const current = (row[sourceCol] as number | undefined) || 0;
              // 检查 + 后面是 ? 还是字面量数字
              const afterPlus = clause.slice(Math.max(0, plusIndex + 1)).trim();
              if (afterPlus === '?') {
                const delta = setParams[paramIdx] as number;
                row[col] = current + delta;
                paramIdx++;
              } else {
                // 字面量数字（如 loginAttempts + 1）
                const delta = parseInt(afterPlus, 10) || 0;
                row[col] = current + delta;
              }
            } else if (clause.includes('?')) {
              row[col] = setParams[paramIdx];
              paramIdx++;
            } else {
              // Simple constant value assignment: column = value
              // Extract the value after =
              const eqIndex = clause.indexOf('=');
              if (eqIndex !== -1) {
                const valueStr = clause.slice(Math.max(0, eqIndex + 1)).trim();
                if (valueStr.toUpperCase() === 'NULL') {
                  row[col] = null;
                } else {
                  const numVal = Number(valueStr);
                  if (!isNaN(numVal) && valueStr !== '') {
                    row[col] = numVal;
                  } else {
                    // String literal - remove quotes
                    row[col] = valueStr.replace(/^['"]|['"]$/g, '');
                  }
                }
              }
            }
          }
        }
      }

      if (!updatedAtExplicitlySet) {
        row.updatedAt = new Date().toISOString();
      }

      if (row.id) {
        tableData.set(row.id as string, row);
      }
    }

    return { changes: rowsToUpdate.length, lastInsertRowid: '' };
  }

  private splitByCommaRespectingParens(str: string): string[] {
    const result: string[] = [];
    let depth = 0;
    let current = '';

    for (let i = 0; i < str.length; i++) {
      const char = str[i];
      if (char === '(') depth++;
      else if (char === ')') depth--;

      if (char === ',' && depth === 0) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }

    if (current.trim()) {
      result.push(current.trim());
    }

    return result;
  }

  private evaluateCaseExpression(_clause: string, row: MockDbRow): unknown {
    // Simplified CASE WHEN evaluation for common patterns:
    // CASE WHEN condition THEN value WHEN condition THEN value ELSE value END

    // Pattern: CASE WHEN paidAmount + ? >= totalAmount - 0.01 THEN 'PAID' ...
    const upperClause = _clause.toUpperCase();

    if (upperClause.includes('PAIDAMOUNT') && upperClause.includes('TOTALAMOUNT')) {
      const paidAmount = (row.paidAmount as number | undefined) || 0;
      const totalAmount = (row.totalAmount as number | undefined) || 0;

      // Check if fully paid
      if (paidAmount >= totalAmount - 0.01) {
        return 'PAID';
      }
      // Check if partially paid
      if (paidAmount > 0) {
        return 'PARTIAL';
      }
      return 'UNPAID';
    }

    // Pattern: CASE WHEN paidAmount + ? >= totalAmount THEN ? ELSE ... END
    // For payAt field
    if (upperClause.includes('PAIDAT')) {
      const paidAmount = (row.paidAmount as number | undefined) || 0;
      const totalAmount = (row.totalAmount as number | undefined) || 0;
      if (paidAmount >= totalAmount - 0.01) {
        return new Date().toISOString();
      }
      return row.paidAt || null;
    }

    // Default: return the row's current value
    return null;
  }

  private handleDelete(sql: string, params: unknown[]): { changes: number; lastInsertRowid: string } {
    const tableMatch = sql.match(/DELETE\s+FROM\s+(\w+)/i);
    if (!tableMatch) return { changes: 0, lastInsertRowid: '' };

    const table = tableMatch[1];
    const tableData = this.tables.get(table);
    if (!tableData) return { changes: 0, lastInsertRowid: '' };

    if (sql.match(/WHERE\s+ID\s*=\s*\?/i)) {
      const id = params[params.length - 1] as string;
      if (tableData.delete(id)) {
        return { changes: 1, lastInsertRowid: '' };
      }
    }

    return { changes: 0, lastInsertRowid: '' };
  }

  private generateId(table: string): string {
    const counter = (this.autoIncrement.get(table) || 0) + 1;
    this.autoIncrement.set(table, counter);
    return `${table.toLowerCase()}-${counter.toString().padStart(3, '0')}`;
  }
}