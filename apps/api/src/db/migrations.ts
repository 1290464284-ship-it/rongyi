import { Logger } from '@nestjs/common';
import { db } from './database';

const TABLE_NAME_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const COLUMN_NAME_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const logger = new Logger('Migration');

function validateTableName(name: string): boolean {
  return TABLE_NAME_REGEX.test(name);
}

function validateColumnName(name: string): boolean {
  return COLUMN_NAME_REGEX.test(name);
}

const columnExists = (table: string, column: string): boolean => {
  if (!validateTableName(table)) throw new Error(`Invalid table name: ${table}`);
  if (!validateColumnName(column)) throw new Error(`Invalid column name: ${column}`);
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return cols.some(c => c.name === column);
};

const tableExists = (table: string): boolean => {
  if (!validateTableName(table)) throw new Error(`Invalid table name: ${table}`);
  const row = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
  ).get(table) as { name: string } | undefined;
  return Boolean(row);
};

const addColumnIfMissing = (table: string, column: string, definition: string) => {
  try {
    if (!columnExists(table, column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
    }
  } catch (err) {
    logger.warn(`跳过列添加 ${table}.${column}:`, (err as Error).message);
  }
};

const createIndexIfNotExists = (name: string, table: string, columns: string) => {
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS ${name} ON ${table}(${columns})`);
  } catch {
    /* ignore */
  }
};

function ensureMigrationTable(): void {
  if (!tableExists('schema_migrations')) {
    db.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        appliedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        durationMs INTEGER DEFAULT 0
      );
    `);
    return;
  }
  addColumnIfMissing('schema_migrations', 'name', 'TEXT');
  addColumnIfMissing('schema_migrations', 'appliedAt', 'TEXT DEFAULT CURRENT_TIMESTAMP');
  addColumnIfMissing('schema_migrations', 'durationMs', 'INTEGER DEFAULT 0');
}

function isMigrationApplied(version: number): boolean {
  const row = db.prepare(
    'SELECT version FROM schema_migrations WHERE version = ?',
  ).get(version) as { version: number } | undefined;
  return Boolean(row);
}

function recordMigration(version: number, name: string, durationMs: number): void {
  db.prepare(
    'INSERT OR IGNORE INTO schema_migrations (version, name, durationMs) VALUES (?, ?, ?)',
  ).run(version, name, durationMs);
}

export const CURRENT_VERSION = 8;

