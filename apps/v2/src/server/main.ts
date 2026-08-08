import * as crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createApp } from './http/app';
import { createDatabase, createPerformanceIndexes, seedDatabase, syncLegacySchema } from './infrastructure/database';
import { cleanupIdempotencyRecords } from './infrastructure/idempotency';
import { Logger } from './infrastructure/logger';
import { runMigrations } from './infrastructure/migrations';
import { rebuildSearchIndex } from './infrastructure/search-index';
import { importLegacyDatabase } from './infrastructure/legacy-import';
import { applyStagedRestore } from './infrastructure/restore-apply';
import { secretFileValue } from './infrastructure/secret-file';
import { cleanupSyncChanges } from './infrastructure/sync-change';
import { assertHostAllowed } from './infrastructure/host-policy';
import { AlertService, AuditService, BackupService } from './application/services';
import { startSchedulers } from './scheduler';
import {
  DEFAULT_API_PORT,
  DEFAULT_AUTO_BACKUP_INTERVAL_MS,
  DEFAULT_AUTO_BACKUP_KEEP,
} from '../shared/constants';

const projectRoot = process.cwd();
// T2R-17 / R2-P0-04: dental.sqlite is no longer bundled in the repository (the
// 2.4 MB patient database was removed from git); the legacy database path must
// be provided explicitly via V2_LEGACY_DB_PATH.
const legacyDbPath = process.env.V2_LEGACY_DB_PATH;
const legacySchemaDir = process.env.V2_LEGACY_SCHEMA_DIR ?? path.join(projectRoot, 'legacy', 'schema');
const v2DataDir = process.env.V2_DATA_DIR ?? path.join(projectRoot, 'data');
const v2DbPath = path.join(v2DataDir, 'v2.sqlite');
const logDir = process.env.V2_LOG_DIR ?? path.join(projectRoot, 'logs');
const logger = new Logger({ logDir });

process.on('uncaughtException', (error) => {
  try {
    logger.error('uncaught exception', { action: 'process-crash', error });
  } finally {
    process.exit(1);
  }
});
process.on('unhandledRejection', (reason) => {
  logger.error('unhandled rejection', {
    action: 'process-crash',
    error: reason instanceof Error ? reason : new Error(String(reason)),
  });
  process.exit(1);
});

// ── T2R-13 / R2-P1-09: orphan protection ─────────────────────────────────────
// If the Electron main process is hard-killed (crash / SIGKILL / taskkill), no
// graceful shutdown message can be sent. This API child must detect the loss of
// its parent and exit instead of continuing to run and write the database as an
// orphan. Detection is only active when this process was spawned over IPC
// (process.channel present); standalone runs such as `pnpm dev:api` are
// unaffected. main.cjs pings this process every 2s over the same channel:
//   1. `disconnect` fires when the IPC channel is torn down;
//   2. a heartbeat timeout: if no message arrives for PARENT_HEARTBEAT_TIMEOUT_MS
//      (covers teardown races and a wedged-but-alive main process that stopped
//      pinging) we exit;
//   3. until the first message has ever been processed (e.g. startup work
//      blocked the event loop), a direct `process.kill(ppid, 0)` probe is used
//      instead, so a long boot cannot cause a false orphan exit and a parent
//      that died during boot is still detected.
const parentHeartbeatEnabled = Boolean(process.channel);
const PARENT_HEARTBEAT_TIMEOUT_MS = 10_000; // must stay well above the 2s ping interval
const PARENT_HEARTBEAT_CHECK_MS = 1_000;
/** Time of the last IPC message; null until the first message is processed. */
let lastParentMessageAt: number | null = null;

/** True when the parent process (by PID) is still alive. */
function parentProcessAlive(): boolean {
  try {
    process.kill(process.ppid, 0);
    return true;
  } catch {
    return false;
  }
}

function exitAsOrphanGuard(reason: string): void {
  try {
    logger.error('parent process lost; API process exiting to avoid running as an orphan', {
      action: 'parent-lost',
      reason,
    });
  } catch {
    // best effort
  }
  try {
    db.pragma('wal_checkpoint(PASSIVE)');
    db.close();
  } catch {
    // best effort: the process is going away regardless
  }
  process.exit(1);
}

process.on('message', (message) => {
  lastParentMessageAt = Date.now();
  if (message === 'shutdown') {
    // M6-edge: IPC shutdown 路径先冲刷审计缓冲（app 在模块加载末尾声明，
    // 闭包在收到消息时才执行，运行时引用合法）。
    try {
      (app.locals.flushAuditNow as (() => void) | undefined)?.();
    } catch {
      // best effort: shutdown 照常进行
    }
    shutdown();
  }
});
if (parentHeartbeatEnabled) {
  process.on('disconnect', () => exitAsOrphanGuard('ipc-disconnect'));
  setInterval(() => {
    if (lastParentMessageAt === null) {
      // No heartbeat message has been processed yet; probe the parent PID
      // directly instead of timing out a stale clock.
      if (!parentProcessAlive()) exitAsOrphanGuard('ppid-probe');
      return;
    }
    if (Date.now() - lastParentMessageAt > PARENT_HEARTBEAT_TIMEOUT_MS) {
      exitAsOrphanGuard('heartbeat-timeout');
    }
  }, PARENT_HEARTBEAT_CHECK_MS).unref();
}

