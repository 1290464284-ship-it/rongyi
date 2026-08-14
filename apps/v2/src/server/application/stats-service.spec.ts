import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../infrastructure/database';
import { runMigrations } from '../infrastructure/migrations';
import { StatsService } from './stats-service';
import type { AppContext } from '../../domain/contracts';

describe('StatsService snapshot and role pruning', () => {
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
