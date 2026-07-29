import { Logger } from '@nestjs/common';
import { Database } from 'better-sqlite3';

const TABLE_NAME_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const COLUMN_NAME_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
export const logger = new Logger('Migration');

let migrationDb: Database | null = null;

export function setMigrationDb(db: Database): void {
  migrationDb = db;
}

export function getMigrationDb(): Database {
  if (!migrationDb) {
    throw new Error('Migration database not initialized');
  }
  return migrationDb;
}

function validateTableName(name: string): boolean {
  return TABLE_NAME_REGEX.test(name);
}

function validateColumnName(name: string): boolean {
  return COLUMN_NAME_REGEX.test(name);
}

export const columnExists = (table: string, column: string): boolean => {
  if (!validateTableName(table)) throw new Error(`Invalid table name: ${table}`);
  if (!validateColumnName(column)) throw new Error(`Invalid column name: ${column}`);
  const cols = getMigrationDb().prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return cols.some(c => c.name === column);
};

export const tableExists = (table: string): boolean => {
  if (!validateTableName(table)) throw new Error(`Invalid table name: ${table}`);
  const row = getMigrationDb().prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
  ).get(table) as { name: string } | undefined;
  return Boolean(row);
};

export const addColumnIfMissing = (table: string, column: string, definition: string) => {
  if (!columnExists(table, column)) {
    try {
      getMigrationDb().exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // P0 修复：原先所有错误都静默 warn 吞没，掩盖了表不存在、磁盘满等真实问题。
      // 仅容忍"duplicate column name"（列已存在，理论上 columnExists 已防住，但兼容并发场景）
      if (/duplicate column name/i.test(msg)) {
        logger.warn(`列已存在，跳过: ${table}.${column}`);
        return;
      }
      logger.error(`添加列失败 ${table}.${column}: ${msg}`);
      throw err;
    }
  }
};

export const createIndexIfNotExists = (name: string, table: string, columns: string) => {
  try {
    getMigrationDb().exec(`CREATE INDEX IF NOT EXISTS ${name} ON ${table}(${columns})`);
  } catch (err: unknown) {
    // P0 修复：索引创建失败不能静默吞没，否则会导致查询性能退化或唯一性约束缺失
    // IF NOT EXISTS 已处理"已存在"情况，此处 catch 仅在真实失败时触发
    logger.error(`创建索引失败 ${name} ON ${table}(${columns}):`, (err as Error).message);
    throw err;
  }
};

export function ensureMigrationTable(): void {
  if (!tableExists('schema_migrations')) {
    getMigrationDb().exec(`
      CREATE TABLE schema_migrations (
        version TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        appliedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        durationMs INTEGER DEFAULT 0
      );
    `);
    return;
  }
  addColumnIfMissing('schema_migrations', 'name', 'TEXT');
  addColumnIfMissing('schema_migrations', 'appliedAt', 'TEXT DEFAULT CURRENT_TIMESTAMP');
  addColumnIfMissing('schema_migrations', 'durationMs', 'INTEGER DEFAULT 0');
}

export function isMigrationApplied(version: number): boolean {
  const row = getMigrationDb().prepare(
    'SELECT version FROM schema_migrations WHERE version = ?',
  ).get(version) as { version: number } | undefined;
  return Boolean(row);
}

export function recordMigration(version: number, name: string, durationMs: number): void {
  getMigrationDb().prepare(
    'INSERT OR IGNORE INTO schema_migrations (version, name, durationMs) VALUES (?, ?, ?)',
  ).run(version, name, durationMs);
}

export const setVersion = (version: number) => {
  getMigrationDb().pragma(`user_version = ${version}`);
};

export const rebuildTableWithNewCheck = (
  tableName: string,
  newTableSql: string,
  insertSql: string,
  indexes: Array<{ name: string; columns: string }> = [],
) => {
  const db = getMigrationDb();

  // P0 修复：检测上一次迁移失败留下的 _new 残留表
  // 若旧表已不存在但 _new 表存在，说明上次重建在 DROP-RENAME 之间中断
  const tempTableName = `${tableName}_new`;
  if (!tableExists(tableName)) {
    if (tableExists(tempTableName)) {
      throw new Error(
        `检测到迁移残留: 表 ${tableName} 不存在但 ${tempTableName} 存在。` +
        `这表明上一次表重建在 DROP 旧表后、RENAME 前中断。` +
        `请手动将 ${tempTableName} 重命名为 ${tableName} 后重启。`
      );
    }
    return;
  }

  // P0 修复：用事务包裹整个重建过程，保证原子性
  // SQLite 支持事务内执行 CREATE/DROP/ALTER/RENAME
  const rebuildTx = db.transaction(() => {
    db.exec(`DROP TABLE IF EXISTS ${tempTableName}`);
    db.exec(newTableSql);
    db.exec(insertSql);
    db.exec(`DROP TABLE ${tableName}`);
    db.exec(`ALTER TABLE ${tempTableName} RENAME TO ${tableName}`);
    indexes.forEach(idx => {
      createIndexIfNotExists(idx.name, tableName, idx.columns);
    });
  });
  rebuildTx();  // 任一步失败 → 整体回滚，旧表保持不变
};
