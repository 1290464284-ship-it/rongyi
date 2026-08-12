import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { SqliteRepository } from '../../infrastructure/repository';
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

  afterEach(() => {
    vi.restoreAllMocks();
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

  it('applies sync changes with synchronous repository methods only', async () => {
    const findSpy = vi.spyOn(SqliteRepository.prototype, 'findById');
    const insertSpy = vi.spyOn(SqliteRepository.prototype, 'insert');
    const updateSpy = vi.spyOn(SqliteRepository.prototype, 'update');
    const deleteSpy = vi.spyOn(SqliteRepository.prototype, 'softDelete');
    const device = service.registerDevice('sync-device-sync-only', 'Device Sync Only', context);
    const result = await service.push({
      deviceId: device.deviceId,
      deviceToken: device.token,
      changes: [{
        tableName: 'Patient',
        recordId: 'sync-patient-1',
        operation: 'UPDATE',
        updatedAt: '2026-08-09T14:00:00.000Z',
        data: { name: 'Sync Name', updatedAt: '2026-08-09T14:00:00.000Z' },
      }],
    }, context);
    expect(result.accepted).toBe(1);
    expect(findSpy).not.toHaveBeenCalled();
    expect(insertSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
    const row = db.prepare('SELECT name FROM Patient WHERE id = ?').get('sync-patient-1') as { name: string };
    expect(row.name).toBe('Sync Name');
  });

  it('rejects invalid cursors and non-BOSS sync roles', async () => {
    expect(() => service.pull('', 'device', 'token', context)).toThrow(/since/);
    const doctor = { ...context, role: 'DOCTOR' as const };
    await expect(service.push({ deviceId: 'device', deviceToken: 'token', changes: [] }, doctor)).rejects.toThrow(/BOSS/);
    expect(() => service.listConflicts(doctor)).toThrow(/BOSS/);
    await expect(service.resolveConflict('missing', 'KEEP_LOCAL', doctor)).rejects.toThrow(/BOSS/);
    expect(() => service.registerDevice('device', 'Device', doctor)).toThrow(/BOSS/);
  });

  it('rejects sync changes that omit row data', async () => {
    const device = service.registerDevice('sync-device-missing-data', 'Missing Data', context);
    const result = await service.push({
      deviceId: device.deviceId,
      deviceToken: device.token,
      changes: [{
        tableName: 'Patient',
        recordId: 'sync-patient-1',
        operation: 'UPDATE',
        updatedAt: '2099-01-01T00:00:00.000Z',
      }],
    }, context);
    expect(result.accepted).toBe(0);
    expect(result.errors).toHaveLength(1);
  });

  it('resolves a remote DELETE conflict by soft-deleting the local row', async () => {
    const patientId = 'sync-patient-remote-delete';
    db.prepare(
      `INSERT INTO Patient (id, clinicId, createdAt, updatedAt, deletedAt, code, name, gender, phone, source, active)
       VALUES (?, 'clinic-v2-001', ?, '2026-08-09T12:00:00.000Z', NULL, 'SYNC-RDEL', 'Delete Me', 'UNKNOWN', '13800000003', 'WALK_IN', 1)`,
    ).run(patientId, now);
    const device = service.registerDevice('sync-device-remote-delete', 'Remote Delete', context);
    await service.push({
      deviceId: device.deviceId,
      deviceToken: device.token,
      changes: [{
        tableName: 'Patient',
        recordId: patientId,
        operation: 'DELETE',
        updatedAt: '2026-08-09T11:00:00.000Z',
      }],
    }, context);
    const [conflict] = service.listConflicts(context).filter((row) => String(row.recordId) === patientId);
    expect(conflict).toBeDefined();
    await service.resolveConflict(String(conflict.id), 'KEEP_REMOTE', context);
    const row = db.prepare('SELECT deletedAt FROM Patient WHERE id = ?').get(patientId) as { deletedAt: string | null };
    expect(row.deletedAt).not.toBeNull();
  });

  it('rejects registering a device already owned by another user', async () => {
    db.prepare(
      `INSERT INTO SyncDevice (id, clinicId, userId, deviceId, tokenHash, name, active, createdAt, updatedAt, deletedAt)
       VALUES (?, 'clinic-v2-001', 'user-other', 'sync-device-owned', 'hash', 'Owned', 1, ?, ?, NULL)`,
    ).run('sync-device-owned', now, now);
    expect(() => service.registerDevice('sync-device-owned', 'Mine', context)).toThrow(/already registered/);
  });

  it('rejects invalid resolutions and applies KEEP_REMOTE to a missing local row', async () => {
    await expect(service.resolveConflict('missing', 'BAD', context)).rejects.toThrow(/KEEP_LOCAL or KEEP_REMOTE/);

    db.prepare(
      `INSERT INTO SyncConflict (
         id, clinicId, tableName, recordId, deviceId, localOperation, remoteOperation,
         localSnapshotJson, remoteSnapshotJson, localUpdatedAt, remoteUpdatedAt,
         status, resolution, resolvedAt, resolvedById, createdAt, updatedAt, deletedAt
       ) VALUES (?, 'clinic-v2-001', 'Patient', 'sync-patient-missing-remote', 'sync-device-insert', 'UPDATE', 'UPDATE',
         '{}', ?, '2026-08-09T11:00:00.000Z', '2026-08-09T12:00:00.000Z',
         'PENDING', NULL, NULL, NULL, ?, ?, NULL)`,
    ).run(
      'sync-conflict-insert',
      JSON.stringify({
        code: 'SYNC-REMOTE-INSERT',
        name: 'Remote Insert',
        gender: 'UNKNOWN',
        phone: '13800000009',
        source: 'WALK_IN',
        active: true,
        updatedAt: '2026-08-09T12:00:00.000Z',
      }),
      now,
      now,
    );
    await service.resolveConflict('sync-conflict-insert', 'KEEP_REMOTE', context);
    const row = db.prepare('SELECT name FROM Patient WHERE id = ?').get('sync-patient-missing-remote') as { name: string };
    expect(row.name).toBe('Remote Insert');
  });

  it('swallows rollback failures and rethrows the original conflict error', async () => {
    db.prepare(
      `INSERT INTO SyncConflict (
         id, clinicId, tableName, recordId, deviceId, localOperation, remoteOperation,
         localSnapshotJson, remoteSnapshotJson, localUpdatedAt, remoteUpdatedAt,
         status, resolution, resolvedAt, resolvedById, createdAt, updatedAt, deletedAt
       ) VALUES (?, 'clinic-v2-001', 'Patient', 'sync-patient-rollback', 'sync-device-rollback', 'UPDATE', 'UPDATE',
         '{}', ?, '2026-08-09T11:00:00.000Z', '2026-08-09T12:00:00.000Z',
         'PENDING', NULL, NULL, NULL, ?, ?, NULL)`,
    ).run(
      'sync-conflict-rollback',
      JSON.stringify({ code: 123, name: 'Rollback', gender: 'UNKNOWN', phone: '13800000010', source: 'WALK_IN', active: true }),
      now,
      now,
    );
    const execSpy = vi.spyOn(db, 'exec').mockImplementation((sql: string) => {
      if (sql === 'ROLLBACK') throw new Error('rollback failed');
      return db;
    });
    await expect(service.resolveConflict('sync-conflict-rollback', 'KEEP_REMOTE', context)).rejects.toThrow();
    expect(execSpy).toHaveBeenCalledWith('ROLLBACK');
  });
});
