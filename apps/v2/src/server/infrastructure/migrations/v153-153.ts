import type Database from 'better-sqlite3';
import type { Migration } from './index';

function backfillNullClinic(db: Database.Database, table: string): void {
  const row = db.prepare('SELECT id FROM Clinic ORDER BY createdAt ASC LIMIT 1').get() as { id: string } | undefined;
  const hasNulls = Boolean(
    db.prepare(`SELECT 1 FROM "${table}" WHERE clinicId IS NULL OR clinicId = '' LIMIT 1`).get(),
  );
  if (!row) {
    if (hasNulls) {
      throw new Error(`Migration 153 requires a Clinic row to backfill ${table}.clinicId`);
    }
    return;
  }
  db.prepare(`UPDATE "${table}" SET clinicId = @clinicId WHERE clinicId IS NULL OR clinicId = ''`).run({ clinicId: row.id });
}

export const migrations153: Migration[] = [
  {
    version: 153,
    name: 'v2-per-clinic-permission-keys',
    up(db) {
      backfillNullClinic(db, 'UserRole');
      db.exec(`
        ALTER TABLE UserRole RENAME TO UserRole_old;
        CREATE TABLE UserRole (
          userId TEXT NOT NULL,
          role TEXT NOT NULL,
          clinicId TEXT NOT NULL,
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
          updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
          deletedAt TEXT,
          PRIMARY KEY (clinicId, userId, role),
          FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE
        );
        INSERT INTO UserRole (userId, role, clinicId, createdAt, updatedAt, deletedAt)
          SELECT userId, role, clinicId, createdAt, updatedAt, deletedAt FROM UserRole_old;
        DROP TABLE UserRole_old;
        CREATE INDEX IF NOT EXISTS idx_v2_user_role_user ON UserRole(userId);
      `);

      backfillNullClinic(db, 'UserPermission');
      db.exec(`
        ALTER TABLE UserPermission RENAME TO UserPermission_old;
        CREATE TABLE UserPermission (
          userId TEXT NOT NULL,
          permission TEXT NOT NULL,
          allowed INTEGER NOT NULL DEFAULT 1 CHECK (allowed IN (0, 1)),
          clinicId TEXT NOT NULL,
          createdAt TEXT NOT NULL,
          updatedAt TEXT NOT NULL,
          deletedAt TEXT,
          PRIMARY KEY (clinicId, userId, permission),
          FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE
        );
        INSERT INTO UserPermission (userId, permission, allowed, clinicId, createdAt, updatedAt, deletedAt)
          SELECT userId, permission, allowed, clinicId, createdAt, updatedAt, deletedAt FROM UserPermission_old;
        DROP TABLE UserPermission_old;
        CREATE INDEX IF NOT EXISTS idx_v2_user_permission_user ON UserPermission(userId);
      `);
    },
  },
];
