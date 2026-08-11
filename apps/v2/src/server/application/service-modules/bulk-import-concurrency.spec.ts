import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { BulkImportService } from './clinical-ops';

describe('BulkImportService concurrency', () => {
  let db: Database.Database;
  let dataDir: string;
  let service: BulkImportService;
  const context = {
    userId: 'user-admin-001',
    clinicId: 'clinic-v2-001',
    role: 'BOSS' as const,
    traceId: 'test-trace',
    now: () => new Date('2026-08-09T10:00:00.000Z'),
  };

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-bulk-import-concurrency-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
    service = new BulkImportService(db);
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('serializes concurrent imports so nested BEGIN never throws', async () => {
    const rows = (prefix: string) => [{
      code: `BULK-${prefix}-1`,
      name: `Bulk ${prefix} One`,
      gender: 'UNKNOWN',
      phone: '13600000001',
      source: 'OTHER',
      active: true,
    }, {
      code: `BULK-${prefix}-2`,
      name: `Bulk ${prefix} Two`,
      gender: 'UNKNOWN',
      phone: '13600000002',
      source: 'OTHER',
      active: true,
    }];

    const [first, second] = await Promise.all([
      service.importRows('patients', rows('A'), context, 10),
      service.importRows('patients', rows('B'), context, 10),
    ]);

    expect(first.imported).toBe(2);
    expect(first.failed).toBe(0);
    expect(second.imported).toBe(2);
    expect(second.failed).toBe(0);
    const count = db.prepare(
      `SELECT COUNT(*) AS count FROM Patient WHERE code LIKE 'BULK-%' AND deletedAt IS NULL`,
    ).get() as { count: number };
    expect(count.count).toBe(4);
  });
});
