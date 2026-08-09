import type { Migration } from './index';

export const migrations149: Migration[] = [
  {
    version: 149,
    name: 'v2-user-module-permissions',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS UserPermission (
          userId TEXT NOT NULL,
          permission TEXT NOT NULL,
          allowed INTEGER NOT NULL DEFAULT 1 CHECK (allowed IN (0, 1)),
          clinicId TEXT,
          createdAt TEXT NOT NULL,
          updatedAt TEXT NOT NULL,
          deletedAt TEXT,
          PRIMARY KEY (userId, permission),
          FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_v2_user_permission_user ON UserPermission(userId);
      `);
    },
  },
];
