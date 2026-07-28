/* eslint-disable security/detect-non-literal-fs-filename -- 迁移文件路径来自内部常量，非用户输入 */
import { Logger } from '@nestjs/common';
import { Database } from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getDbPath } from './database';

const TABLE_NAME_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const COLUMN_NAME_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const logger = new Logger('Migration');

let migrationDb: Database | null = null;

function getMigrationDb(): Database {
  if (!migrationDb) {
    throw new Error('Migration database not initialized');
  }
  return migrationDb;
}

function validateTableName(name: string): boolean {
  return TABLE_NAME_REGEX.test(name);
}

function validateColumnName(name: string): boolean {
  return COLUMN_NAME_REGEX.test(name);
}

const columnExists = (table: string, column: string): boolean => {
  if (!validateTableName(table)) throw new Error(`Invalid table name: ${table}`);
  if (!validateColumnName(column)) throw new Error(`Invalid column name: ${column}`);
  const cols = getMigrationDb().prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return cols.some(c => c.name === column);
};

const tableExists = (table: string): boolean => {
  if (!validateTableName(table)) throw new Error(`Invalid table name: ${table}`);
  const row = getMigrationDb().prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
  ).get(table) as { name: string } | undefined;
  return Boolean(row);
};

const addColumnIfMissing = (table: string, column: string, definition: string) => {
  if (!columnExists(table, column)) {
    try {
      getMigrationDb().exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // P0 修复：原先所有错误都静默 warn 吞没，掩盖了表不存在、磁盘满等真实问题。
      // 仅容忍"duplicate column name"（列已存在，理论上 columnExists 已防住，但兼容并发场景）
      if (/duplicate column name/i.test(msg)) {
        logger.warn(`列已存在，跳过: ${table}.${column}`);
        return;
      }
      logger.error(`添加列失败 ${table}.${column}: ${msg}`);
      throw err;
    }
  }
};

const createIndexIfNotExists = (name: string, table: string, columns: string) => {
  try {
    getMigrationDb().exec(`CREATE INDEX IF NOT EXISTS ${name} ON ${table}(${columns})`);
  } catch (err: unknown) {
    // P0 修复：索引创建失败不能静默吞没，否则会导致查询性能退化或唯一性约束缺失
    // IF NOT EXISTS 已处理"已存在"情况，此处 catch 仅在真实失败时触发
    logger.error(`创建索引失败 ${name} ON ${table}(${columns}):`, (err as Error).message);
    throw err;
  }
};

function ensureMigrationTable(): void {
  if (!tableExists('schema_migrations')) {
    getMigrationDb().exec(`
      CREATE TABLE schema_migrations (
        version TEXT PRIMARY KEY,
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
  const row = getMigrationDb().prepare(
    'SELECT version FROM schema_migrations WHERE version = ?',
  ).get(version) as { version: number } | undefined;
  return Boolean(row);
}

function recordMigration(version: number, name: string, durationMs: number): void {
  getMigrationDb().prepare(
    'INSERT OR IGNORE INTO schema_migrations (version, name, durationMs) VALUES (?, ?, ?)',
  ).run(version, name, durationMs);
}

export const CURRENT_VERSION = 26;

export const getCurrentVersion = (): number => {
  return (getMigrationDb().prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
};

const setVersion = (version: number) => {
  getMigrationDb().pragma(`user_version = ${version}`);
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
    getMigrationDb().exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_debt_charge_unique ON DebtRecord(chargeId)');
  } catch (err: unknown) {
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

const migrateToV9 = () => {
  // D2-3: 采购单补建软删除列（v3 迁移遗漏了 PurchaseOrder）
  addColumnIfMissing('PurchaseOrder', 'deletedAt', 'TEXT');
  createIndexIfNotExists('idx_purchase_order_deleted', 'PurchaseOrder', 'deletedAt');
};

const migrateToV10 = () => {
  // P0-3: ClinicInfo 表添加 clinicId 列，支持多诊所配置隔离
  // SQLite 不支持 ALTER TABLE 修改约束，需重建表以支持复合唯一约束 UNIQUE(clinicId, key)
  const db = getMigrationDb();
  if (!columnExists('ClinicInfo', 'clinicId')) {
    // P0 修复：检测残留的 _new 表（与 rebuildTableWithNewCheck 一致的防护）
    if (!tableExists('ClinicInfo') && tableExists('ClinicInfo_new')) {
      throw new Error(
        '检测到迁移残留: 表 ClinicInfo 不存在但 ClinicInfo_new 存在。' +
        '请手动将 ClinicInfo_new 重命名为 ClinicInfo 后重启。'
      );
    }
    // P0 修复：用事务包裹整个重建过程，保证原子性
    const rebuildTx = db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS ClinicInfo_new (
          id TEXT PRIMARY KEY,
          key TEXT NOT NULL,
          value TEXT,
          clinicId TEXT,
          updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(clinicId, key)
        )
      `);
      // 复制现有数据（clinicId 设为 NULL 表示全局配置）
      db.exec(`
        INSERT OR IGNORE INTO ClinicInfo_new (id, key, value, clinicId, updatedAt)
        SELECT id, key, value, NULL, updatedAt FROM ClinicInfo
      `);
      db.exec('DROP TABLE ClinicInfo');
      db.exec('ALTER TABLE ClinicInfo_new RENAME TO ClinicInfo');
      createIndexIfNotExists('idx_clinicinfo_clinic', 'ClinicInfo', 'clinicId');
    });
    rebuildTx();
  }
  // P1-1: UsedRefreshToken 添加 usedAt 索引，加速定时清理
  createIndexIfNotExists('idx_used_refresh_token_usedat', 'UsedRefreshToken', 'usedAt');
};

const rebuildTableWithNewCheck = (
  tableName: string,
  newTableSql: string,
  insertSql: string,
  indexes: Array<{ name: string; columns: string }> = [],
) => {
  const db = getMigrationDb();

  // P0 修复：检测上一次迁移失败留下的 _new 残留表
  // 若旧表已不存在但 _new 表存在，说明上次重建在 DROP-RENAME 之间中断
  const tempTableName = `${tableName}_new`;
  if (!tableExists(tableName)) {
    if (tableExists(tempTableName)) {
      throw new Error(
        `检测到迁移残留: 表 ${tableName} 不存在但 ${tempTableName} 存在。` +
        `这表明上一次表重建在 DROP 旧表后、RENAME 前中断。` +
        `请手动将 ${tempTableName} 重命名为 ${tableName} 后重启。`
      );
    }
    return;
  }

  // P0 修复：用事务包裹整个重建过程，保证原子性
  // SQLite 支持事务内执行 CREATE/DROP/ALTER/RENAME
  const rebuildTx = db.transaction(() => {
    db.exec(`DROP TABLE IF EXISTS ${tempTableName}`);
    db.exec(newTableSql);
    db.exec(insertSql);
    db.exec(`DROP TABLE ${tableName}`);
    db.exec(`ALTER TABLE ${tempTableName} RENAME TO ${tableName}`);
    indexes.forEach(idx => {
      createIndexIfNotExists(idx.name, tableName, idx.columns);
    });
  });
  rebuildTx();  // 任一步失败 → 整体回滚，旧表保持不变
};

const migrateToV11 = () => {
  // 第四轮审计修复 2.1: Appointment 表状态 CHECK 约束与代码不一致
  // 原约束: BOOKED, CONFIRMED, CANCELLED, COMPLETED, NO_SHOW
  // 新约束: BOOKED, ARRIVED, IN_CHAIR, COMPLETED, CANCELLED, NO_SHOW
  const db = getMigrationDb();
  if (!tableExists('Appointment')) return;

  // 检查是否有旧状态数据需要迁移（CONFIRMED -> BOOKED）
  const oldStatusCount = (db.prepare(
    "SELECT COUNT(*) as count FROM Appointment WHERE status = 'CONFIRMED'"
  ).get() as { count: number })?.count || 0;
  if (oldStatusCount > 0) {
    logger.log(`Appointment 表存在 ${oldStatusCount} 条 CONFIRMED 状态数据，将迁移为 BOOKED`);
  }

  rebuildTableWithNewCheck(
    'Appointment',
    `
    CREATE TABLE Appointment_new (
      id TEXT PRIMARY KEY,
      patientId TEXT NOT NULL,
      doctorId TEXT NOT NULL,
      chairId TEXT,
      startTime TEXT NOT NULL,
      endTime TEXT NOT NULL,
      status TEXT DEFAULT 'BOOKED' CHECK (status IN ('BOOKED', 'ARRIVED', 'IN_CHAIR', 'COMPLETED', 'CANCELLED', 'NO_SHOW')),
      type TEXT NOT NULL,
      remark TEXT,
      visitId TEXT,
      clinicId TEXT NOT NULL,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
      deletedAt TEXT,
      FOREIGN KEY (patientId) REFERENCES Patient(id),
      FOREIGN KEY (doctorId) REFERENCES User(id),
      FOREIGN KEY (chairId) REFERENCES Chair(id),
      FOREIGN KEY (visitId) REFERENCES Visit(id)
    )
    `,
    `
    INSERT INTO Appointment_new (id, patientId, doctorId, chairId, startTime, endTime, status, type, remark, visitId, clinicId, createdAt, updatedAt, deletedAt)
    SELECT id, patientId, doctorId, chairId, startTime, endTime,
           CASE WHEN status = 'CONFIRMED' THEN 'BOOKED' ELSE status END,
           type, remark, visitId, clinicId, createdAt, updatedAt, deletedAt
    FROM Appointment
    `,
    [
      { name: 'idx_appointment_deleted', columns: 'deletedAt' },
      { name: 'idx_appointment_visit', columns: 'visitId' },
      { name: 'idx_appointment_clinic', columns: 'clinicId' },
      { name: 'idx_appointment_doctor', columns: 'doctorId' },
      { name: 'idx_appointment_patient', columns: 'patientId' },
      { name: 'idx_appointment_start_time', columns: 'startTime' },
      { name: 'idx_appointment_status', columns: 'status' },
    ]
  );
  logger.log('Appointment 表状态 CHECK 约束已更新');
};

