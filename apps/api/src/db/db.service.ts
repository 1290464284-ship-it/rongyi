import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import Database, { Database as DatabaseType } from 'better-sqlite3';
import { IDatabase, IStatement } from './db.interface';
import { initDb, seedDb, createDbConnection, cancelAutoBackup, resetTestMode } from './database';

const MAX_STATEMENT_CACHE_SIZE = 100;
const STATEMENT_EVICT_BATCH_SIZE = 10;
const SLOW_QUERY_THRESHOLD_MS = 100;

const DB_BUSY_MAX_RETRIES = 5;
const DB_BUSY_INITIAL_DELAY_MS = 10;

const BUSY_ERROR_PATTERNS = [
  'SQLITE_BUSY',
  'database is locked',
  'SQLITE_LOCKED',
  'database table is locked',
];

function isBusyError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message;
  return BUSY_ERROR_PATTERNS.some(pattern => msg.includes(pattern));
}

function sleepSync(ms: number): void {
  const sab = new SharedArrayBuffer(4);
  const ia = new Int32Array(sab);
  Atomics.wait(ia, 0, 0, ms);
}

function withRetrySync<T>(fn: () => T, maxRetries: number = DB_BUSY_MAX_RETRIES, initialDelayMs: number = DB_BUSY_INITIAL_DELAY_MS): T {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return fn();
    } catch (err: unknown) {
      lastError = err;
      if (attempt < maxRetries && isBusyError(err)) {
        const delayMs = initialDelayMs * Math.pow(2, attempt);
        sleepSync(delayMs);
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

/**
 * P2 修复（WriteQueue 写操作串行化机制已定义但从未使用）：
 *
 * 已移除 WriteQueue 类与 writeTransaction() 方法。理由：
 * 1. better-sqlite3 是同步驱动，所有 SQL 调用天然受 JS 事件循环串行化，
 *    同一进程内两个 transaction() 不可能并发执行，队列是冗余的。
 * 2. 跨进程并发（Electron 多窗口）由 SQLite 自身的 WAL + busy_timeout=5000
 *    处理，应用层队列也管不到别的进程。
 * 3. writeTransaction() 返回 Promise<T> 而 transaction() 返回 T，
 *    若强制迁移会破坏所有 13 个 service 的同步调用代码。
 *
 * 因此移除该死代码，保持 transaction() 为唯一事务入口，简化心智模型。
 */

@Injectable()
export class DbService implements OnModuleInit, OnModuleDestroy, IDatabase {
  private database!: DatabaseType;
  private walCheckpointTimer: NodeJS.Timeout | null = null;
  private readonly logger = new Logger(DbService.name);
  private statementCache = new Map<string, IStatement>();

  onModuleInit() {
    resetTestMode();
    this.database = createDbConnection();
    initDb(this.database);
    seedDb(this.database);

    this.walCheckpointTimer = setInterval(() => {
      try {
        this.database.pragma('wal_checkpoint(PASSIVE)');
      } catch (err: unknown) {
        this.logger.error('WAL checkpoint 失败', err instanceof Error ? err : undefined);
      }
    }, 60 * 1000);
    this.walCheckpointTimer.unref();
  }

  onModuleDestroy() {
    if (this.walCheckpointTimer) {
      clearInterval(this.walCheckpointTimer);
      this.walCheckpointTimer = null;
    }
    cancelAutoBackup();
    try {
      if (this.database) {
        this.database.pragma('wal_checkpoint(PASSIVE)');
        this.database.close();
      }
    } catch (err: unknown) {
      this.logger.warn('关闭数据库连接时出错', err instanceof Error ? err : undefined);
    }
  }

  prepare(sql: string): IStatement {
    const cached = this.statementCache.get(sql);
    if (cached) {
      this.statementCache.delete(sql);
      this.statementCache.set(sql, cached);
      return cached;
    }
    const rawStmt = this.database.prepare(sql);
    const stmt: IStatement = {
      get: (...params: unknown[]) => withRetrySync(() => rawStmt.get(...params)),
      all: (...params: unknown[]) => withRetrySync(() => rawStmt.all(...params)),
      run: (...params: unknown[]) => withRetrySync(() => rawStmt.run(...params)),
    };
    if (this.statementCache.size >= MAX_STATEMENT_CACHE_SIZE) {
      this.evictOldestStatements(STATEMENT_EVICT_BATCH_SIZE);
    }
    this.statementCache.set(sql, stmt);
    return stmt;
  }

  private evictOldestStatements(count: number): void {
    const keys = this.statementCache.keys();
    let removed = 0;
    while (removed < count) {
      const result = keys.next();
      if (result.done) break;
      this.statementCache.delete(result.value as string);
      removed++;
    }
  }

  clearStatementCache(): void {
    this.statementCache.clear();
  }

  /**
   * Execute a query and log if it exceeds SLOW_QUERY_THRESHOLD_MS.
   * Usage: const rows = this.dbService.timedQuery('SELECT ...', () => stmt.all(...params));
   */
  timedQuery<T>(sql: string, fn: () => T): T {
    const start = Date.now();
    const result = fn();
    const duration = Date.now() - start;
    if (duration > SLOW_QUERY_THRESHOLD_MS) {
      this.logger.warn(`Slow query (${duration}ms): ${sql.slice(0, 200)}`);
    }
    return result;
  }

  exec(sql: string): void {
    try {
      withRetrySync(() => this.database.exec(sql));
    } catch (err: unknown) {
      this.logger.error('exec() failed', err instanceof Error ? err : undefined);
      throw err;
    }
  }

  get name(): string {
    return this.database.name;
  }

  pragma(sql: string): unknown {
    try {
      return withRetrySync(() => this.database.pragma(sql));
    } catch (err: unknown) {
      this.logger.error('pragma() failed', err instanceof Error ? err : undefined);
      throw err;
    }
  }

  close(): void {
    try {
      this.database.close();
    } catch (err: unknown) {
      this.logger.error('close() failed', err instanceof Error ? err : undefined);
      throw err;
    }
  }

  async backup(destination: string): Promise<unknown> {
    try {
      return await this.database.backup(destination);
    } catch (err: unknown) {
      this.logger.error('备份数据库失败', err instanceof Error ? err : undefined);
      throw err;
    }
  }

  transaction<T>(fn: (db: IDatabase) => T): T {
    // 顶层事务使用 BEGIN IMMEDIATE 提升写隔离级别，避免延迟锁升级死锁
    // 嵌套调用（已在事务中）退回 better-sqlite3 原生 transaction，由其用 SAVEPOINT 处理
    if (this.database.inTransaction) {
      const txFn = this.database.transaction(fn);
      return txFn(this);
    }
    const executeTransaction = (): T => {
      this.database.exec('BEGIN IMMEDIATE');
      try {
        const result = fn(this.db);
        try {
          this.database.exec('COMMIT');
        } catch (commitErr) {
          try { this.database.exec('ROLLBACK'); } catch { /* best effort */ }
          throw commitErr;
        }
        return result;
      } catch (err) {
        try { this.database.exec('ROLLBACK'); } catch { /* best effort */ }
        throw err;
      }
    };
    return withRetrySync(executeTransaction);
  }

  /**
   * 打开一个只读数据库连接（用于备份文件校验等场景）。
   * 调用方需负责调用返回实例的 close()。
   */
  openReadonly(path: string): IDatabase {
    const conn = new Database(path, { readonly: true });
    return {
      name: conn.name,
      prepare: (sql: string) => conn.prepare(sql),
      exec: (sql: string) => { conn.exec(sql); },
      pragma: (sql: string) => conn.pragma(sql),
      close: () => conn.close(),
      backup: (destination: string) => conn.backup(destination),
      transaction: () => {
        throw new Error('只读连接不支持事务');
      },
    };
  }

  checkpoint(mode: 'PASSIVE' | 'FULL' | 'RESTART' | 'TRUNCATE' = 'TRUNCATE'): void {
    try {
      this.database.pragma(`wal_checkpoint(${mode})`);
    } catch (err: unknown) {
      this.logger.error('WAL checkpoint 失败', err instanceof Error ? err : undefined);
    }
  }

  get db(): IDatabase {
    // 返回 this 而非底层连接：DbService 本身实现 IDatabase（含 transaction），
    // 且 prepare 走语句缓存，底层仍是同一连接
    return this;
  }

  rebuildConnection(): void {
    if (this.walCheckpointTimer) {
      clearInterval(this.walCheckpointTimer);
      this.walCheckpointTimer = null;
    }
    try {
      this.database?.close();
    } catch (err: unknown) {
      this.logger.warn('关闭数据库连接失败:', err instanceof Error ? err.message : String(err));
    }
    this.statementCache.clear();
    this.database = createDbConnection();
    initDb(this.database);
    this.walCheckpointTimer = setInterval(() => {
      try {
        this.database.pragma('wal_checkpoint(PASSIVE)');
      } catch (err: unknown) {
        this.logger.error('WAL checkpoint 失败', err instanceof Error ? err : undefined);
      }
    }, 60 * 1000);
    this.walCheckpointTimer.unref();
    this.logger.log('数据库连接已重建');
  }
}
