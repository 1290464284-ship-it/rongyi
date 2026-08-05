import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { resourceRegistry } from '../../domain/resources';
import { uniqueIndexColumns } from './database';
import type { ResourceField } from '../../domain/contracts';

export interface Migration {
  version: number;
  name: string;
  up: (db: Database.Database) => void;
}

/**
 * Versioned schema migrations for V2.
 *
 * Baseline legacy table synchronization is intentionally separate. This
 * registry owns future schema changes and records them in schema_migrations.
 */
export const migrations: Migration[] = [
  {
    version: 101,
    name: 'v2-initial-indexes',
    up(db) {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_v2_patient_phone ON Patient(phone);
        CREATE INDEX IF NOT EXISTS idx_v2_appointment_doctor_start ON Appointment(doctorId, startTime);
        CREATE INDEX IF NOT EXISTS idx_v2_charge_patient ON Charge(patientId);
        CREATE INDEX IF NOT EXISTS idx_v2_inventory_tx_item_date ON InventoryTransaction(itemId, createdAt);
        CREATE INDEX IF NOT EXISTS idx_v2_followup_patient_date ON FollowUp(patientId, planDate);
      `);
    },
  },
  {
    version: 102,
    name: 'v2-auth-refresh-session',
    up(db) {
      const userColumns = new Set(
        (db.prepare('PRAGMA table_info(User)').all() as Array<{ name: string }>).map((column) => column.name),
      );
      if (!userColumns.has('refreshToken')) {
        db.exec('ALTER TABLE User ADD COLUMN refreshToken TEXT');
      }
      if (!userColumns.has('refreshTokenExpiresAt')) {
        db.exec('ALTER TABLE User ADD COLUMN refreshTokenExpiresAt TEXT');
      }
      db.exec(`
        CREATE TABLE IF NOT EXISTS UsedRefreshToken (
          tokenHash TEXT PRIMARY KEY,
          userId TEXT NOT NULL,
          usedAt TEXT DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (userId) REFERENCES User(id)
        );
        CREATE INDEX IF NOT EXISTS idx_v2_user_refresh_token ON User(refreshToken);
      `);
    },
  },
  {
    version: 103,
    name: 'v2-audit-backup-columns',
    up(db) {
      const ensureColumns = (table: string, columns: string[]): void => {
        const existing = new Set(
          (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name),
        );
        for (const column of columns) {
          if (!existing.has(column)) {
            db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT`);
          }
        }
      };
      ensureColumns('OperationLog', ['traceId', 'updatedAt', 'deletedAt']);
      ensureColumns('BackupRecord', ['updatedAt', 'deletedAt']);
    },
  },
  {
    version: 104,
    name: 'v2-idempotency-columns',
    up(db) {
      const columns = new Set(
        (db.prepare('PRAGMA table_info(IdempotencyRecord)').all() as Array<{ name: string }>).map((column) => column.name),
      );
      for (const column of ['responseJson', 'clinicId', 'updatedAt', 'deletedAt']) {
        if (!columns.has(column)) {
          db.exec(`ALTER TABLE IdempotencyRecord ADD COLUMN ${column} ${column === 'responseJson' ? 'TEXT' : 'TEXT'}`);
        }
      }
    },
  },
  {
    version: 105,
    name: 'v2-idempotency-legacy-columns',
    up(db) {
      const columns = new Set(
        (db.prepare('PRAGMA table_info(IdempotencyRecord)').all() as Array<{ name: string }>).map((column) => column.name),
      );
      const additions: Array<[string, string]> = [
        ['type', "TEXT DEFAULT 'GENERIC'"],
        ['status', "TEXT DEFAULT 'COMPLETED'"],
        ['result', 'TEXT'],
        ['expiresAt', "TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+1 day'))"],
      ];
      for (const [name, definition] of additions) {
        if (!columns.has(name)) {
          db.exec(`ALTER TABLE IdempotencyRecord ADD COLUMN ${name} ${definition}`);
        }
      }
    },
  },
  {
    version: 106,
    name: 'v2-resource-column-sync',
    up(db) {
      const fieldType: Record<ResourceField['type'], string> = {
        number: 'REAL',
        money: 'INTEGER',
        boolean: 'INTEGER',
        date: 'TEXT',
        datetime: 'TEXT',
        json: 'TEXT',
        text: 'TEXT',
        longText: 'TEXT',
        enum: 'TEXT',
        relation: 'TEXT',
      };
      for (const resource of resourceRegistry.all()) {
        const existing = new Set(
          (db.prepare(`PRAGMA table_info(${resource.table})`).all() as Array<{ name: string }>).map((column) => column.name),
        );
        for (const field of resource.fields) {
          if (!existing.has(field.name)) {
            db.exec(`ALTER TABLE ${resource.table} ADD COLUMN ${field.name} ${fieldType[field.type]}`);
          }
        }
      }
      const childAdditions: Array<[string, string]> = [
        ['InventoryReplenishmentSuggestion', 'status TEXT'],
        ['InventoryReplenishmentSuggestion', 'supplierId TEXT'],
        ['InventoryReplenishmentSuggestion', 'totalAmount INTEGER'],
        ['ProcessingOrderItem', 'name TEXT'],
        ['ProcessingOrderItem', 'spec TEXT'],
        ['PurchaseOrder', 'receivedAt TEXT'],
      ];
      for (const [table, definition] of childAdditions) {
        const existing = new Set(
          (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name),
        );
        const columnName = definition.split(' ')[0];
        /* v8 ignore start -- legacy schema compatibility branch. */
        if (!existing.has(columnName)) {
          db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
        }
        /* v8 ignore stop */
      }
    },
  },
  {
    version: 107,
    name: 'v2-base-column-sync',
    up(db) {
      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != 'schema_migrations'",
      ).all() as Array<{ name: string }>;
      const baseColumns: Array<[string, string]> = [
        ['clinicId', 'TEXT'],
        ['createdAt', 'TEXT'],
        ['updatedAt', 'TEXT'],
        ['deletedAt', 'TEXT'],
      ];
      for (const { name } of tables) {
        const existing = new Set(
          (db.prepare(`PRAGMA table_info(${name})`).all() as Array<{ name: string }>).map((column) => column.name),
        );
        for (const [column, type] of baseColumns) {
          if (!existing.has(column)) {
            db.exec(`ALTER TABLE ${name} ADD COLUMN ${column} ${type}`);
          }
        }
      }
    },
  },
  {
    version: 108,
    name: 'v2-sync-device',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS SyncDevice (
          id TEXT PRIMARY KEY,
          clinicId TEXT,
          userId TEXT,
          deviceId TEXT NOT NULL,
          tokenHash TEXT NOT NULL,
          name TEXT,
          active INTEGER DEFAULT 1,
          createdAt TEXT NOT NULL,
          updatedAt TEXT NOT NULL,
          deletedAt TEXT,
          UNIQUE (clinicId, deviceId)
        );
        CREATE INDEX IF NOT EXISTS idx_v2_sync_device_scope ON SyncDevice(clinicId, deviceId, active);
      `);
    },
  },
  {
    version: 109,
    name: 'v2-idempotency-scope',
    up(db) {
      const columns = new Set(
        (db.prepare('PRAGMA table_info(IdempotencyRecord)').all() as Array<{ name: string }>).map((column) => column.name),
      );
      if (!columns.has('userId')) {
        db.exec('ALTER TABLE IdempotencyRecord ADD COLUMN userId TEXT');
      }
      if (!columns.has('operation')) {
        db.exec('ALTER TABLE IdempotencyRecord ADD COLUMN operation TEXT');
      }
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_v2_idempotency_scope ON IdempotencyRecord(userId, clinicId, operation);
        CREATE INDEX IF NOT EXISTS idx_v2_idempotency_expiry ON IdempotencyRecord(expiresAt);
      `);
    },
  },
  {
    version: 110,
    name: 'v2-performance-indexes',
    up(db) {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_v2_charge_doctor ON Charge(doctorId);
        CREATE INDEX IF NOT EXISTS idx_v2_visit_doctor ON Visit(doctorId);
        CREATE INDEX IF NOT EXISTS idx_v2_visit_patient ON Visit(patientId);
        CREATE INDEX IF NOT EXISTS idx_v2_member_card_patient ON MemberCard(patientId);
        CREATE INDEX IF NOT EXISTS idx_v2_satisfaction_clinic_date ON SatisfactionSurvey(clinicId, surveyDate);
        CREATE INDEX IF NOT EXISTS idx_v2_inventory_clinic_expiry ON InventoryItem(clinicId, expireDate);
        CREATE INDEX IF NOT EXISTS idx_v2_followup_clinic_status_date ON FollowUp(clinicId, status, planDate);
      `);
    },
  },
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
  },
  {
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
  },
  {
    version: 113,
    name: 'v2-auth-and-sync-performance-indexes',
    up(db) {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_v2_used_refresh_token_used_at ON UsedRefreshToken(usedAt);
        CREATE INDEX IF NOT EXISTS idx_v2_sync_change_clinic_created ON SyncChange(clinicId, createdAt);
      `);
    },
  },
  {
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
  },
  {
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
  },
  {
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
  },
  {
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
  },
  {
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
  },
  {
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
  },
];

