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
  tableExists,
} from './helpers';
import {
  migrateToV1, migrateToV2, migrateToV3, migrateToV4, migrateToV5,
  migrateToV6, migrateToV7, migrateToV8, migrateToV9, migrateToV10,
  migrateToV11, migrateToV12, migrateToV13, migrateToV14, migrateToV15,
} from './v1-v15';
import { migrateToV16, migrateToV17, migrateToV18 } from './v16-v18';
import {
  migrateToV19, migrateToV20, migrateToV21, migrateToV22, migrateToV23,
  migrateToV24, migrateToV25, migrateToV26, migrateToV27,
} from './v19-v26';
import { migrateToV28 } from './v27-v28';
import { migrateToV29 } from './v29';
import { migrateToV30 } from './v30';
import { migrateToV31 } from './v31';
import { migrateToV32 } from './v32';
import { migrateToV33 } from './v33';
import { migrateToV34 } from './v34';
import { migrateToV35 } from './v35';
import { migrateToV36 } from './v36';
import { migrateToV37 } from './v37';
import { migrateToV38 } from './v38';
import { migrateToV39 } from './v39';
import { migrateToV40 } from './v40';
import { migrateToV41 } from './v41';
import { migrateToV42 } from './v42';
import { migrateToV43 } from './v43';
import { migrateToV44 } from './v44';
import { migrateToV45 } from './v45';
import { migrateToV46 } from './v46';
import { migrateToV47 } from './v47';
import { migrateToV48 } from './v48';
import { migrateToV49 } from './v49';
import { migrateToV50 } from './v50';

export const CURRENT_VERSION = 50;

export const getCurrentVersion = (): number => {
  return (getMigrationDb().prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
};

export const migrationNames: Record<number, string> = {
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
  27: 'user-deletedAt-soft-delete',
  28: 'treatment-medicalrecord-deletedAt-columns',
  29: 'soft-delete-query-optimization-indexes',
  30: 'audit-log-hash-chain',
  31: 'aident-12-new-tables',
  32: 'aident-visit-phrase-columns',
  33: 'aident-visit-summary-column',
  34: 'drug-contraindication-extra-columns',
  35: 'patient-riskscore-composite-index',
  36: 'business-alert-composite-index',
  37: 'inventory-item-sku-clinic-index',
  38: 'db-encryption-placeholder',
  39: 'medical-phrase-usage-triggers',
  40: 'follow-up-recommendation-engine',
  41: 'charge-association-rules',
  42: 'inventory-replenishment-suggestion-status',
  43: 'rfm-churn-doctor-perf',
  44: 'treatment-progress-snapshot',
  45: 'satisfaction-nps-system',
  46: 'print-template-engine',
  47: 'hr-work-schedule-leave',
  48: 'cephalometric-analysis',
  49: 'cephalometric-landmark-set-columns',
  50: 'unique-index-code-number-safety-net',
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

  // 基线迁移优化：全新安装时跳过所有增量迁移
  // createSchema() 已创建完整的 v30 表结构，user_version 为 0 且无迁移记录
  // 此时直接标记为最新版本，避免执行 30 个无意义的增量迁移
  if (currentVersion === 0 && tableExists('Patient') && tableExists('Charge') && tableExists('Appointment')) {
    logger.log('检测到全新安装，直接标记为 v' + CURRENT_VERSION + '（跳过增量迁移）');
    const migrationDb = getMigrationDb();
    const recordAll = migrationDb.transaction(() => {
      for (let v = 1; v <= CURRENT_VERSION; v++) {
        recordMigration(v, migrationNames[v] || `v${v}`, 0);
      }
    });
    recordAll();
    setVersion(CURRENT_VERSION);
    return;
  }

  logger.log(`开始迁移: v${currentVersion} -> v${CURRENT_VERSION}`);

  // P0-1.6: 迁移前自动备份数据库，作为失败回滚点
  // P1 修复：备份失败时终止迁移，避免无回滚点时迁移失败导致数据不可恢复
  // 内存数据库（测试模式）无文件可备份，跳过备份直接迁移
  const dbPath = getDbPath();
  const isMemoryDb = dbPath === ':memory:' || process.env.TEST_DB_MEMORY === '1';
  const backupPath = isMemoryDb ? null : backupBeforeMigration(currentVersion, CURRENT_VERSION);
  if (backupPath) {
    logger.log(`已创建迁移前备份: ${backupPath}`);
  } else if (!isMemoryDb) {
    throw new Error(
      '迁移前备份失败，拒绝继续执行迁移以保护数据。' +
      '请检查磁盘空间和备份目录权限后重试。'
    );
  } else {
    logger.log('内存数据库模式，跳过迁移前备份');
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
        // eslint-disable-next-line sonarjs/max-switch-cases -- 迁移版本路由，每个case对应一个迁移版本
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
          case 27: migrateToV27(); break;
          case 28: migrateToV28(); break;
          case 29: migrateToV29(); break;
          case 30: migrateToV30(); break;
          case 31: migrateToV31(); break;
          case 32: migrateToV32(); break;
          case 33: migrateToV33(); break;
          case 34: migrateToV34(); break;
          case 35: migrateToV35(); break;
          case 36: migrateToV36(); break;
          case 37: migrateToV37(); break;
          case 38: migrateToV38(); break;
          case 39: migrateToV39(); break;
          case 40: migrateToV40(); break;
          case 41: migrateToV41(); break;
          case 42: migrateToV42(); break;
          case 43: migrateToV43(); break;
          case 44: migrateToV44(); break;
          case 45: migrateToV45(); break;
          case 46: migrateToV46(); break;
          case 47: migrateToV47(); break;
          case 48: migrateToV48(); break;
          case 49: migrateToV49(); break;
          case 50: migrateToV50(); break;
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