const migrateToV12 = () => {
  // 第四轮审计修复 2.2: MemberCard 表状态 CHECK 约束与代码不一致
  // 原约束: ACTIVE, FROZEN, CANCELLED, EXPIRED
  // 新约束: ACTIVE, DISABLED, FROZEN, EXPIRED
  const db = getMigrationDb();
  if (!tableExists('MemberCard')) return;

  // 检查是否有旧状态数据需要迁移（CANCELLED -> DISABLED）
  const oldStatusCount = (db.prepare(
    "SELECT COUNT(*) as count FROM MemberCard WHERE status = 'CANCELLED'"
  ).get() as { count: number })?.count || 0;
  if (oldStatusCount > 0) {
    logger.log(`MemberCard 表存在 ${oldStatusCount} 条 CANCELLED 状态数据，将迁移为 DISABLED`);
  }

  rebuildTableWithNewCheck(
    'MemberCard',
    `
    CREATE TABLE MemberCard_new (
      id TEXT PRIMARY KEY,
      patientId TEXT NOT NULL,
      cardNo TEXT UNIQUE NOT NULL,
      balance INTEGER DEFAULT 0 CHECK (balance >= 0),
      totalRecharge INTEGER DEFAULT 0 CHECK (totalRecharge >= 0),
      totalConsume INTEGER DEFAULT 0 CHECK (totalConsume >= 0),
      points INTEGER DEFAULT 0,
      totalPoints INTEGER DEFAULT 0,
      level TEXT DEFAULT 'NORMAL',
      status TEXT DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED', 'FROZEN', 'EXPIRED')),
      clinicId TEXT NOT NULL,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
      deletedAt TEXT,
      FOREIGN KEY (patientId) REFERENCES Patient(id)
    )
    `,
    `
    INSERT INTO MemberCard_new (id, patientId, cardNo, balance, totalRecharge, totalConsume, points, totalPoints, level, status, clinicId, createdAt, updatedAt, deletedAt)
    SELECT id, patientId, cardNo, balance, totalRecharge, totalConsume, points, totalPoints, level,
           CASE WHEN status = 'CANCELLED' THEN 'DISABLED' ELSE status END,
           clinicId, createdAt, updatedAt, deletedAt
    FROM MemberCard
    `,
    [
      { name: 'idx_membercard_deleted', columns: 'deletedAt' },
      { name: 'idx_membercard_clinic', columns: 'clinicId' },
    ]
  );
  logger.log('MemberCard 表状态 CHECK 约束已更新');
};

const migrateToV13 = () => {
  // 第四轮审计修复 2.3: PurchaseOrder 表状态 CHECK 约束与代码不一致
  // 原约束: DRAFT, SUBMITTED, RECEIVED, CANCELLED
  // 新约束: PENDING, PARTIAL, RECEIVED, CANCELLED
  const db = getMigrationDb();
  if (!tableExists('PurchaseOrder')) return;

  // 检查是否有旧状态数据需要迁移
  const oldStatusRows = db.prepare(
    "SELECT status, COUNT(*) as count FROM PurchaseOrder WHERE status IN ('DRAFT', 'SUBMITTED') GROUP BY status"
  ).all() as Array<{ status: string; count: number }>;
  if (oldStatusRows.length > 0) {
    oldStatusRows.forEach(row => {
      logger.log(`PurchaseOrder 表存在 ${row.count} 条 ${row.status} 状态数据，将迁移为 PENDING`);
    });
  }

  rebuildTableWithNewCheck(
    'PurchaseOrder',
    `
    CREATE TABLE PurchaseOrder_new (
      id TEXT PRIMARY KEY,
      number TEXT UNIQUE NOT NULL,
      supplierId TEXT NOT NULL,
      totalAmount INTEGER DEFAULT 0,
      status TEXT DEFAULT 'DRAFT' CHECK (status IN ('PENDING', 'PARTIAL', 'RECEIVED', 'CANCELLED')),
      operatorId TEXT,
      remark TEXT,
      clinicId TEXT NOT NULL,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
      deletedAt TEXT,
      FOREIGN KEY (supplierId) REFERENCES Supplier(id),
      FOREIGN KEY (operatorId) REFERENCES User(id)
    )
    `,
    `
    INSERT INTO PurchaseOrder_new (id, number, supplierId, totalAmount, status, operatorId, remark, clinicId, createdAt, updatedAt, deletedAt)
    SELECT id, number, supplierId, totalAmount,
           CASE WHEN status IN ('DRAFT', 'SUBMITTED') THEN 'PENDING' ELSE status END,
           operatorId, remark, clinicId, createdAt, updatedAt, deletedAt
    FROM PurchaseOrder
    `,
    [
      { name: 'idx_purchase_order_deleted', columns: 'deletedAt' },
      { name: 'idx_purchaseorder_clinic', columns: 'clinicId' },
    ]
  );
  logger.log('PurchaseOrder 表状态 CHECK 约束已更新');
};

const migrateToV14 = () => {
  if (tableExists('InventoryTransaction')) {
    rebuildTableWithNewCheck(
      'InventoryTransaction',
      `
      CREATE TABLE InventoryTransaction_new (
        id TEXT PRIMARY KEY,
        itemId TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('IN', 'OUT', 'ADJUST')),
        quantity REAL NOT NULL CHECK (quantity >= 0),
        unitPrice INTEGER DEFAULT 0,
        totalAmount INTEGER DEFAULT 0,
        supplierId TEXT,
        purchaseOrderId TEXT,
        operatorId TEXT,
        operatorName TEXT,
        remark TEXT,
        clinicId TEXT NOT NULL,
        createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (itemId) REFERENCES InventoryItem(id),
        FOREIGN KEY (supplierId) REFERENCES Supplier(id),
        FOREIGN KEY (operatorId) REFERENCES User(id)
      )
      `,
      `
      INSERT INTO InventoryTransaction_new (id, itemId, type, quantity, unitPrice, totalAmount, supplierId, purchaseOrderId, operatorId, operatorName, remark, clinicId, createdAt)
      SELECT id, itemId, type, quantity, unitPrice, totalAmount, supplierId, purchaseOrderId, operatorId, operatorName, remark, clinicId, createdAt
      FROM InventoryTransaction
      `,
      []
    );
    logger.log('InventoryTransaction 表 type CHECK 约束已添加');
  }

  if (tableExists('MemberCardLog')) {
    rebuildTableWithNewCheck(
      'MemberCardLog',
      `
      CREATE TABLE MemberCardLog_new (
        id TEXT PRIMARY KEY,
        cardId TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('RECHARGE', 'CONSUME', 'REFUND')),
        amount INTEGER NOT NULL,
        balanceAfter INTEGER,
        chargeId TEXT,
        remark TEXT,
        clinicId TEXT NOT NULL,
        createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (cardId) REFERENCES MemberCard(id) ON DELETE CASCADE,
        FOREIGN KEY (chargeId) REFERENCES Charge(id)
      )
      `,
      `
      INSERT INTO MemberCardLog_new (id, cardId, type, amount, balanceAfter, chargeId, remark, clinicId, createdAt)
      SELECT id, cardId, type, amount, balanceAfter, chargeId, remark, clinicId, createdAt
      FROM MemberCardLog
      `,
      []
    );
    logger.log('MemberCardLog 表 type CHECK 约束已添加');
  }

  if (tableExists('MemberPointLog')) {
    rebuildTableWithNewCheck(
      'MemberPointLog',
      `
      CREATE TABLE MemberPointLog_new (
        id TEXT PRIMARY KEY,
        cardId TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('ADD', 'DEDUCT')),
        points INTEGER NOT NULL,
        balanceAfter INTEGER,
        chargeId TEXT,
        remark TEXT,
        clinicId TEXT NOT NULL,
        createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (cardId) REFERENCES MemberCard(id) ON DELETE CASCADE,
        FOREIGN KEY (chargeId) REFERENCES Charge(id)
      )
      `,
      `
      INSERT INTO MemberPointLog_new (id, cardId, type, points, balanceAfter, chargeId, remark, clinicId, createdAt)
      SELECT id, cardId, type, points, balanceAfter, chargeId, remark, clinicId, createdAt
      FROM MemberPointLog
      `,
      []
    );
    logger.log('MemberPointLog 表 type CHECK 约束已添加');
  }
};

const migrateToV15 = () => {
  // P0: ChargeCombo / PaymentMethod / ChargeComboItem 表补建 updatedAt 列
  // BaseService.softDelete() 与 update 操作会 SET updatedAt，但 schema 早期版本遗漏了这些表
  // softDelete 的级联更新也会 SET updatedAt 于 ChargeComboItem，缺失会导致 500
  // CREATE TABLE IF NOT EXISTS 不会修改已存在的表，必须走迁移
  addColumnIfMissing('ChargeCombo', 'updatedAt', 'TEXT DEFAULT CURRENT_TIMESTAMP');
  addColumnIfMissing('PaymentMethod', 'updatedAt', 'TEXT DEFAULT CURRENT_TIMESTAMP');
  addColumnIfMissing('ChargeComboItem', 'updatedAt', 'TEXT DEFAULT CURRENT_TIMESTAMP');
  addColumnIfMissing('ChargeComboItem', 'createdAt', 'TEXT DEFAULT CURRENT_TIMESTAMP');
  // P0: InventoryTransaction 表补建 deletedAt 列
  // InventoryService 的 softDelete 会级联更新 InventoryTransaction 的 deletedAt/updatedAt，
  // 但 V3 迁移遗漏了 InventoryTransaction（未在 tablesNeedDeletedAt 列表中）
  addColumnIfMissing('InventoryTransaction', 'deletedAt', 'TEXT');
  addColumnIfMissing('InventoryTransaction', 'updatedAt', 'TEXT DEFAULT CURRENT_TIMESTAMP');
};

