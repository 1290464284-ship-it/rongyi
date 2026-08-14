import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addColumns, dedupNullClinicRows, ensureForeignKeys, snapshotDatabase } from './helpers';

describe('migration helpers', () => {
  let dir: string;
  let dbPath: string;
  let db: Database.Database;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-migration-helpers-'));
    dbPath = path.join(dir, 'helpers.sqlite');
    db = new Database(dbPath);
    db.exec(`
      CREATE TABLE HelperProbe (
        id TEXT PRIMARY KEY,
        code TEXT,
        clinicId TEXT
      );
    `);
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('adds columns once and skips existing ones', () => {
    addColumns(db, 'HelperProbe', [['extra', 'TEXT']]);
    addColumns(db, 'HelperProbe', [['extra', 'TEXT']]);
    const columns = (db.prepare('PRAGMA table_info("HelperProbe")').all() as Array<{ name: string }>).map((c) => c.name);
    expect(columns).toContain('extra');
    expect(columns.filter((name) => name === 'extra')).toHaveLength(1);
  });

  it('deduplicates null-clinic unique rows with -dup suffixes', () => {
    const insert = db.prepare('INSERT INTO HelperProbe (id, code, clinicId) VALUES (?, ?, NULL)');
    insert.run('dup-1', 'DUP-CODE');
    insert.run('dup-2', 'DUP-CODE');
    insert.run('dup-3', 'DUP-CODE');
    const repaired = dedupNullClinicRows(db, 'HelperProbe', 'code');
    expect(repaired).toBe(2);
    const codes = (db.prepare('SELECT code FROM HelperProbe WHERE id IN (?, ?)').all('dup-1', 'dup-2') as Array<{ code: string }>)
      .map((row) => row.code)
      .sort();
    expect(codes).toEqual(['DUP-CODE-dup-1', 'DUP-CODE-dup-2']);
  });

  it('snapshots a database and prunes stale pre-migration files', () => {
    const snapshotDir = path.join(dir, 'snapshots');
    const preDir = path.join(snapshotDir, 'pre-migration');
    fs.mkdirSync(preDir, { recursive: true });
    for (const name of ['pre-1.sqlite', 'pre-2.sqlite', 'pre-3.sqlite', 'pre-4.sqlite']) {
      fs.writeFileSync(path.join(preDir, name), 'stale');
    }
    snapshotDatabase(db, snapshotDir);
    const files = fs.readdirSync(preDir).filter((name) => name.endsWith('.sqlite'));
    expect(files.length).toBeLessThanOrEqual(3);
    expect(fs.existsSync(path.join(preDir, 'pre-1.sqlite'))).toBe(false);
  });

  it('repairs NULL Refund.amount rows and logs an empty beforeValue', () => {
    db.exec('CREATE TABLE Refund (id TEXT PRIMARY KEY, amount INTEGER, clinicId TEXT)');
    db.prepare('INSERT INTO Refund (id, amount, clinicId) VALUES (?, NULL, ?)').run('refund-null-1', 'clinic-a');
    ensureForeignKeys(db, 'Refund', 'CREATE TABLE "Refund" (id TEXT PRIMARY KEY, amount INTEGER, clinicId TEXT)');
    const row = db.prepare('SELECT amount FROM Refund WHERE id = ?').get('refund-null-1') as { amount: number };
    expect(row.amount).toBe(1);
    const log = db.prepare(
      'SELECT beforeValue FROM MigrationRepairLog WHERE tableName = ? AND recordId = ? AND field = ?',
    ).get('Refund', 'refund-null-1', 'amount') as { beforeValue: string };
    expect(log.beforeValue).toBe('');
  });
});
