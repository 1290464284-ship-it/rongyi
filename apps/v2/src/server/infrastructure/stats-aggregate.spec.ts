import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from './database';
import { runMigrations } from './migrations';
import {
  invalidateStatSnapshots,
  readDashboardSnapshot,
  readReplenishmentSnapshot,
  writeDashboardSnapshot,
  writeReplenishmentSnapshot,
} from './stats-aggregate';

describe('stats-aggregate snapshots', () => {
  let dataDir: string;
  let db: Database.Database;

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-stats-aggregate-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('round-trips and invalidates the dashboard snapshot', () => {
    writeDashboardSnapshot(db, 'clinic-v2-001', { patients: 3, appointments: 2 }, '2026-08-12T00:00:00.000Z');
    expect(readDashboardSnapshot(db, 'clinic-v2-001')).toEqual({ patients: 3, appointments: 2 });
    invalidateStatSnapshots(db, 'Charge', 'clinic-v2-001');
    expect(readDashboardSnapshot(db, 'clinic-v2-001')).toBeNull();
    // 其他诊所不受影响
    writeDashboardSnapshot(db, 'clinic-other', { patients: 1 }, '2026-08-12T00:00:00.000Z');
    expect(readDashboardSnapshot(db, 'clinic-other')).toEqual({ patients: 1 });
  });

  it('round-trips and invalidates the replenishment snapshot with window check', () => {
    const consumption = new Map([['item-1', 12], ['item-2', 5]]);
    writeReplenishmentSnapshot(db, 'clinic-v2-001', '2026-01-01T00:00:00.000Z', '2026-04-01T00:00:00.000Z', consumption, '2026-04-01T01:00:00.000Z');
    expect(readReplenishmentSnapshot(
      db,
      'clinic-v2-001',
      '2026-01-01T00:00:00.000Z',
      '2026-04-01T00:00:00.000Z',
      '2026-03-31T00:00:00.000Z',
    )).toEqual(new Map([['item-1', 12], ['item-2', 5]]));
    // 窗口不匹配或出现更新的流水时拒绝缓存
    expect(readReplenishmentSnapshot(db, 'clinic-v2-001', '2026-01-02T00:00:00.000Z', '2026-04-01T00:00:00.000Z', null)).toBeNull();
    expect(readReplenishmentSnapshot(db, 'clinic-v2-001', '2026-01-01T00:00:00.000Z', '2026-04-01T00:00:00.000Z', '2026-04-02T00:00:00.000Z')).toBeNull();
    invalidateStatSnapshots(db, 'InventoryTransaction', 'clinic-v2-001');
    expect(readReplenishmentSnapshot(db, 'clinic-v2-001', '2026-01-01T00:00:00.000Z', '2026-04-01T00:00:00.000Z', null)).toBeNull();
  });
});