export const getCurrentVersion = (): number => {
  return (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
};

const setVersion = (version: number) => {
  db.pragma(`user_version = ${version}`);
};

const migrateToV1 = () => {
  addColumnIfMissing('User', 'passwordNeedsRehash', 'INTEGER DEFAULT 0');
  addColumnIfMissing('User', 'tokenVersion', 'INTEGER DEFAULT 0');
  addColumnIfMissing('User', 'refreshToken', 'TEXT');
  addColumnIfMissing('User', 'refreshTokenExpiresAt', 'TEXT');

  addColumnIfMissing('Patient', 'idCard', 'TEXT');
  addColumnIfMissing('Patient', 'occupation', 'TEXT');
  addColumnIfMissing('Patient', 'avatar', 'TEXT');
  addColumnIfMissing('Patient', 'tags', "TEXT DEFAULT '[]'");
  addColumnIfMissing('Patient', 'allergies', "TEXT DEFAULT '[]'");
  addColumnIfMissing('Patient', 'medicalHistory', "TEXT DEFAULT '[]'");
  addColumnIfMissing('Patient', 'medicationHistory', "TEXT DEFAULT '[]'");
  addColumnIfMissing('Patient', 'systemicDiseases', "TEXT DEFAULT '[]'");
  addColumnIfMissing('Patient', 'source', "TEXT DEFAULT 'WALK_IN'");
  addColumnIfMissing('Patient', 'familyId', 'TEXT');
  addColumnIfMissing('Patient', 'referrer', 'TEXT');
  addColumnIfMissing('Patient', 'emergencyContact', 'TEXT');
  addColumnIfMissing('Patient', 'emergencyPhone', 'TEXT');
  addColumnIfMissing('Patient', 'remark', 'TEXT');
  addColumnIfMissing('Patient', 'openId', 'TEXT');

  addColumnIfMissing('Appointment', 'chairId', 'TEXT');
  addColumnIfMissing('Appointment', 'type', "TEXT DEFAULT 'CLEANING'");
  addColumnIfMissing('Appointment', 'remark', 'TEXT');

  addColumnIfMissing('Visit', 'createdAt', "TEXT DEFAULT CURRENT_TIMESTAMP");
  addColumnIfMissing('Visit', 'updatedAt', "TEXT DEFAULT CURRENT_TIMESTAMP");

  addColumnIfMissing('Prescription', 'updatedAt', "TEXT DEFAULT CURRENT_TIMESTAMP");

  addColumnIfMissing('Charge', 'discount', 'REAL DEFAULT 0');
  addColumnIfMissing('Charge', 'payMethod', 'TEXT');
  addColumnIfMissing('Charge', 'paidAt', 'TEXT');
  addColumnIfMissing('Charge', 'remark', 'TEXT');

  addColumnIfMissing('User', 'phone', 'TEXT');
  addColumnIfMissing('User', 'loginAttempts', 'INTEGER DEFAULT 0');
  addColumnIfMissing('User', 'lockedUntil', 'TEXT');

  addColumnIfMissing('MemberCard', 'points', 'REAL DEFAULT 0');
  addColumnIfMissing('MemberCard', 'totalPoints', 'REAL DEFAULT 0');
  addColumnIfMissing('MemberCard', 'level', "TEXT DEFAULT 'NORMAL'");
};

const migrateToV2 = () => {
  createIndexIfNotExists('idx_charge_doctor', 'Charge', 'doctorId');
  createIndexIfNotExists('idx_medical_record_created_at', 'MedicalRecord', 'createdAt');
  createIndexIfNotExists('idx_charge_patient_status', 'Charge', 'patientId, status');
  createIndexIfNotExists('idx_medical_record_doctor', 'MedicalRecord', 'doctorId');

  const tablesNeedUpdatedAt = [
    'ChargeItem', 'TreatmentPlanItem', 'PrescriptionItem', 'PurchaseOrderItem',
    'MemberCardLog', 'MemberPointLog', 'InventoryTransaction', 'OperationLog',
    'BackupRecord', 'SmsLog', 'WechatMessage', 'Refund', 'Invoice',
  ];
  tablesNeedUpdatedAt.forEach(table => {
    addColumnIfMissing(table, 'updatedAt', 'TEXT DEFAULT CURRENT_TIMESTAMP');
  });
};

const migrateToV3 = () => {
  const tablesNeedDeletedAt = [
    'MedicalRecord', 'Patient', 'Appointment', 'Prescription', 'PrescriptionItem',
    'Visit', 'Treatment', 'TreatmentPlan', 'TreatmentPlanItem', 'Imaging',
    'OralExamination', 'PeriodontalRecord', 'Charge', 'ChargeItem', 'Refund',
    'MemberCard', 'Registration', 'FollowUp', 'FirstExam', 'ToothRecord',
    'InventoryItem', 'Supplier', 'ProcessingFactory',
  ];
  tablesNeedDeletedAt.forEach(table => {
    addColumnIfMissing(table, 'deletedAt', 'TEXT');
    createIndexIfNotExists(`idx_${table.toLowerCase().replace(/([a-z])([A-Z])/g, '$1_$2').replace(/_/g, '_')}_deleted`, table, 'deletedAt');
  });
};

const migrateToV4 = () => {
  addColumnIfMissing('Charge', 'refundedAmount', 'REAL DEFAULT 0');
};

const migrateToV5 = () => {
  // 补建 ProcessingOrder 表的 deletedAt 列（v3 迁移遗漏）
  addColumnIfMissing('ProcessingOrder', 'deletedAt', 'TEXT');
  createIndexIfNotExists('idx_processingorder_deleted', 'ProcessingOrder', 'deletedAt');
};

const migrateToV6 = () => {
  // P0.1: Appointment 表补建 visitId 列（前端/服务端已引用但 schema 缺失，运行时报 no such column）
  addColumnIfMissing('Appointment', 'visitId', 'TEXT');
  createIndexIfNotExists('idx_appointment_visit', 'Appointment', 'visitId');

  // P0.6/P0.7: ChargeItem 表补建 inventoryItemId 列（材料费扣库存关联）
  addColumnIfMissing('ChargeItem', 'inventoryItemId', 'TEXT');
  addColumnIfMissing('ChargeItem', 'consumedQuantity', 'REAL DEFAULT 0');

  // P0.4: DebtRecord.chargeId 增加唯一索引，防止 createDebtFromCharge 的 TOCTOU 竞态产生重复欠费
  // 用 try/catch 容错已存在的重复数据（极少见，但避免迁移失败阻塞启动）
  try {
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_debt_charge_unique ON DebtRecord(chargeId)');
  } catch (err) {
    logger.warn('跳过 DebtRecord.chargeId 唯一索引创建（可能存在历史重复数据）:', (err as Error).message);
  }
};

const migrateToV7 = () => {
  // P1 修复（软删除级联遗漏）：为以下表补建 deletedAt 列，使患者软删除时可级联
  // DebtRecord / WechatMessage / FirstExamTrack 在 v3 迁移中遗漏
  const tablesNeedDeletedAt = ['DebtRecord', 'WechatMessage', 'FirstExamTrack'];
  tablesNeedDeletedAt.forEach(table => {
    addColumnIfMissing(table, 'deletedAt', 'TEXT');
  });
};

const migrateToV8 = () => {
  // P3: 多诊所扩展 — 为所有业务表添加 clinicId 列
  const tablesNeedClinicId = [
    'User', 'Patient', 'Appointment', 'Visit', 'Treatment', 'TreatmentPlan',
    'Charge', 'ChargeItem', 'Prescription', 'Imaging', 'ToothRecord',
    'MemberCard', 'InventoryItem', 'Supplier', 'PurchaseOrder', 'ProcessingOrder',
    'Refund', 'Registration', 'MedicalRecord', 'OralExamination',
    'PeriodontalRecord', 'FirstExam', 'Equipment', 'DebtRecord', 'WechatMessage',
    'FollowUp', 'Chair', 'TreatmentCatalog', 'DrugCatalog', 'ChargeCombo',
    'PaymentMethod', 'ProcessingFactory', 'BackupRecord',
  ];
  tablesNeedClinicId.forEach(table => {
    addColumnIfMissing(table, 'clinicId', 'TEXT');
  });

  // 为 clinicId 创建索引以提升查询性能
  tablesNeedClinicId.forEach(table => {
    const indexName = `idx_${table.toLowerCase()}_clinic`;
    createIndexIfNotExists(indexName, table, 'clinicId');
  });
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
};

export const runMigrations = () => {
  ensureMigrationTable();

  const currentVersion = getCurrentVersion();
  if (currentVersion >= CURRENT_VERSION) return;

  logger.log(`开始迁移: v${currentVersion} -> v${CURRENT_VERSION}`);

  for (let v = currentVersion + 1; v <= CURRENT_VERSION; v++) {
    if (isMigrationApplied(v)) {
      logger.log(`跳过已记录的迁移: v${v}`);
      continue;
    }

    const startTime = Date.now();
    try {
      switch (v) {
        case 1: migrateToV1(); break;
        case 2: migrateToV2(); break;
        case 3: migrateToV3(); break;
        case 4: migrateToV4(); break;
        case 5: migrateToV5(); break;
        case 6: migrateToV6(); break;
        case 7: migrateToV7(); break;
        case 8: migrateToV8(); break;
      }
      setVersion(v);
      const duration = Date.now() - startTime;
      recordMigration(v, migrationNames[v] || `v${v}`, duration);
      logger.log(`已完成: v${v} (${duration}ms)`);
    } catch (err) {
      logger.error(`v${v} 迁移失败:`, err);
      throw err;
    }
  }
};
