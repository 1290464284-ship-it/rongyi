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
    for (const { db: local, dir } of localDbs) {
      local.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  // shuffle 顺序下共享库会被 10 万行快照测试污染（走快照路径、prepare 计数
  // 不同），且快照测试之间也互相踩 StatSnapshot 行 → 这些测试各自用独立
  // 临时库，彻底解耦顺序。
  const localDbs: Array<{ db: Database.Database; dir: string }> = [];
  function makeLocalDb(): Database.Database {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-stats-local-'));
    const local = createDatabase(dir);
    seedDatabase(local);
    runMigrations(local);
    localDbs.push({ db: local, dir });
    return local;
  }

  it('serves repeated dashboard calls from the TTL cache without re-running aggregation SQL', () => {
    const local = makeLocalDb();
    const service = new StatsService(local);
    const prepare = vi.spyOn(local, 'prepare');
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
    const local = makeLocalDb();
    const service = new StatsService(local);
    const prepare = vi.spyOn(local, 'prepare');
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
    const local = makeLocalDb();
    const service = new StatsService(local);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-05T00:00:00.000Z'));
    const prepare = vi.spyOn(local, 'prepare');
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
    const local = makeLocalDb();
    local.prepare(
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
    const insert = local.prepare(
      `INSERT INTO Patient (id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, gender, phone, wechatId, preferredContact, contactNote, tags,
         allergies, medicalHistory, medicationHistory, systemicDiseases, source, active)
       VALUES (?, 'clinic-v2-001', '2026-08-14T00:00:00.000Z', '2026-08-14T00:00:00.000Z', NULL,
         ?, 'Bulk Patient', 'UNKNOWN', '', NULL, 'WECHAT', NULL, '[]', '[]', '[]', '[]', '[]', 'WALK_IN', 1)`,
    );
    local.transaction(() => {
      for (let i = 0; i < 100_001; i += 1) {
        insert.run(`bulk-p-${i}`, `B${i}`);
      }
    })();
    const service = new StatsService(local);
    const result = service.dashboard(makeContext());
    expect(result.patients).toBe(999);
    expect(result.paidAmount).toBe(42);
  });

  it('rebuilds and persists the snapshot when it is missing above the threshold', () => {
    const local = makeLocalDb();
    // 自给自足：本库也要超过聚合阈值，快照路径才会写入 StatSnapshot。
    const insert = local.prepare(
      `INSERT INTO Patient (id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, gender, phone, wechatId, preferredContact, contactNote, tags,
         allergies, medicalHistory, medicationHistory, systemicDiseases, source, active)
       VALUES (?, 'clinic-v2-001', '2026-08-14T00:00:00.000Z', '2026-08-14T00:00:00.000Z', NULL,
         ?, 'Bulk Patient', 'UNKNOWN', '', NULL, 'WECHAT', NULL, '[]', '[]', '[]', '[]', '[]', 'WALK_IN', 1)`,
    );
    local.transaction(() => {
      for (let i = 0; i < 100_001; i += 1) {
        insert.run(`bulk-rebuild-${i}`, `RB${i}`);
      }
    })();
    local.prepare('DELETE FROM StatSnapshot WHERE 1 = 1').run();
    const service = new StatsService(local);
    const result = service.dashboard(makeContext());
    expect(result).toHaveProperty('patients');
    const row = local.prepare(
      "SELECT valueJson FROM StatSnapshot WHERE key = 'dashboard' AND clinicId = 'clinic-v2-001'",
    ).get() as { valueJson: string } | undefined;
    expect(row).toBeDefined();
    expect(JSON.parse(String(row?.valueJson))).toHaveProperty('patients');
  });

  // ---- 边缘分支测试（自 services-edge.spec.ts 聚合文件迁移）----

  it('excludes soft-deleted member cards from memberStats', () => {
    const now = new Date().toISOString();
    const clinicId = 'clinic-v2-001';
    db.prepare(
      `INSERT INTO Patient (id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, gender, phone, tags, allergies, medicalHistory,
         medicationHistory, systemicDiseases, source, active)
       VALUES ('patient-stats-del', ?, ?, ?, NULL, 'P-STATS-DEL', 'Stats Del', 'UNKNOWN', '13700000005',
         '[]', '[]', '[]', '[]', '[]', 'WALK_IN', 1)`,
    ).run(clinicId, now, now);
    db.prepare(
      `INSERT INTO MemberCard (id, clinicId, createdAt, updatedAt, deletedAt, patientId, cardNo,
         balance, totalRecharge, totalConsume, status, points, totalPoints, level)
       VALUES ('card-stats-del', ?, ?, ?, NULL, 'patient-stats-del', 'CARD-STATS-DEL', 100, 100, 0, 'ACTIVE', 10, 10, 'NORMAL')`,
    ).run(clinicId, now, now);
    // 缓存按实例隔离：每次断言用新实例，避免 30s TTL 缓存。
    const countActive = (): number => {
      const row = db.prepare(
        `SELECT COUNT(*) AS c FROM MemberCard WHERE clinicId = ? AND deletedAt IS NULL`,
      ).get(clinicId) as { c: number };
      return Number(row.c);
    };
    const before = new StatsService(db).memberStats(makeContext());
    expect(Number(before.total)).toBe(countActive());
    // 软删该卡后统计应减去一行。
    db.prepare(`UPDATE MemberCard SET deletedAt = ? WHERE id = 'card-stats-del'`).run(now);
    const after = new StatsService(db).memberStats(makeContext());
    expect(Number(after.total)).toBe(countActive());
    expect(Number(after.total)).toBe(Number(before.total) - 1);
  });

  it('reports dashboard aggregates with a null clinic scope', () => {
    const nullContext = { ...makeContext(), clinicId: null };
    const stats = new StatsService(db);
    expect(stats.dashboard(nullContext)).toHaveProperty('patients');
    expect(stats.revenue('2026-01-01T00:00:00.000Z', '2026-12-31T23:59:59.999Z', 'day', nullContext)).toBeInstanceOf(Array);
    expect(stats.revenue('2026-01-01T00:00:00.000Z', '2026-12-31T23:59:59.999Z', 'month', nullContext)).toBeInstanceOf(Array);
    expect(stats.patientGrowth('2026-01-01T00:00:00.000Z', '2026-12-31T23:59:59.999Z', nullContext)).toBeInstanceOf(Array);
    expect(stats.inventoryStats(nullContext)).toBeInstanceOf(Array);
    expect(stats.memberStats(nullContext)).toHaveProperty('total');
  });
});
