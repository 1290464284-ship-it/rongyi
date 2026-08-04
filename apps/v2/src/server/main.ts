import fs from 'node:fs';
import path from 'node:path';
import { createApp } from './http/app';
import { createDatabase, seedDatabase, syncLegacySchema } from './infrastructure/database';
import { Logger } from './infrastructure/logger';
import { runMigrations } from './infrastructure/migrations';
import { importLegacyDatabase } from './infrastructure/legacy-import';
import { applyStagedRestore } from './infrastructure/restore-apply';
import { AlertService, BackupService } from './application/services';

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
const backupDir = process.env.V2_BACKUP_DIR ?? path.join(dataDir, 'backups');
const port = Number(process.env.V2_PORT ?? 3180);
const nodeEnv = process.env.NODE_ENV ?? 'development';
const jwtSecret = process.env.V2_JWT_SECRET ?? 'v2-local-secret-change-me';

if (nodeEnv === 'production') {
  if (jwtSecret === 'v2-local-secret-change-me' || jwtSecret.length < 32) {
    throw new Error('V2_JWT_SECRET must be set to a random secret of at least 32 characters in production');
  }
}

applyStagedRestore(dbPath, [dataDir, backupDir], logger);
const db = createDatabase(dataDir, dbPath);
syncLegacySchema(db, legacySchemaDir);
runMigrations(db);
seedDatabase(db);
const app = createApp({ db, dbPath, backupDir, logger, logDir });

const server = app.listen(port, () => {
  logger.info('server started', { action: 'listen', port });
});
server.on('error', (error) => {
  logger.error('server failed to start', { action: 'listen', port, error });
  process.exit(1);
});

const backups = new BackupService(db, dbPath, backupDir);
const alerts = new AlertService(db);
const autoBackupIntervalMs = Number(process.env.V2_AUTO_BACKUP_INTERVAL_MS ?? 24 * 60 * 60 * 1000);
const autoBackupKeep = Number(process.env.V2_AUTO_BACKUP_KEEP ?? 30);
async function runAutoBackup(): Promise<void> {
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
      title: 'Automatic backup failed',
      message: error instanceof Error ? error.message : String(error),
      source: 'BACKUP_AUTO',
      metricName: 'automatic_backup',
      suggestion: 'Check disk space, backup permissions, and V2_BACKUP_KEY.',
      clinicId: null,
    });
  }
}
void runAutoBackup();
setInterval(() => void runAutoBackup(), Math.max(60_000, autoBackupIntervalMs)).unref();

function shutdown(): void {
  try {
    db.pragma('wal_checkpoint(PASSIVE)');
    db.close();
  } catch (error) {
    logger.error('failed to close database', { error });
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
