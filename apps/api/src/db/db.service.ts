import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { Database, Statement } from 'better-sqlite3';
import { db, initDb, seedDb, createDbConnection, cancelAutoBackup, resetTestMode } from './database';
import { setLegacyEncryptionKey, migrateEncryptedData } from '../common/utils/encryption';

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
export class DbService implements OnModuleInit, OnModuleDestroy {
  private database!: Database;
  private walCheckpointTimer: NodeJS.Timeout | null = null;
  private readonly logger = new Logger('DbService');

  onModuleInit() {
    resetTestMode();
    if (!db) {
      createDbConnection();
    }
    this.database = db;
    initDb();
    seedDb();

    if (process.env.LEGACY_ENCRYPTION_KEY) {
      setLegacyEncryptionKey(process.env.LEGACY_ENCRYPTION_KEY);
      const result = migrateEncryptedData(this);
      if (result.migrated > 0 || result.errors > 0) {
        this.logger.log(`加密数据迁移完成: ${result.migrated} 条已重新加密, ${result.errors || 0} 条出错`);
      }
    }

    this.walCheckpointTimer = setInterval(() => {
      try {
        this.database.pragma('wal_checkpoint(TRUNCATE)');
      } catch (err) {
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
        this.database.pragma('wal_checkpoint(TRUNCATE)');
        this.database.close();
      }
    } catch (err) {
      this.logger.warn('关闭数据库连接时出错', err instanceof Error ? err : undefined);
    }
  }

  prepare(sql: string): Statement {
    return this.database.prepare(sql);
  }

  exec(sql: string): void {
    this.database.exec(sql);
  }

  transaction<T>(fn: (db: Database) => T): T {
    const txFn = this.database.transaction(fn);
    const result = txFn(this.database);
    return result;
  }

  checkpoint(mode: 'PASSIVE' | 'FULL' | 'RESTART' | 'TRUNCATE' = 'TRUNCATE'): void {
    try {
      this.database.pragma(`wal_checkpoint(${mode})`);
    } catch (err) {
      this.logger.error('WAL checkpoint 失败', err instanceof Error ? err : undefined);
    }
  }

  get db(): Database {
    return this.database;
  }

  rebuildConnection(): void {
    if (this.walCheckpointTimer) {
      clearInterval(this.walCheckpointTimer);
      this.walCheckpointTimer = null;
    }
    try {
      this.database?.close();
    } catch {
      // 忽略关闭失败
    }
    this.database = createDbConnection();
    initDb();
    this.walCheckpointTimer = setInterval(() => {
      try {
        this.database.pragma('wal_checkpoint(TRUNCATE)');
      } catch (err) {
        this.logger.error('WAL checkpoint 失败', err instanceof Error ? err : undefined);
      }
    }, 60 * 1000);
    this.walCheckpointTimer.unref();
    this.logger.log('数据库连接已重建');
  }
}
