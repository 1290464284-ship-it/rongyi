/* eslint-disable security/detect-non-literal-fs-filename -- 迁移文件路径来自内部常量，非用户输入 */
import { Database } from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getDbPath } from '../database';
import {
  logger,
  setMigrationDb,
  getMigrationDb,
  ensureMigrationTable,
  isMigrationApplied,
  recordMigration,
  setVersion,
} from './helpers';
import {
  migrateToV1, migrateToV2, migrateToV3, migrateToV4, migrateToV5,
  migrateToV6, migrateToV7, migrateToV8, migrateToV9, migrateToV10,
  migrateToV11, migrateToV12, migrateToV13, migrateToV14, migrateToV15,
} from './v1-v15';
import { migrateToV16, migrateToV17, migrateToV18 } from './v16-v18';
import {
  migrateToV19, migrateToV20, migrateToV21, migrateToV22, migrateToV23,
  migrateToV24, migrateToV25, migrateToV26,
} from './v19-v26';

export const CURRENT_VERSION = 26;

export const getCurrentVersion = (): number => {
  return (getMigrationDb().prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
};

const migrationNames: Record<number, string> = {
  1: 'initial-columns',
  2: 'indexes-and-updatedAt',
  3: 'soft-delete-columns',
  4: 'charge-refundedAmount',
  5: 'processingorder-softdelete',
  6: 'appointment-visitid-and-chargeitem-inventory',
  7: 'debt-wechat-firstexamtrack-softdelete',
  8: 'multi-clinic-clinicId',
  9: 'purchaseorder-softdelete',
  10: 'clinicinfo-clinicid',
  11: 'appointment-status-check-constraint',
  12: 'membercard-status-check-constraint',
  13: 'purchaseorder-status-check-constraint',
  14: 'type-check-constraints',
  15: 'chargecombo-paymentmethod-updatedAt',
  16: 'cascade-tables-softdelete-columns',
  17: 'user-username-unique-per-clinic',
  18: 'check-constraints-audit-fix',
  19: 'supplementary-indexes',
  20: 'system-alert-table',
  21: 'user-password-history-fields',
  22: 'patient-search-optimization-indexes',
  23: 'slow-query-composite-indexes',
  24: 'money-field-type-unification',
  25: 'clinic-scoped-unique-constraints',
  26: 'status-check-constraints-alignment',
};

function backupBeforeMigration(fromVersion: number, toVersion: number): string | null {
  try {
    const dbPath = getDbPath();
    const backupDir = path.join(path.dirname(dbPath), 'backups');
    try { fs.mkdirSync(backupDir, { recursive: true }); } catch {
      logger.warn('创建备份目录失败，跳过迁移前备份');
      return null;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupDir, `pre-migration-v${fromVersion}-to-v${toVersion}-${timestamp}.sqlite`);

    try {
      const db = getMigrationDb();
      db.pragma('wal_checkpoint(FULL)');
    } catch {
      // checkpoint 失败不影响备份
    }

    fs.copyFileSync(dbPath, backupPath);

    const stats = fs.statSync(backupPath);
    logger.log(`迁移前备份已创建: ${backupPath} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
    return backupPath;
  } catch (err: unknown) {
    logger.warn('迁移前备份失败，继续迁移（无回滚点）：' + (err instanceof Error ? err.message : String(err)));
    return null;
  }
}

export const runMigrations = (db: Database) => {
  setMigrationDb(db);
  ensureMigrationTable();

  const currentVersion = getCurrentVersion();
  if (currentVersion >= CURRENT_VERSION) return;

  logger.log(`开始迁移: v${currentVersion} -> v${CURRENT_VERSION}`);

  // P0-1.6: 迁移前自动备份数据库，作为失败回滚点
  // P1 修复：备份失败时终止迁移，避免无回滚点时迁移失败导致数据不可恢复
  const backupPath = backupBeforeMigration(currentVersion, CURRENT_VERSION);
  if (backupPath) {
    logger.log(`已创建迁移前备份: ${backupPath}`);
  } else {
    throw new Error(
      '迁移前备份失败，拒绝继续执行迁移以保护数据。' +
      '请检查磁盘空间和备份目录权限后重试。'
    );
  }

  for (let v = currentVersion + 1; v <= CURRENT_VERSION; v++) {
    if (isMigrationApplied(v)) {
      logger.log(`跳过已记录的迁移: v${v}`);
      continue;
    }

    const startTime = Date.now();
    try {
      // P1 修复：将每个迁移包在事务中，保证原子性
      // 注意：PRAGMA user_version 不能在事务内执行，因此 setVersion 在事务外调用
      // recordMigration 也移到事务外，避免 user_version 已升但 schema_migrations 未写入的不一致
      const migrationDb = getMigrationDb();
      const migrateTx = migrationDb.transaction(() => {
        switch (v) {
          case 1: migrateToV1(); break;
          case 2: migrateToV2(); break;
          case 3: migrateToV3(); break;
          case 4: migrateToV4(); break;
          case 5: migrateToV5(); break;
          case 6: migrateToV6(); break;
          case 7: migrateToV7(); break;
          case 8: migrateToV8(); break;
          case 9: migrateToV9(); break;
          case 10: migrateToV10(); break;
          case 11: migrateToV11(); break;
          case 12: migrateToV12(); break;
          case 13: migrateToV13(); break;
          case 14: migrateToV14(); break;
          case 15: migrateToV15(); break;
          case 16: migrateToV16(); break;
          case 17: migrateToV17(); break;
          case 18: migrateToV18(); break;
          case 19: migrateToV19(); break;
          case 20: migrateToV20(); break;
          case 21: migrateToV21(); break;
          case 22: migrateToV22(); break;
          case 23: migrateToV23(); break;
          case 24: migrateToV24(); break;
          case 25: migrateToV25(); break;
          case 26: migrateToV26(); break;
        }
      });
      migrateTx();  // 任一迁移失败 → 整体回滚，数据库保持迁移前状态
      setVersion(v);
      const duration = Date.now() - startTime;
      recordMigration(v, migrationNames[v] || `v${v}`, duration);
      logger.log(`已完成: v${v} (${duration}ms)`);
    } catch (err: unknown) {
      logger.error(`v${v} 迁移失败:`, err);
      throw err;
    }
  }
};
