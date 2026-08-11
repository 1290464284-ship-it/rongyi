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
    expect(String(conflicts[0].localOperation)).toBe('UPDATE');
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

  it('serializes concurrent conflict resolutions', async () => {
    const now = '2026-08-09T10:00:00.000Z';
    for (const id of ['sync-patient-concurrent-a', 'sync-patient-concurrent-b']) {
      db.prepare(
        `INSERT INTO Patient (id, clinicId, createdAt, updatedAt, deletedAt, code, name, gender, phone, source, active)
         VALUES (?, 'clinic-v2-001', ?, ?, NULL, ?, ?, 'UNKNOWN', '13800000001', 'WALK_IN', 1)`,
      ).run(id, now, '2026-08-09T12:00:00.000Z', `CONCURRENT-${id}`, `Concurrent ${id}`);
    }
    const deviceA = service.registerDevice('sync-conflict-device-a', 'Device A', context);
    const deviceB = service.registerDevice('sync-conflict-device-b', 'Device B', context);
    await Promise.all([
      service.push({
        deviceId: deviceA.deviceId,
        deviceToken: deviceA.token,
        changes: [{
          tableName: 'Patient',
          recordId: 'sync-patient-concurrent-a',
          operation: 'UPDATE',
          updatedAt: '2026-08-09T11:00:00.000Z',
          data: { name: 'Stale A' },
        }],
      }, context),
      service.push({
        deviceId: deviceB.deviceId,
        deviceToken: deviceB.token,
        changes: [{
          tableName: 'Patient',
          recordId: 'sync-patient-concurrent-b',
          operation: 'UPDATE',
          updatedAt: '2026-08-09T11:00:00.000Z',
          data: { name: 'Stale B' },
        }],
      }, context),
    ]);

    const conflicts = service.listConflicts(context);
    expect(conflicts.length).toBeGreaterThanOrEqual(2);
    await Promise.all(
      conflicts.map((conflict) => service.resolveConflict(String(conflict.id), 'KEEP_LOCAL', context)),
    );
    expect(service.listConflicts(context)).toHaveLength(0);
  });

  it('lists conflicts with corrupted snapshot JSON without failing', async () => {
    const patientId = 'sync-patient-corrupt-json';
    db.prepare(
      `INSERT INTO Patient (id, clinicId, createdAt, updatedAt, deletedAt, code, name, gender, phone, source, active)
       VALUES (?, 'clinic-v2-001', ?, ?, NULL, 'SYNC-CORRUPT', 'Corrupt JSON', 'UNKNOWN', '13800000002', 'WALK_IN', 1)`,
    ).run(patientId, now, '2026-08-09T12:00:00.000Z');
    const device = service.registerDevice('sync-device-corrupt', 'Device Corrupt', context);
    await service.push({
      deviceId: device.deviceId,
      deviceToken: device.token,
      changes: [{
        tableName: 'Patient',
        recordId: patientId,
        operation: 'UPDATE',
        updatedAt: '2026-08-09T11:00:00.000Z',
        data: { name: 'Stale Corrupt' },
      }],
    }, context);
    db.prepare(
      `UPDATE SyncConflict SET localSnapshotJson = ?, remoteSnapshotJson = ? WHERE recordId = ?`,
    ).run('{broken', '[1,2]', patientId);

    const conflicts = service.listConflicts(context);
    const corrupt = conflicts.find((conflict) => String(conflict.recordId) === patientId);
    expect(corrupt).toBeDefined();
    expect(corrupt?.localSnapshot).toEqual({});
    expect(corrupt?.remoteSnapshot).toEqual({});

    db.prepare(`DELETE FROM SyncConflict WHERE recordId = ?`).run(patientId);
    db.prepare(`DELETE FROM Patient WHERE id = ?`).run(patientId);
  });
});