function ensureForeignKeys(
  db: Database.Database,
  table: string,
  createSql: string,
): void {
  const existing = db.prepare(`PRAGMA foreign_key_list("${table}")`).all();
  if (existing.length > 0) return;

  const indexes = db.prepare(
    `SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL`,
  ).all(table) as Array<{ sql: string }>;
  const newTable = `${table}_fk_new`;
  db.exec(createSql.replace(`"${table}"`, `"${newTable}"`));

  const oldColumns = new Set(
    (db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>).map((column) => column.name),
  );
  const newColumns = new Set(
    (db.prepare(`PRAGMA table_info("${newTable}")`).all() as Array<{ name: string }>).map((column) => column.name),
  );
  const missing = [...oldColumns].filter((column) => !newColumns.has(column));
  if (missing.length > 0) {
    throw new Error(`Migration for ${table} would drop columns: ${missing.join(', ')}`);
  }
  const columns = [...newColumns].filter((column) => oldColumns.has(column));
  const columnList = columns.map((column) => `"${column}"`).join(', ');
  repairLegacyData(db, table);
  db.prepare(
    `INSERT INTO "${newTable}" (${columnList})
     SELECT ${columnList} FROM "${table}"`,
  ).run();
  db.exec(`DROP TABLE "${table}"`);
  db.exec(`ALTER TABLE "${newTable}" RENAME TO "${table}"`);
  for (const index of indexes) db.exec(index.sql);
}

