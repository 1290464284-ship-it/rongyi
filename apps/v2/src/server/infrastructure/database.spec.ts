import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase, syncLegacySchema } from './database';

describe('database bootstrap', () => {
  let db: Database.Database;
  let dataDir: string;

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-db-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('creates core tables and seeds an admin user', () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>;
    expect(tables.some((table) => table.name === 'Patient')).toBe(true);
    expect(tables.some((table) => table.name === 'Charge')).toBe(true);
    const admin = db.prepare("SELECT username FROM User WHERE username = 'admin'").get() as { username: string } | undefined;
    expect(admin?.username).toBe('admin');
  });

  it('is idempotent when seed runs again', () => {
    seedDatabase(db);
    const count = (db.prepare("SELECT COUNT(*) AS c FROM User WHERE username = 'admin'").get() as { c: number }).c;
    expect(count).toBe(1);
  });

  it('synchronizes legacy schema tables from the existing schema files', () => {
    const schemaDir = path.resolve(import.meta.dirname, '..', '..', '..', 'legacy', 'schema');
    syncLegacySchema(db, schemaDir);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>;
    expect(tables.some((table) => table.name === 'PrintTemplate')).toBe(true);
  });

  it('is safe when the legacy schema directory is missing', () => {
    expect(() => syncLegacySchema(db, path.join(os.tmpdir(), 'missing-v2-schema'))).not.toThrow();
  });

  it('tolerates malformed legacy schema statements', () => {
    const malformedDir = path.join(dataDir, 'malformed-schema');
    fs.mkdirSync(malformedDir, { recursive: true });
    fs.writeFileSync(path.join(malformedDir, 'no-paren.tables.ts'), 'CREATE TABLE IF NOT EXISTS MissingParen');
    fs.writeFileSync(path.join(malformedDir, 'no-close.tables.ts'), 'CREATE TABLE IF NOT EXISTS MissingClose (id TEXT');
    expect(() => syncLegacySchema(db, malformedDir)).not.toThrow();
  });
});
