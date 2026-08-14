// SatisfactionService 模块化 spec：自 services-edge.spec.ts（聚合文件）迁移而来。
// 迁移约定：聚合文件按模块逐步拆出后删除（迁移前保持聚合）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { SatisfactionService } from '../satisfaction-service';
import type { AppContext } from '../../../domain/contracts';

describe('SatisfactionService', () => {
  let db: Database.Database;
  let dataDir: string;

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-satisfaction-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('reports nps, trend, and doctor rankings with a null clinic scope', () => {
    const nullContext: AppContext = {
      userId: 'user-admin-001',
      clinicId: null,
      role: 'BOSS',
      traceId: 'trace-null',
      now: () => new Date(),
    };
    const satisfaction = new SatisfactionService(db);
    expect(satisfaction.nps(nullContext).score).toBeGreaterThanOrEqual(0);
    expect(satisfaction.trend(nullContext)).toBeInstanceOf(Array);
    expect(satisfaction.doctorRankings(nullContext)).toBeInstanceOf(Array);
  });

  it('ignores soft-deleted surveys in nps and reports trend and rankings', () => {
    const context: AppContext = {
      userId: 'user-admin-001',
      clinicId: 'clinic-v2-001',
      role: 'BOSS',
      traceId: 'test-trace',
      now: () => new Date(),
    };
    const satisfaction = new SatisfactionService(db);
    const npsBefore = satisfaction.nps(context);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO SatisfactionSurvey (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, score, channel, comment, surveyDate
       ) VALUES (?, ?, ?, ?, ?, 'patient-demo-001', 'user-admin-001', 10, 'CLINIC', 'deleted', '2026-08-04')`,
    ).run('satisfaction-deleted', context.clinicId, now, now, now);
    expect(satisfaction.nps(context)).toEqual(npsBefore);
    expect(satisfaction.trend(context)).toBeInstanceOf(Array);
    expect(satisfaction.doctorRankings(context)).toBeInstanceOf(Array);
  });
});
