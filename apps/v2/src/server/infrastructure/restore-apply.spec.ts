import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { Logger } from './logger';
import { applyStagedRestore } from './restore-apply';

describe('applyStagedRestore', () => {
  let dir: string;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-restore-apply-'));
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('does nothing without a pending marker', () => {
    expect(applyStagedRestore(path.join(dir, 'v2.sqlite'), [dir])).toEqual({ applied: false });
  });

  it('applies a staged restore, backs up the current database, and removes the marker', () => {
    const dbPath = path.join(dir, 'v2.sqlite');
    const stagedPath = path.join(dir, 'backups', 'staged.sqlite');
    fs.mkdirSync(path.dirname(stagedPath), { recursive: true });
    fs.writeFileSync(dbPath, 'current-db');
    fs.writeFileSync(stagedPath, 'staged-db');
    fs.writeFileSync(path.join(dir, '.restore-pending.json'), JSON.stringify({ stagedPath }));

    const result = applyStagedRestore(dbPath, [dir, path.dirname(stagedPath)]);
    expect(result.applied).toBe(true);
    expect(fs.readFileSync(dbPath, 'utf8')).toBe('staged-db');
    expect(result.backupPath).toBeDefined();
    expect(fs.existsSync(result.backupPath as string)).toBe(true);
    expect(fs.existsSync(path.join(dir, '.restore-pending.json'))).toBe(false);
  });

  it('removes stale WAL and SHM files when applying a staged restore', () => {
    const dbPath = path.join(dir, 'sidecar-target.sqlite');
    const stagedPath = path.join(dir, 'sidecar-staged.sqlite');
    fs.writeFileSync(dbPath, 'old-db');
    fs.writeFileSync(`${dbPath}-wal`, 'stale-wal');
    fs.writeFileSync(`${dbPath}-shm`, 'stale-shm');
    fs.writeFileSync(stagedPath, 'fresh-db');
    fs.writeFileSync(path.join(dir, '.restore-pending.json'), JSON.stringify({ stagedPath }));

    applyStagedRestore(dbPath, [dir]);
    expect(fs.readFileSync(dbPath, 'utf8')).toBe('fresh-db');
    expect(fs.existsSync(`${dbPath}-wal`)).toBe(false);
    expect(fs.existsSync(`${dbPath}-shm`)).toBe(false);
    expect(fs.existsSync(`${stagedPath}-wal`)).toBe(false);
    expect(fs.existsSync(`${stagedPath}-shm`)).toBe(false);
  });

  it('backs up a valid current database with SQLite instead of copying the main file', () => {
    const dbPath = path.join(dir, 'valid-current.sqlite');
    const stagedPath = path.join(dir, 'valid-staged.sqlite');
    const current = new Database(dbPath);
    current.pragma('journal_mode = WAL');
    current.exec('CREATE TABLE backup_sample (id TEXT PRIMARY KEY)');
    current.prepare('INSERT INTO backup_sample VALUES (?)').run('kept');
    current.close();
    fs.writeFileSync(stagedPath, 'fresh-db');
    fs.writeFileSync(path.join(dir, '.restore-pending.json'), JSON.stringify({ stagedPath }));

    const result = applyStagedRestore(dbPath, [dir]);
    const backupDb = new Database(result.backupPath as string, { readonly: true });
    const row = backupDb.prepare('SELECT COUNT(*) AS c FROM backup_sample').get() as { c: number };
    expect(Number(row.c)).toBe(1);
    backupDb.close();
  });

  it('renames the marker and returns { applied: false } when the staged path is unsafe', () => {
    const caseDir = path.join(dir, 'unsafe-case');
    fs.mkdirSync(caseDir, { recursive: true });
    const dbPath = path.join(caseDir, 'unsafe.sqlite');
    fs.writeFileSync(path.join(caseDir, '.restore-pending.json'), JSON.stringify({ stagedPath: 'C:/Windows/system32/evil.sqlite' }));

    const result = applyStagedRestore(dbPath, [caseDir]);

    expect(result).toEqual({ applied: false });
    expect(fs.existsSync(path.join(caseDir, '.restore-pending.json'))).toBe(false);
    const renamed = fs.readdirSync(caseDir).filter((name) => name.startsWith('.restore-pending.json.invalid-'));
    expect(renamed).toHaveLength(1);
  });

  it('renames the marker and returns { applied: false } when the staged file is missing', () => {
    const caseDir = path.join(dir, 'missing-case');
    fs.mkdirSync(caseDir, { recursive: true });
    const dbPath = path.join(caseDir, 'missing-staged.sqlite');
    const stagedPath = path.join(caseDir, 'backups', 'missing.sqlite');
    fs.writeFileSync(path.join(caseDir, '.restore-pending.json'), JSON.stringify({ stagedPath }));

    const result = applyStagedRestore(dbPath, [caseDir]);

    expect(result).toEqual({ applied: false });
    expect(fs.existsSync(path.join(caseDir, '.restore-pending.json'))).toBe(false);
    const renamed = fs.readdirSync(caseDir).filter((name) => name.startsWith('.restore-pending.json.invalid-'));
    expect(renamed).toHaveLength(1);
  });

  it('warns through the logger when the stagedPath is not a string', () => {
    const caseDir = path.join(dir, 'nonstring-case');
    fs.mkdirSync(caseDir, { recursive: true });
    const dbPath = path.join(caseDir, 'nonstring.sqlite');
    fs.writeFileSync(path.join(caseDir, '.restore-pending.json'), JSON.stringify({ stagedPath: 123 }));
    const warn = vi.fn();
    const logger = { warn } as unknown as Logger;

    const result = applyStagedRestore(dbPath, [caseDir], logger);

    expect(result).toEqual({ applied: false });
    expect(warn).toHaveBeenCalledTimes(1);
    const [message, meta] = warn.mock.calls[0] as [string, Record<string, unknown>];
    expect(message).toContain('invalid');
    expect(meta).toMatchObject({ action: 'restore-apply' });
    expect(String(meta.markerPath)).toMatch(/\.restore-pending\.json\.invalid-\d+$/);
    expect(fs.existsSync(path.join(caseDir, '.restore-pending.json'))).toBe(false);
  });

  it('applies a restore when no current database exists yet', () => {
    const newDbPath = path.join(dir, 'new-v2.sqlite');
    const stagedPath = path.join(dir, 'new-staged.sqlite');
    fs.writeFileSync(stagedPath, 'new-db');
    fs.writeFileSync(path.join(dir, '.restore-pending.json'), JSON.stringify({ stagedPath }));

    const result = applyStagedRestore(newDbPath, [dir]);
    expect(result.applied).toBe(true);
    expect(result.backupPath).toBeUndefined();
    expect(fs.readFileSync(newDbPath, 'utf8')).toBe('new-db');
  });
});