/**
 * Repair legacy rows that would violate the constraints of the rebuilt table
 * before `ensureForeignKeys` copies them over. Every change is recorded in
 * `MigrationRepairLog`; rows with orphan NOT NULL foreign keys are preserved
 * verbatim in `MigrationRepairQuarantine` and removed from the source table so
 * the INSERT SELECT cannot fail.
 */
function repairLegacyData(db: Database.Database, table: string): void {
  db.exec(`CREATE TABLE IF NOT EXISTS MigrationRepairLog (
    id TEXT PRIMARY KEY,
    tableName TEXT NOT NULL,
    field TEXT NOT NULL,
    recordId TEXT,
    beforeValue TEXT,
    afterValue TEXT,
    reason TEXT NOT NULL,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  const log = (tableName: string, field: string, recordId: string, beforeValue: unknown, afterValue: unknown, reason: string): void => {
    db.prepare(
      `INSERT INTO MigrationRepairLog (id, tableName, field, recordId, beforeValue, afterValue, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(randomUUID(), tableName, field, recordId, String(beforeValue ?? ''), String(afterValue ?? ''), reason);
  };
  // 旧表未必含 116 新表的所有列（如 ChargeItem.inventoryItemId 只在新 DDL 里）；
  // 缺列时跳过对应修复，INSERT SELECT 会为其使用新表 DEFAULT（通常为 NULL）。
  const hasColumn = (t: string, c: string): boolean =>
    (db.prepare(`PRAGMA table_info("${t}")`).all() as Array<{ name: string }>).some((column) => column.name === c);

  // 数值钳制：新表 CHECK/NOT NULL 约束要求的取值域。
  const repairs: Record<string, Array<[string, string, string]>> = {
    MemberCard: [
      ['balance', 'UPDATE MemberCard SET balance = 0 WHERE balance < 0', '负余额钳为 0'],
      ['totalRecharge', 'UPDATE MemberCard SET totalRecharge = 0 WHERE totalRecharge < 0', '负充值额钳为 0'],
      ['totalConsume', 'UPDATE MemberCard SET totalConsume = 0 WHERE totalConsume < 0', '负消费额钳为 0'],
    ],
    Refund: [
      ['amount', 'UPDATE Refund SET amount = 1 WHERE amount IS NULL OR amount <= 0', '退款金额置为 1 分'],
    ],
    ChargeItem: [
      ['price', 'UPDATE ChargeItem SET price = 0 WHERE price IS NULL OR price < 0', '单价钳为 0'],
      ['quantity', 'UPDATE ChargeItem SET quantity = 1 WHERE quantity IS NULL OR quantity < 1', '数量置为 1'],
      ['subtotal', 'UPDATE ChargeItem SET subtotal = 0 WHERE subtotal IS NULL OR subtotal < 0', '小计钳为 0'],
    ],
    PurchaseOrderItem: [
      ['quantity', 'UPDATE PurchaseOrderItem SET quantity = 1 WHERE quantity IS NULL OR quantity <= 0', '数量置为 1'],
      ['unitPrice', 'UPDATE PurchaseOrderItem SET unitPrice = 0 WHERE unitPrice IS NULL OR unitPrice < 0', '单价钳为 0'],
    ],
    ProcessingOrder: [
      ['status', "UPDATE ProcessingOrder SET status = 'SENT' WHERE status IS NULL OR status NOT IN ('PENDING','DRAFT','SENT','IN_PROGRESS','COMPLETED','RECEIVED','CANCELLED')", '非法状态置为 SENT'],
    ],
  };
  for (const [field, sql, reason] of repairs[table] ?? []) {
    if (!hasColumn(table, field)) continue;
    const rows = db.prepare(`SELECT id, ${field} AS beforeValue FROM "${table}" WHERE ${sql.split('WHERE ')[1]}`).all() as Array<{ id: string; beforeValue: unknown }>;
    db.exec(sql);
    for (const row of rows) log(table, field, row.id, row.beforeValue, null, reason);
  }

  // 唯一键去重：保留组内 MAX(id) 一行，其余追加 -dup-N 后缀。
  const uniqueColumns: Record<string, string> = {
    MemberCard: 'cardNo',
    ProcessingOrder: 'number',
  };
  const uniqueColumn = uniqueColumns[table];
  if (uniqueColumn && hasColumn(table, uniqueColumn) && hasColumn(table, 'clinicId')) {
    const dupRows = db.prepare(
      `SELECT id, ${uniqueColumn} AS value, clinicId FROM "${table}" t
       WHERE t.clinicId IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM "${table}" t2
           WHERE t2.clinicId = t.clinicId AND t2.${uniqueColumn} = t.${uniqueColumn} AND t2.id != t.id
         )
         AND t.id != (
           SELECT MAX(id) FROM "${table}" t3
           WHERE t3.clinicId = t.clinicId AND t3.${uniqueColumn} = t.${uniqueColumn}
         )`,
    ).all() as Array<{ id: string; value: string; clinicId: string | null }>;
    let n = 1;
    for (const dup of dupRows) {
      let after = `${dup.value}-dup-${n++}`;
      // 避免后缀与同组既有值冲突（重复键组可能已有 -dup-N 形式的值）。
      while (db.prepare(`SELECT 1 FROM "${table}" WHERE clinicId IS ? AND ${uniqueColumn} = ? AND id != ? LIMIT 1`).get(dup.clinicId, after, dup.id)) {
        after = `${dup.value}-dup-${n++}`;
      }
      db.prepare(`UPDATE "${table}" SET ${uniqueColumn} = ? WHERE id = ?`).run(after, dup.id);
      log(table, uniqueColumn, dup.id, dup.value, after, '重复唯一键追加后缀');
    }
  }

  // 孤儿外键：以迁移 116 各表实际定义的 FK 为准（可空列 -> NULL，NOT NULL 列 -> 隔离）。
  const orphanFkRepairs: Record<string, Array<[string, string, boolean]>> = {
    MemberCard: [['patientId', 'Patient', false]],
    Refund: [['chargeId', 'Charge', false], ['patientId', 'Patient', false], ['operatorId', 'User', true]],
    ChargeItem: [['chargeId', 'Charge', false], ['treatmentId', 'Treatment', true], ['inventoryItemId', 'InventoryItem', true]],
    PurchaseOrderItem: [['orderId', 'PurchaseOrder', false], ['itemId', 'InventoryItem', true]],
    InventoryTransaction: [['itemId', 'InventoryItem', false], ['supplierId', 'Supplier', true], ['operatorId', 'User', true]],
    ProcessingOrder: [['patientId', 'Patient', false], ['visitId', 'Visit', true], ['factoryId', 'ProcessingFactory', true], ['doctorId', 'User', true], ['chargeId', 'Charge', true]],
  };
  for (const [fkColumn, refTable, nullable] of orphanFkRepairs[table] ?? []) {
    if (!hasColumn(table, fkColumn)) continue;
    const orphans = db.prepare(
      `SELECT id, ${fkColumn} AS refId FROM "${table}"
       WHERE ${fkColumn} IS NOT NULL
         AND ${fkColumn} NOT IN (SELECT id FROM "${refTable}")`,
    ).all() as Array<{ id: string; refId: string }>;
    if (nullable) {
      for (const o of orphans) {
        db.prepare(`UPDATE "${table}" SET ${fkColumn} = NULL WHERE id = ?`).run(o.id);
        log(table, fkColumn, o.id, o.refId, null, '孤儿外键置 NULL');
      }
    } else {
      // NOT NULL 外键孤儿：整行移入隔离表并立即从源表删除，INSERT SELECT 时不再复制。
      db.exec(`CREATE TABLE IF NOT EXISTS MigrationRepairQuarantine (
        id TEXT PRIMARY KEY,
        tableName TEXT NOT NULL,
        recordJson TEXT NOT NULL,
        reason TEXT NOT NULL,
        createdAt TEXT DEFAULT CURRENT_TIMESTAMP
      )`);
      for (const o of orphans) {
        const row = db.prepare(`SELECT * FROM "${table}" WHERE id = ?`).get(o.id) as Record<string, unknown>;
        db.prepare(
          `INSERT INTO MigrationRepairQuarantine (id, tableName, recordJson, reason) VALUES (?, ?, ?, ?)`,
        ).run(randomUUID(), table, JSON.stringify(row), `孤儿外键 ${fkColumn}=${o.refId}`);
        db.prepare(`DELETE FROM "${table}" WHERE id = ?`).run(o.id);
      }
    }
  }
}

function snapshotDatabase(db: Database.Database, snapshotDir: string): void {
  const dir = path.join(snapshotDir, 'pre-migration');
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `pre-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
  // VACUUM INTO 不能在事务内执行；runMigrations 开始时无事务，安全。
  db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
}

export function runMigrations(db: Database.Database, options?: { snapshotDir?: string }): void {
  if (options?.snapshotDir) {
    try {
      snapshotDatabase(db, options.snapshotDir);
    } catch (error) {
      // 快照失败不阻断启动；迁移本身仍会继续。
      console.warn('[migrations] pre-migration snapshot failed, continuing', error);
    }
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      appliedAt TEXT NOT NULL
    );
  `);
  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number | string }>).map((row) => Number(row.version)),
  );
  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    const run = db.transaction(() => {
      migration.up(db);
      db.prepare('INSERT INTO schema_migrations (version, name, appliedAt) VALUES (?, ?, ?)')
        .run(String(migration.version), migration.name, new Date().toISOString());
    });
    run();
  }
}
