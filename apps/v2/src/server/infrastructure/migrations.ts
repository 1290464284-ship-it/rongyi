import type Database from 'better-sqlite3';
import { resourceRegistry } from '../../domain/resources';
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
          db.exec(
            `CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_unique_${resource.name}_${field.name}
             ON ${resource.table} (${field.name}) WHERE deletedAt IS NULL`,
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

  const columns = commonColumns(db, table, newTable);
  const columnList = columns.map((column) => `"${column}"`).join(', ');
  db.prepare(
    `INSERT INTO "${newTable}" (${columnList})
     SELECT ${columnList} FROM "${table}"`,
  ).run();
  db.exec(`DROP TABLE "${table}"`);
  db.exec(`ALTER TABLE "${newTable}" RENAME TO "${table}"`);
  for (const index of indexes) db.exec(index.sql);
}

function commonColumns(db: Database.Database, oldTable: string, newTable: string): string[] {
  const columns = (table: string): Set<string> => new Set(
    (db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>).map((column) => column.name),
  );
  const oldColumns = columns(oldTable);
  const newColumns = columns(newTable);
  return [...newColumns].filter((column) => oldColumns.has(column));
}

export function runMigrations(db: Database.Database): void {
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
