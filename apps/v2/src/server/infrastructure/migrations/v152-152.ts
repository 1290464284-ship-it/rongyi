import type { Migration } from './index';

export const migrations152: Migration[] = [
  {
    version: 152,
    name: 'v2-sync-conflicts',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS SyncConflict (
          id TEXT PRIMARY KEY,
          clinicId TEXT,
          tableName TEXT NOT NULL,
          recordId TEXT NOT NULL,
          deviceId TEXT NOT NULL,
          localOperation TEXT NOT NULL,
          remoteOperation TEXT NOT NULL,
          localSnapshotJson TEXT NOT NULL,
          remoteSnapshotJson TEXT NOT NULL,
          localUpdatedAt TEXT,
          remoteUpdatedAt TEXT,
          status TEXT NOT NULL DEFAULT 'PENDING'
            CHECK (status IN ('PENDING', 'RESOLVED')),
          resolution TEXT,
          resolvedAt TEXT,
          resolvedById TEXT,
          createdAt TEXT NOT NULL,
          updatedAt TEXT NOT NULL,
          deletedAt TEXT
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_sync_conflict_unique
          ON SyncConflict(clinicId, tableName, recordId)
          WHERE deletedAt IS NULL AND status = 'PENDING';
        CREATE INDEX IF NOT EXISTS idx_v2_sync_conflict_status
          ON SyncConflict(clinicId, status);
      `);
    },
  },
];
