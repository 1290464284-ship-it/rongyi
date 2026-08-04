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
];

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
