import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase } from './database';
import { cleanupSyncChanges } from './sync-change';

describe('cleanupSyncChanges', () => {
  let db: Database.Database;
  let dataDir: string;

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-sync-change-'));
    db = createDatabase(dataDir);
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('deletes only rows older than the cutoff', () => {
    const now = Date.now();
    const oldIso = new Date(now - 100 * 24 * 60 * 60 * 1000).toISOString();
    const freshIso = new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString();
    const insert = db.prepare(
      `INSERT INTO SyncChange (id, clinicId, createdAt, updatedAt, deletedAt, tableName, recordId, operation, deviceId)
       VALUES (?, 'clinic-v2-001', ?, ?, NULL, 'Patient', ?, 'INSERT', 'server')`,
    );
    insert.run('sync-old-1', oldIso, oldIso, 'p-old-1');
    insert.run('sync-fresh-1', freshIso, freshIso, 'p-fresh-1');

    const cutoff = new Date(now - 90 * 24 * 60 * 60 * 1000).toISOString();
    const result = cleanupSyncChanges(db, cutoff);

    expect(result.deleted).toBe(1);
    expect(db.prepare('SELECT id FROM SyncChange WHERE id = ?').get('sync-old-1')).toBeUndefined();
    expect(db.prepare('SELECT id FROM SyncChange WHERE id = ?').get('sync-fresh-1')).toBeDefined();
  });
});
