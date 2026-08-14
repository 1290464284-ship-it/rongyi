import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pruneFailedCopies, restoreLatestMigrationSnapshot } from './migration-recovery';
import type { Logger } from './logger';

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
}

function createDb(dbPath: string, marker: string): void {
  const db = new Database(dbPath);
  db.exec(`CREATE TABLE t (id INTEGER PRIMARY KEY, marker TEXT); INSERT INTO t (marker) VALUES ('${marker}');`);
  db.close();
}

function readMarker(dbPath: string): string {
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db.prepare('SELECT marker FROM t').get() as { marker: string };
    return row.marker;
  } finally {
    db.close();
  }
}

describe('restoreLatestMigrationSnapshot', () => {
  let dir: string;

  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('rolls back to the newest pre-migration snapshot and keeps the failed copy', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-migrec-'));
    const dbPath = path.join(dir, 'v2.sqlite');
    const snapDir = path.join(dir, 'pre-migration');
    fs.mkdirSync(snapDir, { recursive: true });
    createDb(path.join(snapDir, 'pre-1000.sqlite'), 'old');
    createDb(path.join(snapDir, 'pre-2000.sqlite'), 'new');
    createDb(dbPath, 'broken');

    const logger = makeLogger();
    expect(restoreLatestMigrationSnapshot(dir, dbPath, logger)).toBe(true);

    expect(readMarker(dbPath)).toBe('new');
    const failed = fs.readdirSync(dir).filter((name) => name.startsWith('v2.sqlite.failed-'));
    expect(failed).toHaveLength(1);
    expect(logger.error).toHaveBeenCalledWith(
      'migration failed; rolled back to pre-migration snapshot',
      expect.objectContaining({ action: 'migration-rollback' }),
    );
  });

  it('clears WAL/SHM sidecars when rolling back', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-migrec-'));
    const dbPath = path.join(dir, 'v2.sqlite');
    const snapDir = path.join(dir, 'pre-migration');
    fs.mkdirSync(snapDir, { recursive: true });
    createDb(path.join(snapDir, 'pre-1000.sqlite'), 'ok');
    createDb(dbPath, 'broken');
    fs.writeFileSync(`${dbPath}-wal`, 'stale wal');
    fs.writeFileSync(`${dbPath}-shm`, 'stale shm');

    expect(restoreLatestMigrationSnapshot(dir, dbPath, makeLogger())).toBe(true);
    expect(fs.existsSync(`${dbPath}-wal`)).toBe(false);
    expect(fs.existsSync(`${dbPath}-shm`)).toBe(false);
  });

  it('returns false and leaves the database untouched when no snapshots exist', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-migrec-'));
    const dbPath = path.join(dir, 'v2.sqlite');
    createDb(dbPath, 'x');

    expect(restoreLatestMigrationSnapshot(dir, dbPath, makeLogger())).toBe(false);
    expect(readMarker(dbPath)).toBe('x');
  });

  it('returns false when the snapshot directory has no valid candidates', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-migrec-'));
    const dbPath = path.join(dir, 'v2.sqlite');
    const snapDir = path.join(dir, 'pre-migration');
    fs.mkdirSync(snapDir, { recursive: true });
    fs.writeFileSync(path.join(snapDir, 'notes.txt'), 'not a snapshot');
    createDb(dbPath, 'x');

    expect(restoreLatestMigrationSnapshot(dir, dbPath, makeLogger())).toBe(false);
    expect(readMarker(dbPath)).toBe('x');
  });

  it('returns false and logs when the rollback itself fails', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-migrec-'));
    const dbPath = path.join(dir, 'v2.sqlite'); // 故意不创建：renameSync 会失败
    const snapDir = path.join(dir, 'pre-migration');
    fs.mkdirSync(snapDir, { recursive: true });
    createDb(path.join(snapDir, 'pre-1000.sqlite'), 'snap');

    const logger = makeLogger();
    expect(restoreLatestMigrationSnapshot(dir, dbPath, logger)).toBe(false);
    expect(logger.error).toHaveBeenCalledWith(
      'migration rollback failed',
      expect.objectContaining({ action: 'migration-rollback' }),
    );
  });

  it('survives a snapshot that vanishes during the mtime sort', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-migrec-'));
    const dbPath = path.join(dir, 'v2.sqlite');
    const snapDir = path.join(dir, 'pre-migration');
    fs.mkdirSync(snapDir, { recursive: true });
    createDb(path.join(snapDir, 'pre-1000.sqlite'), 'old');
    createDb(path.join(snapDir, 'pre-2000.sqlite'), 'new');
    createDb(dbPath, 'broken');
    const originalStat = fs.statSync.bind(fs);
    const spy = vi.spyOn(fs, 'statSync').mockImplementation((p: fs.PathLike) => {
      if (String(p).includes('pre-migration')) throw new Error('vanished');
      return originalStat(p);
    });
    try {
      expect(restoreLatestMigrationSnapshot(dir, dbPath, makeLogger())).toBe(true);
      expect(fs.readdirSync(dir).filter((name) => name.startsWith('v2.sqlite.failed-'))).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('pruneFailedCopies', () => {
  let dir: string;

  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('keeps at most N failed copies and removes the oldest first', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-migrec-'));
    const dbPath = path.join(dir, 'v2.sqlite');
    createDb(dbPath, 'x');
    const base = Date.now() - 60_000;
    for (let i = 1; i <= 5; i += 1) {
      const copy = `${dbPath}.failed-${i}`;
      fs.writeFileSync(copy, `copy-${i}`);
      const atime = new Date(base + i * 1000);
      fs.utimesSync(copy, atime, atime);
    }

    const removed = pruneFailedCopies(dbPath, 3);
    expect(removed).toBe(2);
    const remaining = fs.readdirSync(dir).filter((name) => name.startsWith('v2.sqlite.failed-')).sort();
    expect(remaining).toEqual(['v2.sqlite.failed-3', 'v2.sqlite.failed-4', 'v2.sqlite.failed-5']);
  });

  it('is a no-op when there are no failed copies', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-migrec-'));
    const dbPath = path.join(dir, 'v2.sqlite');
    createDb(dbPath, 'x');
    expect(pruneFailedCopies(dbPath, 3)).toBe(0);
  });

  it('drains every copy and breaks on an empty shift when keep is negative', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-migrec-'));
    const dbPath = path.join(dir, 'v2.sqlite');
    createDb(dbPath, 'x');
    for (let i = 1; i <= 2; i += 1) {
      fs.writeFileSync(`${dbPath}.failed-${i}`, `copy-${i}`);
    }

    expect(pruneFailedCopies(dbPath, -1)).toBe(2);
    expect(fs.readdirSync(dir).filter((name) => name.startsWith('v2.sqlite.failed-'))).toEqual([]);
  });

  it('survives a failed copy that vanishes during the prune sort', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-migrec-'));
    const dbPath = path.join(dir, 'v2.sqlite');
    createDb(dbPath, 'x');
    for (let i = 1; i <= 3; i += 1) {
      fs.writeFileSync(`${dbPath}.failed-${i}`, `copy-${i}`);
    }
    const originalStat = fs.statSync.bind(fs);
    const spy = vi.spyOn(fs, 'statSync').mockImplementation((p: fs.PathLike) => {
      if (String(p).includes('.failed-')) throw new Error('vanished');
      return originalStat(p);
    });
    try {
      expect(pruneFailedCopies(dbPath, 1)).toBe(2);
    } finally {
      spy.mockRestore();
    }
  });
});