const migrateToV16 = () => {
  // P0: 级联软删除补全 — ProcessingOrderItem / ProcessingFlowLog / PurchaseOrderItem
  // 这三张表被 ProcessingOrdersService / PurchaseOrdersService 用作 cascadeTables，
  // BaseService.softDelete() 级联更新会 SET deletedAt = ?, updatedAt = ?
  // 但 V2/V3 迁移均遗漏了它们，导致软删除加工单/采购单时 500
  addColumnIfMissing('ProcessingOrderItem', 'createdAt', 'TEXT DEFAULT CURRENT_TIMESTAMP');
  addColumnIfMissing('ProcessingOrderItem', 'updatedAt', 'TEXT DEFAULT CURRENT_TIMESTAMP');
  addColumnIfMissing('ProcessingOrderItem', 'deletedAt', 'TEXT');

  addColumnIfMissing('ProcessingFlowLog', 'updatedAt', 'TEXT DEFAULT CURRENT_TIMESTAMP');
  addColumnIfMissing('ProcessingFlowLog', 'deletedAt', 'TEXT');

  addColumnIfMissing('PurchaseOrderItem', 'createdAt', 'TEXT DEFAULT CURRENT_TIMESTAMP');
  addColumnIfMissing('PurchaseOrderItem', 'updatedAt', 'TEXT DEFAULT CURRENT_TIMESTAMP');
  addColumnIfMissing('PurchaseOrderItem', 'deletedAt', 'TEXT');

  // P0: Patient.gender CHECK 约束补加 'OTHER'
  // 共享枚举 Gender 包含 OTHER，DTO @IsEnum(PatientGender) 允许 OTHER 通过，
  // 但旧 CHECK 约束只允许 ('MALE','FEMALE','UNKNOWN')，导致 INSERT 失败
  rebuildTableWithNewCheck(
    'Patient',
    `
    CREATE TABLE Patient_new (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      gender TEXT NOT NULL CHECK (gender IN ('MALE','FEMALE','UNKNOWN','OTHER')),
      birthDate TEXT,
      phone TEXT NOT NULL,
      idCard TEXT,
      address TEXT,
      occupation TEXT,
      remark TEXT,
      avatar TEXT,
      tags TEXT DEFAULT '[]',
      allergies TEXT DEFAULT '[]',
      medicalHistory TEXT DEFAULT '[]',
      medicationHistory TEXT DEFAULT '[]',
      systemicDiseases TEXT DEFAULT '[]',
      source TEXT DEFAULT 'WALK_IN',
      familyId TEXT,
      referrer TEXT,
      emergencyContact TEXT,
      emergencyPhone TEXT,
      openId TEXT,
      clinicId TEXT NOT NULL,
      active INTEGER DEFAULT 1 CHECK (active IN (0,1)),
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
      deletedAt TEXT,
      FOREIGN KEY (familyId) REFERENCES Family(id),
      FOREIGN KEY (clinicId) REFERENCES Clinic(id)
    )
    `,
    `
    INSERT INTO Patient_new (id, code, name, gender, birthDate, phone, idCard, address, occupation, remark, avatar, tags, allergies, medicalHistory, medicationHistory, systemicDiseases, source, familyId, referrer, emergencyContact, emergencyPhone, openId, clinicId, active, createdAt, updatedAt, deletedAt)
    SELECT id, code, name, gender, birthDate, phone, idCard, address, occupation, remark, avatar, tags, allergies, medicalHistory, medicationHistory, systemicDiseases, source, familyId, referrer, emergencyContact, emergencyPhone, openId, clinicId, active, createdAt, updatedAt, deletedAt
    FROM Patient
    `,
    [
      { name: 'idx_patient_clinic', columns: 'clinicId' },
      { name: 'idx_patient_name', columns: 'name' },
      { name: 'idx_patient_phone', columns: 'phone' },
      { name: 'idx_patient_code', columns: 'code' },
      { name: 'idx_patient_source', columns: 'source' },
    ]
  );
};

const migrateToV17 = () => {
  // P0: User 表 username UNIQUE 约束修复 — 支持多诊所独立用户名
  // 原约束: username TEXT UNIQUE NOT NULL（全局唯一，跨诊所不允许同名）
  // 新约束: UNIQUE(clinicId, username)（诊所内唯一，不同诊所可同名）
  // SQLite 不支持 ALTER TABLE 修改约束，需重建表
  const db = getMigrationDb();
  if (!tableExists('User')) return;

  // 检查当前是否已经是复合唯一约束（即 clinicId 列已存在且新约束已建）
  const hasOldUnique = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='User'").get() as { sql: string } | undefined;

  // 如果 schema 定义已经是 UNIQUE(clinicId, username)，则无需重建
  if (hasOldUnique?.sql?.includes('UNIQUE(clinicId, username)')) {
    logger.log('User 表已包含 UNIQUE(clinicId, username) 约束，跳过重建');
    return;
  }

  rebuildTableWithNewCheck(
    'User',
    `
    CREATE TABLE User_new (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      passwordHash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT DEFAULT 'RECEPTIONIST' CHECK (role IN ('BOSS','DOCTOR','RECEPTIONIST','NURSE','ADMIN')),
      phone TEXT,
      active INTEGER DEFAULT 1 CHECK (active IN (0,1)),
      loginAttempts INTEGER DEFAULT 0 CHECK (loginAttempts >= 0),
      lockedUntil TEXT,
      passwordNeedsRehash INTEGER DEFAULT 0,
      tokenVersion INTEGER DEFAULT 0,
      refreshToken TEXT,
      refreshTokenExpiresAt TEXT,
      clinicId TEXT NOT NULL,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (clinicId) REFERENCES Clinic(id),
      UNIQUE(clinicId, username)
    )
    `,
    `
    INSERT INTO User_new (id, username, passwordHash, name, role, phone, active, loginAttempts, lockedUntil, passwordNeedsRehash, tokenVersion, refreshToken, refreshTokenExpiresAt, clinicId, createdAt, updatedAt)
    SELECT id, username, passwordHash, name, role, phone, active, loginAttempts, lockedUntil, passwordNeedsRehash, tokenVersion, refreshToken, refreshTokenExpiresAt, clinicId, createdAt, updatedAt
    FROM User
    `,
    [
      { name: 'idx_user_clinic', columns: 'clinicId' },
      { name: 'idx_user_username', columns: 'username' },
    ]
  );
  logger.log('User 表 username UNIQUE 约束已更新为 UNIQUE(clinicId, username)');
};

