/**
 * Mock implementation of DbService for unit testing.
 * Simulates better-sqlite3's synchronous API without requiring a real database.
 */
export class MockDbService {
  private tables: Map<string, Map<string, any>> = new Map();
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
    ];
    tableNames.forEach(name => this.tables.set(name, new Map()));
  }

  /**
   * Seed a table with test data
   */
  seed(table: string, rows: Record<string, any>[]): void {
    const tableData = this.tables.get(table) || new Map();
    rows.forEach(row => {
      const id = row.id || this.generateId(table);
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
  prepare(sql: string) {
    const self = this;
    return {
      get: function (...params: any[]) {
        return self.executeGet(sql, params);
      },
      all: function (...params: any[]) {
        return self.executeAll(sql, params);
      },
      run: function (...params: any[]) {
        return self.executeRun(sql, params);
      },
    };
  }

  /**
   * Execute arbitrary SQL (DDL, etc.)
   */
  exec(sql: string): void {
    // For unit tests, we typically don't need real DDL execution
  }

  /**
   * Transaction support
   */
  transaction<T>(fn: (db: MockDbService) => T): T {
    this.inTransaction = true;
    try {
      return fn(this);
    } finally {
      this.inTransaction = false;
    }
  }

  /**
   * Get all rows from a table
   */
  getTableData(table: string): any[] {
    const tableData = this.tables.get(table);
    if (!tableData) return [];
    return Array.from(tableData.values());
  }

  // --- Private helpers ---

  private executeGet(sql: string, params: any[]): any | undefined {
    const upperSql = sql.trim().toUpperCase();

    // SELECT by id
    if (upperSql.startsWith('SELECT') && upperSql.includes('WHERE') && upperSql.includes('ID = ?')) {
      const tableMatch = sql.match(/FROM\s+(\w+)/i);
      if (tableMatch) {
        const table = tableMatch[1];
        const id = params.find(p => typeof p === 'string' && p.length > 5) || params[0];
        return this.tables.get(table)?.get(id);
      }
    }

    // SELECT COUNT
    if (upperSql.startsWith('SELECT COUNT')) {
      const tableMatch = sql.match(/FROM\s+(\w+)/i);
      if (tableMatch) {
        const table = tableMatch[1];
        const tableData = this.tables.get(table);
        const count = tableData ? tableData.size : 0;
        return { count };
      }
    }

    // SELECT single column with WHERE
    if (upperSql.startsWith('SELECT') && !upperSql.includes('*')) {
      const columnMatch = sql.match(/SELECT\s+(\w+)/i);
      const tableMatch = sql.match(/FROM\s+(\w+)/i);
      const whereMatch = sql.match(/WHERE\s+(\w+)\s*=\s*\?/i);

      if (columnMatch && tableMatch) {
        const column = columnMatch[1];
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

  private executeAll(sql: string, params: any[]): any[] {
    const upperSql = sql.trim().toUpperCase();

    if (!upperSql.startsWith('SELECT')) {
      return [];
    }

    const tableMatch = sql.match(/FROM\s+(\w+)/i);
    if (!tableMatch) return [];

    const table = tableMatch[1];
    let rows = this.getTableData(table);

    // Handle WHERE clauses
    if (upperSql.includes('WHERE')) {
      // Simple equality: WHERE column = ?
      const simpleWhere = sql.match(/WHERE\s+(\w+)\s*=\s*\?/i);
      if (simpleWhere) {
        const column = simpleWhere[1];
        const value = params[0];
        rows = rows.filter(r => r[column] === value);
      }

      // WHERE deletedAt IS NULL
      if (upperSql.includes('DELETEDAT IS NULL')) {
        rows = rows.filter(r => !r.deletedAt);
      }

      // WHERE id = ? AND other conditions
      const idWhere = sql.match(/WHERE\s+ID\s*=\s*\?/i);
      if (idWhere && params.length > 0) {
        const id = params.find(p => typeof p === 'string' && p.includes('-')) || params[params.length - 1];
        rows = rows.filter(r => r.id === id);
      }

      // WHERE chargeId = ?
      const chargeIdMatch = sql.match(/WHERE\s+CHARGEID\s*=\s*\?/i);
      if (chargeIdMatch) {
        const chargeId = params[0];
        rows = rows.filter(r => r.chargeId === chargeId);
      }
    }

    // ORDER BY
    if (upperSql.includes('ORDER BY')) {
      const orderMatch = sql.match(/ORDER BY\s+(\w+)(?:\s+(ASC|DESC))?/i);
      if (orderMatch) {
        const column = orderMatch[1];
        const direction = (orderMatch[2] || 'ASC').toUpperCase();
        rows.sort((a, b) => {
          const aVal = a[column];
          const bVal = b[column];
          if (aVal < bVal) return direction === 'ASC' ? -1 : 1;
          if (aVal > bVal) return direction === 'ASC' ? 1 : -1;
          return 0;
        });
      }
    }

    // LIMIT and OFFSET
    const limitMatch = sql.match(/LIMIT\s+(\d+)/i);
    const offsetMatch = sql.match(/OFFSET\s+(\d+)/i);
    if (limitMatch) {
      const limit = parseInt(limitMatch[1], 10);
      const offset = offsetMatch ? parseInt(offsetMatch[1], 10) : 0;
      rows = rows.slice(offset, offset + limit);
    }

    return rows;
  }

  private executeRun(sql: string, params: any[]): { changes: number; lastInsertRowid: string } {
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

  private handleInsert(sql: string, params: any[]): { changes: number; lastInsertRowid: string } {
    const tableMatch = sql.match(/INSERT\s+INTO\s+(\w+)/i);
    if (!tableMatch) return { changes: 0, lastInsertRowid: '' };

    const table = tableMatch[1];
    const tableData = this.tables.get(table) || new Map();

    // Parse column names from INSERT statement
    // Format: INSERT INTO Table (col1, col2, ...) VALUES (val1, val2, ...)
    const columnsMatch = sql.match(/\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i);

    let row: any = {};
    if (columnsMatch) {
      const columns = columnsMatch[1].split(',').map(c => c.trim());
      const valuesPart = columnsMatch[2];

      // Parse VALUES - mix of ? placeholders and literal values
      const values: any[] = [];
      const valueTokens = valuesPart.split(',').map(v => v.trim());

      let paramIdx = 0;
      for (const token of valueTokens) {
        if (token === '?') {
          values.push(params[paramIdx++]);
        } else {
          // Try to parse as number or use as string (removing quotes if present)
          const num = Number(token);
          if (!isNaN(num) && token !== '') {
            values.push(num);
          } else {
            // Remove quotes from string literals
            values.push(token.replace(/^['"]|['"]$/g, ''));
          }
        }
      }

      // Map values to columns
      columns.forEach((col, idx) => {
        if (idx < values.length) {
          row[col] = values[idx];
        }
      });
    }

    // Ensure id exists
    if (!row.id) {
      row.id = this.generateId(table);
    }

    tableData.set(row.id, row);
    this.tables.set(table, tableData);

    return { changes: 1, lastInsertRowid: row.id };
  }

  private handleUpdate(sql: string, params: any[]): { changes: number; lastInsertRowid: string } {
    const tableMatch = sql.match(/UPDATE\s+(\w+)/i);
    if (!tableMatch) return { changes: 0, lastInsertRowid: '' };

    const table = tableMatch[1];
    const tableData = this.tables.get(table);
    if (!tableData) return { changes: 0, lastInsertRowid: '' };

    // Simple UPDATE WHERE id = ?
    if (sql.match(/WHERE\s+ID\s*=\s*\?/i)) {
      const id = params[params.length - 1];
      const row = tableData.get(id);
      if (!row) return { changes: 0, lastInsertRowid: '' };

      // Parse SET clause
      const setMatch = sql.match(/SET\s+(.+?)\s+WHERE/i);
      if (setMatch) {
        const setClauses = setMatch[1].split(',').map(s => s.trim());
        let paramIdx = 0;

        for (const clause of setClauses) {
          // Handle: column = expression
          const colMatch = clause.match(/^(\w+)\s*=/);
          if (colMatch) {
            const col = colMatch[1];
            // Check if it's a simple ? or an expression
            if (clause.includes('?')) {
              row[col] = params[paramIdx++];
            } else if (clause.toUpperCase().includes('CASE WHEN')) {
              // Handle CASE WHEN expressions - evaluate them
              const result = this.evaluateCaseExpression(clause, row, params);
              row[col] = result;
              // Skip consumed params
            } else {
              // column = column + ? style
              const exprMatch = clause.match(/(\w+)\s*\+\s*\?/);
              if (exprMatch) {
                const sourceCol = exprMatch[1];
                row[col] = (row[sourceCol] || 0) + params[paramIdx++];
              }
            }
          }
        }

        row.updatedAt = new Date().toISOString();
        return { changes: 1, lastInsertRowid: '' };
      }
    }

    return { changes: 0, lastInsertRowid: '' };
  }

  private evaluateCaseExpression(clause: string, row: any, params: any[]): any {
    // Simplified CASE WHEN evaluation for common patterns:
    // CASE WHEN condition THEN value WHEN condition THEN value ELSE value END

    // Pattern: CASE WHEN paidAmount + ? >= totalAmount - 0.01 THEN 'PAID' ...
    const upperClause = clause.toUpperCase();

    if (upperClause.includes('PAIDAMOUNT') && upperClause.includes('TOTALAMOUNT')) {
      const paidAmount = row.paidAmount || 0;
      const totalAmount = row.totalAmount || 0;

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
      const paidAmount = row.paidAmount || 0;
      const totalAmount = row.totalAmount || 0;
      if (paidAmount >= totalAmount - 0.01) {
        return new Date().toISOString();
      }
      return row.paidAt || null;
    }

    // Default: return the row's current value
    return null;
  }

  private handleDelete(sql: string, params: any[]): { changes: number; lastInsertRowid: string } {
    const tableMatch = sql.match(/DELETE\s+FROM\s+(\w+)/i);
    if (!tableMatch) return { changes: 0, lastInsertRowid: '' };

    const table = tableMatch[1];
    const tableData = this.tables.get(table);
    if (!tableData) return { changes: 0, lastInsertRowid: '' };

    if (sql.match(/WHERE\s+ID\s*=\s*\?/i)) {
      const id = params[params.length - 1];
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