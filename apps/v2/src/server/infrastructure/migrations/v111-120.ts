import { resourceRegistry } from '../../../domain/resources';
import { uniqueIndexColumns } from '../database';
import type { Migration } from './index';
import { ensureForeignKeys } from './helpers';

export const migrations111to120: Migration[] = [
  {
    version: 111,
    name: 'v2-search-indexes',
    up(db) {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_v2_patient_search ON Patient(name, code);
        CREATE INDEX IF NOT EXISTS idx_v2_inventory_search ON InventoryItem(name, code);
        CREATE INDEX IF NOT EXISTS idx_v2_supplier_search ON Supplier(name, code, phone);
        CREATE INDEX IF NOT EXISTS idx_v2_charge_number ON Charge(number);
        CREATE INDEX IF NOT EXISTS idx_v2_appointment_patient_start ON Appointment(patientId, startTime);
      `);
    },
  },  {
    version: 112,
    name: 'v2-unique-field-indexes',
    up(db) {
      for (const resource of resourceRegistry.all()) {
        for (const field of resource.fields) {
          if (!field.unique) continue;
          const indexColumns = uniqueIndexColumns(db, resource.table, field.name);
          db.exec(
            `CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_unique_${resource.name}_${field.name}
             ON ${resource.table} (${indexColumns}) WHERE deletedAt IS NULL`,
          );
        }
      }
    },
  },  {
    version: 113,
    name: 'v2-auth-and-sync-performance-indexes',
    up(db) {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_v2_used_refresh_token_used_at ON UsedRefreshToken(usedAt);
        CREATE INDEX IF NOT EXISTS idx_v2_sync_change_clinic_created ON SyncChange(clinicId, createdAt);
      `);
    },
  },  {
    version: 114,
    name: 'v2-charge-member-card',
    up(db) {
      const columns = new Set(
        (db.prepare('PRAGMA table_info(Charge)').all() as Array<{ name: string }>).map((column) => column.name),
      );
      if (!columns.has('memberCardId')) {
        db.exec('ALTER TABLE Charge ADD COLUMN memberCardId TEXT');
      }
      db.exec('CREATE INDEX IF NOT EXISTS idx_v2_charge_member_card ON Charge(memberCardId)');
    },
  },  {
    version: 115,
    name: 'v2-fts-search-index',
    up(db) {
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS SearchIndex USING fts5(
          resource UNINDEXED,
          recordId UNINDEXED,
          clinicId UNINDEXED,
          content
        );
      `);
      db.exec(`
        DROP TRIGGER IF EXISTS search_patient_ai;
        CREATE TRIGGER search_patient_ai AFTER INSERT ON Patient BEGIN
          DELETE FROM SearchIndex WHERE resource = 'Patient' AND recordId = NEW.id;
          INSERT INTO SearchIndex(resource, recordId, clinicId, content)
          SELECT 'Patient', NEW.id, NEW.clinicId,
                 trim(COALESCE(NEW.name, '') || ' ' || COALESCE(NEW.code, '') || ' ' || COALESCE(NEW.phone, ''))
          WHERE NEW.deletedAt IS NULL;
        END;

        DROP TRIGGER IF EXISTS search_patient_au;
        CREATE TRIGGER search_patient_au AFTER UPDATE ON Patient BEGIN
          DELETE FROM SearchIndex WHERE resource = 'Patient' AND recordId = NEW.id;
          INSERT INTO SearchIndex(resource, recordId, clinicId, content)
          SELECT 'Patient', NEW.id, NEW.clinicId,
                 trim(COALESCE(NEW.name, '') || ' ' || COALESCE(NEW.code, '') || ' ' || COALESCE(NEW.phone, ''))
          WHERE NEW.deletedAt IS NULL;
        END;

        DROP TRIGGER IF EXISTS search_patient_ad;
        CREATE TRIGGER search_patient_ad AFTER DELETE ON Patient BEGIN
          DELETE FROM SearchIndex WHERE resource = 'Patient' AND recordId = OLD.id;
        END;

        DROP TRIGGER IF EXISTS search_patient_child_update;
        CREATE TRIGGER search_patient_child_update AFTER UPDATE OF name ON Patient BEGIN
          DELETE FROM SearchIndex WHERE resource = 'Appointment' AND recordId IN (
            SELECT id FROM Appointment WHERE patientId = NEW.id
          );
          INSERT INTO SearchIndex(resource, recordId, clinicId, content)
          SELECT 'Appointment', A.id, A.clinicId,
                 trim(COALESCE(P.name, '') || ' ' || COALESCE(A.startTime, '') || ' ' || COALESCE(A.status, ''))
          FROM Appointment A LEFT JOIN Patient P ON P.id = A.patientId
          WHERE A.patientId = NEW.id AND A.deletedAt IS NULL AND NEW.deletedAt IS NULL;

          DELETE FROM SearchIndex WHERE resource = 'Charge' AND recordId IN (
            SELECT id FROM Charge WHERE patientId = NEW.id
          );
          INSERT INTO SearchIndex(resource, recordId, clinicId, content)
          SELECT 'Charge', C.id, C.clinicId,
                 trim(COALESCE(P.name, '') || ' ' || COALESCE(C.number, '') || ' ' || COALESCE(C.status, ''))
          FROM Charge C LEFT JOIN Patient P ON P.id = C.patientId
          WHERE C.patientId = NEW.id AND C.deletedAt IS NULL AND NEW.deletedAt IS NULL;

          DELETE FROM SearchIndex WHERE resource = 'FollowUp' AND recordId IN (
            SELECT id FROM FollowUp WHERE patientId = NEW.id
          );
          INSERT INTO SearchIndex(resource, recordId, clinicId, content)
          SELECT 'FollowUp', F.id, F.clinicId,
                 trim(COALESCE(P.name, '') || ' ' || COALESCE(F.content, '') || ' ' || COALESCE(F.status, '') || ' ' || COALESCE(F.planDate, ''))
          FROM FollowUp F LEFT JOIN Patient P ON P.id = F.patientId
          WHERE F.patientId = NEW.id AND F.deletedAt IS NULL AND NEW.deletedAt IS NULL;
        END;

        DROP TRIGGER IF EXISTS search_inventory_item_ai;
        CREATE TRIGGER search_inventory_item_ai AFTER INSERT ON InventoryItem BEGIN
          DELETE FROM SearchIndex WHERE resource = 'InventoryItem' AND recordId = NEW.id;
          INSERT INTO SearchIndex(resource, recordId, clinicId, content)
          SELECT 'InventoryItem', NEW.id, NEW.clinicId,
                 trim(COALESCE(NEW.name, '') || ' ' || COALESCE(NEW.code, '') || ' ' || COALESCE(NEW.category, ''))
          WHERE NEW.deletedAt IS NULL;
        END;

        DROP TRIGGER IF EXISTS search_inventory_item_au;
        CREATE TRIGGER search_inventory_item_au AFTER UPDATE ON InventoryItem BEGIN
          DELETE FROM SearchIndex WHERE resource = 'InventoryItem' AND recordId = NEW.id;
          INSERT INTO SearchIndex(resource, recordId, clinicId, content)
          SELECT 'InventoryItem', NEW.id, NEW.clinicId,
                 trim(COALESCE(NEW.name, '') || ' ' || COALESCE(NEW.code, '') || ' ' || COALESCE(NEW.category, ''))
          WHERE NEW.deletedAt IS NULL;
        END;

        DROP TRIGGER IF EXISTS search_inventory_item_ad;
        CREATE TRIGGER search_inventory_item_ad AFTER DELETE ON InventoryItem BEGIN
          DELETE FROM SearchIndex WHERE resource = 'InventoryItem' AND recordId = OLD.id;
        END;

        DROP TRIGGER IF EXISTS search_supplier_ai;
        CREATE TRIGGER search_supplier_ai AFTER INSERT ON Supplier BEGIN
          DELETE FROM SearchIndex WHERE resource = 'Supplier' AND recordId = NEW.id;
          INSERT INTO SearchIndex(resource, recordId, clinicId, content)
          SELECT 'Supplier', NEW.id, NEW.clinicId,
                 trim(COALESCE(NEW.name, '') || ' ' || COALESCE(NEW.code, '') || ' ' || COALESCE(NEW.phone, ''))
          WHERE NEW.deletedAt IS NULL;
        END;

        DROP TRIGGER IF EXISTS search_supplier_au;
        CREATE TRIGGER search_supplier_au AFTER UPDATE ON Supplier BEGIN
          DELETE FROM SearchIndex WHERE resource = 'Supplier' AND recordId = NEW.id;
          INSERT INTO SearchIndex(resource, recordId, clinicId, content)
          SELECT 'Supplier', NEW.id, NEW.clinicId,
                 trim(COALESCE(NEW.name, '') || ' ' || COALESCE(NEW.code, '') || ' ' || COALESCE(NEW.phone, ''))
          WHERE NEW.deletedAt IS NULL;
        END;

        DROP TRIGGER IF EXISTS search_supplier_ad;
        CREATE TRIGGER search_supplier_ad AFTER DELETE ON Supplier BEGIN
          DELETE FROM SearchIndex WHERE resource = 'Supplier' AND recordId = OLD.id;
        END;

        DROP TRIGGER IF EXISTS search_appointment_ai;
        CREATE TRIGGER search_appointment_ai AFTER INSERT ON Appointment BEGIN
          DELETE FROM SearchIndex WHERE resource = 'Appointment' AND recordId = NEW.id;
          INSERT INTO SearchIndex(resource, recordId, clinicId, content)
          SELECT 'Appointment', NEW.id, NEW.clinicId,
                 trim(COALESCE((SELECT name FROM Patient WHERE id = NEW.patientId), '') || ' ' || COALESCE(NEW.startTime, '') || ' ' || COALESCE(NEW.status, ''))
          WHERE NEW.deletedAt IS NULL;
        END;

        DROP TRIGGER IF EXISTS search_appointment_au;
        CREATE TRIGGER search_appointment_au AFTER UPDATE ON Appointment BEGIN
          DELETE FROM SearchIndex WHERE resource = 'Appointment' AND recordId = NEW.id;
          INSERT INTO SearchIndex(resource, recordId, clinicId, content)
          SELECT 'Appointment', NEW.id, NEW.clinicId,
                 trim(COALESCE((SELECT name FROM Patient WHERE id = NEW.patientId), '') || ' ' || COALESCE(NEW.startTime, '') || ' ' || COALESCE(NEW.status, ''))
          WHERE NEW.deletedAt IS NULL;
        END;

        DROP TRIGGER IF EXISTS search_appointment_ad;
        CREATE TRIGGER search_appointment_ad AFTER DELETE ON Appointment BEGIN
          DELETE FROM SearchIndex WHERE resource = 'Appointment' AND recordId = OLD.id;
        END;

        DROP TRIGGER IF EXISTS search_charge_ai;
        CREATE TRIGGER search_charge_ai AFTER INSERT ON Charge BEGIN
          DELETE FROM SearchIndex WHERE resource = 'Charge' AND recordId = NEW.id;
          INSERT INTO SearchIndex(resource, recordId, clinicId, content)
          SELECT 'Charge', NEW.id, NEW.clinicId,
                 trim(COALESCE((SELECT name FROM Patient WHERE id = NEW.patientId), '') || ' ' || COALESCE(NEW.number, '') || ' ' || COALESCE(NEW.status, ''))
          WHERE NEW.deletedAt IS NULL;
        END;

        DROP TRIGGER IF EXISTS search_charge_au;
        CREATE TRIGGER search_charge_au AFTER UPDATE ON Charge BEGIN
          DELETE FROM SearchIndex WHERE resource = 'Charge' AND recordId = NEW.id;
          INSERT INTO SearchIndex(resource, recordId, clinicId, content)
          SELECT 'Charge', NEW.id, NEW.clinicId,
                 trim(COALESCE((SELECT name FROM Patient WHERE id = NEW.patientId), '') || ' ' || COALESCE(NEW.number, '') || ' ' || COALESCE(NEW.status, ''))
          WHERE NEW.deletedAt IS NULL;
        END;

        DROP TRIGGER IF EXISTS search_charge_ad;
        CREATE TRIGGER search_charge_ad AFTER DELETE ON Charge BEGIN
          DELETE FROM SearchIndex WHERE resource = 'Charge' AND recordId = OLD.id;
        END;

        DROP TRIGGER IF EXISTS search_followup_ai;
        CREATE TRIGGER search_followup_ai AFTER INSERT ON FollowUp BEGIN
          DELETE FROM SearchIndex WHERE resource = 'FollowUp' AND recordId = NEW.id;
          INSERT INTO SearchIndex(resource, recordId, clinicId, content)
          SELECT 'FollowUp', NEW.id, NEW.clinicId,
                 trim(COALESCE((SELECT name FROM Patient WHERE id = NEW.patientId), '') || ' ' || COALESCE(NEW.content, '') || ' ' || COALESCE(NEW.status, '') || ' ' || COALESCE(NEW.planDate, ''))
          WHERE NEW.deletedAt IS NULL;
        END;

        DROP TRIGGER IF EXISTS search_followup_au;
        CREATE TRIGGER search_followup_au AFTER UPDATE ON FollowUp BEGIN
          DELETE FROM SearchIndex WHERE resource = 'FollowUp' AND recordId = NEW.id;
          INSERT INTO SearchIndex(resource, recordId, clinicId, content)
          SELECT 'FollowUp', NEW.id, NEW.clinicId,
                 trim(COALESCE((SELECT name FROM Patient WHERE id = NEW.patientId), '') || ' ' || COALESCE(NEW.content, '') || ' ' || COALESCE(NEW.status, '') || ' ' || COALESCE(NEW.planDate, ''))
          WHERE NEW.deletedAt IS NULL;
        END;

        DROP TRIGGER IF EXISTS search_followup_ad;
        CREATE TRIGGER search_followup_ad AFTER DELETE ON FollowUp BEGIN
          DELETE FROM SearchIndex WHERE resource = 'FollowUp' AND recordId = OLD.id;
        END;
      `);
      db.exec(`
        INSERT INTO SearchIndex(resource, recordId, clinicId, content)
        SELECT 'Patient', id, clinicId, trim(COALESCE(name, '') || ' ' || COALESCE(code, '') || ' ' || COALESCE(phone, ''))
        FROM Patient WHERE deletedAt IS NULL;
        INSERT INTO SearchIndex(resource, recordId, clinicId, content)
        SELECT 'InventoryItem', id, clinicId, trim(COALESCE(name, '') || ' ' || COALESCE(code, '') || ' ' || COALESCE(category, ''))
        FROM InventoryItem WHERE deletedAt IS NULL;
        INSERT INTO SearchIndex(resource, recordId, clinicId, content)
        SELECT 'Supplier', id, clinicId, trim(COALESCE(name, '') || ' ' || COALESCE(code, '') || ' ' || COALESCE(phone, ''))
        FROM Supplier WHERE deletedAt IS NULL;
        INSERT INTO SearchIndex(resource, recordId, clinicId, content)
        SELECT 'Appointment', A.id, A.clinicId,
               trim(COALESCE(P.name, '') || ' ' || COALESCE(A.startTime, '') || ' ' || COALESCE(A.status, ''))
        FROM Appointment A LEFT JOIN Patient P ON P.id = A.patientId
        WHERE A.deletedAt IS NULL;
        INSERT INTO SearchIndex(resource, recordId, clinicId, content)
        SELECT 'Charge', C.id, C.clinicId,
               trim(COALESCE(P.name, '') || ' ' || COALESCE(C.number, '') || ' ' || COALESCE(C.status, ''))
        FROM Charge C LEFT JOIN Patient P ON P.id = C.patientId
        WHERE C.deletedAt IS NULL;
        INSERT INTO SearchIndex(resource, recordId, clinicId, content)
        SELECT 'FollowUp', F.id, F.clinicId,
               trim(COALESCE(P.name, '') || ' ' || COALESCE(F.content, '') || ' ' || COALESCE(F.status, '') || ' ' || COALESCE(F.planDate, ''))
        FROM FollowUp F LEFT JOIN Patient P ON P.id = F.patientId
        WHERE F.deletedAt IS NULL;
      `);
    },
  },  {
    version: 116,
    name: 'v2-core-foreign-keys',
    up(db) {
      ensureForeignKeys(db, 'MemberCard', `
        CREATE TABLE "MemberCard" (
          id TEXT PRIMARY KEY,
          patientId TEXT NOT NULL,
          cardNo TEXT NOT NULL,
          balance INTEGER DEFAULT 0 CHECK (balance >= 0),
          totalRecharge INTEGER DEFAULT 0 CHECK (totalRecharge >= 0),
          totalConsume INTEGER DEFAULT 0 CHECK (totalConsume >= 0),
          points INTEGER DEFAULT 0,
          totalPoints INTEGER DEFAULT 0,
          level TEXT DEFAULT 'NORMAL',
          status TEXT DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE', 'DISABLED', 'FROZEN', 'EXPIRED')),
          discountRate INTEGER,
          maxDiscountAmount INTEGER,
          roundingMode TEXT DEFAULT 'FLOOR',
          annualDiscountLimit INTEGER,
          specialDiscountsJson TEXT DEFAULT '[]',
          clinicId TEXT,
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
          updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
          deletedAt TEXT,
          UNIQUE(clinicId, cardNo),
          FOREIGN KEY (patientId) REFERENCES Patient(id)
        )
      `);
      ensureForeignKeys(db, 'Refund', `
        CREATE TABLE "Refund" (
          id TEXT PRIMARY KEY,
          chargeId TEXT NOT NULL,
          patientId TEXT NOT NULL,
          amount INTEGER NOT NULL CHECK (amount > 0),
          reason TEXT,
          operatorId TEXT,
          operatorName TEXT,
          status TEXT DEFAULT 'REQUESTED',
          approvedById TEXT,
          approvedAt TEXT,
          processedById TEXT,
          processedAt TEXT,
          clinicId TEXT,
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
          updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
          deletedAt TEXT,
          FOREIGN KEY (chargeId) REFERENCES Charge(id),
          FOREIGN KEY (patientId) REFERENCES Patient(id),
          FOREIGN KEY (operatorId) REFERENCES User(id)
        )
      `);
      ensureForeignKeys(db, 'ChargeItem', `
        CREATE TABLE "ChargeItem" (
          id TEXT PRIMARY KEY,
          chargeId TEXT NOT NULL,
          treatmentId TEXT,
          inventoryItemId TEXT,
          consumedQuantity REAL DEFAULT 0,
          name TEXT NOT NULL,
          category TEXT NOT NULL,
          price INTEGER NOT NULL CHECK (price >= 0),
          quantity INTEGER DEFAULT 1 CHECK (quantity >= 1),
          teethNumbers TEXT DEFAULT '[]',
          subtotal INTEGER DEFAULT 0 CHECK (subtotal >= 0),
          costType TEXT DEFAULT 'SERVICE',
          clinicId TEXT,
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
          updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
          deletedAt TEXT,
          FOREIGN KEY (chargeId) REFERENCES Charge(id) ON DELETE CASCADE,
          FOREIGN KEY (treatmentId) REFERENCES Treatment(id),
          FOREIGN KEY (inventoryItemId) REFERENCES InventoryItem(id)
        )
      `);
      ensureForeignKeys(db, 'PurchaseOrderItem', `
        CREATE TABLE "PurchaseOrderItem" (
          id TEXT PRIMARY KEY,
          orderId TEXT NOT NULL,
          itemId TEXT,
          name TEXT NOT NULL,
          spec TEXT,
          quantity REAL NOT NULL,
          unitPrice INTEGER NOT NULL,
          subtotal INTEGER DEFAULT 0,
          clinicId TEXT,
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
          updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
          deletedAt TEXT,
          FOREIGN KEY (orderId) REFERENCES PurchaseOrder(id) ON DELETE CASCADE,
          FOREIGN KEY (itemId) REFERENCES InventoryItem(id)
        )
      `);
      ensureForeignKeys(db, 'InventoryTransaction', `
        CREATE TABLE "InventoryTransaction" (
          id TEXT PRIMARY KEY,
          itemId TEXT NOT NULL,
          type TEXT NOT NULL CHECK (type IN ('IN', 'OUT', 'ADJUST')),
          quantity REAL NOT NULL,
          unitPrice INTEGER DEFAULT 0,
          totalAmount INTEGER DEFAULT 0,
          supplierId TEXT,
          purchaseOrderId TEXT,
          operatorId TEXT,
          operatorName TEXT,
          remark TEXT,
          clinicId TEXT,
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
          deletedAt TEXT,
          updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
          beforeStock REAL,
          afterStock REAL,
          referenceType TEXT,
          referenceId TEXT,
          batchId TEXT,
          FOREIGN KEY (itemId) REFERENCES InventoryItem(id),
          FOREIGN KEY (supplierId) REFERENCES Supplier(id),
          FOREIGN KEY (operatorId) REFERENCES User(id)
        )
      `);
      ensureForeignKeys(db, 'ProcessingOrder', `
        CREATE TABLE "ProcessingOrder" (
          id TEXT PRIMARY KEY,
          number TEXT NOT NULL,
          patientId TEXT NOT NULL,
          visitId TEXT,
          factoryId TEXT,
          doctorId TEXT,
          shade TEXT,
          teethNumbers TEXT DEFAULT '[]',
          totalFee INTEGER DEFAULT 0,
          status TEXT DEFAULT 'SENT' CHECK (status IN ('PENDING', 'DRAFT', 'SENT', 'IN_PROGRESS', 'COMPLETED', 'RECEIVED', 'CANCELLED')),
          chargeId TEXT,
          sentAt TEXT,
          expectedAt TEXT,
          receivedAt TEXT,
          deliveredAt TEXT,
          remark TEXT,
          creatorId TEXT,
          settleStatus TEXT DEFAULT 'UNSETTLED',
          settledAmount INTEGER,
          settledAt TEXT,
          settlementNote TEXT,
          settlementRef TEXT,
          clinicId TEXT,
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
      `);
    },
  },  {
    version: 117,
    name: 'v2-user-clinic-memberships',
    up(db) {
      const userColumns = new Set(
        (db.prepare('PRAGMA table_info(User)').all() as Array<{ name: string }>).map((column) => column.name),
      );
      if (!userColumns.has('currentClinicId')) {
        db.exec('ALTER TABLE User ADD COLUMN currentClinicId TEXT');
      }
      db.exec(`
        CREATE TABLE IF NOT EXISTS UserClinic (
          userId TEXT NOT NULL,
          clinicId TEXT NOT NULL,
          role TEXT NOT NULL,
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
          updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
          deletedAt TEXT,
          PRIMARY KEY (userId, clinicId),
          FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE,
          FOREIGN KEY (clinicId) REFERENCES Clinic(id) ON DELETE CASCADE
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_user_clinic
          ON UserClinic(userId, clinicId);
      `);
      db.exec(`
        INSERT OR IGNORE INTO UserClinic (userId, clinicId, role, createdAt, updatedAt, deletedAt)
        SELECT id, clinicId, role, createdAt, updatedAt, NULL
        FROM User
        WHERE clinicId IS NOT NULL AND deletedAt IS NULL
      `);
    },
  },  {
    version: 118,
    name: 'v2-clinic-scoped-unique-field-indexes',
    up(db) {
      for (const resource of resourceRegistry.all()) {
        for (const field of resource.fields) {
          if (!field.unique) continue;
          const indexName = `idx_v2_unique_${resource.name}_${field.name}`;
          db.exec(`DROP INDEX IF EXISTS "${indexName}"`);
          const indexColumns = uniqueIndexColumns(db, resource.table, field.name);
          db.exec(
            `CREATE UNIQUE INDEX IF NOT EXISTS "${indexName}"
             ON ${resource.table} (${indexColumns}) WHERE deletedAt IS NULL`,
          );
        }
      }
    },
  },  {
    version: 119,
    name: 'v2-drop-search-triggers',
    up(db) {
      db.exec(`
        DROP TRIGGER IF EXISTS search_patient_ai;
        DROP TRIGGER IF EXISTS search_patient_au;
        DROP TRIGGER IF EXISTS search_patient_ad;
        DROP TRIGGER IF EXISTS search_patient_child_update;
        DROP TRIGGER IF EXISTS search_inventory_item_ai;
        DROP TRIGGER IF EXISTS search_inventory_item_au;
        DROP TRIGGER IF EXISTS search_inventory_item_ad;
        DROP TRIGGER IF EXISTS search_supplier_ai;
        DROP TRIGGER IF EXISTS search_supplier_au;
        DROP TRIGGER IF EXISTS search_supplier_ad;
        DROP TRIGGER IF EXISTS search_appointment_ai;
        DROP TRIGGER IF EXISTS search_appointment_au;
        DROP TRIGGER IF EXISTS search_appointment_ad;
        DROP TRIGGER IF EXISTS search_charge_ai;
        DROP TRIGGER IF EXISTS search_charge_au;
        DROP TRIGGER IF EXISTS search_charge_ad;
        DROP TRIGGER IF EXISTS search_followup_ai;
        DROP TRIGGER IF EXISTS search_followup_au;
        DROP TRIGGER IF EXISTS search_followup_ad;
      `);
    },
  },  {
    version: 120,
    name: 'v2-perf-indexes',
    up(db) {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_idempotency_status_updated ON IdempotencyRecord(status, updatedAt);
        CREATE INDEX IF NOT EXISTS idx_charge_item_clinic_category_name ON ChargeItem(clinicId, category, name);
      `);
    },
  },
];
