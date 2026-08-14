import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { BulkImportService, PatientRiskService } from './clinical-ops';
import type { AppContext } from '../../../domain/contracts';

describe('BulkImportService edge paths', () => {
  let db: Database.Database;
  let dataDir: string;
  let service: BulkImportService;
  const baseContext = {
    userId: 'user-admin-001',
    clinicId: 'clinic-v2-001',
    role: 'BOSS' as const,
    traceId: 'bulk-edge-test',
    now: () => new Date('2026-08-14T10:00:00.000Z'),
  };

  const patientRow = () => ({
    code: `BULK-EDGE-${Math.floor(Math.random() * 1e9)}`,
    name: 'Bulk Edge Patient',
    gender: 'UNKNOWN',
    phone: '13600000099',
    source: 'OTHER',
    active: true,
  });

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-bulk-import-edge-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
    service = new BulkImportService(db);
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('rejects imports for resources whose module permission the caller lacks', async () => {
    const context: AppContext = { ...baseContext, permissions: ['analytics'] };
    await expect(service.importRows('patients', [patientRow()], context)).rejects.toThrow(
      'Forbidden resource: patients',
    );
  });

  it('aborts with the message when the insert statement fails with a systematic sqlite error', async () => {
    const originalPrepare = db.prepare.bind(db);
    vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      if (sql.includes('INSERT INTO Patient')) {
        throw Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' });
      }
      return originalPrepare(sql);
    });
    try {
      await expect(service.importRows('patients', [patientRow()], baseContext)).rejects.toThrow(
        '批量导入中止：database is locked',
      );
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('rolls back and aborts with the message when COMMIT fails with a systematic sqlite error', async () => {
    const originalExec = db.exec.bind(db);
    vi.spyOn(db, 'exec').mockImplementation((sql: string) => {
      if (sql === 'COMMIT') {
        throw Object.assign(new Error('database or disk is full'), { code: 'SQLITE_FULL' });
      }
      return originalExec(sql);
    });
    try {
      await expect(service.importRows('patients', [patientRow()], baseContext)).rejects.toThrow(
        '批量导入中止：前 0 条已导入，请人工核对后重试（database or disk is full）',
      );
      const count = db.prepare(
        "SELECT COUNT(*) AS count FROM Patient WHERE code LIKE 'BULK-EDGE-%' AND deletedAt IS NULL",
      ).get() as { count: number };
      expect(count.count).toBe(0);
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe('PatientRiskService', () => {
  // 复用同模块文件（clinical-ops.ts）的共享库：风险评分只读种子患者数据。
  let db: Database.Database;
  let dataDir: string;

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-risk-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('calculates a patient risk score', () => {
    const service = new PatientRiskService(db);
    const result = service.calculate('patient-demo-001', {
      userId: 'user-admin-001',
      clinicId: 'clinic-v2-001',
      role: 'BOSS',
      traceId: 'risk-test',
      now: () => new Date(),
    });
    expect(result).toHaveProperty('cariesScore');
    expect(result).toHaveProperty('periodontalScore');
  });
});
