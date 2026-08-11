import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { SyncService } from './sync';

describe('sync push concurrency', () => {
  let db: Database.Database;
  let dataDir: string;
  let service: SyncService;
  const context = {
    userId: 'user-admin-001',
    clinicId: 'clinic-v2-001',
    role: 'BOSS' as const,
    traceId: 'test-trace',
    now: () => new Date('2026-08-09T10:00:00.000Z'),
  };

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-sync-push-concurrency-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
    service = new SyncService(db);
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('serializes concurrent pushes so nested BEGIN never throws', async () => {
    const device = service.registerDevice('sync-concurrent-device', 'Concurrent Device', context);
    const change = (recordId: string) => ({
      tableName: 'Patient',
      recordId,
      operation: 'INSERT',
      updatedAt: '2026-08-09T10:00:00.000Z',
      data: {
        code: `SYNC-CONCURRENT-${recordId}`,
        name: `Concurrent ${recordId}`,
        gender: 'UNKNOWN',
        phone: '13600000001',
        source: 'OTHER',
        active: true,
      },
    });

    const [first, second] = await Promise.all([
      service.push({
        deviceId: device.deviceId,
        deviceToken: device.token,
        changes: [change('push-a')],
      }, context),
      service.push({
        deviceId: device.deviceId,
        deviceToken: device.token,
        changes: [change('push-b')],
      }, context),
    ]);

    expect(first.accepted).toBe(1);
    expect(first.failed).toBe(0);
    expect(second.accepted).toBe(1);
    expect(second.failed).toBe(0);
    const count = db.prepare(
      `SELECT COUNT(*) AS count FROM Patient WHERE id IN ('push-a', 'push-b') AND deletedAt IS NULL`,
    ).get() as { count: number };
    expect(count.count).toBe(2);
  });

  it('keeps the queue usable after a failed push', async () => {
    const device = service.registerDevice('sync-concurrent-device-2', 'Concurrent Device Two', context);
    const failed = await service.push({
      deviceId: device.deviceId,
      deviceToken: device.token,
      changes: [{
        tableName: 'NotAllowed',
        recordId: 'x',
        operation: 'INSERT',
        updatedAt: '2026-08-09T10:00:00.000Z',
        data: {},
      }],
    }, context);
    expect(failed.failed).toBe(1);

    const next = await service.push({
      deviceId: device.deviceId,
      deviceToken: device.token,
      changes: [{
        tableName: 'Patient',
        recordId: 'push-after-failure',
        operation: 'INSERT',
        updatedAt: '2026-08-09T10:00:00.000Z',
        data: {
          code: 'SYNC-AFTER-FAILURE',
          name: 'After Failure',
          gender: 'UNKNOWN',
          phone: '13600000002',
          source: 'OTHER',
          active: true,
        },
      }],
    }, context);
    expect(next.accepted).toBe(1);
  });

  it('keeps processing valid rows when a later row fails validation', async () => {
    const device = service.registerDevice('sync-validation-device', 'Validation Device', context);
    const result = await service.push({
      deviceId: device.deviceId,
      deviceToken: device.token,
      changes: [
        {
          tableName: 'Patient',
          recordId: 'push-valid-row',
          operation: 'INSERT',
          updatedAt: '2026-08-09T10:00:00.000Z',
          data: {
            code: 'SYNC-VALID-ROW',
            name: 'Valid Row',
            gender: 'UNKNOWN',
            phone: '13600000003',
            source: 'OTHER',
            active: true,
          },
        },
        {
          tableName: 'Patient',
          recordId: 'push-invalid-row',
          operation: 'INSERT',
          updatedAt: '2026-08-09T10:00:00.000Z',
          data: {
            code: 'SYNC-INVALID-ROW',
            name: 'Invalid Row',
            gender: 'UNKNOWN',
            phone: '13600000004',
            source: 'NOT_A_REAL_SOURCE',
            active: true,
          },
        },
      ],
    }, context);
    expect(result.accepted).toBe(1);
    expect(result.failed).toBe(1);
    const validRow = db.prepare('SELECT id FROM Patient WHERE id = ? AND deletedAt IS NULL').get('push-valid-row');
    expect(validRow).toBeDefined();
    const invalidRow = db.prepare('SELECT id FROM Patient WHERE id = ? AND deletedAt IS NULL').get('push-invalid-row');
    expect(invalidRow).toBeUndefined();
  });
});
