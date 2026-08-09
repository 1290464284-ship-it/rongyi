import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { SyncService } from './sync';

describe('sync conflict detection and resolution', () => {
  let db: Database.Database;
  let dataDir: string;
  let service: SyncService;
  const now = '2026-08-09T10:00:00.000Z';
  const context = {
    userId: 'user-admin-001',
    clinicId: 'clinic-v2-001',
    role: 'BOSS' as const,
    traceId: 'test-trace',
    now: () => new Date(now),
  };

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-sync-conflicts-spec-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
    service = new SyncService(db);
    db.prepare(
      `INSERT INTO Patient (id, clinicId, createdAt, updatedAt, deletedAt, code, name, gender, phone, source, active)
       VALUES ('sync-patient-1', 'clinic-v2-001', ?, ?, NULL, 'SYNC-1', 'Local Name', 'UNKNOWN', '13800000000', 'WALK_IN', 1)`,
    ).run(now, '2026-08-09T12:00:00.000Z');
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('defers a stale remote update as a pending conflict', async () => {
    const device = service.registerDevice('sync-device-1', 'Device One', context);
    const result = await service.push({
      deviceId: device.deviceId,
      deviceToken: device.token,
      changes: [{
        tableName: 'Patient',
        recordId: 'sync-patient-1',
        operation: 'UPDATE',
        updatedAt: '2026-08-09T11:00:00.000Z',
        data: { name: 'Remote Name', updatedAt: '2026-08-09T11:00:00.000Z' },
      }],
    }, context);
    expect(result.accepted).toBe(0);
    expect(result.conflicts).toHaveLength(1);

    const conflicts = service.listConflicts(context);
    expect(conflicts).toHaveLength(1);
    expect(String(conflicts[0].recordId)).toBe('sync-patient-1');
    expect(String(conflicts[0].status)).toBe('PENDING');
  });

  it('resolves with KEEP_LOCAL without touching the local row', async () => {
    const [conflict] = service.listConflicts(context);
    await service.resolveConflict(String(conflict.id), 'KEEP_LOCAL', context);
    const row = db.prepare('SELECT name FROM Patient WHERE id = ?').get('sync-patient-1') as { name: string };
    expect(row.name).toBe('Local Name');
    expect(service.listConflicts(context)).toHaveLength(0);
  });

  it('resolves with KEEP_REMOTE by applying the remote snapshot', async () => {
    db.prepare(
      `UPDATE Patient SET name = 'Local After', updatedAt = '2026-08-09T13:00:00.000Z' WHERE id = 'sync-patient-1'`,
    ).run();
    const device = service.registerDevice('sync-device-2', 'Device Two', context);
    await service.push({
      deviceId: device.deviceId,
      deviceToken: device.token,
      changes: [{
        tableName: 'Patient',
        recordId: 'sync-patient-1',
        operation: 'UPDATE',
        updatedAt: '2026-08-09T12:30:00.000Z',
        data: { name: 'Remote Wins', updatedAt: '2026-08-09T12:30:00.000Z' },
      }],
    }, context);
    const [conflict] = service.listConflicts(context);
    await service.resolveConflict(String(conflict.id), 'KEEP_REMOTE', context);
    const row = db.prepare('SELECT name FROM Patient WHERE id = ?').get('sync-patient-1') as { name: string };
    expect(row.name).toBe('Remote Wins');
  });
});
