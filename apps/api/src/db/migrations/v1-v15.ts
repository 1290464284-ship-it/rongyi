import {
  addColumnIfMissing,
  createIndexIfNotExists,
  columnExists,
  tableExists,
  getMigrationDb,
  rebuildTableWithNewCheck,
  logger,
} from './helpers';

export const migrateToV1 = () => {
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

export const migrateToV2 = () => {
  createIndexIfNotExists('idx_charge_doctor', 'Charge', 'doctorId');
  createIndexIfNotExists('idx_medical_record_created_at', 'MedicalRecord', 'createdAt');
  createIndexIfNotExists('idx_charge_patient_status', 'Charge', 'patientId, status');
  createIndexIfNotExists('idx_medical_record_doctor', 'MedicalRecord', 'doctorId');

  if (tableExists('InventoryTransaction')) {
    createIndexIfNotExists('idx_inv_trans_item_created', 'InventoryTransaction', 'itemId, createdAt DESC');
    createIndexIfNotExists('idx_inv_trans_type_created', 'InventoryTransaction', 'type, createdAt DESC');
    createIndexIfNotExists('idx_inv_trans_clinic_created', 'InventoryTransaction', 'clinicId, createdAt DESC');
  }

  if (tableExists('BackupRecord')) {
    createIndexIfNotExists('idx_backup_clinic_created', 'BackupRecord', 'clinicId, createdAt DESC');
  }

  const tablesNeedUpdatedAt = [
    'ChargeItem', 'TreatmentPlanItem', 'PrescriptionItem', 'PurchaseOrderItem',
    'MemberCardLog', 'MemberPointLog', 'InventoryTransaction', 'OperationLog',
    'BackupRecord', 'SmsLog', 'WechatMessage', 'Refund', 'Invoice',
  ];
  tablesNeedUpdatedAt.forEach(table => {
    addColumnIfMissing(table, 'updatedAt', 'TEXT DEFAULT CURRENT_TIMESTAMP');
  });
};

export const migrateToV3 = () => {
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

export const migrateToV4 = () => {
  addColumnIfMissing('Charge', 'refundedAmount', 'REAL DEFAULT 0');
};

export const migrateToV5 = () => {
  addColumnIfMissing('ProcessingOrder', 'deletedAt', 'TEXT');
  createIndexIfNotExists('idx_processingorder_deleted', 'ProcessingOrder', 'deletedAt');
};

export const migrateToV6 = () => {
  addColumnIfMissing('Appointment', 'visitId', 'TEXT');
  createIndexIfNotExists('idx_appointment_visit', 'Appointment', 'visitId');

  addColumnIfMissing('ChargeItem', 'inventoryItemId', 'TEXT');
  addColumnIfMissing('ChargeItem', 'consumedQuantity', 'REAL DEFAULT 0');

  try {
    getMigrationDb().exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_debt_charge_unique ON DebtRecord(chargeId)');
  } catch (err: unknown) {
    logger.warn('跳过 DebtRecord.chargeId 唯一索引创建（可能存在历史重复数据）:', (err as Error).message);
  }
};

export const migrateToV7 = () => {
  const tablesNeedDeletedAt = ['DebtRecord', 'WechatMessage', 'FirstExamTrack'];
  tablesNeedDeletedAt.forEach(table => {
    addColumnIfMissing(table, 'deletedAt', 'TEXT');
  });
};

export const migrateToV8 = () => {
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

  tablesNeedClinicId.forEach(table => {
    const indexName = `idx_${table.toLowerCase()}_clinic`;
    createIndexIfNotExists(indexName, table, 'clinicId');
  });
};

export const migrateToV9 = () => {
  addColumnIfMissing('PurchaseOrder', 'deletedAt', 'TEXT');
  createIndexIfNotExists('idx_purchase_order_deleted', 'PurchaseOrder', 'deletedAt');
};

export const migrateToV10 = () => {
  const db = getMigrationDb();
  if (!columnExists('ClinicInfo', 'clinicId')) {
    if (!tableExists('ClinicInfo') && tableExists('ClinicInfo_new')) {
      throw new Error(
        '检测到迁移残留: 表 ClinicInfo 不存在但 ClinicInfo_new 存在。' +
        '请手动将 ClinicInfo_new 重命名为 ClinicInfo 后重启。'
      );
    }
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
  createIndexIfNotExists('idx_used_refresh_token_usedat', 'UsedRefreshToken', 'usedAt');
};

export const migrateToV11 = () => {
  const db = getMigrationDb();
  if (!tableExists('Appointment')) return;

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

export const migrateToV12 = () => {
  const db = getMigrationDb();
  if (!tableExists('MemberCard')) return;

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

export const migrateToV13 = () => {
  const db = getMigrationDb();
  if (!tableExists('PurchaseOrder')) return;

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

export const migrateToV14 = () => {
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

export const migrateToV15 = () => {
  addColumnIfMissing('ChargeCombo', 'updatedAt', 'TEXT DEFAULT CURRENT_TIMESTAMP');
  addColumnIfMissing('PaymentMethod', 'updatedAt', 'TEXT DEFAULT CURRENT_TIMESTAMP');
  addColumnIfMissing('ChargeComboItem', 'updatedAt', 'TEXT DEFAULT CURRENT_TIMESTAMP');
  addColumnIfMissing('ChargeComboItem', 'createdAt', 'TEXT DEFAULT CURRENT_TIMESTAMP');
  addColumnIfMissing('InventoryTransaction', 'deletedAt', 'TEXT');
  addColumnIfMissing('InventoryTransaction', 'updatedAt', 'TEXT DEFAULT CURRENT_TIMESTAMP');
};
