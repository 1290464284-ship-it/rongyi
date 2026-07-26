import { join, dirname } from 'node:path';
import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
import Database from 'better-sqlite3';
import type { Options } from 'better-sqlite3';
import {
  getDataDir,
  getDbPath,
  migrateLegacyDatabaseIfNeeded,
} from './paths';
import { createSchema } from './schema';
import { createIndexes } from './schema/indexes';
import { runMigrations } from './migrations';
import { logger } from '../common/utils/infra/log';
import {
  SQLITE_BUSY_TIMEOUT_MS,
  SQLITE_CACHE_SIZE,
  SQLITE_JOURNAL_MODE,
  SQLITE_SYNCHRONOUS,
  SQLITE_TEMP_STORE,
  SQLITE_MMAP_SIZE,
  SQLITE_WAL_AUTOCHECKPOINT,
  BACKUP_MAX_AUTO_BACKUPS,
} from '../config/constants';

export { getDbPath, getEnvPath, getDataDir } from './paths';
export { seedDb } from './seeds';

/**
 * SQLite pragma 配置可环境变量化。
 * 支持 SQLITE_JOURNAL_MODE / SQLITE_SYNCHRONOUS / SQLITE_BUSY_TIMEOUT_MS / SQLITE_CACHE_SIZE
 * / SQLITE_TEMP_STORE / SQLITE_MMAP_SIZE / SQLITE_WAL_AUTOCHECKPOINT
 */
function applyPragmas(dbInstance: InstanceType<typeof Database>): void {
  const journalMode = process.env.SQLITE_JOURNAL_MODE || SQLITE_JOURNAL_MODE;
  const synchronous = process.env.SQLITE_SYNCHRONOUS || SQLITE_SYNCHRONOUS;
  const busyTimeout = parseInt(process.env.SQLITE_BUSY_TIMEOUT_MS || String(SQLITE_BUSY_TIMEOUT_MS), 10);
  const cacheSize = parseInt(process.env.SQLITE_CACHE_SIZE || String(SQLITE_CACHE_SIZE), 10);
  const tempStore = process.env.SQLITE_TEMP_STORE || SQLITE_TEMP_STORE;
  const mmapSize = parseInt(process.env.SQLITE_MMAP_SIZE || String(SQLITE_MMAP_SIZE), 10);
  const walAutocheckpoint = parseInt(process.env.SQLITE_WAL_AUTOCHECKPOINT || String(SQLITE_WAL_AUTOCHECKPOINT), 10);

  dbInstance.pragma('encoding = "UTF-8"');
  dbInstance.pragma(`journal_mode = ${journalMode}`);
  dbInstance.pragma(`busy_timeout = ${busyTimeout}`);
  dbInstance.pragma(`synchronous = ${synchronous}`);
  dbInstance.pragma(`cache_size = ${cacheSize}`);
  dbInstance.pragma(`temp_store = ${tempStore}`);
  dbInstance.pragma(`mmap_size = ${mmapSize}`);
  dbInstance.pragma(`wal_autocheckpoint = ${walAutocheckpoint}`);
  dbInstance.pragma('foreign_keys = ON');
}

const resourcesPath =
  (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath ||
  process.env.RESOURCES_PATH ||
  '';

const dbOptions: Options = {
  verbose: process.env.NODE_ENV === 'development' ? (msg: string) => logger.debug(msg, 'SQLite') : undefined,
};

if (resourcesPath && (process.env.NODE_ENV === 'production' || process.env.ELECTRON_RUN_AS_NODE)) {
  const bindingFromEnv = process.env.BETTER_SQLITE3_BINDINGS_PATH;
  const bindingPath =
    bindingFromEnv ||
    join(resourcesPath, 'api', 'bundle', 'build', 'Release', 'better_sqlite3.node');
  dbOptions.nativeBinding = bindingPath;
}

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
  } catch (err: unknown) {
    logger.warn('[DB] SharedArrayBuffer不可用，使用轮询等待:', (err as Error).message);
    const end = Date.now() + ms;
    while (Date.now() < end) {
      /* fallback */
    }
  }
}

