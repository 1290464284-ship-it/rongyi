import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../infrastructure/database';
import { runMigrations } from '../infrastructure/migrations';
import { StatsService } from './stats-service';
import type { AppContext } from '../../domain/contracts';

describe('StatsService', () => {
  let db: Database.Database;
  let dataDir: string;

  const makeContext = (role: AppContext['role'] = 'BOSS'): AppContext => ({
    userId: 'user-admin-001',
    clinicId: 'clinic-v2-001',
    role,
    traceId: 'stats-test',
    now: () => new Date('2026-08-14T00:00:00.000Z'),
  });

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-stats-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  // 缓存测试依赖初始库（未超聚合阈值）：必须先于 10 万行快照测试执行。
  it('serves repeated dashboard calls from the TTL cache without re-running aggregation SQL', () => {
    const service = new StatsService(db);
    const prepare = vi.spyOn(db, 'prepare');
    try {
      service.dashboard(makeContext());
      expect(prepare).toHaveBeenCalledTimes(2);

      const cached = service.dashboard(makeContext());
      expect(prepare).toHaveBeenCalledTimes(2);
      expect(cached).toHaveProperty('patients');
      expect(cached).toHaveProperty('pendingFollowUps');

      // A different clinic is a different cache key, so it recomputes.
      service.dashboard({ ...makeContext(), clinicId: 'clinic-v2-002' });
      expect(prepare).toHaveBeenCalledTimes(4);
    } finally {
      prepare.mockRestore();
    }
  });

  it('keeps revenue cache keys distinct per date range and granularity', () => {
    const service = new StatsService(db);
    const prepare = vi.spyOn(db, 'prepare');
    try {
      service.revenue('2026-01-01', '2026-01-31', 'month', makeContext());
      expect(prepare).toHaveBeenCalledTimes(1);
      service.revenue('2026-01-01', '2026-01-31', 'month', makeContext());
      expect(prepare).toHaveBeenCalledTimes(1);

      service.revenue('2026-02-01', '2026-02-28', 'month', makeContext());
      expect(prepare).toHaveBeenCalledTimes(2);
      service.revenue('2026-01-01', '2026-01-31', 'day', makeContext());
      expect(prepare).toHaveBeenCalledTimes(3);
    } finally {
      prepare.mockRestore();
    }
  });

  it('recomputes dashboard aggregation after the 30s TTL expires', () => {
    const service = new StatsService(db);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-05T00:00:00.000Z'));
    const prepare = vi.spyOn(db, 'prepare');
    try {
      service.dashboard(makeContext());
      expect(prepare).toHaveBeenCalledTimes(2);
      service.dashboard(makeContext());
      expect(prepare).toHaveBeenCalledTimes(2);

      vi.advanceTimersByTime(29_999);
      service.dashboard(makeContext());
      expect(prepare).toHaveBeenCalledTimes(2);

      vi.advanceTimersByTime(1_001);
      service.dashboard(makeContext());
      expect(prepare).toHaveBeenCalledTimes(4);
    } finally {
      prepare.mockRestore();
      vi.useRealTimers();
    }
  });

  it('prunes revenue fields for DOCTOR dashboards', () => {
    const service = new StatsService(db);
    const result = service.dashboard(makeContext('DOCTOR'));
    expect(result).toHaveProperty('patients');
    expect(result).toHaveProperty('appointments');
    expect(result).not.toHaveProperty('paidAmount');
    expect(result).not.toHaveProperty('unpaidAmount');
  });

  it('serves the dashboard from the materialized snapshot above the aggregate threshold', () => {
    db.prepare(
      `INSERT INTO StatSnapshot (clinicId, key, valueJson, updatedAt)
       VALUES ('clinic-v2-001', 'dashboard', ?, '2026-08-14T00:00:00.000Z')`,
    ).run(JSON.stringify({
      patients: 999,
      appointments: 1,
      paidAmount: 42,
      unpaidAmount: 7,
      inventoryItems: 3,
      pendingFollowUps: 0,
    }));
    const insert = db.prepare(
      `INSERT INTO Patient (id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, gender, phone, wechatId, preferredContact, contactNote, tags,
         allergies, medicalHistory, medicationHistory, systemicDiseases, source, active)
       VALUES (?, 'clinic-v2-001', '2026-08-14T00:00:00.000Z', '2026-08-14T00:00:00.000Z', NULL,
         ?, 'Bulk Patient', 'UNKNOWN', '', NULL, 'WECHAT', NULL, '[]', '[]', '[]', '[]', '[]', 'WALK_IN', 1)`,
    );
    db.transaction(() => {
      for (let i = 0; i < 100_001; i += 1) {
        insert.run(`bulk-p-${i}`, `B${i}`);
      }
    })();
    const service = new StatsService(db);
    const result = service.dashboard(makeContext());
    expect(result.patients).toBe(999);
    expect(result.paidAmount).toBe(42);
  });

  it('rebuilds and persists the snapshot when it is missing above the threshold', () => {
    db.prepare('DELETE FROM StatSnapshot WHERE 1 = 1').run();
    const service = new StatsService(db);
    const result = service.dashboard(makeContext());
    expect(result).toHaveProperty('patients');
    const row = db.prepare(
      "SELECT valueJson FROM StatSnapshot WHERE key = 'dashboard' AND clinicId = 'clinic-v2-001'",
    ).get() as { valueJson: string } | undefined;
    expect(row).toBeDefined();
    expect(JSON.parse(String(row?.valueJson))).toHaveProperty('patients');
  });
});
