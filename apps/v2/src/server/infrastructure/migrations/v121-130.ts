import type { Migration } from './index';
import { addColumns } from './helpers';

// 迁移版本 121..130（M-04：由 migrations.ts 拆分）
export const migrations121to130: Migration[] = [
  {
    version: 121,
    name: 'v2-backfill-null-clinic-ids',
    up(db) {
      const tables = ['User', 'Patient', 'Appointment', 'Charge', 'Refund', 'MemberCard', 'ChargeItem',
        'Treatment', 'Visit', 'FollowUp', 'InventoryItem', 'InventoryTransaction', 'Supplier',
        'PurchaseOrder', 'PurchaseOrderItem', 'ProcessingOrder', 'Debt', 'OperationLog', 'Alert', 'Notification'];
      const defaultClinic = db.prepare(`SELECT id FROM Clinic ORDER BY createdAt ASC LIMIT 1`).get() as { id: string } | undefined;
      if (!defaultClinic) return; // 无诊所数据时跳过
      // 用户特殊处理：优先取 UserClinic 第一个成员关系。
      // 必须先于通用回填执行，否则 User 的 NULL 已被填为最早诊所，COALESCE 永不生效。
      const userCols = (db.prepare('PRAGMA table_info("User")').all() as Array<{ name: string }>).map((c) => c.name);
      const userClinicExists = db.prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'UserClinic'`,
      ).get() !== undefined;
      if (userCols.includes('clinicId') && userClinicExists) {
        db.prepare(`UPDATE User SET clinicId = COALESCE(
          (SELECT clinicId FROM UserClinic WHERE userId = User.id AND deletedAt IS NULL LIMIT 1), ?
        ) WHERE clinicId IS NULL`).run(defaultClinic.id);
      }
      const clinicColumn = 'clinicId';
      for (const table of tables) {
        const cols = (db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>).map((c) => c.name);
        if (!cols.includes(clinicColumn)) continue;
        db.prepare(`UPDATE "${table}" SET "${clinicColumn}" = ? WHERE "${clinicColumn}" IS NULL`).run(defaultClinic.id);
      }
      // 记录修复
      db.exec(`CREATE TABLE IF NOT EXISTS MigrationRepairLog (id TEXT PRIMARY KEY, tableName TEXT NOT NULL, field TEXT NOT NULL, recordId TEXT, beforeValue TEXT, afterValue TEXT, reason TEXT NOT NULL, createdAt TEXT DEFAULT CURRENT_TIMESTAMP)`);
    },
  },  {
    version: 122,
    name: 'v2-operationlog-status-code',
    up(db) {
      const columns = new Set(
        (db.prepare('PRAGMA table_info(OperationLog)').all() as Array<{ name: string }>).map((column) => column.name),
      );
      if (!columns.has('statusCode')) {
        db.exec('ALTER TABLE OperationLog ADD COLUMN statusCode TEXT');
      }
    },
  },  {
    version: 123,
    name: 'v2-userclinic-backfill-members',
    up(db) {
      // R2-P1-22：迁移 121 只从 UserClinic 回填 User.clinicId，不反向补成员行；
      // User.clinicId 非 NULL 但 UserClinic 无对应行的用户会产生关系不一致。
      // 这里按 User.clinicId 反向补齐成员行（role 取自 User.role）。
      // 防御：老库可能没有 UserClinic 表或 User.clinicId 列，缺失则跳过。
      const userClinicExists = db.prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'UserClinic'`,
      ).get() !== undefined;
      if (!userClinicExists) return;
      const userColumns = new Set(
        (db.prepare('PRAGMA table_info(User)').all() as Array<{ name: string }>).map((column) => column.name),
      );
      if (!userColumns.has('clinicId')) return;
      const now = new Date().toISOString();
      // clinicId IN (SELECT id FROM Clinic) 过滤悬空引用：UserClinic.clinicId
      // 有外键约束，INSERT OR IGNORE 不适用于外键违例，悬空引用会让整个迁移抛错。
      db.prepare(
        `INSERT OR IGNORE INTO UserClinic (userId, clinicId, role, createdAt, updatedAt, deletedAt)
         SELECT id, clinicId, role, ?, ?, NULL
         FROM User
         WHERE clinicId IS NOT NULL
           AND clinicId IN (SELECT id FROM Clinic)
           AND NOT EXISTS (
             SELECT 1 FROM UserClinic UC
             WHERE UC.userId = User.id AND UC.clinicId = User.clinicId AND UC.deletedAt IS NULL
           )`,
      ).run(now, now);
    },
  },  {
    version: 124,
    name: 'v2-followup-execution',
    up(db) {
      addColumns(db, 'FollowUp', [
        ['executionStatus', "TEXT DEFAULT 'PENDING'"],
        ['patientRating', 'INTEGER'],
        ['painLevel', 'INTEGER'],
        ['feedback', 'TEXT'],
        ['contactedAt', 'TEXT'],
        ['nextPlanDate', 'TEXT'],
      ]);
    },
  },  {
    version: 125,
    name: 'v2-medical-record-edit-request',
    up(db) {
      addColumns(db, 'MedicalRecord', [
        ['editRequestStatus', "TEXT DEFAULT 'NONE'"],
        ['editRequestReason', 'TEXT'],
        ['editRequestedById', 'TEXT'],
        ['editRequestedAt', 'TEXT'],
        ['reviewedById', 'TEXT'],
        ['reviewedAt', 'TEXT'],
        ['reviewNote', 'TEXT'],
      ]);
    },
  },  {
    version: 126,
    name: 'v2-member-card-discount-plan',
    up(db) {
      addColumns(db, 'MemberCard', [
        ['discountRate', 'INTEGER'],
        ['maxDiscountAmount', 'INTEGER'],
        ['roundingMode', "TEXT DEFAULT 'FLOOR'"],
        ['annualDiscountLimit', 'INTEGER'],
        ['specialDiscountsJson', "TEXT DEFAULT '[]'"],
      ]);
      addColumns(db, 'Charge', [
        ['discountPlanSnapshotJson', "TEXT DEFAULT '{}'"],
      ]);
    },
  },  {
    version: 127,
    name: 'v2-inventory-batches',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS InventoryBatch (
          id TEXT PRIMARY KEY,
          itemId TEXT NOT NULL,
          batchNo TEXT,
          productionDate TEXT,
          expiryDate TEXT,
          initialQuantity INTEGER DEFAULT 0,
          remainingQuantity INTEGER DEFAULT 0,
          supplierId TEXT,
          purchaseOrderId TEXT,
          active INTEGER DEFAULT 1,
          clinicId TEXT,
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
          updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
          deletedAt TEXT,
          FOREIGN KEY (itemId) REFERENCES InventoryItem(id),
          FOREIGN KEY (supplierId) REFERENCES Supplier(id)
        )
      `);
      addColumns(db, 'InventoryTransaction', [
        ['batchId', 'TEXT'],
      ]);
      addColumns(db, 'InventoryItem', [
        ['batchManaged', 'INTEGER DEFAULT 0'],
      ]);
    },
  },  {
    version: 128,
    name: 'v2-stocktakes',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS Stocktake (
          id TEXT PRIMARY KEY,
          number TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'IN_PROGRESS'
            CHECK (status IN ('IN_PROGRESS', 'LOCKED', 'COMPLETED', 'CANCELLED')),
          startedById TEXT,
          startedAt TEXT,
          completedById TEXT,
          completedAt TEXT,
          note TEXT,
          clinicId TEXT,
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
          updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
          deletedAt TEXT,
          UNIQUE(clinicId, number)
        );
        CREATE TABLE IF NOT EXISTS StocktakeItem (
          id TEXT PRIMARY KEY,
          stocktakeId TEXT NOT NULL,
          itemId TEXT NOT NULL,
          systemStock INTEGER DEFAULT 0,
          countedStock INTEGER,
          difference INTEGER DEFAULT 0,
          note TEXT,
          clinicId TEXT,
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
          updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
          deletedAt TEXT,
          FOREIGN KEY (stocktakeId) REFERENCES Stocktake(id),
          FOREIGN KEY (itemId) REFERENCES InventoryItem(id)
        );
      `);
    },
  },  {
    version: 129,
    name: 'v2-first-exam-tracking',
    up(db) {
      addColumns(db, 'FirstExam', [
        ['followUpStatus', "TEXT DEFAULT 'NONE'"],
        ['lossReasonType', 'TEXT'],
        ['lossReason', 'TEXT'],
        ['nextFollowUpAt', 'TEXT'],
        ['trackingNote', 'TEXT'],
      ]);
    },
  },  {
    version: 130,
    name: 'v2-treatment-plan-signature',
    up(db) {
      addColumns(db, 'TreatmentPlan', [
        ['printCount', 'INTEGER DEFAULT 0'],
        ['lastPrintedAt', 'TEXT'],
        ['patientSignature', 'TEXT'],
        ['signedAt', 'TEXT'],
        ['signerName', 'TEXT'],
        ['signatureRemark', 'TEXT'],
      ]);
    },
  },
];
