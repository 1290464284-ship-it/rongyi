import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import Database, { Database as DatabaseType } from 'better-sqlite3';
import { IDatabase, IStatement } from './db.interface';
import {
  initDb,
  seedDb,
  createDbConnection,
  cancelAutoBackup,
  resetTestMode,
  shutdownEncryptedDb,
  persistEncryptedDb,
  initEncryptedDbWrapper,
  getEncryptedDbLifecycle,
} from './database';
import { SettingsService } from '../modules/system/settings/settings.service';

const MAX_STATEMENT_CACHE_SIZE = 100;
const STATEMENT_EVICT_BATCH_SIZE = 10;
const SLOW_QUERY_THRESHOLD_MS = 100;

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

/**
 * 关于应用层 BUSY 重试的移除说明：
 *
 * 旧实现使用 sleepSync() + Atomics.wait 在 Node 主线程上阻塞重试 SQLITE_BUSY，
 * 由于 better-sqlite3 是同步驱动，每次重试的 sleepSync 都会卡死整个事件循环，
 * 等于让所有 HTTP 请求为单次写冲突陪葬 10/20/40/80ms…。
 *
 * 实际上 database.ts 的 applyPragmas() 已设置 `busy_timeout = 5000`（毫秒），
 * better-sqlite3 在内部遇到 SQLITE_BUSY 时会自动 sleep+retry，由 SQLite 自旋，
 * 不会上抛 SQLITE_BUSY 给应用层。跨进程并发（Electron 多窗口）也由它兜底。
 *
 * 因此应用层只需直接调用 rawStmt.run/all/get 即可，无需也禁止再做阻塞重试。
 */

@Injectable()
export class DbService implements OnModuleInit, OnModuleDestroy, IDatabase {
  private database!: DatabaseType;
  private walCheckpointTimer: NodeJS.Timeout | null = null;
  private readonly logger = new Logger(DbService.name);
  private statementCache = new Map<string, IStatement>();
  private encryptedDbInitialized = false;

  // 评估结论：保留可选注入（?）。
  // 虽然 NestJS DI 在生产环境会强制注入 SettingsService，但测试代码大量使用 `new DbService()`
  // 手动实例化（绕过 DI），强制注入会破坏所有单测。可选注入 + onModuleInit 内的运行时兜底
  // 兼顾两者：生产由 DI 注入，测试手动 new 时 settingsProvider 走 `{}` fallback。
  constructor(
    private readonly settingsService?: SettingsService,
  ) {}

  async onModuleInit() {
    resetTestMode();

    const settingsProvider = this.settingsService
      ? async () => {
          try {
            return await this.settingsService!.getClinicInfo();
          } catch {
            return {};
          }
        }
      : undefined;
    try {
      await initEncryptedDbWrapper(settingsProvider);
      this.encryptedDbInitialized = getEncryptedDbLifecycle().enabled;
      if (this.encryptedDbInitialized) {
        this.logger.log('数据库加密模式已启用，运行于临时明文路径');
      }
    } catch (err: unknown) {
      this.logger.error(
        '初始化加密数据库失败: ' + (err instanceof Error ? err.message : String(err)),
      );
      throw err;
    }

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

  async onModuleDestroy() {
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
    try {
      await persistEncryptedDb();
    } catch (persistErr: unknown) {
      this.logger.warn(
        '持久化加密数据库失败: ' + (persistErr instanceof Error ? persistErr.message : String(persistErr)),
      );
    }
    try {
      await shutdownEncryptedDb();
    } catch (shutdownErr: unknown) {
      this.logger.warn(
        '关闭加密数据库失败: ' + (shutdownErr instanceof Error ? shutdownErr.message : String(shutdownErr)),
      );
    }
  }

  async onApplicationShutdown() {
    try {
      await persistEncryptedDb();
    } catch (persistErr: unknown) {
      this.logger.warn(
        'Shutdown 阶段持久化加密数据库失败: ' + (persistErr instanceof Error ? persistErr.message : String(persistErr)),
      );
    }
    try {
      await shutdownEncryptedDb();
    } catch (shutdownErr: unknown) {
      this.logger.warn(
        'Shutdown 阶段关闭加密数据库失败: ' + (shutdownErr instanceof Error ? shutdownErr.message : String(shutdownErr)),
      );
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
    // better-sqlite3 内部已通过 busy_timeout pragma 处理 SQLITE_BUSY 重试，
    // 这里直接透传，避免应用层 sleepSync 阻塞 Node 主线程。
    const stmt: IStatement = {
      get: (...params: unknown[]) => rawStmt.get(...params),
      all: (...params: unknown[]) => rawStmt.all(...params),
      run: (...params: unknown[]) => rawStmt.run(...params),
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
      this.statementCache.delete(result.value);
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
      this.database.exec(sql);
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
      return this.database.pragma(sql);
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
    // BUSY 重试交给底层 busy_timeout pragma（5s）+ SQLite 自旋，应用层不再阻塞事件循环
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
    return executeTransaction();
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
