import type Database from 'better-sqlite3';

export const migrations157 = [
  {
    version: 157,
    name: 'v2-stat-snapshots',
    up(db: Database.Database): void {
      db.exec(`
        CREATE TABLE IF NOT EXISTS StatSnapshot (
          clinicId TEXT NOT NULL,
          key TEXT NOT NULL,
          valueJson TEXT NOT NULL,
          updatedAt TEXT NOT NULL,
          PRIMARY KEY (clinicId, key)
        );
        CREATE TABLE IF NOT EXISTS ReplenishmentSnapshot (
          clinicId TEXT PRIMARY KEY,
          windowStart TEXT NOT NULL,
          windowEnd TEXT NOT NULL,
          dataJson TEXT NOT NULL,
          updatedAt TEXT NOT NULL
        );
      `);
    },
  },
];
