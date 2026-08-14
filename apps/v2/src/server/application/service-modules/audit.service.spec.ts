// AuditService 模块化 spec：自 services.spec.ts / services-edge.spec.ts
// （聚合文件）迁移而来。迁移约定：聚合文件按模块逐步拆出后删除（迁移前保持聚合）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { AuditService } from './audit.service';

describe('AuditService', () => {
  let db: Database.Database;
  let dataDir: string;

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-audit-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('writes operation log entries', () => {
    const audit = new AuditService(db);
    audit.log({
      userId: 'user-admin-001',
      action: 'TEST_WRITE',
      target: 'target-1',
      traceId: 'trace-audit',
      clinicId: 'clinic-v2-001',
    });
    const row = db.prepare('SELECT * FROM OperationLog WHERE target = ?').get('target-1') as Record<string, unknown>;
    expect(row.action).toBe('TEST_WRITE');
    expect(row.traceId).toBe('trace-audit');
    db.prepare('UPDATE OperationLog SET createdAt = ? WHERE target = ?')
      .run('2000-01-01T00:00:00.000Z', 'target-1');
    expect(audit.cleanup('2000-01-02T00:00:00.000Z')).toBe(1);
  });

  it('covers audit logs with nullish optional fields', () => {
    const audit = new AuditService(db);
    audit.log({ action: 'EDGE_NULL' });
    const row = db.prepare("SELECT * FROM OperationLog WHERE action = 'EDGE_NULL'").get() as Record<string, unknown>;
    expect(row.userId).toBeNull();
    expect(row.traceId).toBeNull();
    expect(row.clinicId).toBeNull();
  });
});
