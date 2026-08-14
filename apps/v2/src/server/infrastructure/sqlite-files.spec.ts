import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import {
  backupSqliteFile,
  copySqliteFileReadonly,
  removeSqliteSidecars,
  sha256File,
  summarizeSqliteFile,
} from './sqlite-files';

describe('sqlite file helpers', () => {
  let dir: string;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-sqlite-files-'));
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('summarizes core table counts and the latest paid charge', () => {
    const dbPath = path.join(dir, 'summary.sqlite');
    const db = new Database(dbPath);
    db.exec('CREATE TABLE Patient (id TEXT PRIMARY KEY)');
    db.exec('CREATE TABLE Charge (id TEXT PRIMARY KEY, paidAt TEXT)');
    db.prepare('INSERT INTO Charge (id, paidAt) VALUES (?, ?)').run('charge-1', '2026-08-04T00:00:00.000Z');
    db.prepare('INSERT INTO Charge (id, paidAt) VALUES (?, ?)').run('charge-2', '2026-08-05T00:00:00.000Z');
    db.close();

    const summary = summarizeSqliteFile(dbPath);
    expect(summary).toMatchObject({
      Patient: 0,
      Charge: 2,
      lastPaidAt: '2026-08-05T00:00:00.000Z',
    });
    expect(summary.Clinic).toBeUndefined();
  });

  it('handles databases without a charge table', () => {
    const dbPath = path.join(dir, 'summary-no-charge.sqlite');
    const db = new Database(dbPath);
    db.exec('CREATE TABLE Patient (id TEXT PRIMARY KEY)');
    db.close();

    expect(summarizeSqliteFile(dbPath).lastPaidAt).toBeNull();
  });

  it('handles charge tables without a paidAt column', () => {
    const dbPath = path.join(dir, 'summary-no-paid-at.sqlite');
    const db = new Database(dbPath);
    db.exec('CREATE TABLE Charge (id TEXT PRIMARY KEY)');
    db.close();

    expect(summarizeSqliteFile(dbPath).lastPaidAt).toBeNull();
  });

  it('copies a SQLite file read-only and hashes the result', () => {
    const source = path.join(dir, 'copy-source.sqlite');
    const target = path.join(dir, 'copy-target.sqlite');
    const db = new Database(source);
    db.exec('CREATE TABLE T (id TEXT PRIMARY KEY, value TEXT)');
    db.prepare('INSERT INTO T (id, value) VALUES (?, ?)').run('c1', 'copied');
    db.close();

    copySqliteFileReadonly(source, target);
    const copy = new Database(target, { readonly: true });
    try {
      expect(copy.prepare('SELECT value FROM T WHERE id = ?').get('c1')).toEqual({ value: 'copied' });
    } finally {
      copy.close();
    }
    expect(sha256File(source)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('removes existing SQLite WAL and SHM sidecars', () => {
    const dbPath = path.join(dir, 'sidecars.sqlite');
    fs.writeFileSync(`${dbPath}-wal`, 'wal');
    fs.writeFileSync(`${dbPath}-shm`, 'shm');
    removeSqliteSidecars(dbPath);
    expect(fs.existsSync(`${dbPath}-wal`)).toBe(false);
    expect(fs.existsSync(`${dbPath}-shm`)).toBe(false);
  });

  it('backupSqliteFile includes uncheckpointed WAL frames from a WAL-mode source', () => {
    const dbPath = path.join(dir, 'wal-source.sqlite');
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('wal_autocheckpoint = 0'); // 关闭自动 checkpoint，保证帧留在 -wal 中
    db.exec('CREATE TABLE T (id TEXT PRIMARY KEY, value TEXT)');
    db.prepare('INSERT INTO T (id, value) VALUES (?, ?)').run('w1', 'first');
    db.prepare('INSERT INTO T (id, value) VALUES (?, ?)').run('w2', 'second');
    db.close();

    const backupPath = path.join(dir, 'wal-backup.sqlite');
    backupSqliteFile(dbPath, backupPath);

    // 副本必须包含 WAL 中未 checkpoint 的已提交数据（裸拷贝会丢这两行）
    const backup = new Database(backupPath, { readonly: true });
    try {
      const integrity = backup.pragma('integrity_check') as Array<{ integrity_check: string }>;
      expect(integrity[0].integrity_check).toBe('ok');
      const rows = backup.prepare('SELECT id, value FROM T ORDER BY id').all() as Array<{ id: string; value: string }>;
      expect(rows).toEqual([
        { id: 'w1', value: 'first' },
        { id: 'w2', value: 'second' },
      ]);
    } finally {
      backup.close();
    }
  });

  it('backupSqliteFile rejects a WAL checkpoint blocked by an active reader', () => {
    const dbPath = path.join(dir, 'wal-busy.sqlite');
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('wal_autocheckpoint = 0');
    db.exec('CREATE TABLE T (id TEXT PRIMARY KEY)');
    db.prepare('INSERT INTO T (id) VALUES (?)').run('busy-1');

    const reader = new Database(dbPath, { readonly: true });
    reader.prepare('BEGIN').run();
    reader.prepare('SELECT COUNT(*) FROM T').get();
    const logger = { warn: vi.fn() };
    try {
      expect(() => backupSqliteFile(dbPath, path.join(dir, 'busy-backup.sqlite'), logger)).toThrow(
        /WAL checkpoint not clean/,
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('SQLite backup skipped: WAL checkpoint busy'),
        expect.objectContaining({ action: 'sqlite-backup' }),
      );
    } finally {
      reader.close();
      db.close();
    }
  });

  it('reports n/a checkpoint fields when the pragma returns no rows', () => {
    const dbPath = path.join(dir, 'wal-empty-pragma.sqlite');
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.exec('CREATE TABLE T (id TEXT PRIMARY KEY)');
    db.close();

    const pragmaSpy = vi.spyOn(Database.prototype, 'pragma').mockReturnValue([] as never);
    try {
      expect(() => backupSqliteFile(dbPath, path.join(dir, 'empty-backup.sqlite'))).toThrow(
        /busy=n\/a, log=n\/a, checkpointed=n\/a/,
      );
    } finally {
      pragmaSpy.mockRestore();
    }
  });

  it('backupSqliteFile warns when VACUUM INTO fails and falls back to a plain copy', () => {
    const dbPath = path.join(dir, 'vacuum-fallback.sqlite');
    const db = new Database(dbPath);
    db.exec('CREATE TABLE T (id TEXT PRIMARY KEY)');
    db.prepare('INSERT INTO T (id) VALUES (?)').run('fallback-1');
    db.close();

    const logger = { warn: vi.fn() };
    const targetDir = path.join(dir, 'missing-target-dir');
    const target = path.join(targetDir, 'backup.sqlite');
    expect(() => backupSqliteFile(dbPath, target, logger)).toThrow();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('VACUUM INTO backup failed'),
      expect.objectContaining({ action: 'sqlite-backup', target }),
    );
  });
});
