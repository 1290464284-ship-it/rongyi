// BulkImportService 模块化 spec：自 services.spec.ts（聚合文件）迁移而来。
// 迁移约定：聚合文件按模块逐步拆出后删除（迁移前保持聚合）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { BulkImportService } from './clinical-ops';
import { AppError } from '../../infrastructure/errors';
import { SqliteRepository } from '../../infrastructure/repository';
import type { AppContext } from '../../../domain/contracts';

describe('BulkImportService', () => {
  let db: Database.Database;
  let dataDir: string;
  let context: AppContext;

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-bulk-'));
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

  it('bulk imports patients', async () => {
    const service = new BulkImportService(db);
    const result = await service.importRows('patients', [
      { code: 'BULK-001', name: 'Bulk Patient', gender: 'UNKNOWN', phone: '13700000001', source: 'OTHER' },
    ], context);
    expect(result.imported).toBe(1);
  });

  it('collects non-systematic bulk import insert errors and keeps importing', async () => {
    // Dedicated temp database so the failed inserts cannot pollute the shared db.
    const localDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-bulk-row-error-'));
    const localDb = createDatabase(localDir);
    seedDatabase(localDb);
    runMigrations(localDb);
    const insert = vi.spyOn(SqliteRepository.prototype, 'insertSync');
    try {
      insert.mockImplementation(() => { throw new Error('row level failure'); });
      const result = await new BulkImportService(localDb).importRows('patients', [
        { code: 'BULK-ROW-1', name: 'Row One', gender: 'UNKNOWN', phone: '13700000011', source: 'OTHER' },
        { code: 'BULK-ROW-2', name: 'Row Two', gender: 'UNKNOWN', phone: '13700000012', source: 'OTHER' },
      ], context);
      expect(result).toMatchObject({ imported: 0, failed: 2, errors: ['row level failure', 'row level failure'] });
    } finally {
      insert.mockRestore();
      localDb.close();
      fs.rmSync(localDir, { recursive: true, force: true });
    }
  });

  it('aborts bulk import with a 500 AppError on systematic insert errors', async () => {
    const localDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-bulk-sys-error-'));
    const localDb = createDatabase(localDir);
    seedDatabase(localDb);
    runMigrations(localDb);
    const insert = vi.spyOn(SqliteRepository.prototype, 'insertSync');
    try {
      insert.mockImplementation(() => {
        throw Object.assign(new Error('database or disk is full'), { code: 'SQLITE_FULL' });
      });
      let error: unknown;
      try {
        await new BulkImportService(localDb).importRows('patients', [
          { code: 'BULK-SYS-1', name: 'Sys One', gender: 'UNKNOWN', phone: '13700000021', source: 'OTHER' },
        ], context);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({ status: 500, code: 'IMPORT_SYSTEM_ERROR' });
      expect((error as Error).message).toContain('批量导入中止');
      expect((error as Error).message).toContain('database or disk is full');
      expect(localDb.prepare('SELECT id FROM Patient WHERE code = ?').get('BULK-SYS-1')).toBeUndefined();
    } finally {
      insert.mockRestore();
      localDb.close();
      fs.rmSync(localDir, { recursive: true, force: true });
    }
  });

  it('reports the rolled-back imported row count when a chunk COMMIT fails systematically', async () => {
    const localDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-bulk-commit-'));
    const localDb = createDatabase(localDir);
    seedDatabase(localDb);
    runMigrations(localDb);
    const originalExec = localDb.exec.bind(localDb);
    const exec = vi.spyOn(localDb, 'exec');
    try {
      exec.mockImplementation((sql: string) => {
        if (sql === 'COMMIT') {
          throw Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' });
        }
        return originalExec(sql);
      });
      let error: unknown;
      try {
        await new BulkImportService(localDb).importRows('patients', [
          { code: 'BULK-COMMIT-1', name: 'Commit One', gender: 'UNKNOWN', phone: '13700000031', source: 'OTHER' },
          { code: 'BULK-COMMIT-2', name: 'Commit Two', gender: 'UNKNOWN', phone: '13700000032', source: 'OTHER' },
        ], context);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({ status: 500, code: 'IMPORT_SYSTEM_ERROR' });
      expect((error as Error).message).toContain('前 0 条已导入');
      expect((error as Error).message).toContain('database is locked');
      expect(localDb.prepare('SELECT id FROM Patient WHERE code = ?').get('BULK-COMMIT-1')).toBeUndefined();
      expect(localDb.prepare('SELECT id FROM Patient WHERE code = ?').get('BULK-COMMIT-2')).toBeUndefined();
    } finally {
      exec.mockRestore();
      localDb.close();
      fs.rmSync(localDir, { recursive: true, force: true });
    }
  });

  it('covers resource, row, and chunk error branches', async () => {
    const bulk = new BulkImportService(db);
    await expect(bulk.importRows('not-a-resource', [], context)).rejects.toThrow('cannot import');
    const bulkResult = await bulk.importRows('patients', [
      { code: 'BULK-EDGE', name: 'Invalid Gender', gender: 'INVALID', phone: '13600000003', source: 'OTHER' },
    ], context);
    expect(bulkResult.failed).toBe(1);
    const missingRequired = await bulk.importRows('patients', [{ name: 'Missing Code' }], context);
    expect(missingRequired.failed).toBe(1);
    await expect(bulk.importRows('users', [], context)).rejects.toThrow('disabled');
    await expect(bulk.importRows('operationLogs', [], context)).rejects.toThrow('Resource cannot import: operationLogs');
    await expect(bulk.importRows('rolePermissions', [], { ...context, role: 'DOCTOR' })).rejects.toThrow('Forbidden resource');
    await expect(bulk.importRows('patients', null as unknown as Array<Record<string, unknown>>, context)).rejects.toThrow('array');
    const tooManyRows = Array.from({ length: 10001 }, (_, index) => ({
      code: `BULK-${index}`,
      name: 'Bulk',
      gender: 'UNKNOWN',
      phone: '13600000000',
      source: 'OTHER',
    }));
    await expect(bulk.importRows('patients', tooManyRows, context)).rejects.toThrow('at most');
    const nonErrorRow: Record<string, unknown> = {};
    Object.defineProperty(nonErrorRow, 'code', {
      enumerable: true,
      get() {
        throw 'bulk-string-error';
      },
    });
    const nonErrorImport = await bulk.importRows('patients', [nonErrorRow], context);
    expect(nonErrorImport.failed).toBe(1);
    const chunked = await bulk.importRows('patients', [
      { code: 'CHUNK-1', name: 'Chunk One', gender: 'UNKNOWN', phone: '13600000001', source: 'OTHER' },
      { name: 'Missing Chunk' },
      { code: 'CHUNK-2', name: 'Chunk Two', gender: 'UNKNOWN', phone: '13600000002', source: 'OTHER' },
    ], context, 1);
    expect(chunked).toMatchObject({ imported: 2, failed: 1, chunks: 3 });
    expect((await bulk.importRows('patients', [
      { code: 'CHUNK-ZERO', name: 'Chunk Zero', gender: 'UNKNOWN', phone: '13600000003', source: 'OTHER' },
    ], context, 0)).chunks).toBe(1);
    expect((await bulk.importRows('patients', [
      { code: 'CHUNK-CLAMP', name: 'Chunk Clamp', gender: 'UNKNOWN', phone: '13600000004', source: 'OTHER' },
    ], context, 5000)).chunks).toBe(1);

    const originalExec = db.exec.bind(db);
    const exec = vi.spyOn(db, 'exec');
    exec.mockImplementation((sql: string) => {
      if (sql === 'COMMIT') throw new Error('commit failed');
      return originalExec(sql);
    });
    await expect(bulk.importRows('patients', [
      { code: 'CHUNK-ROLLBACK', name: 'Chunk Rollback', gender: 'UNKNOWN', phone: '13600000005', source: 'OTHER' },
    ], context, 1)).rejects.toThrow('commit failed');
    expect(db.prepare('SELECT id FROM Patient WHERE code = ?').get('CHUNK-ROLLBACK')).toBeUndefined();
    exec.mockRestore();
  });
});
