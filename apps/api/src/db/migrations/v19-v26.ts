import {
  addColumnIfMissing,
  createIndexIfNotExists,
  tableExists,
  getMigrationDb,
  rebuildTableWithNewCheck,
  logger,
} from './helpers';

export const migrateToV19 = () => {
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

export const migrateToV20 = () => {
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

export const migrateToV21 = () => {
  addColumnIfMissing('User', 'passwordChangedAt', 'TEXT');
  addColumnIfMissing('User', 'isTempPassword', 'INTEGER DEFAULT 0');
  logger.log('v21 迁移完成：User 表添加 passwordChangedAt 和 isTempPassword 字段');
};

export const migrateToV22 = () => {
  if (tableExists('Patient')) {
    createIndexIfNotExists('idx_patient_clinic_phone', 'Patient', 'clinicId, phone');
    createIndexIfNotExists('idx_patient_clinic_code', 'Patient', 'clinicId, code');
  }
  logger.log('v22 迁移完成：患者搜索优化索引');
};

export const migrateToV23 = () => {
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

export const migrateToV24 = () => {
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

export const migrateToV25 = () => {
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

export const migrateToV26 = () => {
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