import { join, dirname } from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import Database from 'better-sqlite3';
import {
  getDataDir,
  getDbPath,
  getEnvPath,
  migrateLegacyDatabaseIfNeeded,
} from './paths';
import { createSchema } from './schema';
import { runMigrations } from './migrations';
import { logger } from '../common/utils/log';

export { getDbPath, getEnvPath, getDataDir } from './paths';
export { seedDb } from './seeds';

const resourcesPath =
  (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath ||
  process.env.RESOURCES_PATH ||
  '';

const dbOptions: any = {
  verbose: process.env.NODE_ENV === 'development' ? (msg: any) => logger.debug(msg, 'SQLite') : undefined,
};

if (resourcesPath && (process.env.NODE_ENV === 'production' || process.env.ELECTRON_RUN_AS_NODE)) {
  const bindingFromEnv = process.env.BETTER_SQLITE3_BINDINGS_PATH;
  const bindingPath =
    bindingFromEnv ||
    join(resourcesPath, 'api', 'bundle', 'build', 'Release', 'better_sqlite3.node');
  dbOptions.nativeBinding = bindingPath;
}

export let db: any = null;

export let _isTestMode: boolean = false;
export function resetTestMode(): void {
  _isTestMode = false;
}

/** 手动设置测试模式（绕过环境变量） */
export function setTestMode(on: boolean): void {
  _isTestMode = on;
}

export function isTestMode(): boolean {
  if (_isTestMode) return true;
  _isTestMode = process.env.TEST_DB_MEMORY === '1';
  return _isTestMode;
}

/** 非忙等阻塞等待（避免自旋占满 CPU） */
function sleepSync(ms: number): void {
  try {
    const sab = new SharedArrayBuffer(4);
    const ia = new Int32Array(sab);
    Atomics.wait(ia, 0, 0, ms);
  } catch (err) {
    logger.warn('[DB] SharedArrayBuffer不可用，使用轮询等待:', (err as Error).message);
    const end = Date.now() + ms;
    while (Date.now() < end) {
      /* fallback */
    }
  }
}

export function createDbConnection(): any {
  if (isTestMode()) {
    const dbInstance = new Database(':memory:');
    dbInstance.pragma('journal_mode = WAL');
    db = dbInstance;
    return dbInstance;
  }

  migrateLegacyDatabaseIfNeeded();

  const maxRetries = 3;
  const retryDelayMs = 2000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const dbInstance = new Database(getDbPath(), dbOptions);
      dbInstance.pragma('encoding = "UTF-8"');
      dbInstance.pragma('journal_mode = WAL');
      dbInstance.pragma('busy_timeout = 5000');
      // P2 修复（synchronous = FULL 严重影响写入性能）：WAL 模式下 NORMAL 已足够安全，
      // 仅在崩溃时可能丢失最后几个事务（WAL 文件未 checkpoint 的部分），FULL 每次提交都 fsync 严重影响吞吐
      dbInstance.pragma('synchronous = NORMAL');
      dbInstance.pragma('cache_size = -20000');
      db = dbInstance;
      logger.info(`数据库连接成功 (第 ${attempt} 次尝试) path=${getDbPath()}`, 'DB');
      return dbInstance;
    } catch (err) {
      logger.error(`数据库连接失败 (第 ${attempt} 次尝试)`, 'DB', err as Error);
      try {
        const logPath = join(getDataDir(), 'db-connection.log');
        fs.writeFileSync(
          logPath,
          `[${new Date().toISOString()}] 数据库连接失败: ${(err as Error).message}\n`,
          { flag: 'a' },
        );
      } catch (logErr) {
        logger.error('[DB] 写入连接错误日志失败', 'DB', logErr as Error);
      }
      if (attempt < maxRetries) {
        logger.info(`等待 ${retryDelayMs}ms 重试...`, 'DB');
        sleepSync(retryDelayMs);
      }
    }
  }

  throw new Error('数据库连接失败，已达最大重试次数');
}

export function rebuildDbConnection(): any {
  if (process.env.TEST_DB_MEMORY === '1') {
    return createDbConnection();
  }
  const dbPath = getDbPath();
  const rebuildOptions: any = {
    verbose: process.env.NODE_ENV === 'development' ? (msg: any) => logger.debug(msg, 'SQLite') : undefined,
    ...dbOptions,
  };
  const dbInstance = new Database(dbPath, rebuildOptions);
  dbInstance.pragma('encoding = "UTF-8"');
  dbInstance.pragma('journal_mode = WAL');
  dbInstance.pragma('busy_timeout = 5000');
  // P2 修复：与 createDbConnection 保持一致，WAL + NORMAL
  dbInstance.pragma('synchronous = NORMAL');
  dbInstance.pragma('cache_size = -20000');
  db = dbInstance;
  logger.info('数据库连接已重建', 'DB');
  return dbInstance;
}

export const initDb = () => {
  // 创建表结构
  createSchema();

  // 运行迁移
  runMigrations();

  // 内存数据库跳过完整性检查
  if (isTestMode()) return;

  // 完整性检查
  try {
    const integrity = db.prepare('PRAGMA integrity_check').all() as Array<{ integrity_check: string }>;
    const hasError = integrity.some((row) => row.integrity_check !== 'ok');
    if (hasError) {
      logger.error('[DB] 完整性检查失败，尝试 wal_checkpoint...', 'DB');
      for (const row of integrity) {
        logger.error('[DB] ' + row.integrity_check, 'DB');
      }
      try {
        db.pragma('wal_checkpoint(TRUNCATE)');
      } catch (checkpointErr) {
        logger.error('[DB] WAL checkpoint失败', 'DB', checkpointErr as Error);
      }
    } else {
      logger.info('[DB] 完整性检查通过', 'DB');
    }
  } catch (err) {
    logger.error('[DB] 完整性检查异常', 'DB', err as Error);
  }
};

