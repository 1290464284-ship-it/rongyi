import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, syncLegacySchema } from './database';
import { migrations, runMigrations } from './migrations';

describe('migrations', () => {
  let db: Database.Database;
  let dataDir: string;

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-mig-'));
    db = createDatabase(dataDir);
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('applies pending migrations once and records versions', () => {
    runMigrations(db);
    runMigrations(db);
    const rows = db.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all() as Array<{
      version: number;
      name: string;
    }>;
    expect(rows.map((row) => ({ version: Number(row.version), name: row.name }))).toEqual(
      migrations.map((migration) => ({ version: migration.version, name: migration.name })),
    );
  });

  it('adds missing migration columns when legacy schema lacks them', () => {
    const freshDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-mig-fresh-'));
    const freshDb = createDatabase(freshDir);
    freshDb.exec('ALTER TABLE OperationLog DROP COLUMN traceId');
    freshDb.exec('ALTER TABLE IdempotencyRecord DROP COLUMN responseJson');
    freshDb.exec('ALTER TABLE IdempotencyRecord DROP COLUMN type');
    freshDb.exec('ALTER TABLE Patient DROP COLUMN occupation');
    freshDb.exec('ALTER TABLE ProcessingOrderItem DROP COLUMN name');
    freshDb.exec('ALTER TABLE InventoryReplenishmentSuggestion DROP COLUMN status');
    runMigrations(freshDb);
    const operationLog = freshDb.prepare('PRAGMA table_info(OperationLog)').all() as Array<{ name: string }>;
    const idempotency = freshDb.prepare('PRAGMA table_info(IdempotencyRecord)').all() as Array<{ name: string }>;
    const patient = freshDb.prepare('PRAGMA table_info(Patient)').all() as Array<{ name: string }>;
    const item = freshDb.prepare('PRAGMA table_info(ProcessingOrderItem)').all() as Array<{ name: string }>;
    const suggestion = freshDb.prepare('PRAGMA table_info(InventoryReplenishmentSuggestion)').all() as Array<{ name: string }>;
    expect(operationLog.some((column) => column.name === 'traceId')).toBe(true);
    expect(idempotency.some((column) => column.name === 'responseJson')).toBe(true);
    expect(idempotency.some((column) => column.name === 'type')).toBe(true);
    expect(patient.some((column) => column.name === 'occupation')).toBe(true);
    expect(item.some((column) => column.name === 'name')).toBe(true);
    expect(suggestion.some((column) => column.name === 'status')).toBe(true);
    freshDb.close();
    fs.rmSync(freshDir, { recursive: true, force: true });
  });

  it('skips migration columns that already exist and covers both column expressions', () => {
    const existingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-mig-existing-'));
    const existingDb = createDatabase(existingDir);
    existingDb.exec('ALTER TABLE User ADD COLUMN refreshToken TEXT');
    existingDb.exec('ALTER TABLE User ADD COLUMN refreshTokenExpiresAt TEXT');
    runMigrations(existingDb);
    const userColumns = new Set(
      (existingDb.prepare('PRAGMA table_info(User)').all() as Array<{ name: string }>).map((column) => column.name),
    );
    expect(userColumns.has('refreshToken')).toBe(true);
    expect(userColumns.has('refreshTokenExpiresAt')).toBe(true);
    existingDb.close();
    fs.rmSync(existingDir, { recursive: true, force: true });

    const responseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-mig-response-'));
    const responseDb = createDatabase(responseDir);
    responseDb.exec('ALTER TABLE IdempotencyRecord DROP COLUMN clinicId');
    runMigrations(responseDb);
    const idemColumns = new Set(
      (responseDb.prepare('PRAGMA table_info(IdempotencyRecord)').all() as Array<{ name: string }>).map((column) => column.name),
    );
    expect(idemColumns.has('responseJson')).toBe(true);
    expect(idemColumns.has('clinicId')).toBe(true);
    responseDb.close();
    fs.rmSync(responseDir, { recursive: true, force: true });
  });
});