const migrateToV18 = () => {
  const db = getMigrationDb();

  // P0-1.1: 修复 PurchaseOrder status 默认值与 CHECK 约束冲突
  // 原默认值 'DRAFT' 不在 CHECK 枚举 ('PENDING', 'PARTIAL', 'RECEIVED', 'CANCELLED') 中
  if (tableExists('PurchaseOrder')) {
    const tableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='PurchaseOrder'").get() as { sql: string } | undefined;
    if (tableSql?.sql?.includes("DEFAULT 'DRAFT'")) {
      rebuildTableWithNewCheck(
        'PurchaseOrder',
        `
        CREATE TABLE PurchaseOrder_new (
          id TEXT PRIMARY KEY,
          number TEXT UNIQUE NOT NULL,
          supplierId TEXT NOT NULL,
          totalAmount INTEGER DEFAULT 0,
          status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PARTIAL', 'RECEIVED', 'CANCELLED')),
          operatorId TEXT,
          remark TEXT,
          clinicId TEXT NOT NULL,
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
          updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
          deletedAt TEXT,
          FOREIGN KEY (supplierId) REFERENCES Supplier(id),
          FOREIGN KEY (operatorId) REFERENCES User(id)
        )
        `,
        `
        INSERT INTO PurchaseOrder_new (id, number, supplierId, totalAmount, status, operatorId, remark, clinicId, createdAt, updatedAt, deletedAt)
        SELECT id, number, supplierId, totalAmount,
               CASE WHEN status IN ('DRAFT', 'SUBMITTED') THEN 'PENDING' ELSE status END,
               operatorId, remark, clinicId, createdAt, updatedAt, deletedAt
        FROM PurchaseOrder
        `,
        [
          { name: 'idx_purchase_order_deleted', columns: 'deletedAt' },
          { name: 'idx_purchaseorder_clinic', columns: 'clinicId' },
        ]
      );
      logger.log('PurchaseOrder 表 status 默认值已修复为 PENDING');
    }
  }

  // P0-1.2: RecordModifyRequest.status 添加 CHECK 约束
  if (tableExists('RecordModifyRequest')) {
    const tableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='RecordModifyRequest'").get() as { sql: string } | undefined;
    if (!tableSql?.sql?.includes('CHECK (status')) {
      rebuildTableWithNewCheck(
        'RecordModifyRequest',
        `
        CREATE TABLE RecordModifyRequest_new (
          id TEXT PRIMARY KEY,
          recordId TEXT NOT NULL,
          applicantId TEXT NOT NULL,
          reason TEXT NOT NULL,
          status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
          reviewerId TEXT,
          reviewRemark TEXT,
          reviewedAt TEXT,
          clinicId TEXT NOT NULL,
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (recordId) REFERENCES MedicalRecord(id) ON DELETE CASCADE,
          FOREIGN KEY (applicantId) REFERENCES User(id),
          FOREIGN KEY (reviewerId) REFERENCES User(id)
        )
        `,
        `
        INSERT INTO RecordModifyRequest_new (id, recordId, applicantId, reason, status, reviewerId, reviewRemark, reviewedAt, clinicId, createdAt)
        SELECT id, recordId, applicantId, reason,
               CASE WHEN status NOT IN ('PENDING', 'APPROVED', 'REJECTED') THEN 'PENDING' ELSE status END,
               reviewerId, reviewRemark, reviewedAt, clinicId, createdAt
        FROM RecordModifyRequest
        `,
        []
      );
      logger.log('RecordModifyRequest 表 status CHECK 约束已添加');
    }
  }

  // P0-1.3: IdempotencyRecord.status 添加 CHECK 约束
  if (tableExists('IdempotencyRecord')) {
    const tableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='IdempotencyRecord'").get() as { sql: string } | undefined;
    if (!tableSql?.sql?.includes('CHECK (status')) {
      rebuildTableWithNewCheck(
        'IdempotencyRecord',
        `
        CREATE TABLE IdempotencyRecord_new (
          id TEXT PRIMARY KEY,
          key TEXT UNIQUE NOT NULL,
          type TEXT NOT NULL,
          status TEXT DEFAULT 'PROCESSING' CHECK (status IN ('PROCESSING', 'COMPLETED', 'FAILED')),
          result TEXT,
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
          expiresAt TEXT NOT NULL
        )
        `,
        `
        INSERT INTO IdempotencyRecord_new (id, key, type, status, result, createdAt, expiresAt)
        SELECT id, key, type,
               CASE WHEN status NOT IN ('PROCESSING', 'COMPLETED', 'FAILED') THEN 'COMPLETED' ELSE status END,
               result, createdAt, expiresAt
        FROM IdempotencyRecord
        `,
        []
      );
      logger.log('IdempotencyRecord 表 status CHECK 约束已添加');
    }
  }

  // P1-4.1: Equipment.status 添加 CHECK 约束
  if (tableExists('Equipment')) {
    const tableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='Equipment'").get() as { sql: string } | undefined;
    if (!tableSql?.sql?.includes('CHECK (status')) {
      const columns = db.prepare('PRAGMA table_info(Equipment)').all() as Array<{ name: string }>;
      const columnNames = columns.map(c => c.name);

      const hasBrand = columnNames.includes('brand');
      const hasManufacturer = columnNames.includes('manufacturer');
      const hasCategory = columnNames.includes('category');
      const hasSupplier = columnNames.includes('supplier');
      const hasRemarks = columnNames.includes('remarks');
      const hasRemark = columnNames.includes('remark');
      const hasDeletedAt = columnNames.includes('deletedAt');

      const brandOrManufacturerCol = hasManufacturer ? 'manufacturer' : (hasBrand ? 'brand' : 'NULL');
      const remarkCol = hasRemark ? 'remark' : (hasRemarks ? 'remarks' : 'NULL');

      const newTableColumns = [
        'id TEXT PRIMARY KEY',
        'name TEXT NOT NULL',
        'model TEXT',
        hasBrand || hasManufacturer ? 'manufacturer TEXT' : null,
        'serialNumber TEXT',
        hasCategory ? 'category TEXT' : null,
        hasSupplier ? 'supplier TEXT' : null,
        'purchaseDate TEXT',
        'purchasePrice INTEGER DEFAULT 0',
        "status TEXT DEFAULT 'NORMAL' CHECK (status IN ('NORMAL', 'MAINTENANCE', 'BROKEN', 'SCRAPPED'))",
        'location TEXT',
        hasRemark || hasRemarks ? 'remark TEXT' : null,
        'clinicId TEXT NOT NULL',
        "createdAt TEXT DEFAULT CURRENT_TIMESTAMP",
        "updatedAt TEXT DEFAULT CURRENT_TIMESTAMP",
        hasDeletedAt ? 'deletedAt TEXT' : null,
      ].filter(Boolean).join(',\n          ');

      const insertColumns = [
        'id', 'name', 'model',
        hasBrand || hasManufacturer ? 'manufacturer' : null,
        'serialNumber',
        hasCategory ? 'category' : null,
        hasSupplier ? 'supplier' : null,
        'purchaseDate', 'purchasePrice', 'status', 'location',
        hasRemark || hasRemarks ? 'remark' : null,
        'clinicId', 'createdAt', 'updatedAt',
        hasDeletedAt ? 'deletedAt' : null,
      ].filter(Boolean);

      const selectColumns = [
        'id', 'name', 'model',
        hasBrand || hasManufacturer ? brandOrManufacturerCol : null,
        'serialNumber',
        hasCategory ? 'category' : null,
        hasSupplier ? 'supplier' : null,
        'purchaseDate', 'purchasePrice',
        "CASE WHEN status NOT IN ('NORMAL', 'MAINTENANCE', 'BROKEN', 'SCRAPPED') THEN 'NORMAL' ELSE status END",
        'location',
        hasRemark || hasRemarks ? remarkCol : null,
        'clinicId', 'createdAt', 'updatedAt',
        hasDeletedAt ? 'deletedAt' : null,
      ].filter(Boolean);

      rebuildTableWithNewCheck(
        'Equipment',
        `
        CREATE TABLE Equipment_new (
          ${newTableColumns}
        )
        `,
        `
        INSERT INTO Equipment_new (${insertColumns.join(', ')})
        SELECT ${selectColumns.join(', ')}
        FROM Equipment
        `,
        [
          { name: 'idx_equipment_clinic', columns: 'clinicId' },
          hasDeletedAt ? { name: 'idx_equipment_deleted', columns: 'deletedAt' } : null,
        ].filter(Boolean)
      );
      logger.log('Equipment 表 status CHECK 约束已添加');
    }
  }

  // P1-4.2: ProcessingFactory.status 添加 CHECK 约束
  if (tableExists('ProcessingFactory')) {
    const tableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='ProcessingFactory'").get() as { sql: string } | undefined;
    if (!tableSql?.sql?.includes('CHECK (status')) {
      const columns = db.prepare('PRAGMA table_info(ProcessingFactory)').all() as Array<{ name: string }>;
      const columnNames = columns.map(c => c.name);

      const hasContact = columnNames.includes('contact');
      const hasContactPerson = columnNames.includes('contactPerson');
      const hasDeletedAt = columnNames.includes('deletedAt');

      const contactCol = hasContact ? 'contact' : (hasContactPerson ? 'contactPerson' : 'NULL');

      const newTableColumns = [
        'id TEXT PRIMARY KEY',
        'name TEXT NOT NULL',
        hasContact || hasContactPerson ? 'contact TEXT' : null,
        'phone TEXT',
        'address TEXT',
        "status TEXT DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED'))",
        'remark TEXT',
        'clinicId TEXT NOT NULL',
        "createdAt TEXT DEFAULT CURRENT_TIMESTAMP",
        "updatedAt TEXT DEFAULT CURRENT_TIMESTAMP",
        hasDeletedAt ? 'deletedAt TEXT' : null,
      ].filter(Boolean).join(',\n          ');

      const insertColumns = [
        'id', 'name',
        hasContact || hasContactPerson ? 'contact' : null,
        'phone', 'address', 'status', 'remark', 'clinicId', 'createdAt', 'updatedAt',
        hasDeletedAt ? 'deletedAt' : null,
      ].filter(Boolean);

      const selectColumns = [
        'id', 'name',
        hasContact || hasContactPerson ? contactCol : null,
        'phone', 'address',
        "CASE WHEN status NOT IN ('ACTIVE', 'DISABLED') THEN 'ACTIVE' ELSE status END",
        'remark', 'clinicId', 'createdAt', 'updatedAt',
        hasDeletedAt ? 'deletedAt' : null,
      ].filter(Boolean);

      rebuildTableWithNewCheck(
        'ProcessingFactory',
        `
        CREATE TABLE ProcessingFactory_new (
          ${newTableColumns}
        )
        `,
        `
        INSERT INTO ProcessingFactory_new (${insertColumns.join(', ')})
        SELECT ${selectColumns.join(', ')}
        FROM ProcessingFactory
        `,
        [
          { name: 'idx_processing_factory_clinic', columns: 'clinicId' },
          hasDeletedAt ? { name: 'idx_processing_factory_deleted', columns: 'deletedAt' } : null,
        ].filter(Boolean)
      );
      logger.log('ProcessingFactory 表 status CHECK 约束已添加');
    }
  }

  // P1-4.3: WechatMessage.status 添加 CHECK 约束
  if (tableExists('WechatMessage')) {
    const tableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='WechatMessage'").get() as { sql: string } | undefined;
    if (!tableSql?.sql?.includes('CHECK (status')) {
      const columns = db.prepare('PRAGMA table_info(WechatMessage)').all() as Array<{ name: string }>;
      const columnNames = columns.map(c => c.name);

      const newTableColumns: string[] = [];
      const insertColumns: string[] = [];
      const selectColumns: string[] = [];

      for (const col of columns) {
        const colDef = `${col.name} TEXT`;
        if (col.name === 'status') {
          newTableColumns.push("status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT', 'FAILED'))");
          insertColumns.push('status');
          selectColumns.push("CASE WHEN status NOT IN ('PENDING', 'SENT', 'FAILED') THEN 'PENDING' ELSE status END");
        } else {
          newTableColumns.push(colDef);
          insertColumns.push(col.name);
          selectColumns.push(col.name);
        }
      }

      const indexes: Array<{ name: string; columns: string }> = [];
      if (columnNames.includes('clinicId')) {
        indexes.push({ name: 'idx_wechat_message_clinic', columns: 'clinicId' });
      }
      indexes.push({ name: 'idx_wechat_message_status', columns: 'status' });

      rebuildTableWithNewCheck(
        'WechatMessage',
        `
        CREATE TABLE WechatMessage_new (
          ${newTableColumns.join(',\n          ')}
        )
        `,
        `
        INSERT INTO WechatMessage_new (${insertColumns.join(', ')})
        SELECT ${selectColumns.join(', ')}
        FROM WechatMessage
        `,
        indexes
      );
      logger.log('WechatMessage 表 status CHECK 约束已添加');
    }
  }

  // P1-4.4: FirstExamTrack.status 添加 CHECK 约束
  if (tableExists('FirstExamTrack')) {
    const tableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='FirstExamTrack'").get() as { sql: string } | undefined;
    if (!tableSql?.sql?.includes('CHECK (status')) {
      rebuildTableWithNewCheck(
        'FirstExamTrack',
        `
        CREATE TABLE FirstExamTrack_new (
          id TEXT PRIMARY KEY,
          examId TEXT NOT NULL,
          patientId TEXT NOT NULL,
          doctorId TEXT,
          status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'FOLLOWING', 'TREATING', 'CHURNED', 'CLOSED')),
          leaderSuggestion TEXT,
          directorSuggestion TEXT,
          churnReason TEXT,
          churnSolution TEXT,
          clinicId TEXT NOT NULL,
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
          updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
          deletedAt TEXT,
          FOREIGN KEY (examId) REFERENCES FirstExam(id) ON DELETE CASCADE,
          FOREIGN KEY (patientId) REFERENCES Patient(id),
          FOREIGN KEY (doctorId) REFERENCES User(id)
        )
        `,
        `
        INSERT INTO FirstExamTrack_new (id, examId, patientId, doctorId, status, leaderSuggestion, directorSuggestion, churnReason, churnSolution, clinicId, createdAt, updatedAt, deletedAt)
        SELECT id, examId, patientId, doctorId,
               CASE WHEN status NOT IN ('PENDING', 'FOLLOWING', 'TREATING', 'CHURNED', 'CLOSED') THEN 'PENDING' ELSE status END,
               leaderSuggestion, directorSuggestion, churnReason, churnSolution, clinicId, createdAt, updatedAt, deletedAt
        FROM FirstExamTrack
        `,
        [
          { name: 'idx_first_exam_track_exam', columns: 'examId' },
          { name: 'idx_first_exam_track_patient', columns: 'patientId' },
          { name: 'idx_first_exam_track_clinic', columns: 'clinicId' },
        ]
      );
      logger.log('FirstExamTrack 表 status CHECK 约束已添加');
    }
  }

  // P2-4.7: TreatmentPlanItem.status 添加 CHECK 约束
  if (tableExists('TreatmentPlanItem')) {
    const tableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='TreatmentPlanItem'").get() as { sql: string } | undefined;
    if (!tableSql?.sql?.includes('CHECK (status')) {
      // 现有列：id, planId, code, name, category, price, quantity, teethNumbers, status, treatmentId, completedAt, remark, clinicId, updatedAt, deletedAt
      // 注意：原表使用 price 字段（非 unitPrice），且无 totalPrice 字段。
      // 这里只添加 status CHECK 约束，不做列名转换（避免破坏现有数据）。
      rebuildTableWithNewCheck(
        'TreatmentPlanItem',
        `
        CREATE TABLE TreatmentPlanItem_new (
          id TEXT PRIMARY KEY,
          planId TEXT NOT NULL,
          code TEXT NOT NULL,
          name TEXT NOT NULL,
          category TEXT NOT NULL,
          price REAL NOT NULL CHECK (price >= 0),
          quantity INTEGER DEFAULT 1 CHECK (quantity >= 1),
          teethNumbers TEXT DEFAULT '[]',
          status TEXT DEFAULT 'PLANNED' CHECK (status IN ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
          treatmentId TEXT,
          completedAt TEXT,
          remark TEXT,
          clinicId TEXT NOT NULL,
          updatedAt TEXT,
          deletedAt TEXT,
          FOREIGN KEY (planId) REFERENCES TreatmentPlan(id) ON DELETE CASCADE,
          FOREIGN KEY (treatmentId) REFERENCES Treatment(id)
        )
        `,
        `
        INSERT INTO TreatmentPlanItem_new (id, planId, code, name, category, price, quantity, teethNumbers, status, treatmentId, completedAt, remark, clinicId, updatedAt, deletedAt)
        SELECT id, planId, code, name, category, price, quantity, teethNumbers,
               CASE WHEN status NOT IN ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED') THEN 'PLANNED' ELSE status END,
               treatmentId, completedAt, remark, clinicId, updatedAt, deletedAt
        FROM TreatmentPlanItem
        `,
        [
          { name: 'idx_treatment_plan_item_plan', columns: 'planId' },
        ]
      );
      logger.log('TreatmentPlanItem 表 status CHECK 约束已添加');
    }
  }

  // P2-4.8: MemberCard.level 添加 CHECK 约束
  if (tableExists('MemberCard')) {
    const tableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='MemberCard'").get() as { sql: string } | undefined;
    if (!tableSql?.sql?.includes('CHECK (level')) {
      // 现有列：id, patientId, cardNo, balance, totalRecharge, totalConsume, points, totalPoints, level, status, clinicId, createdAt, updatedAt, deletedAt
      // 注意：原表使用 cardNo 字段（非 cardNumber）。这里只添加 level CHECK 约束，保持列结构不变。
      rebuildTableWithNewCheck(
        'MemberCard',
        `
        CREATE TABLE MemberCard_new (
          id TEXT PRIMARY KEY,
          patientId TEXT NOT NULL,
          cardNo TEXT UNIQUE NOT NULL,
          balance INTEGER DEFAULT 0 CHECK (balance >= 0),
          totalRecharge INTEGER DEFAULT 0 CHECK (totalRecharge >= 0),
          totalConsume INTEGER DEFAULT 0 CHECK (totalConsume >= 0),
          points INTEGER DEFAULT 0,
          totalPoints INTEGER DEFAULT 0,
          level TEXT DEFAULT 'NORMAL' CHECK (level IN ('NORMAL', 'SILVER', 'GOLD', 'PLATINUM')),
          status TEXT DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED', 'FROZEN', 'EXPIRED')),
          clinicId TEXT NOT NULL,
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
          updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
          deletedAt TEXT,
          FOREIGN KEY (patientId) REFERENCES Patient(id)
        )
        `,
        `
        INSERT INTO MemberCard_new (id, patientId, cardNo, balance, totalRecharge, totalConsume, points, totalPoints, level, status, clinicId, createdAt, updatedAt, deletedAt)
        SELECT id, patientId, cardNo, balance, totalRecharge, totalConsume, points, totalPoints,
               CASE WHEN level NOT IN ('NORMAL', 'SILVER', 'GOLD', 'PLATINUM') THEN 'NORMAL' ELSE level END,
               status, clinicId, createdAt, updatedAt, deletedAt
        FROM MemberCard
        `,
        [
          { name: 'idx_member_card_patient', columns: 'patientId' },
          { name: 'idx_member_card_clinic', columns: 'clinicId' },
          { name: 'idx_member_card_deleted', columns: 'deletedAt' },
        ]
      );
      logger.log('MemberCard 表 level CHECK 约束已添加');
    }
  }

  logger.log('v18 迁移完成：9 张表的 CHECK 约束已完善');
};

