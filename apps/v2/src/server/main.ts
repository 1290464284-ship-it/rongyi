import * as crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from './http/app';
import { createDatabase, seedDatabase, syncLegacySchema } from './infrastructure/database';
import { cleanupIdempotencyRecords } from './infrastructure/idempotency';
import { Logger } from './infrastructure/logger';
import { runMigrations } from './infrastructure/migrations';
import { rebuildSearchIndex } from './infrastructure/search-index';
import { importLegacyDatabase } from './infrastructure/legacy-import';
import { applyStagedRestore } from './infrastructure/restore-apply';
import { AlertService, AuditService, BackupService } from './application/services';

const projectRoot = process.cwd();
const selfContainedLegacyDb = path.join(projectRoot, 'legacy', 'dental.sqlite');
const legacyDbPath = process.env.V2_LEGACY_DB_PATH
  ?? (fs.existsSync(selfContainedLegacyDb) ? selfContainedLegacyDb : undefined);
const legacySchemaDir = process.env.V2_LEGACY_SCHEMA_DIR ?? path.join(projectRoot, 'legacy', 'schema');
const v2DataDir = process.env.V2_DATA_DIR ?? path.join(projectRoot, 'data');
const v2DbPath = path.join(v2DataDir, 'v2.sqlite');
const logDir = process.env.V2_LOG_DIR ?? path.join(projectRoot, 'logs');
const logger = new Logger({ logDir });
if (!process.env.V2_DB_PATH && legacyDbPath && fs.existsSync(legacyDbPath)) {
  fs.mkdirSync(v2DataDir, { recursive: true });
  if (!fs.existsSync(v2DbPath) || fs.statSync(v2DbPath).size < 64 * 1024) {
    const importResult = importLegacyDatabase(legacyDbPath, v2DbPath, logger);
    if (!importResult.imported) {
      throw new Error('Legacy database import failed. Refusing to continue with an untrusted working database.');
    }
  }
}
const dbPath = process.env.V2_DB_PATH ?? v2DbPath;
const dataDir = path.dirname(dbPath);
const cleanExitMarker = path.join(dataDir, '.clean-exit');
const backupDir = process.env.V2_BACKUP_DIR ?? path.join(dataDir, 'backups');
const port = Number(process.env.V2_PORT ?? 3180);
const host = process.env.V2_HOST ?? '127.0.0.1';
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error('V2_PORT must be an integer between 1 and 65535');
}
const nodeEnv = process.env.NODE_ENV ?? 'development';
let jwtSecret: string;
{
  const envSecret = process.env.V2_JWT_SECRET;
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
runMigrations(db, { snapshotDir: dataDir });
try {
  rebuildSearchIndex(db);
} catch (error) {
  logger.error('search index rebuild failed at startup', { action: 'search-index-rebuild', error });
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
const configuredAutoBackupInterval = Number(process.env.V2_AUTO_BACKUP_INTERVAL_MS ?? 24 * 60 * 60 * 1000);
const autoBackupIntervalMs = Number.isFinite(configuredAutoBackupInterval) && configuredAutoBackupInterval >= 60_000
  ? configuredAutoBackupInterval
  : 24 * 60 * 60 * 1000;
const configuredAutoBackupKeep = Number(process.env.V2_AUTO_BACKUP_KEEP ?? 30);
const autoBackupKeep = Number.isFinite(configuredAutoBackupKeep)
  ? Math.min(365, Math.max(1, Math.floor(configuredAutoBackupKeep)))
  : 30;
let _autoBackupRunning = false;
async function runAutoBackup(): Promise<void> {
  if (_autoBackupRunning) return;
  _autoBackupRunning = true;
  try {
    const result = await backups.create({ type: 'AUTO' });
    const cleanup = backups.cleanup(autoBackupKeep);
    logger.info('automatic backup completed', { action: 'auto-backup', ...result, cleanup });
  } catch (error) {
    logger.error('automatic backup failed', { action: 'auto-backup', error });
    alerts.create({
      alertType: 'SCHEDULER_TASK_FAILURE',
      level: 'CRITICAL',
      severity: 'CRITICAL',
      title: '自动备份失败',
      message: error instanceof Error ? error.message : String(error),
      source: 'BACKUP_AUTO',
      metricName: 'automatic_backup',
      suggestion: '请检查磁盘空间、备份目录权限和备份密钥。',
      clinicId: null,
    });
  } finally {
    _autoBackupRunning = false;
  }
}
setTimeout(() => void runAutoBackup(), 5 * 60 * 1000).unref();
setInterval(() => void runAutoBackup(), Math.max(60_000, autoBackupIntervalMs)).unref();

const AUDIT_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;
function cleanupAuditLogs(): void {
  try {
    const deleted = audit.cleanup(new Date(Date.now() - AUDIT_RETENTION_MS).toISOString());
    if (deleted > 0) logger.info('audit log cleanup completed', { action: 'audit-cleanup', deleted });
  } catch (error) {
    logger.error('audit log cleanup failed', { action: 'audit-cleanup', error });
  }
}
cleanupAuditLogs();
setInterval(cleanupAuditLogs, 24 * 60 * 60 * 1000).unref();

setInterval(() => {
  try {
    const { deleted } = cleanupIdempotencyRecords(db);
    if (deleted > 0) logger.info('idempotency cleanup completed', { action: 'idempotency-cleanup', deleted });
  } catch (error) {
    logger.error('idempotency cleanup failed', { action: 'idempotency-cleanup', error });
  }
}, 24 * 60 * 60 * 1000).unref();

function shutdown(): void {
  try {
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
process.on('message', (message) => {
  if (message === 'shutdown') shutdown();
});
