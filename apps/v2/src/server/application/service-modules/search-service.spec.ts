// SearchService 模块化 spec：自 services-edge.spec.ts（聚合文件）迁移而来。
// 迁移约定：聚合文件按模块逐步拆出后删除（迁移前保持聚合）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { rebuildSearchIndex } from '../../infrastructure/search-index';
import { SearchService } from '../search-service';
import type { AppContext } from '../../../domain/contracts';

describe('SearchService', () => {
  let db: Database.Database;
  let dataDir: string;
  let context: AppContext;
  const nullContext: AppContext = {
    userId: 'user-admin-001',
    clinicId: null,
    role: 'BOSS',
    traceId: 'trace-null',
    now: () => new Date(),
  };

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-search-'));
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

  it('covers label branches and nullish field masking', () => {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO Supplier (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, phone
       ) VALUES (?, ?, ?, ?, NULL, 'S-EDGE', NULL, '1351234')`,
    ).run('supplier-edge', null, now, now);
    db.prepare(
      `INSERT INTO Supplier (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, phone
       ) VALUES (?, ?, ?, ?, NULL, NULL, 'Supplier Only', '13512345')`,
    ).run('supplier-edge-2', null, now, now);
    db.prepare(
      `INSERT INTO Patient (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, gender, phone, tags, allergies, medicalHistory,
         medicationHistory, systemicDiseases, source, active
       ) VALUES (?, ?, ?, ?, NULL, 'XNULL', NULL, 'UNKNOWN', 'PHONE123',
         '[]', '[]', '[]', '[]', '[]', 'WALK_IN', 1)`,
    ).run('patient-null-name', null, now, now);
    db.prepare(
      `INSERT INTO Patient (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, gender, phone, tags, allergies, medicalHistory,
         medicationHistory, systemicDiseases, source, active
       ) VALUES (?, ?, ?, ?, NULL, NULL, NULL, 'UNKNOWN', 'SHORT',
         '[]', '[]', '[]', '[]', '[]', 'WALK_IN', 1)`,
    ).run('patient-short-phone', null, now, now);
    db.prepare(
      `INSERT INTO InventoryItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, category, unit, stock, minStock, price
       ) VALUES (?, ?, ?, ?, NULL, NULL, NULL, 'SEARCHCAT', 'box', 1, 0, 100)`,
    ).run('inventory-null-label', null, now, now);
    // 迁移 119 已移除 FTS 触发器（按需重建索引），测试需显式重建。
    rebuildSearchIndex(db);
    const search = new SearchService(db);
    const results = search.search('Supplier', nullContext);
    expect(results.length).toBeGreaterThanOrEqual(1);
    db.prepare(
      `INSERT INTO SearchIndex(resource, recordId, clinicId, content)
       VALUES ('Unknown', 'search-unknown', 'clinic-v2-001', 'UNKNOWNTERM')`,
    ).run();
    search.search('UNKNOWNTERM', context);
    expect(search.search('', context)).toEqual([]);
    expect(search.search('XNULL', nullContext).some((row) => row.resource === 'patients' && row.label === 'XNULL')).toBe(true);
    expect(search.search('SHORT', nullContext).some((row) => (row.detail as Record<string, unknown>).phone === '*****')).toBe(true);
    expect(search.search('SEARCHCAT', nullContext).some((row) => row.resource === 'inventoryItems' && row.label === '')).toBe(true);

    db.prepare(
      `INSERT INTO Appointment (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, startTime, endTime, status, type
       ) VALUES (?, NULL, ?, ?, NULL, 'patient-missing-label', 'user-admin-001', ?, ?, 'LABELSTATUS', 'REGULAR')`,
    ).run('appointment-label-null', now, now, now, now);
    db.prepare(
      `INSERT INTO Charge (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, number, totalAmount, status
       ) VALUES (?, NULL, ?, ?, NULL, 'patient-missing-label', NULL, 100, 'LABELCHARGE')`,
    ).run('charge-label-null', now, now);
    db.prepare(
      `INSERT INTO Supplier (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, phone
       ) VALUES (?, NULL, ?, ?, NULL, NULL, NULL, 'LABELPHONE')`,
    ).run('supplier-label-null', now, now);
    db.prepare(
      `INSERT INTO FollowUp (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, planDate, content, status
       ) VALUES (?, NULL, ?, ?, NULL, 'patient-missing-label', ?, 'LABELCONTENT', 'PENDING')`,
    ).run('followup-label-null', now, now, now.slice(0, 10));
    rebuildSearchIndex(db);
    expect(search.search('LABELSTATUS', nullContext).some((row) => row.resource === 'appointments' && row.label === '')).toBe(true);
    expect(search.search('LABELCHARGE', nullContext).some((row) => row.resource === 'charges' && row.label === '')).toBe(true);
    expect(search.search('LABELPHONE', nullContext).some((row) => row.resource === 'suppliers' && row.label === '')).toBe(true);
    expect(search.search('LABELCONTENT', nullContext).some((row) => row.resource === 'followUps' && row.label === '')).toBe(true);
  });
});