/**
 * T2R-15 / R2-P1-12: legacy import decision.
 *
 * The old heuristic treated any v2.sqlite smaller than 64KB as an "empty/new
 * database" and re-imported from the legacy database, which wrongly clobbered
 * normal small databases (e.g. freshly created ones with a small schema).
 *
 * New behavior:
 *  - v2.sqlite does not exist        -> import from the legacy database;
 *  - v2.sqlite exists and passes
 *    PRAGMA quick_check               -> do nothing (database is healthy);
 *  - v2.sqlite exists but fails
 *    PRAGMA quick_check               -> prompt the user to restore/re-import
 *                                       (the caller raises an error that the
 *                                       Electron shell surfaces as a dialog).
 *
 * The database opener is injected via `options.openDb` so the decision can be
 * unit-tested without touching real files.
 */
export interface LegacyImportDecision {
  /** Whether the legacy database should be imported into v2.sqlite. */
  shouldImport: boolean;
  /** Set when v2.sqlite exists but fails quick_check: prompt restore/re-import. */
  promptRestore: boolean;
  /** Result of the v2.sqlite quick_check; undefined when the file does not exist. */
  v2IntegrityOk?: boolean;
}

export interface V2DbHandle {
  pragma(source: string): unknown;
  close(): void;
}

export type V2DbOpener = (filePath: string) => V2DbHandle;

const defaultV2DbOpener: V2DbOpener = (filePath) => new Database(filePath, { readonly: true });

export function shouldImportLegacyDb(
  v2DbPath: string,
  options: { openDb?: V2DbOpener } = {},
): LegacyImportDecision {
  const openDb = options.openDb ?? defaultV2DbOpener;
  if (!fs.existsSync(v2DbPath)) {
    return { shouldImport: true, promptRestore: false };
  }
  let integrityOk = false;
  let db: V2DbHandle | undefined;
  try {
    db = openDb(v2DbPath);
    const rows = db.pragma('quick_check') as Array<{ quick_check: string }>;
    integrityOk = Array.isArray(rows) && rows.length === 1 && rows[0].quick_check === 'ok';
  } catch {
    integrityOk = false;
  } finally {
    db?.close();
  }
  return integrityOk
    ? { shouldImport: false, promptRestore: false, v2IntegrityOk: true }
    : { shouldImport: false, promptRestore: true, v2IntegrityOk: false };
}

if (!process.env.V2_DB_PATH && legacyDbPath && fs.existsSync(legacyDbPath)) {
  fs.mkdirSync(v2DataDir, { recursive: true });
  const decision = shouldImportLegacyDb(v2DbPath);
  if (decision.shouldImport) {
    const importResult = importLegacyDatabase(legacyDbPath, v2DbPath, logger);
    if (!importResult.imported) {
      throw new Error('Legacy database import failed. Refusing to continue with an untrusted working database.');
    }
  } else if (decision.promptRestore) {
    logger.error('v2 database failed integrity check (quick_check); refusing to start with an untrusted database', {
      action: 'v2-db-integrity-check',
      path: v2DbPath,
    });
    throw new Error(
      'v2.sqlite failed integrity check (quick_check). Refusing to continue with an untrusted working database. ' +
        'Please restore from a backup, or delete the damaged v2.sqlite and restart to re-import the legacy database.',
    );
  }
}
const dbPath = process.env.V2_DB_PATH ?? v2DbPath;
const dataDir = path.dirname(dbPath);
const cleanExitMarker = path.join(dataDir, '.clean-exit');
const backupDir = process.env.V2_BACKUP_DIR ?? path.join(dataDir, 'backups');
// S-M5（第七轮，部署层文档项）：本服务不实现 TLS 终止。默认仅监听
// 127.0.0.1 回环（Electron 打包版强制回环）；只有显式设置 V2_HOST=0.0.0.0
// 的局域网部署才暴露监听，此时 JWT/刷新令牌/患者数据全链路明文。局域网
// 部署必须在前置代理（nginx/caddy HTTPS 终结）后转发，或保持回环并仅经
// TLS 隧道访问；Electron 客户端若需信任自签/内部 CA，须在 main.cjs 的
// webRequest/证书校验处显式放行（当前未实现，视为不支持项）。
const port = Number(process.env.V2_PORT ?? DEFAULT_API_PORT);
const host = process.env.V2_HOST ?? '127.0.0.1';
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error('V2_PORT must be an integer between 1 and 65535');
}
const nodeEnv = process.env.NODE_ENV ?? 'development';
assertHostAllowed(host);
let jwtSecret: string;
{
  // S-L2：Electron 主进程经 V2_SECRET_FILE 传入密钥（0o600 临时文件，不落 env）；
  // 直跑环境仍兼容 V2_JWT_SECRET。生产缺密钥/长度不足时 fail-closed。
  const fileSecret = process.env.V2_SECRET_FILE ? secretFileValue('jwt') : null;
  const envSecret = fileSecret ?? process.env.V2_JWT_SECRET;
  if (envSecret) {
    jwtSecret = envSecret;
  } else if (nodeEnv === 'production') {
    throw new Error('V2_JWT_SECRET must be set to a random secret of at least 32 characters in production');
  } else {
    jwtSecret = crypto.randomBytes(32).toString('hex');
    logger.warn('V2_JWT_SECRET not set, using temporary random secret for development; tokens will not survive restart');
  }
}
if (nodeEnv === 'production' && jwtSecret.length < 32) {
  throw new Error('V2_JWT_SECRET must be set to a random secret of at least 32 characters in production');
}

