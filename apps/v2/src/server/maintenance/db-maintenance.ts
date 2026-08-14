import type Database from 'better-sqlite3';
import type { Logger } from '../infrastructure/logger';

/** 与 scheduler.ts 的 onAlertCreate 输入形状保持一致 */
export interface MaintenanceAlert {
  alertType: string;
  level: 'INFO' | 'WARNING' | 'CRITICAL';
  severity: 'INFO' | 'WARN' | 'CRITICAL';
  title: string;
  message: string;
  source: string;
  metricName?: string;
  suggestion?: string;
  clinicId?: string | null;
}

export interface DbMaintenanceOptions {
  db: Database.Database;
  logger: Logger;
  onAlert: (input: MaintenanceAlert) => void;
  /** 是否允许在维护窗口执行全量 VACUUM（会阻塞写入，仅停诊窗口开启） */
  allowFullVacuum?: boolean;
}

export interface DailyMaintenanceResult {
  integrityOk: boolean;
  optimizeOk: boolean;
  checkpointed: boolean;
  autoVacuum: number;
}

export interface WeeklyMaintenanceResult {
  vacuumedPages: number;
  skippedReason?: string;
}

const WEEKLY_VACUUM_MAX_PAGES = 4096;

/**
 * 每日低峰：quick_check + PRAGMA optimize + WAL checkpoint。
 * 只做元数据/维护操作，不写业务数据；quick_check 失败必须产生 CRITICAL 告警。
 */
export function runDailyDatabaseMaintenance(options: DbMaintenanceOptions): DailyMaintenanceResult {
  const { db, logger, onAlert } = options;
  let integrityOk = false;
  try {
    const rows = db.pragma('quick_check') as Array<{ quick_check: string }>;
    integrityOk = Array.isArray(rows) && rows.length === 1 && rows[0].quick_check === 'ok';
  } catch (error) {
    logger.error('daily integrity check failed', { action: 'maintenance-integrity', error });
  }
  if (!integrityOk) {
    onAlert({
      alertType: 'DB_INTEGRITY_FAILURE',
      level: 'CRITICAL',
      severity: 'CRITICAL',
      title: '数据库完整性检查失败',
      message: '每日 quick_check 未通过，请立即执行备份并联系管理员。',
      source: 'MAINTENANCE_INTEGRITY',
      metricName: 'daily_quick_check',
      suggestion: '先运行 设置→系统操作→备份，再执行 verify:database；必要时恢复最近备份。',
      clinicId: null,
    });
  }
  let optimizeOk = false;
  try {
    db.pragma('analysis_limit = 1000');
    db.pragma('optimize');
    optimizeOk = true;
  } catch (error) {
    logger.error('daily optimize failed', { action: 'maintenance-optimize', error });
  }
  let checkpointed = false;
  try {
    db.pragma('wal_checkpoint(PASSIVE)');
    checkpointed = true;
  } catch (error) {
    logger.error('daily wal checkpoint failed', { action: 'maintenance-checkpoint', error });
  }
  const autoVacuum = Number(db.pragma('auto_vacuum', { simple: true }));
  logger.info('daily database maintenance finished', {
    action: 'maintenance-daily',
    integrityOk,
    optimizeOk,
    checkpointed,
    autoVacuum,
  });
  return { integrityOk, optimizeOk, checkpointed, autoVacuum };
}

/**
 * 每周：回收空闲页。auto_vacuum=INCREMENTAL 时逐页回收（耗时可控）；
 * 否则仅在 allowFullVacuum 时执行全量 VACUUM（阻塞写入）。
 */
export function runWeeklyDatabaseMaintenance(options: DbMaintenanceOptions): WeeklyMaintenanceResult {
  const { db, logger } = options;
  const autoVacuum = Number(db.pragma('auto_vacuum', { simple: true }));
  if (autoVacuum === 2) {
    const before = Number(db.pragma('freelist_count', { simple: true }));
    db.pragma(`incremental_vacuum(${WEEKLY_VACUUM_MAX_PAGES})`);
    const after = Number(db.pragma('freelist_count', { simple: true }));
    logger.info('incremental vacuum finished', { action: 'maintenance-weekly', before, after });
    return { vacuumedPages: Math.max(0, before - after) };
  }
  if (!options.allowFullVacuum) {
    return { vacuumedPages: 0, skippedReason: 'auto_vacuum is not INCREMENTAL and full vacuum is disabled' };
  }
  db.exec('VACUUM');
  logger.info('full vacuum finished', { action: 'maintenance-weekly' });
  return { vacuumedPages: 0 };
}

/**
 * 一次性迁移：把已有库切换为 INCREMENTAL auto_vacuum。
 * auto_vacuum 需重建库文件才生效，仅在显式开启 V2_ENABLE_AUTO_VACUUM=1
 * 且处于维护窗口时调用一次；之后无需再调。
 */
export function enableIncrementalAutoVacuum(db: Database.Database, logger: Logger): boolean {
  const current = Number(db.pragma('auto_vacuum', { simple: true }));
  if (current === 2) return true;
  if (process.env.V2_ENABLE_AUTO_VACUUM !== '1') return false;
  db.pragma('auto_vacuum = INCREMENTAL');
  db.exec('VACUUM');
  const after = Number(db.pragma('auto_vacuum', { simple: true }));
  logger.info('auto_vacuum migration finished', { action: 'maintenance-auto-vacuum', before: current, after });
  return after === 2;
}
