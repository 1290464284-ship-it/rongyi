import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

  it('rejects an unsafe or missing staged path', () => {
    const dbPath = path.join(dir, 'unsafe.sqlite');
    fs.writeFileSync(path.join(dir, '.restore-pending.json'), JSON.stringify({ stagedPath: 'C:/Windows/system32/evil.sqlite' }));
    expect(() => applyStagedRestore(dbPath, [dir])).toThrow('invalid or missing');

    fs.writeFileSync(path.join(dir, '.restore-pending.json'), JSON.stringify({ stagedPath: 123 }));
    expect(() => applyStagedRestore(dbPath, [dir])).toThrow('invalid or missing');
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
