import { Database } from 'better-sqlite3';
import { logger } from '../../common/utils/infra/log';

const MAINTENANCE_LOGGER = {
  info: (msg: string) => {
    logger.info(`[Maintenance] ${msg}`, 'DB');
  },
  warn: (msg: string, err?: unknown) => {
    const errMsg = err ? ` - ${(err as Error)?.message || String(err)}` : '';
    logger.warn(`[Maintenance] ${msg}${errMsg}`, 'DB');
  },
  error: (msg: string, err?: unknown) => {
    logger.error(`[Maintenance] ${msg}`, 'DB', err as Error);
  },
};

const SOFT_DELETE_TABLES = [
  'Appointment',
  'Visit',
  'Treatment',
  'TreatmentPlan',
  'TreatmentPlanItem',
  'OralExamination',
  'PeriodontalRecord',
  'MedicalRecord',
  'FirstExam',
  'FirstExamTrack',
  'Charge',
  'ChargeItem',
  'ChargeCombo',
  'ChargeComboItem',
  'PaymentMethod',
  'DebtRecord',
  'Refund',
  'MemberCard',
  'Patient',
  'FollowUp',
  'Registration',
  'Supplier',
  'InventoryItem',
  'PurchaseOrder',
  'Equipment',
  'ProcessingFactory',
  'ProcessingOrder',
];

export function vacuumAndAnalyze(db: Database): void {
  try {
    MAINTENANCE_LOGGER.info('开始执行 VACUUM 和 ANALYZE');
    db.exec('VACUUM');
    db.exec('ANALYZE');
    MAINTENANCE_LOGGER.info('VACUUM 和 ANALYZE 执行完成');
  } catch (err: unknown) {
    MAINTENANCE_LOGGER.error('VACUUM 和 ANALYZE 执行失败', err);
    throw err;
  }
}

export function cleanupSoftDeleted(db: Database, days: number = 365): { totalDeleted: number; details: Record<string, number> } {
  const details: Record<string, number> = {};
  let totalDeleted = 0;

  try {
    MAINTENANCE_LOGGER.info(`开始清理 ${days} 天前的软删除数据`);

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    const cutoffDateStr = cutoffDate.toISOString();

    const existingTables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string }>;
    const existingTableNames = new Set(existingTables.map((t) => t.name));

    const tablesWithSoftDelete = SOFT_DELETE_TABLES.filter((table) => existingTableNames.has(table));

    db.exec('BEGIN TRANSACTION');

    try {
      for (const tableName of tablesWithSoftDelete) {
        try {
          const countResult = db
            .prepare(`SELECT COUNT(*) as count FROM ${tableName} WHERE deletedAt IS NOT NULL AND deletedAt < ?`)
            .get(cutoffDateStr) as { count: number };

          const count = countResult.count || 0;

          if (count > 0) {
            db.prepare(`DELETE FROM ${tableName} WHERE deletedAt IS NOT NULL AND deletedAt < ?`).run(cutoffDateStr);
            details[tableName] = count;
            totalDeleted += count;
            MAINTENANCE_LOGGER.info(`${tableName}: 删除 ${count} 条软删除记录`);
          }
        } catch (tableErr) {
          MAINTENANCE_LOGGER.warn(`清理 ${tableName} 软删除数据失败`, tableErr);
        }
      }

      db.exec('COMMIT');
      MAINTENANCE_LOGGER.info(`软删除数据清理完成，共删除 ${totalDeleted} 条记录`);
    } catch (err: unknown) {
      db.exec('ROLLBACK');
      MAINTENANCE_LOGGER.error('软删除数据清理失败，已回滚事务', err);
      throw err;
    }

    return { totalDeleted, details };
  } catch (err: unknown) {
    MAINTENANCE_LOGGER.error('清理软删除数据时发生错误', err);
    throw err;
  }
}

export function getSoftDeleteStats(db: Database, days: number = 365): {
  totalSoftDeleted: number;
  eligibleForCleanup: number;
  details: Record<string, { total: number; eligible: number }>;
} {
  const details: Record<string, { total: number; eligible: number }> = {};
  let totalSoftDeleted = 0;
  let eligibleForCleanup = 0;

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  const cutoffDateStr = cutoffDate.toISOString();

  const existingTables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all() as Array<{ name: string }>;
  const existingTableNames = new Set(existingTables.map((t) => t.name));

  const tablesWithSoftDelete = SOFT_DELETE_TABLES.filter((table) => existingTableNames.has(table));

  for (const tableName of tablesWithSoftDelete) {
    try {
      const totalResult = db
        .prepare(`SELECT COUNT(*) as count FROM ${tableName} WHERE deletedAt IS NOT NULL`)
        .get() as { count: number };

      const eligibleResult = db
        .prepare(`SELECT COUNT(*) as count FROM ${tableName} WHERE deletedAt IS NOT NULL AND deletedAt < ?`)
        .get(cutoffDateStr) as { count: number };

      const total = totalResult.count || 0;
      const eligible = eligibleResult.count || 0;

      if (total > 0) {
        details[tableName] = { total, eligible };
        totalSoftDeleted += total;
        eligibleForCleanup += eligible;
      }
    } catch {
      continue;
    }
  }

  return { totalSoftDeleted, eligibleForCleanup, details };
}
