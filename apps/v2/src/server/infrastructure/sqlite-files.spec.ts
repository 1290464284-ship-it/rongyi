import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { backupSqliteFile, summarizeSqliteFile } from './sqlite-files';

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
});