export function createDbConnection(): InstanceType<typeof Database> {
  if (isTestMode()) {
    const dbInstance = new Database(':memory:');
    applyPragmas(dbInstance);
    return dbInstance;
  }

  migrateLegacyDatabaseIfNeeded();

  const maxRetries = 3;
  const retryDelayMs = 2000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const dbInstance = new Database(getDbPath(), dbOptions);
      applyPragmas(dbInstance);
      logger.info(`数据库连接成功 (第 ${attempt} 次尝试) path=${getDbPath()}`, 'DB');
      return dbInstance;
    } catch (err: unknown) {
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

export function rebuildDbConnection(): InstanceType<typeof Database> {
  if (process.env.TEST_DB_MEMORY === '1') {
    return createDbConnection();
  }
  const dbPath = getDbPath();
  const rebuildOptions: Options = {
    verbose: process.env.NODE_ENV === 'development' ? (msg: string) => logger.debug(msg, 'SQLite') : undefined,
    ...dbOptions,
  };
  const dbInstance = new Database(dbPath, rebuildOptions);
  applyPragmas(dbInstance);
  logger.info('数据库连接已重建', 'DB');
  return dbInstance;
}

export const initDb = (db: InstanceType<typeof Database>) => {
  // 创建表结构
  createSchema(db);

  // 运行迁移
  runMigrations(db);

  // 重新创建索引（迁移可能通过 rebuildTableWithNewCheck 重建表导致索引丢失）
  createIndexes(db);

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
  } catch (err: unknown) {
    logger.error('[DB] 完整性检查异常', 'DB', err as Error);
  }
};

function validateBackup(backupPath: string): { valid: boolean; error?: string } {
  try {
    const testDb = new Database(backupPath, { readonly: true });
    // P3-5: 用 SELECT 1 LIMIT 1 替代 COUNT(*) 避免全表扫描
    testDb.prepare('SELECT 1 FROM User LIMIT 1').get();
    testDb.prepare('SELECT 1 FROM Patient LIMIT 1').get();
    // 完整性检查：确保备份文件无损坏
    const integrity = testDb.prepare('PRAGMA integrity_check').all() as Array<{ integrity_check: string }>;
    const hasError = integrity.some((row) => row.integrity_check !== 'ok');
    testDb.close();
    if (hasError) {
      return { valid: false, error: 'integrity_check failed' };
    }
    return { valid: true };
  } catch (err: unknown) {
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

export const scheduleAutoBackup = (db: InstanceType<typeof Database>) => {
  // 防止重复调度
  cancelAutoBackup();

  const performBackup = () => {
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

    const doFallbackCopy = () => {
      try { db.pragma('wal_checkpoint(FULL)'); } catch (checkpointErr) {
        logger.error('[Auto Backup] WAL checkpoint失败', 'Backup', checkpointErr as Error);
      }
      fs.copyFileSync(dbPath, backupPath);
    };

    const finishBackup = () => {
      try {
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

        const clinicRow = db.prepare(`SELECT id FROM Clinic WHERE isActive = 1 LIMIT 1`).get() as { id: string } | undefined;
        const clinicId = clinicRow?.id ?? null;

        const insertRecord = db.prepare(`INSERT INTO BackupRecord (id, filename, fileSize, type, remark, clinicId)
          VALUES (?, ?, ?, 'AUTO', '自动备份', ?)`);
        insertRecord.run(crypto.randomUUID(), `dental-${timestamp}.sqlite`, stats.size, clinicId);

        const backups = fs.readdirSync(backupDir)
          .filter((f: string) => f.startsWith('dental-') && f.endsWith('.sqlite'))
          .map((f: string) => ({ name: f, mtime: fs.statSync(join(backupDir, f)).mtimeMs }))
          .sort((a, b) => b.mtime - a.mtime);

        for (let i = BACKUP_MAX_AUTO_BACKUPS; i < backups.length; i++) {
          try { fs.unlinkSync(join(backupDir, backups[i].name)); } catch (delErr) {
            logger.error('[Auto Backup] 删除旧备份失败: ' + backups[i].name, 'Backup', delErr as Error);
          }
        }

        logger.info(`[Auto Backup] 自动备份完成: ${backupPath}, 大小: ${(stats.size / 1024 / 1024).toFixed(2)} MB`, 'Backup');

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
      } catch (err: unknown) {
        logger.error('[Auto Backup] 自动备份失败', 'Backup', err as Error);
      }
    };

    const backupPromise = db.backup(backupPath) as unknown as Promise<{ transfer: (n: number) => void; close: () => void }>;
    if (backupPromise && typeof backupPromise.then === 'function') {
      backupPromise.then((backup) => {
        try {
          backup.transfer(-1);
          backup.close();
          finishBackup();
        } catch (transferErr) {
          logger.error(`[Auto Backup] backup.transfer() 失败，回退到 copyFileSync`, 'Backup', transferErr as Error);
          try { doFallbackCopy(); } catch { /* ignore */ }
          finishBackup();
        }
      }).catch((backupErr: unknown) => {
        logger.error(`[Auto Backup] db.backup() 失败，回退到 copyFileSync`, 'Backup', backupErr as Error);
        try { doFallbackCopy(); } catch { /* ignore */ }
        finishBackup();
      });
    } else {
      try {
        const backup = backupPromise as unknown as { transfer: (n: number) => void; close: () => void };
        backup.transfer(-1);
        backup.close();
      } catch (backupErr) {
        logger.error(`[Auto Backup] db.backup() 失败，回退到 copyFileSync`, 'Backup', backupErr as Error);
        try { doFallbackCopy(); } catch { /* ignore */ }
      }
      finishBackup();
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
