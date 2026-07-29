import {
  addColumnIfMissing,
  tableExists,
  getMigrationDb,
  rebuildTableWithNewCheck,
  logger,
} from './helpers';

export const migrateToV16 = () => {
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

export const migrateToV17 = () => {
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

export const migrateToV18 = () => {
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
        ].filter((x): x is { name: string; columns: string } => x !== null)
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
        ].filter((x): x is { name: string; columns: string } => x !== null)
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