function validateBackup(backupPath: string): { valid: boolean; error?: string } {
  try {
    const testDb = new Database(backupPath, { readonly: true });
    testDb.prepare('SELECT COUNT(*) FROM User').get();
    testDb.prepare('SELECT COUNT(*) FROM Patient').get();
    // 完整性检查：确保备份文件无损坏
    const integrity = testDb.prepare('PRAGMA integrity_check').all() as Array<{ integrity_check: string }>;
    const hasError = integrity.some((row) => row.integrity_check !== 'ok');
    testDb.close();
    if (hasError) {
      return { valid: false, error: 'integrity_check failed' };
    }
    return { valid: true };
  } catch (err) {
    return { valid: false, error: (err as Error).message };
  }
}

let autoBackupTimer: NodeJS.Timeout | null = null;

export const cancelAutoBackup = () => {
  if (autoBackupTimer) {
    clearTimeout(autoBackupTimer);
    autoBackupTimer = null;
  }
};

function cleanupOnShutdown(): void {
  cancelAutoBackup();
  if (db) {
    try {
      db.close();
    } catch (err) {
      logger.error('[DB] 关闭数据库连接失败', 'DB', err as Error);
    }
  }
}

process.on('SIGINT', cleanupOnShutdown);
process.on('SIGTERM', cleanupOnShutdown);

export const scheduleAutoBackup = () => {
  // 防止重复调度
  cancelAutoBackup();

  const performBackup = () => {
    try {
      const dbPath = getDbPath();
      const backupDir = join(dirname(dbPath), 'backups');
      try { fs.mkdirSync(backupDir, { recursive: true }); } catch (mkdirErr) {
        logger.error('[Auto Backup] 创建备份目录失败', 'Backup', mkdirErr as Error);
        return;
      }

      try {
        fs.accessSync(backupDir, fs.constants.W_OK);
      } catch {
        logger.error(`[Auto Backup] 备份目录不可写: ${backupDir}`, 'Backup');
        return;
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = join(backupDir, `dental-${timestamp}.sqlite`);

      try {
        const backup = db.backup(backupPath);
        backup.transfer(-1);
        backup.close();
      } catch (backupErr) {
        logger.error(`[Auto Backup] db.backup() 失败，回退到 copyFileSync`, 'Backup', backupErr as Error);
        try { db.pragma('wal_checkpoint(FULL)'); } catch (checkpointErr) {
          logger.error('[Auto Backup] WAL checkpoint失败', 'Backup', checkpointErr as Error);
        }
        fs.copyFileSync(dbPath, backupPath);
      }

      const result = validateBackup(backupPath);
      if (!result.valid) {
        try { fs.unlinkSync(backupPath); } catch (unlinkErr) {
          logger.error('[Auto Backup] 删除无效备份失败', 'Backup', unlinkErr as Error);
        }
        logger.error(`[Auto Backup] 备份验证失败(${result.error})，已尝试删除无效备份: ${backupPath}`, 'Backup');
        return;
      }

      const stats = fs.statSync(backupPath);

      logger.info(`[Auto Backup] 备份验证通过: ${backupPath}, 大小: ${(stats.size / 1024 / 1024).toFixed(2)} MB`, 'Backup');

      const insertRecord = db.prepare(`INSERT INTO BackupRecord (id, filename, fileSize, type, remark)
        VALUES (?, ?, ?, 'AUTO', '自动备份')`);
      insertRecord.run(crypto.randomUUID(), `dental-${timestamp}.sqlite`, stats.size);

      const backups = fs.readdirSync(backupDir)
        .filter((f: string) => f.startsWith('dental-') && f.endsWith('.sqlite'))
        .map((f: string) => ({ name: f, mtime: fs.statSync(join(backupDir, f)).mtimeMs }))
        .sort((a: any, b: any) => b.mtime - a.mtime);

      const maxBackups = 14;
      for (let i = maxBackups; i < backups.length; i++) {
        try { fs.unlinkSync(join(backupDir, backups[i].name)); } catch (delErr) {
          logger.error('[Auto Backup] 删除旧备份失败: ' + backups[i].name, 'Backup', delErr as Error);
        }
      }

      logger.info(`[Auto Backup] 自动备份完成: ${backupPath}, 大小: ${(stats.size / 1024 / 1024).toFixed(2)} MB`, 'Backup');

      // 异地存储：如果配置了 BACKUP_REMOTE_DIR，复制一份到远程目录
      const remoteDir = process.env.BACKUP_REMOTE_DIR;
      if (remoteDir) {
        try {
          if (!fs.existsSync(remoteDir)) fs.mkdirSync(remoteDir, { recursive: true });
          const remotePath = join(remoteDir, `dental-${timestamp}.sqlite`);
          fs.copyFileSync(backupPath, remotePath);
          logger.info(`[Auto Backup] 异地备份完成: ${remotePath}`, 'Backup');
        } catch (remoteErr) {
          logger.error(`[Auto Backup] 异地备份失败`, 'Backup', remoteErr as Error);
        }
      }
    } catch (err) {
      logger.error('[Auto Backup] 自动备份失败', 'Backup', err as Error);
    }
  };

  setImmediate(performBackup);

  const scheduleNextBackup = () => {
    const now = new Date();
    const nextBackup = new Date(now);
    nextBackup.setHours(nextBackup.getHours() + 6, 0, 0, 0);
    const delay = nextBackup.getTime() - now.getTime();

    autoBackupTimer = setTimeout(() => {
      performBackup();
      scheduleNextBackup();
    }, delay);
    autoBackupTimer.unref();
  };

  scheduleNextBackup();
};