applyStagedRestore(dbPath, [dataDir, backupDir], logger);
const wasCleanExit = fs.existsSync(cleanExitMarker);
if (wasCleanExit) fs.rmSync(cleanExitMarker, { force: true });
const db = createDatabase(dataDir, dbPath, { fullIntegrityCheck: !wasCleanExit });
syncLegacySchema(db, legacySchemaDir);
const appliedMigrations = runMigrations(db, { snapshotDir: dataDir });
createPerformanceIndexes(db);
// 搜索索引由单行 upsertSearchRow 增量维护（repository/search-index 同源 SQL）；
// 仅当本次启动了迁移（可能改动被索引表结构）或索引为空（首次/被清空）时全量重建，
// 避免每次启动全表扫描拖慢启动。
const hasSearchIndexTable = !!db.prepare(
  `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'SearchIndex'`,
).get();
let searchIndexEmpty = false;
if (hasSearchIndexTable) {
  searchIndexEmpty = Number((db.prepare('SELECT COUNT(*) AS total FROM SearchIndex').get() as { total: number }).total) === 0;
}
if (appliedMigrations > 0 || searchIndexEmpty) {
  try {
    rebuildSearchIndex(db);
  } catch (error) {
    logger.error('search index rebuild failed at startup', { action: 'search-index-rebuild', error });
  }
}
seedDatabase(db);
const app = createApp({ db, dbPath, backupDir, logger, logDir });

const server = app.listen(port, host, () => {
  logger.info('server started', { action: 'listen', host, port });
});
server.on('error', (error) => {
  logger.error('server failed to start', { action: 'listen', host, port, error });
  process.exit(1);
});

const backups = new BackupService(db, dbPath, backupDir);
const audit = new AuditService(db);
const alerts = new AlertService(db);
const configuredAutoBackupInterval = Number(process.env.V2_AUTO_BACKUP_INTERVAL_MS ?? DEFAULT_AUTO_BACKUP_INTERVAL_MS);
const autoBackupIntervalMs = Number.isFinite(configuredAutoBackupInterval) && configuredAutoBackupInterval >= 60_000
  ? configuredAutoBackupInterval
  : DEFAULT_AUTO_BACKUP_INTERVAL_MS;
const configuredAutoBackupKeep = Number(process.env.V2_AUTO_BACKUP_KEEP ?? DEFAULT_AUTO_BACKUP_KEEP);
const autoBackupKeep = Number.isFinite(configuredAutoBackupKeep)
  ? Math.min(365, Math.max(1, Math.floor(configuredAutoBackupKeep)))
  : DEFAULT_AUTO_BACKUP_KEEP;
const configuredSyncRetentionDays = Number(process.env.V2_SYNC_CHANGE_RETENTION_DAYS);
const syncChangeRetentionDays = Number.isFinite(configuredSyncRetentionDays)
  ? Math.min(3650, Math.max(1, Math.floor(configuredSyncRetentionDays)))
  : undefined;

// ── 定时任务统一收敛到 scheduler 模块 ──────────────────────────────────────────
// 原内联的三组定时器（自动备份 5min 首延迟 + interval、审计日志清理每日、
// idempotency 清理每日）全部由 startSchedulers 管理，shutdown 时通过 stop()
// 一并清空。
const schedulers = startSchedulers({
  backups,
  audit,
  autoBackupIntervalMs,
  autoBackupKeep,
  logger,
  onAlertCreate: (input) => alerts.create(input),
  idempotencyCleanup: () => cleanupIdempotencyRecords(db),
  syncChangeCleanup: (beforeIso) => cleanupSyncChanges(db, beforeIso),
  syncChangeRetentionDays,
});

function shutdown(): void {
  try {
    // 先停所有定时器，确保关闭数据库期间没有任何调度回调触碰 db。
    schedulers.stop();
    db.pragma('wal_checkpoint(PASSIVE)');
    db.close();
    try {
      fs.writeFileSync(cleanExitMarker, new Date().toISOString(), 'utf8');
    } catch { /* best effort */ }
  } catch (error) {
    logger.error('failed to close database', { error });
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
