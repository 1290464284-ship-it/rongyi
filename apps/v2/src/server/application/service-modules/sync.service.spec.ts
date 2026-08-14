// SyncService 模块化 spec：自 services.spec.ts（聚合文件）迁移而来。
// 迁移约定：聚合文件按模块逐步拆出后删除（迁移前保持聚合）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { SyncService } from './sync';
import type { AppContext } from '../../../domain/contracts';

describe('SyncService', () => {
  let db: Database.Database;
  let dataDir: string;
  let context: AppContext;

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-sync-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
    context = {
      userId: 'user-admin-001',
      clinicId: 'clinic-v2-001',
      role: 'BOSS',
      traceId: 'test-trace',
      now: () => new Date(),
    };
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('pulls sync changes with a cursor across the 1000-row page', () => {
    const service = new SyncService(db);
    const device = service.registerDevice('sync-cursor-device', 'Cursor Test', context);
    // 起点取本库当前最新 createdAt +1ms：新语义下与游标同毫秒的行也会投递（防丢变更），
    // 必须跳过同毫秒的遗留行，确保后续插入的 1001 条是唯一可见的新变更。
    const maxRow = db.prepare('SELECT MAX(createdAt) AS m FROM SyncChange WHERE clinicId = ?').get(context.clinicId) as { m: string | null };
    const since = maxRow.m ? new Date(Date.parse(maxRow.m) + 1).toISOString() : new Date(0).toISOString();
    const createdAtFor = (index: number) => new Date(Date.parse(since) + index + 1).toISOString();
    try {
      for (let index = 0; index < 1001; index += 1) {
        const createdAt = createdAtFor(index);
        db.prepare(
          `INSERT INTO SyncChange (
             id, clinicId, createdAt, updatedAt, deletedAt,
             tableName, recordId, operation, deviceId
           ) VALUES (?, ?, ?, ?, NULL, 'Patient', ?, 'INSERT', 'other-device')`,
        ).run(`sync-cursor-change-${index}`, context.clinicId, createdAt, createdAt, `sync-cursor-record-${index}`);
      }

      const first = service.pull(since, 'sync-cursor-device', device.token, context);
      expect(first.changes).toHaveLength(1000);
      expect(first.changes[0].recordId).toBe('sync-cursor-record-0');
      expect(first.changes[999].recordId).toBe('sync-cursor-record-999');
      expect(first.cursor).toBe(`${createdAtFor(999)}|${first.changes[999].rowid}`);

      const second = service.pull(first.cursor, 'sync-cursor-device', device.token, context);
      expect(second.changes).toHaveLength(1);
      expect(second.changes[0].recordId).toBe('sync-cursor-record-1000');
      expect(second.cursor).toBe(`${createdAtFor(1000)}|${second.changes[0].rowid}`);

      const empty = service.pull(second.cursor, 'sync-cursor-device', device.token, context);
      expect(empty.changes).toHaveLength(0);
      expect(empty.cursor).toBe(second.cursor);
    } finally {
      db.prepare('DELETE FROM SyncChange WHERE clinicId = ? AND recordId LIKE ?').run(context.clinicId, 'sync-cursor-record-%');
      db.prepare('DELETE FROM SyncDevice WHERE deviceId = ?').run('sync-cursor-device');
    }
  });

  it('does not lose sync changes sharing the same createdAt across the 1000-row page', () => {
    const service = new SyncService(db);
    const device = service.registerDevice('sync-tie-device', 'Tie Test', context);
    // 起点 = 当前最新 createdAt +1ms，所有新行共用该时间点：与游标同毫秒的遗留行
    // 已被排除，且该毫秒恰好没有旧数据，能精确验证同毫秒分页不丢行。
    const maxRow = db.prepare('SELECT MAX(createdAt) AS m FROM SyncChange WHERE clinicId = ?').get(context.clinicId) as { m: string | null };
    const since = maxRow.m ? new Date(Date.parse(maxRow.m) + 1).toISOString() : new Date(0).toISOString();
    const tieTime = since;
    try {
      // 1001 条变更共用同一 createdAt（同毫秒并列），且超出单页 LIMIT 1000。
      for (let index = 0; index < 1001; index += 1) {
        db.prepare(
          `INSERT INTO SyncChange (
             id, clinicId, createdAt, updatedAt, deletedAt,
             tableName, recordId, operation, deviceId
           ) VALUES (?, ?, ?, ?, NULL, 'Patient', ?, 'INSERT', 'other-device')`,
        ).run(`sync-tie-change-${index}`, context.clinicId, tieTime, tieTime, `sync-tie-record-${index}`);
      }

      const first = service.pull(since, 'sync-tie-device', device.token, context);
      expect(first.changes).toHaveLength(1000);
      const firstIds = new Set(first.changes.map((row) => String(row.recordId)));
      expect(firstIds.size).toBe(1000);

      const second = service.pull(first.cursor, 'sync-tie-device', device.token, context);
      expect(second.changes).toHaveLength(1);
      expect(second.changes[0].recordId).toBe('sync-tie-record-1000');
      expect(second.cursor).toMatch(/^.+\.\d{3}Z\|\d+$/);

      const third = service.pull(second.cursor, 'sync-tie-device', device.token, context);
      expect(third.changes).toHaveLength(0);
      expect(third.cursor).toBe(second.cursor);
    } finally {
      db.prepare('DELETE FROM SyncChange WHERE clinicId = ? AND recordId LIKE ?').run(context.clinicId, 'sync-tie-record-%');
      db.prepare('DELETE FROM SyncDevice WHERE deviceId = ?').run('sync-tie-device');
    }
  });

  it('pushes sync changes in transactional batches and persists every row', async () => {
    const service = new SyncService(db);
    const device = service.registerDevice('sync-push-batch-device', 'Push Batch', context);
    const changes = Array.from({ length: 300 }, (_, index) => ({
      tableName: 'Patient',
      recordId: `sync-push-batch-record-${index}`,
      operation: 'INSERT',
      updatedAt: new Date().toISOString(),
      data: {
        code: `SYNC-PUSH-BATCH-${index}`,
        name: `Sync Push Batch ${index}`,
        gender: 'UNKNOWN',
        phone: `13${String(400000000 + index)}`,
        source: 'OTHER',
        active: true,
      },
    }));
    try {
      const result = await service.push({
        deviceId: 'sync-push-batch-device',
        deviceToken: device.token,
        changes,
      }, context);
      expect(result.accepted).toBe(300);
      expect(result.failed).toBe(0);
      expect(result.errors).toHaveLength(0);

      const patients = db.prepare('SELECT COUNT(*) AS n FROM Patient WHERE clinicId = ? AND id LIKE ?').get(context.clinicId, 'sync-push-batch-record-%') as { n: number };
      expect(Number(patients.n)).toBe(300);
      const changeLog = db.prepare('SELECT COUNT(*) AS n FROM SyncChange WHERE deviceId = ? AND recordId LIKE ?').get('sync-push-batch-device', 'sync-push-batch-record-%') as { n: number };
      expect(Number(changeLog.n)).toBe(300);
    } finally {
      db.prepare('DELETE FROM Patient WHERE clinicId = ? AND id LIKE ?').run(context.clinicId, 'sync-push-batch-record-%');
      db.prepare('DELETE FROM SearchIndex WHERE resource = ? AND recordId LIKE ?').run('Patient', 'sync-push-batch-record-%');
      db.prepare('DELETE FROM SyncChange WHERE deviceId = ? AND recordId LIKE ?').run('sync-push-batch-device', 'sync-push-batch-record-%');
      db.prepare('DELETE FROM SyncDevice WHERE deviceId = ?').run('sync-push-batch-device');
    }
  });
});
