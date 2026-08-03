import type Database from 'better-sqlite3';

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
    version: 1,
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