const migrateToV19 = () => {
  // AuditLog 表索引
  if (tableExists('AuditLog')) {
    createIndexIfNotExists('idx_audit_target', 'AuditLog', 'targetType, targetId, createdAt DESC');
    createIndexIfNotExists('idx_audit_operator', 'AuditLog', 'operatorId, createdAt DESC');
    createIndexIfNotExists('idx_audit_clinic_created', 'AuditLog', 'clinicId, createdAt DESC');
  }

  // RecordModifyRequest 表索引
  if (tableExists('RecordModifyRequest')) {
    createIndexIfNotExists('idx_record_modify_status', 'RecordModifyRequest', 'status, clinicId');
    createIndexIfNotExists('idx_record_modify_record', 'RecordModifyRequest', 'recordId, clinicId');
  }

  // MemberCardLog 表索引
  if (tableExists('MemberCardLog')) {
    createIndexIfNotExists('idx_membercardlog_card_created', 'MemberCardLog', 'cardId, createdAt DESC');
  }

  // MemberPointLog 表索引
  if (tableExists('MemberPointLog')) {
    createIndexIfNotExists('idx_memberpointlog_card_created', 'MemberPointLog', 'cardId, createdAt DESC');
  }

  // InventoryTransaction 表索引
  if (tableExists('InventoryTransaction')) {
    createIndexIfNotExists('idx_inv_trans_item_created', 'InventoryTransaction', 'itemId, createdAt DESC');
    createIndexIfNotExists('idx_inv_trans_type_created', 'InventoryTransaction', 'type, createdAt DESC');
    createIndexIfNotExists('idx_inv_trans_clinic_created', 'InventoryTransaction', 'clinicId, createdAt DESC');
  }

  // BackupRecord 表索引
  if (tableExists('BackupRecord')) {
    createIndexIfNotExists('idx_backup_clinic_created', 'BackupRecord', 'clinicId, createdAt DESC');
  }

  logger.log('v19 迁移完成：补充 6 张表的查询优化索引');
};

