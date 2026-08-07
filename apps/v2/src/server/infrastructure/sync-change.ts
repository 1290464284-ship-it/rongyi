import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

export type SyncChangeOperation = 'INSERT' | 'UPDATE' | 'DELETE';

export interface SyncChangeInput {
  tableName: string;
  recordId: string;
  operation: SyncChangeOperation;
  clinicId: string;
  /** 默认 'server'：本地写入哨兵；push 路径显式传设备 id。 */
  deviceId?: string;
}

export function recordSyncChange(db: Database.Database, change: SyncChangeInput): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO SyncChange (id, clinicId, createdAt, updatedAt, deletedAt, tableName, recordId, operation, deviceId)
     VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
  ).run(randomUUID(), change.clinicId, now, now, change.tableName, change.recordId, change.operation, change.deviceId ?? 'server');
}
