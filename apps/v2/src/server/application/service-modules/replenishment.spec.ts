import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { ReplenishmentService } from './replenishment';
import type { AppContext } from '../../../domain/contracts';

vi.mock('../../infrastructure/stats-aggregate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../infrastructure/stats-aggregate')>();
  return {
    ...actual,
    tableRowCount: vi.fn(() => actual.AGGREGATE_THRESHOLD + 1),
  };
});

describe('replenishment snapshot reuse', () => {
  let db: Database.Database;
  let dataDir: string;
  let context: AppContext;

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-replenishment-'));
    db = createDatabase(dataDir);
    runMigrations(db);
    context = {
      userId: 'user-admin-001',
      clinicId: 'clinic-v2-001',
      role: 'BOSS',
      traceId: 'trace-replenishment',
      now: () => new Date('2026-08-03T10:00:00.000Z'),
    };
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('reuses the snapshot within the same UTC day and recomputes the next day', () => {
    const service = new ReplenishmentService(db);
    service.generate(context);
    const snapshot = db.prepare(
      'SELECT windowStart, windowEnd, dataJson, updatedAt FROM ReplenishmentSnapshot WHERE clinicId = ?',
    ).get(context.clinicId) as
      | { windowStart: string; windowEnd: string; dataJson: string; updatedAt: string }
      | undefined;
    expect(snapshot).toBeDefined();
    expect(snapshot?.windowStart).toBe('2026-05-05T00:00:00.000Z');
    expect(snapshot?.windowEnd).toBe('2026-08-03T00:00:00.000Z');

    // 同一天第二次生成：窗口不变且无新流水，直接复用快照。
    const sentinel = '{"sentinel-item": 7}';
    db.prepare('UPDATE ReplenishmentSnapshot SET dataJson = ? WHERE clinicId = ?').run(sentinel, context.clinicId);
    context.now = () => new Date('2026-08-03T15:00:00.000Z');
    service.generate(context);
    const reused = db.prepare(
      'SELECT dataJson FROM ReplenishmentSnapshot WHERE clinicId = ?',
    ).get(context.clinicId) as { dataJson: string } | undefined;
    expect(reused?.dataJson).toBe(sentinel);

    // 其他诊所的新增流水不能使本诊所快照失效（MAX(createdAt) 必须按诊所限定）。
    db.prepare(
      `INSERT INTO InventoryItem (
         id, clinicId, createdAt, updatedAt, deletedAt, code, name,
         category, unit, stock, minStock, price
       ) VALUES (?, 'clinic-other', ?, ?, NULL, 'OTHER-1', 'Other Item',
                 'CONSUMABLE', 'box', 1, 0, 100)`,
    ).run('item-other', '2026-08-03T00:00:00.000Z', '2026-08-03T00:00:00.000Z');
    db.prepare(
      `INSERT INTO InventoryTransaction (
         id, clinicId, createdAt, updatedAt, deletedAt, itemId, type,
         quantity, beforeStock, afterStock, operatorId
       ) VALUES (?, 'clinic-other', ?, ?, NULL, 'item-other', 'OUT', 1, 5, 4, NULL)`,
    ).run(
      'tx-other-clinic',
      '2026-08-03T16:00:00.000Z',
      '2026-08-03T16:00:00.000Z',
    );
    service.generate(context);
    const crossClinic = db.prepare(
      'SELECT dataJson FROM ReplenishmentSnapshot WHERE clinicId = ?',
    ).get(context.clinicId) as { dataJson: string } | undefined;
    expect(crossClinic?.dataJson).toBe(sentinel);

    // 跨天后窗口平移，必须重算并覆盖快照。
    context.now = () => new Date('2026-08-04T09:00:00.000Z');
    service.generate(context);
    const nextDay = db.prepare(
      'SELECT windowStart, dataJson FROM ReplenishmentSnapshot WHERE clinicId = ?',
    ).get(context.clinicId) as { windowStart: string; dataJson: string } | undefined;
    expect(nextDay?.windowStart).toBe('2026-05-06T00:00:00.000Z');
    expect(nextDay?.dataJson).not.toBe(sentinel);
  });
});