const migrateToV20 = () => {
  const db = getMigrationDb();

  if (!tableExists('SystemAlert')) {
    db.exec(`
      CREATE TABLE SystemAlert (
        id TEXT PRIMARY KEY,
        level TEXT NOT NULL CHECK (level IN ('INFO','WARNING','ERROR','CRITICAL')),
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        data TEXT,
        resolved INTEGER DEFAULT 0 CHECK (resolved IN (0,1)),
        resolvedAt TEXT,
        consecutiveFailures INTEGER DEFAULT 0,
        clinicId TEXT,
        createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
        updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    createIndexIfNotExists('idx_system_alert_clinic_created', 'SystemAlert', 'clinicId, createdAt DESC');
    createIndexIfNotExists('idx_system_alert_level', 'SystemAlert', 'level, createdAt DESC');
    createIndexIfNotExists('idx_system_alert_resolved', 'SystemAlert', 'resolved, createdAt DESC');
    logger.log('v20 迁移完成：创建 SystemAlert 表及索引');
  }
};

const migrateToV21 = () => {
  addColumnIfMissing('User', 'passwordChangedAt', 'TEXT');
  addColumnIfMissing('User', 'isTempPassword', 'INTEGER DEFAULT 0');
  logger.log('v21 迁移完成：User 表添加 passwordChangedAt 和 isTempPassword 字段');
};

const migrateToV22 = () => {
  if (tableExists('Patient')) {
    createIndexIfNotExists('idx_patient_clinic_phone', 'Patient', 'clinicId, phone');
    createIndexIfNotExists('idx_patient_clinic_code', 'Patient', 'clinicId, code');
  }
  logger.log('v22 迁移完成：患者搜索优化索引');
};

const migrateToV23 = () => {
  if (tableExists('ChargeItem')) {
    createIndexIfNotExists('idx_charge_item_charge_category', 'ChargeItem', 'chargeId, category');
  }
  if (tableExists('Charge')) {
    createIndexIfNotExists('idx_charge_clinic_status_created', 'Charge', 'clinicId, status, createdAt DESC');
    createIndexIfNotExists('idx_charge_clinic_patient_created', 'Charge', 'clinicId, patientId, createdAt DESC');
    createIndexIfNotExists('idx_charge_clinic_paidat_doctor', 'Charge', 'clinicId, paidAt, doctorId');
  }
  if (tableExists('Patient')) {
    createIndexIfNotExists('idx_patient_clinic_name_phone', 'Patient', 'clinicId, name, phone');
  }
  if (tableExists('DrugCatalog')) {
    createIndexIfNotExists('idx_drugcatalog_clinic_code', 'DrugCatalog', 'clinicId, code');
  }
  logger.log('v23 迁移完成：慢查询优化复合索引');
};

const migrateToV24 = () => {
  // P0: 修复金额字段类型不一致（REAL → INTEGER）
  // Treatment、TreatmentCatalog、TreatmentPlan、TreatmentPlanItem、DrugCatalog 使用 REAL
  // Charge、MemberCard 等使用 INTEGER（分），需要统一为 INTEGER
  // 迁移策略：重建表 + 现有数据乘以 100（元→分）

  // 1. Treatment.price: REAL → INTEGER
  if (tableExists('Treatment')) {
    const tableSql = getMigrationDb().prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='Treatment'").get() as { sql: string } | undefined;
    if (tableSql?.sql?.includes('price REAL')) {
      rebuildTableWithNewCheck(
        'Treatment',
        `
        CREATE TABLE Treatment_new (
          id TEXT PRIMARY KEY,
          patientId TEXT NOT NULL,
          visitId TEXT,
          doctorId TEXT NOT NULL,
          code TEXT NOT NULL,
          name TEXT NOT NULL,
          category TEXT NOT NULL,
          price INTEGER NOT NULL CHECK (price >= 0),
          quantity INTEGER DEFAULT 1 CHECK (quantity >= 1),
          teethNumbers TEXT DEFAULT '[]',
          status TEXT DEFAULT 'PLANNED' CHECK (status IN ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
          plannedDate TEXT,
          completedDate TEXT,
          remark TEXT,
          clinicId TEXT NOT NULL,
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
          updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
          deletedAt TEXT,
          FOREIGN KEY (patientId) REFERENCES Patient(id),
          FOREIGN KEY (visitId) REFERENCES Visit(id),
          FOREIGN KEY (doctorId) REFERENCES User(id)
        )
        `,
        `
        INSERT INTO Treatment_new (id, patientId, visitId, doctorId, code, name, category, price, quantity, teethNumbers, status, plannedDate, completedDate, remark, clinicId, createdAt, updatedAt, deletedAt)
        SELECT id, patientId, visitId, doctorId, code, name, category,
               CAST(ROUND(price * 100) AS INTEGER),
               quantity, teethNumbers, status, plannedDate, completedDate, remark, clinicId, createdAt, updatedAt, deletedAt
        FROM Treatment
        `,
        [
          { name: 'idx_treatment_clinic', columns: 'clinicId' },
        ]
      );
      logger.log('Treatment.price 已从 REAL 转换为 INTEGER');
    }
  }

  // 2. TreatmentCatalog.price: REAL → INTEGER
  if (tableExists('TreatmentCatalog')) {
    const tableSql = getMigrationDb().prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='TreatmentCatalog'").get() as { sql: string } | undefined;
    if (tableSql?.sql?.includes('price REAL')) {
      rebuildTableWithNewCheck(
        'TreatmentCatalog',
        `
        CREATE TABLE TreatmentCatalog_new (
          id TEXT PRIMARY KEY,
          code TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          category TEXT NOT NULL,
          price INTEGER NOT NULL CHECK (price >= 0),
          remark TEXT,
          clinicId TEXT NOT NULL,
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP
        )
        `,
        `
        INSERT INTO TreatmentCatalog_new (id, code, name, category, price, remark, clinicId, createdAt)
        SELECT id, code, name, category,
               CAST(ROUND(price * 100) AS INTEGER),
               remark, clinicId, createdAt
        FROM TreatmentCatalog
        `,
        [
          { name: 'idx_treatment_catalog_clinic', columns: 'clinicId' },
        ]
      );
      logger.log('TreatmentCatalog.price 已从 REAL 转换为 INTEGER');
    }
  }

  // 3. TreatmentPlan.totalFee: REAL → INTEGER
  if (tableExists('TreatmentPlan')) {
    const tableSql = getMigrationDb().prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='TreatmentPlan'").get() as { sql: string } | undefined;
    if (tableSql?.sql?.includes('totalFee REAL')) {
      rebuildTableWithNewCheck(
        'TreatmentPlan',
        `
        CREATE TABLE TreatmentPlan_new (
          id TEXT PRIMARY KEY,
          patientId TEXT NOT NULL,
          visitId TEXT,
          doctorId TEXT NOT NULL,
          name TEXT NOT NULL,
          status TEXT DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'APPROVED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
          totalFee INTEGER DEFAULT 0 CHECK (totalFee >= 0),
          remark TEXT,
          clinicId TEXT NOT NULL,
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
          updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
          deletedAt TEXT,
          FOREIGN KEY (patientId) REFERENCES Patient(id),
          FOREIGN KEY (visitId) REFERENCES Visit(id),
          FOREIGN KEY (doctorId) REFERENCES User(id)
        )
        `,
        `
        INSERT INTO TreatmentPlan_new (id, patientId, visitId, doctorId, name, status, totalFee, remark, clinicId, createdAt, updatedAt, deletedAt)
        SELECT id, patientId, visitId, doctorId, name, status,
               CAST(ROUND(COALESCE(totalFee, 0) * 100) AS INTEGER),
               remark, clinicId, createdAt, updatedAt, deletedAt
        FROM TreatmentPlan
        `,
        [
          { name: 'idx_treatment_plan_clinic', columns: 'clinicId' },
        ]
      );
      logger.log('TreatmentPlan.totalFee 已从 REAL 转换为 INTEGER');
    }
  }

  // 4. TreatmentPlanItem.price: REAL → INTEGER
  if (tableExists('TreatmentPlanItem')) {
    const tableSql = getMigrationDb().prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='TreatmentPlanItem'").get() as { sql: string } | undefined;
    if (tableSql?.sql?.includes('price REAL')) {
      rebuildTableWithNewCheck(
        'TreatmentPlanItem',
        `
        CREATE TABLE TreatmentPlanItem_new (
          id TEXT PRIMARY KEY,
          planId TEXT NOT NULL,
          code TEXT NOT NULL,
          name TEXT NOT NULL,
          category TEXT NOT NULL,
          price INTEGER NOT NULL CHECK (price >= 0),
          quantity INTEGER DEFAULT 1 CHECK (quantity >= 1),
          teethNumbers TEXT DEFAULT '[]',
          status TEXT DEFAULT 'PLANNED' CHECK (status IN ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
          treatmentId TEXT,
          completedAt TEXT,
          remark TEXT,
          clinicId TEXT NOT NULL,
          updatedAt TEXT,
          deletedAt TEXT,
          FOREIGN KEY (planId) REFERENCES TreatmentPlan(id) ON DELETE CASCADE,
          FOREIGN KEY (treatmentId) REFERENCES Treatment(id)
        )
        `,
        `
        INSERT INTO TreatmentPlanItem_new (id, planId, code, name, category, price, quantity, teethNumbers, status, treatmentId, completedAt, remark, clinicId, updatedAt, deletedAt)
        SELECT id, planId, code, name, category,
               CAST(ROUND(price * 100) AS INTEGER),
               quantity, teethNumbers, status, treatmentId, completedAt, remark, clinicId, updatedAt, deletedAt
        FROM TreatmentPlanItem
        `,
        [
          { name: 'idx_treatment_plan_item_plan', columns: 'planId' },
        ]
      );
      logger.log('TreatmentPlanItem.price 已从 REAL 转换为 INTEGER');
    }
  }

  // 5. DrugCatalog.price: REAL → INTEGER
  if (tableExists('DrugCatalog')) {
    const tableSql = getMigrationDb().prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='DrugCatalog'").get() as { sql: string } | undefined;
    if (tableSql?.sql?.includes('price REAL')) {
      rebuildTableWithNewCheck(
        'DrugCatalog',
        `
        CREATE TABLE DrugCatalog_new (
          id TEXT PRIMARY KEY,
          code TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          spec TEXT NOT NULL,
          category TEXT NOT NULL,
          price INTEGER NOT NULL CHECK (price >= 0),
          unit TEXT NOT NULL,
          stock REAL DEFAULT 0 CHECK (stock >= 0),
          remark TEXT,
          clinicId TEXT NOT NULL,
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP
        )
        `,
        `
        INSERT INTO DrugCatalog_new (id, code, name, spec, category, price, unit, stock, remark, clinicId, createdAt)
        SELECT id, code, name, spec, category,
               CAST(ROUND(price * 100) AS INTEGER),
               unit, stock, remark, clinicId, createdAt
        FROM DrugCatalog
        `,
        [
          { name: 'idx_drug_catalog_clinic', columns: 'clinicId' },
        ]
      );
      logger.log('DrugCatalog.price 已从 REAL 转换为 INTEGER');
    }
  }

  // 6. Charge.discount: 修复 v1 迁移遗留的 REAL 类型
  // schema 定义为 INTEGER，但 v1 迁移使用了 REAL，需要统一
  if (tableExists('Charge')) {
    const _tableSql = getMigrationDb().prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='Charge'").get() as { sql: string } | undefined;
    // 检查 discount 列类型（通过 PRAGMA table_info）
    const columns = getMigrationDb().prepare('PRAGMA table_info(Charge)').all() as Array<{ name: string; type: string }>;
    const discountCol = columns.find(c => c.name === 'discount');
    if (discountCol && discountCol.type === 'REAL') {
      rebuildTableWithNewCheck(
        'Charge',
        `
        CREATE TABLE Charge_new (
          id TEXT PRIMARY KEY,
          patientId TEXT NOT NULL,
          visitId TEXT,
          doctorId TEXT,
          number TEXT UNIQUE NOT NULL,
          totalAmount INTEGER NOT NULL CHECK (totalAmount >= 0),
          paidAmount INTEGER DEFAULT 0 CHECK (paidAmount >= 0),
          refundedAmount INTEGER DEFAULT 0 CHECK (refundedAmount >= 0),
          discount INTEGER DEFAULT 0 CHECK (discount >= 0),
          status TEXT DEFAULT 'UNPAID' CHECK (status IN ('UNPAID', 'PARTIAL', 'PAID', 'REFUNDED', 'CANCELLED')),
          payMethod TEXT,
          paidAt TEXT,
          remark TEXT,
          clinicId TEXT NOT NULL,
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
          updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
          deletedAt TEXT,
          FOREIGN KEY (patientId) REFERENCES Patient(id),
          FOREIGN KEY (visitId) REFERENCES Visit(id),
          FOREIGN KEY (doctorId) REFERENCES User(id)
        )
        `,
        `
        INSERT INTO Charge_new (id, patientId, visitId, doctorId, number, totalAmount, paidAmount, refundedAmount, discount, status, payMethod, paidAt, remark, clinicId, createdAt, updatedAt, deletedAt)
        SELECT id, patientId, visitId, doctorId, number, totalAmount, paidAmount, refundedAmount,
               CAST(ROUND(COALESCE(discount, 0)) AS INTEGER),
               status, payMethod, paidAt, remark, clinicId, createdAt, updatedAt, deletedAt
        FROM Charge
        `,
        [
          { name: 'idx_charge_clinic', columns: 'clinicId' },
          { name: 'idx_charge_patient_status', columns: 'patientId, status' },
          { name: 'idx_charge_doctor', columns: 'doctorId' },
        ]
      );
      logger.log('Charge.discount 已从 REAL 转换为 INTEGER');
    }
  }

  logger.log('v24 迁移完成：金额字段类型统一为 INTEGER（分）');
};

const migrateToV25 = () => {
  // P0: 多租户 UNIQUE 约束修复 — 全局唯一改为诊所内唯一
  // 原约束: code/number/cardNo TEXT UNIQUE NOT NULL（全局唯一，跨诊所不允许重复）
  // 新约束: UNIQUE(clinicId, fieldName)（诊所内唯一，不同诊所可重复）
  // SQLite 不支持 ALTER TABLE 修改约束，需重建表
  const db = getMigrationDb();

  // 1. Patient.code: UNIQUE NOT NULL -> UNIQUE(clinicId, code)
  if (tableExists('Patient')) {
    const tableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='Patient'").get() as { sql: string } | undefined;
    if (tableSql?.sql?.includes('code TEXT UNIQUE NOT NULL') && !tableSql?.sql?.includes('UNIQUE(clinicId, code)')) {
      rebuildTableWithNewCheck(
        'Patient',
        `
        CREATE TABLE Patient_new (
          id TEXT PRIMARY KEY,
          code TEXT NOT NULL,
          name TEXT NOT NULL,
          gender TEXT NOT NULL CHECK (gender IN ('MALE','FEMALE','UNKNOWN','OTHER')),
          birthDate TEXT,
          phone TEXT NOT NULL,
          idCard TEXT,
          address TEXT,
          occupation TEXT,
          remark TEXT,
          avatar TEXT,
          tags TEXT DEFAULT '[]',
          allergies TEXT DEFAULT '[]',
          medicalHistory TEXT DEFAULT '[]',
          medicationHistory TEXT DEFAULT '[]',
          systemicDiseases TEXT DEFAULT '[]',
          source TEXT DEFAULT 'WALK_IN',
          familyId TEXT,
          referrer TEXT,
          emergencyContact TEXT,
          emergencyPhone TEXT,
          openId TEXT,
          clinicId TEXT NOT NULL,
          active INTEGER DEFAULT 1 CHECK (active IN (0,1)),
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
          updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
          deletedAt TEXT,
          UNIQUE(clinicId, code),
          FOREIGN KEY (familyId) REFERENCES Family(id),
          FOREIGN KEY (clinicId) REFERENCES Clinic(id)
        )
        `,
        `
        INSERT INTO Patient_new (id, code, name, gender, birthDate, phone, idCard, address, occupation, remark, avatar, tags, allergies, medicalHistory, medicationHistory, systemicDiseases, source, familyId, referrer, emergencyContact, emergencyPhone, openId, clinicId, active, createdAt, updatedAt, deletedAt)
        SELECT id, code, name, gender, birthDate, phone, idCard, address, occupation, remark, avatar, tags, allergies, medicalHistory, medicationHistory, systemicDiseases, source, familyId, referrer, emergencyContact, emergencyPhone, openId, clinicId, active, createdAt, updatedAt, deletedAt
        FROM Patient
        `,
        [
          { name: 'idx_patient_clinic', columns: 'clinicId' },
          { name: 'idx_patient_name', columns: 'name' },
          { name: 'idx_patient_phone', columns: 'phone' },
          { name: 'idx_patient_code', columns: 'code' },
          { name: 'idx_patient_source', columns: 'source' },
        ]
      );
      logger.log('Patient.code 全局唯一约束已改为诊所内唯一');
    }
  }

  // 2. Charge.number: UNIQUE NOT NULL -> UNIQUE(clinicId, number)
  if (tableExists('Charge')) {
    const tableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='Charge'").get() as { sql: string } | undefined;
    if (tableSql?.sql?.includes('number TEXT UNIQUE NOT NULL') && !tableSql?.sql?.includes('UNIQUE(clinicId, number)')) {
      rebuildTableWithNewCheck(
        'Charge',
        `
        CREATE TABLE Charge_new (
          id TEXT PRIMARY KEY,
          patientId TEXT NOT NULL,
          visitId TEXT,
          doctorId TEXT,
          number TEXT NOT NULL,
          totalAmount INTEGER NOT NULL CHECK (totalAmount >= 0),
          paidAmount INTEGER DEFAULT 0 CHECK (paidAmount >= 0),
          refundedAmount INTEGER DEFAULT 0 CHECK (refundedAmount >= 0),
          discount INTEGER DEFAULT 0 CHECK (discount >= 0),
          status TEXT DEFAULT 'UNPAID' CHECK (status IN ('UNPAID', 'PARTIAL', 'PAID', 'REFUNDED', 'CANCELLED')),
          payMethod TEXT,
          paidAt TEXT,
          remark TEXT,
          clinicId TEXT NOT NULL,
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
          updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
          deletedAt TEXT,
          UNIQUE(clinicId, number),
          FOREIGN KEY (patientId) REFERENCES Patient(id),
          FOREIGN KEY (visitId) REFERENCES Visit(id),
          FOREIGN KEY (doctorId) REFERENCES User(id)
        )
        `,
        `
        INSERT INTO Charge_new (id, patientId, visitId, doctorId, number, totalAmount, paidAmount, refundedAmount, discount, status, payMethod, paidAt, remark, clinicId, createdAt, updatedAt, deletedAt)
        SELECT id, patientId, visitId, doctorId, number, totalAmount, paidAmount, refundedAmount, discount, status, payMethod, paidAt, remark, clinicId, createdAt, updatedAt, deletedAt
        FROM Charge
        `,
        [
          { name: 'idx_charge_clinic', columns: 'clinicId' },
          { name: 'idx_charge_patient_status', columns: 'patientId, status' },
          { name: 'idx_charge_doctor', columns: 'doctorId' },
        ]
      );
      logger.log('Charge.number 全局唯一约束已改为诊所内唯一');
    }
  }

  // 3. MemberCard.cardNo: UNIQUE NOT NULL -> UNIQUE(clinicId, cardNo)
  if (tableExists('MemberCard')) {
    const tableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='MemberCard'").get() as { sql: string } | undefined;
    if (tableSql?.sql?.includes('cardNo TEXT UNIQUE NOT NULL') && !tableSql?.sql?.includes('UNIQUE(clinicId, cardNo)')) {
      rebuildTableWithNewCheck(
        'MemberCard',
        `
        CREATE TABLE MemberCard_new (
          id TEXT PRIMARY KEY,
          patientId TEXT NOT NULL,
          cardNo TEXT NOT NULL,
          balance INTEGER DEFAULT 0 CHECK (balance >= 0),
          totalRecharge INTEGER DEFAULT 0 CHECK (totalRecharge >= 0),
          totalConsume INTEGER DEFAULT 0 CHECK (totalConsume >= 0),
          points INTEGER DEFAULT 0,
          totalPoints INTEGER DEFAULT 0,
          level TEXT DEFAULT 'NORMAL',
          status TEXT DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED', 'FROZEN', 'EXPIRED')),
          clinicId TEXT NOT NULL,
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
          updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
          deletedAt TEXT,
          UNIQUE(clinicId, cardNo),
          FOREIGN KEY (patientId) REFERENCES Patient(id)
        )
        `,
        `
        INSERT INTO MemberCard_new (id, patientId, cardNo, balance, totalRecharge, totalConsume, points, totalPoints, level, status, clinicId, createdAt, updatedAt, deletedAt)
        SELECT id, patientId, cardNo, balance, totalRecharge, totalConsume, points, totalPoints, level, status, clinicId, createdAt, updatedAt, deletedAt
        FROM MemberCard
        `,
        [
          { name: 'idx_membercard_clinic', columns: 'clinicId' },
        ]
      );
      logger.log('MemberCard.cardNo 全局唯一约束已改为诊所内唯一');
    }
  }

  // 4. TreatmentCatalog.code: UNIQUE NOT NULL -> UNIQUE(clinicId, code)
  if (tableExists('TreatmentCatalog')) {
    const tableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='TreatmentCatalog'").get() as { sql: string } | undefined;
    if (tableSql?.sql?.includes('code TEXT UNIQUE NOT NULL') && !tableSql?.sql?.includes('UNIQUE(clinicId, code)')) {
      rebuildTableWithNewCheck(
        'TreatmentCatalog',
        `
        CREATE TABLE TreatmentCatalog_new (
          id TEXT PRIMARY KEY,
          code TEXT NOT NULL,
          name TEXT NOT NULL,
          category TEXT NOT NULL,
          price INTEGER NOT NULL CHECK (price >= 0),
          remark TEXT,
          clinicId TEXT NOT NULL,
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(clinicId, code)
        )
        `,
        `
        INSERT INTO TreatmentCatalog_new (id, code, name, category, price, remark, clinicId, createdAt)
        SELECT id, code, name, category, price, remark, clinicId, createdAt
        FROM TreatmentCatalog
        `,
        [
          { name: 'idx_treatment_catalog_clinic', columns: 'clinicId' },
        ]
      );
      logger.log('TreatmentCatalog.code 全局唯一约束已改为诊所内唯一');
    }
  }

  // 5. DrugCatalog.code: UNIQUE NOT NULL -> UNIQUE(clinicId, code)
  if (tableExists('DrugCatalog')) {
    const tableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='DrugCatalog'").get() as { sql: string } | undefined;
    if (tableSql?.sql?.includes('code TEXT UNIQUE NOT NULL') && !tableSql?.sql?.includes('UNIQUE(clinicId, code)')) {
      rebuildTableWithNewCheck(
        'DrugCatalog',
        `
        CREATE TABLE DrugCatalog_new (
          id TEXT PRIMARY KEY,
          code TEXT NOT NULL,
          name TEXT NOT NULL,
          spec TEXT NOT NULL,
          category TEXT NOT NULL,
          price INTEGER NOT NULL CHECK (price >= 0),
          unit TEXT NOT NULL,
          stock REAL DEFAULT 0 CHECK (stock >= 0),
          remark TEXT,
          clinicId TEXT NOT NULL,
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(clinicId, code)
        )
        `,
        `
        INSERT INTO DrugCatalog_new (id, code, name, spec, category, price, unit, stock, remark, clinicId, createdAt)
        SELECT id, code, name, spec, category, price, unit, stock, remark, clinicId, createdAt
        FROM DrugCatalog
        `,
        [
          { name: 'idx_drugcatalog_clinic', columns: 'clinicId' },
        ]
      );
      logger.log('DrugCatalog.code 全局唯一约束已改为诊所内唯一');
    }
  }

  // 6. InventoryItem.code: UNIQUE NOT NULL -> UNIQUE(clinicId, code)
  if (tableExists('InventoryItem')) {
    const tableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='InventoryItem'").get() as { sql: string } | undefined;
    if (tableSql?.sql?.includes('code TEXT UNIQUE NOT NULL') && !tableSql?.sql?.includes('UNIQUE(clinicId, code)')) {
      rebuildTableWithNewCheck(
        'InventoryItem',
        `
        CREATE TABLE InventoryItem_new (
          id TEXT PRIMARY KEY,
          code TEXT NOT NULL,
          name TEXT NOT NULL,
          spec TEXT,
          category TEXT NOT NULL,
          unit TEXT NOT NULL,
          stock REAL DEFAULT 0 CHECK (stock >= 0),
          minStock REAL DEFAULT 0 CHECK (minStock >= 0),
          price INTEGER DEFAULT 0,
          supplierId TEXT,
          expireDate TEXT,
          location TEXT,
          remark TEXT,
          clinicId TEXT NOT NULL,
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
          updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
          deletedAt TEXT,
          UNIQUE(clinicId, code),
          FOREIGN KEY (supplierId) REFERENCES Supplier(id)
        )
        `,
        `
        INSERT INTO InventoryItem_new (id, code, name, spec, category, unit, stock, minStock, price, supplierId, expireDate, location, remark, clinicId, createdAt, updatedAt, deletedAt)
        SELECT id, code, name, spec, category, unit, stock, minStock, price, supplierId, expireDate, location, remark, clinicId, createdAt, updatedAt, deletedAt
        FROM InventoryItem
        `,
        [
          { name: 'idx_inventory_item_clinic', columns: 'clinicId' },
        ]
      );
      logger.log('InventoryItem.code 全局唯一约束已改为诊所内唯一');
    }
  }

  // 7. PurchaseOrder.number: UNIQUE NOT NULL -> UNIQUE(clinicId, number)
  if (tableExists('PurchaseOrder')) {
    const tableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='PurchaseOrder'").get() as { sql: string } | undefined;
    if (tableSql?.sql?.includes('number TEXT UNIQUE NOT NULL') && !tableSql?.sql?.includes('UNIQUE(clinicId, number)')) {
      rebuildTableWithNewCheck(
        'PurchaseOrder',
        `
        CREATE TABLE PurchaseOrder_new (
          id TEXT PRIMARY KEY,
          number TEXT NOT NULL,
          supplierId TEXT NOT NULL,
          totalAmount INTEGER DEFAULT 0,
          status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PARTIAL', 'RECEIVED', 'CANCELLED')),
          operatorId TEXT,
          remark TEXT,
          clinicId TEXT NOT NULL,
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
          updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
          deletedAt TEXT,
          UNIQUE(clinicId, number),
          FOREIGN KEY (supplierId) REFERENCES Supplier(id),
          FOREIGN KEY (operatorId) REFERENCES User(id)
        )
        `,
        `
        INSERT INTO PurchaseOrder_new (id, number, supplierId, totalAmount, status, operatorId, remark, clinicId, createdAt, updatedAt, deletedAt)
        SELECT id, number, supplierId, totalAmount, status, operatorId, remark, clinicId, createdAt, updatedAt, deletedAt
        FROM PurchaseOrder
        `,
        [
          { name: 'idx_purchase_order_clinic', columns: 'clinicId' },
        ]
      );
      logger.log('PurchaseOrder.number 全局唯一约束已改为诊所内唯一');
    }
  }

  // 8. ProcessingOrder.number: UNIQUE NOT NULL -> UNIQUE(clinicId, number)
  if (tableExists('ProcessingOrder')) {
    const tableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='ProcessingOrder'").get() as { sql: string } | undefined;
    if (tableSql?.sql?.includes('number TEXT UNIQUE NOT NULL') && !tableSql?.sql?.includes('UNIQUE(clinicId, number)')) {
      rebuildTableWithNewCheck(
        'ProcessingOrder',
        `
        CREATE TABLE ProcessingOrder_new (
          id TEXT PRIMARY KEY,
          number TEXT NOT NULL,
          patientId TEXT NOT NULL,
          visitId TEXT,
          factoryId TEXT NOT NULL,
          doctorId TEXT,
          shade TEXT,
          teethNumbers TEXT DEFAULT '[]',
          totalFee INTEGER DEFAULT 0,
          status TEXT DEFAULT 'SENT' CHECK (status IN ('PENDING', 'SENT', 'IN_PROGRESS', 'COMPLETED', 'RECEIVED', 'CANCELLED')),
          chargeId TEXT,
          sentAt TEXT,
          expectedAt TEXT,
          receivedAt TEXT,
          deliveredAt TEXT,
          remark TEXT,
          creatorId TEXT,
          clinicId TEXT NOT NULL,
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
          updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
          deletedAt TEXT,
          UNIQUE(clinicId, number),
          FOREIGN KEY (patientId) REFERENCES Patient(id),
          FOREIGN KEY (visitId) REFERENCES Visit(id),
          FOREIGN KEY (factoryId) REFERENCES ProcessingFactory(id),
          FOREIGN KEY (doctorId) REFERENCES User(id),
          FOREIGN KEY (chargeId) REFERENCES Charge(id)
        )
        `,
        `
        INSERT INTO ProcessingOrder_new (id, number, patientId, visitId, factoryId, doctorId, shade, teethNumbers, totalFee, status, chargeId, sentAt, expectedAt, receivedAt, deliveredAt, remark, creatorId, clinicId, createdAt, updatedAt, deletedAt)
        SELECT id, number, patientId, visitId, factoryId, doctorId, shade, teethNumbers, totalFee, status, chargeId, sentAt, expectedAt, receivedAt, deliveredAt, remark, creatorId, clinicId, createdAt, updatedAt, deletedAt
        FROM ProcessingOrder
        `,
        [
          { name: 'idx_processing_order_clinic', columns: 'clinicId' },
        ]
      );
      logger.log('ProcessingOrder.number 全局唯一约束已改为诊所内唯一');
    }
  }

  logger.log('v25 迁移完成：多租户 UNIQUE 约束改为诊所内唯一');
};

const migrateToV26 = () => {
  // P1 修复：CHECK 约束与代码枚举不一致
  //
  // 1. FirstExam：DB 约束有 CANCELLED（代码未使用），缺失 REJECTED（代码使用）
  //    原约束: DRAFT, SUBMITTED, APPROVED, CANCELLED
  //    新约束: DRAFT, SUBMITTED, APPROVED, REJECTED
  //
  // 2. TreatmentPlan：DB 约束缺失 SUBMITTED 和 REJECTED（代码状态机使用）
  //    原约束: DRAFT, APPROVED, IN_PROGRESS, COMPLETED, CANCELLED
  //    新约束: DRAFT, SUBMITTED, APPROVED, REJECTED, IN_PROGRESS, COMPLETED, CANCELLED
  //
  // 3. TreatmentPlanItem：DB 约束缺少 SKIPPED（shared enum 使用）
  //    原约束: PLANNED, IN_PROGRESS, COMPLETED, CANCELLED
  //    新约束: PLANNED, IN_PROGRESS, COMPLETED, CANCELLED, SKIPPED
  //
  // 由于之前 FirstExam/PlanStatus enum 修复已清理 PENDING 等无效值，
  // 此处只需扩展 CHECK 集合。
  const db = getMigrationDb();

  // 1. FirstExam: CANCELLED -> REJECTED（如有历史 CANCELLED 数据需迁移为 REJECTED 以保持一致）
  if (tableExists('FirstExam')) {
    const tableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='FirstExam'").get() as { sql: string } | undefined;
    if (tableSql?.sql?.includes("'CANCELLED'") && !tableSql?.sql?.includes("'REJECTED'")) {
      const cancelledCount = (db.prepare(
        "SELECT COUNT(*) as count FROM FirstExam WHERE status = 'CANCELLED'"
      ).get() as { count: number })?.count || 0;
      if (cancelledCount > 0) {
        logger.log(`FirstExam 表存在 ${cancelledCount} 条 CANCELLED 状态数据，将迁移为 REJECTED`);
      }
      rebuildTableWithNewCheck(
        'FirstExam',
        `
        CREATE TABLE FirstExam_new (
          id TEXT PRIMARY KEY,
          patientId TEXT NOT NULL,
          doctorId TEXT,
          consultantId TEXT,
          examDate TEXT DEFAULT CURRENT_TIMESTAMP,
          dentitionType TEXT DEFAULT 'PERMANENT',
          chiefComplaint TEXT,
          diagnosis TEXT,
          treatmentSuggestion TEXT,
          remark TEXT,
          isRestart INTEGER DEFAULT 0,
          parentExamId TEXT,
          status TEXT DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED')),
          clinicId TEXT NOT NULL,
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
          updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
          deletedAt TEXT,
          FOREIGN KEY (patientId) REFERENCES Patient(id),
          FOREIGN KEY (doctorId) REFERENCES User(id),
          FOREIGN KEY (consultantId) REFERENCES User(id)
        )
        `,
        `
        INSERT INTO FirstExam_new (id, patientId, doctorId, consultantId, examDate, dentitionType, chiefComplaint, diagnosis, treatmentSuggestion, remark, isRestart, parentExamId, status, clinicId, createdAt, updatedAt, deletedAt)
        SELECT id, patientId, doctorId, consultantId, examDate, dentitionType, chiefComplaint, diagnosis, treatmentSuggestion, remark, isRestart, parentExamId,
               CASE WHEN status = 'CANCELLED' THEN 'REJECTED' ELSE status END,
               clinicId, createdAt, updatedAt, deletedAt
        FROM FirstExam
        `,
      );
      logger.log('FirstExam 表状态 CHECK 约束已更新（CANCELLED → REJECTED）');
    }
  }

  // 2. TreatmentPlan: 添加 SUBMITTED 和 REJECTED
  if (tableExists('TreatmentPlan')) {
    const tableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='TreatmentPlan'").get() as { sql: string } | undefined;
    if (tableSql?.sql && !tableSql.sql.includes("'SUBMITTED'") && !tableSql.sql.includes("'REJECTED'")) {
      rebuildTableWithNewCheck(
        'TreatmentPlan',
        `
        CREATE TABLE TreatmentPlan_new (
          id TEXT PRIMARY KEY,
          patientId TEXT NOT NULL,
          visitId TEXT,
          doctorId TEXT NOT NULL,
          name TEXT NOT NULL,
          status TEXT DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
          totalFee INTEGER DEFAULT 0 CHECK (totalFee >= 0),
          remark TEXT,
          clinicId TEXT NOT NULL,
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
          updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
          deletedAt TEXT,
          FOREIGN KEY (patientId) REFERENCES Patient(id),
          FOREIGN KEY (visitId) REFERENCES Visit(id),
          FOREIGN KEY (doctorId) REFERENCES User(id)
        )
        `,
        `
        INSERT INTO TreatmentPlan_new (id, patientId, visitId, doctorId, name, status, totalFee, remark, clinicId, createdAt, updatedAt, deletedAt)
        SELECT id, patientId, visitId, doctorId, name, status, totalFee, remark, clinicId, createdAt, updatedAt, deletedAt
        FROM TreatmentPlan
        `,
      );
      logger.log('TreatmentPlan 表状态 CHECK 约束已更新（添加 SUBMITTED/REJECTED）');
    }
  }

  // 3. TreatmentPlanItem: 添加 SKIPPED
  if (tableExists('TreatmentPlanItem')) {
    const tableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='TreatmentPlanItem'").get() as { sql: string } | undefined;
    if (tableSql?.sql && !tableSql.sql.includes("'SKIPPED'")) {
      rebuildTableWithNewCheck(
        'TreatmentPlanItem',
        `
        CREATE TABLE TreatmentPlanItem_new (
          id TEXT PRIMARY KEY,
          planId TEXT NOT NULL,
          code TEXT NOT NULL,
          name TEXT NOT NULL,
          category TEXT NOT NULL,
          price INTEGER NOT NULL CHECK (price >= 0),
          quantity INTEGER DEFAULT 1 CHECK (quantity >= 1),
          teethNumbers TEXT DEFAULT '[]',
          status TEXT DEFAULT 'PLANNED' CHECK (status IN ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'SKIPPED')),
          treatmentId TEXT,
          completedAt TEXT,
          remark TEXT,
          clinicId TEXT NOT NULL,
          updatedAt TEXT,
          deletedAt TEXT,
          FOREIGN KEY (planId) REFERENCES TreatmentPlan(id) ON DELETE CASCADE,
          FOREIGN KEY (treatmentId) REFERENCES Treatment(id)
        )
        `,
        `
        INSERT INTO TreatmentPlanItem_new (id, planId, code, name, category, price, quantity, teethNumbers, status, treatmentId, completedAt, remark, clinicId, updatedAt, deletedAt)
        SELECT id, planId, code, name, category, price, quantity, teethNumbers, status, treatmentId, completedAt, remark, clinicId, updatedAt, deletedAt
        FROM TreatmentPlanItem
        `,
      );
      logger.log('TreatmentPlanItem 表状态 CHECK 约束已更新（添加 SKIPPED）');
    }
  }

  logger.log('v26 迁移完成：CHECK 约束与代码枚举对齐');
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
  migrationDb = db;
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
      const db = getMigrationDb();
      const migrateTx = db.transaction(() => {
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
