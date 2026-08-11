import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { BackupService, shouldEncryptBackup } from './backup';

describe('BackupService staged cleanup', () => {
  let dir: string;
  let service: BackupService;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-backup-spec-'));
    const db = new Database(':memory:');
    service = new BackupService(db as unknown as Database.Database, path.join(dir, 'v2.sqlite'), path.join(dir, 'backups'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('removes stale and over-limit staged files while keeping fresh ones', () => {
    const backupsDir = path.join(dir, 'backups');
    fs.mkdirSync(backupsDir, { recursive: true });
    const oldStaged = path.join(backupsDir, '.staged-old.sqlite');
    const freshStaged = path.join(backupsDir, '.staged-fresh.sqlite');
    const tmpFile = path.join(backupsDir, 'backup.tmp');
    const freshTmp = path.join(backupsDir, 'backup-fresh.tmp');
    fs.writeFileSync(oldStaged, 'x');
    fs.writeFileSync(freshStaged, 'x');
    fs.writeFileSync(tmpFile, 'x');
    fs.writeFileSync(freshTmp, 'x');
    const now = Date.now();
    fs.utimesSync(oldStaged, new Date(now - 7 * 60 * 60 * 1000), new Date(now - 7 * 60 * 60 * 1000));
    fs.utimesSync(freshStaged, new Date(now), new Date(now));
    fs.utimesSync(tmpFile, new Date(now - 7 * 60 * 60 * 1000), new Date(now - 7 * 60 * 60 * 1000));
    fs.utimesSync(freshTmp, new Date(now), new Date(now));

    const result = service.cleanupStaged();
    expect(result.removed).toBe(2);
    expect(fs.existsSync(oldStaged)).toBe(false);
    expect(fs.existsSync(freshStaged)).toBe(true);
    expect(fs.existsSync(tmpFile)).toBe(false);
    expect(fs.existsSync(freshTmp)).toBe(true);
  });

  it('encrypts whenever a backup key exists, even when plaintext is allowed', () => {
    expect(shouldEncryptBackup({}, true, true)).toBe(true);
    expect(shouldEncryptBackup({}, true, false)).toBe(false);
    expect(shouldEncryptBackup({ encrypted: false }, true, true)).toBe(false);
    expect(shouldEncryptBackup({}, false, false)).toBe(true);
  });

  it('leaves no final backup file when the source backup fails', async () => {
    const backupsDir = path.join(dir, 'backups');
    fs.mkdirSync(backupsDir, { recursive: true });
    const failingDb = {
      backup: async () => {
        throw new Error('source backup failed');
      },
      pragma: vi.fn(),
      prepare: vi.fn(),
      transaction: vi.fn(),
    };
    const serviceWithFailure = new BackupService(
      failingDb as unknown as Database.Database,
      path.join(dir, 'v2.sqlite'),
      backupsDir,
    );
    await expect(serviceWithFailure.create({})).rejects.toThrow('source backup failed');
    const leftovers = fs.readdirSync(backupsDir);
    expect(leftovers.filter((name) => name.startsWith('backup-') || name.endsWith('.enc') || name.endsWith('.sqlite'))).toEqual([]);
  });

  it('removes the finalized backup file when the BackupRecord insert fails', async () => {
    const backupsDir = path.join(dir, 'backups');
    fs.mkdirSync(backupsDir, { recursive: true });
    const validSource = path.join(dir, 'valid-source.sqlite');
    const sourceDb = new Database(validSource);
    sourceDb.exec('CREATE TABLE t (id TEXT)');
    sourceDb.close();

    const failingInsertDb = {
      backup: async (targetPath: string) => {
        fs.copyFileSync(validSource, targetPath);
      },
      pragma: vi.fn(),
      prepare: vi.fn(() => ({
        run: vi.fn(() => {
          throw new Error('BackupRecord insert failed');
        }),
      })),
    };
    const serviceWithInsertFailure = new BackupService(
      failingInsertDb as unknown as Database.Database,
      path.join(dir, 'v2.sqlite'),
      backupsDir,
    );
    await expect(serviceWithInsertFailure.create({})).rejects.toThrow('BackupRecord insert failed');
    const leftovers = fs.readdirSync(backupsDir);
    expect(leftovers.filter((name) => name.startsWith('backup-') || name.endsWith('.enc') || name.endsWith('.sqlite'))).toEqual([]);
  });

  it('removes an existing restore marker before a failing verify', async () => {
    const backupsDir = path.join(dir, 'backups');
    fs.mkdirSync(backupsDir, { recursive: true });
    const markerPath = path.join(dir, '.restore-pending.json');
    fs.writeFileSync(markerPath, JSON.stringify({ stagedPath: 'old' }));
    const db = new Database(':memory:');
    const service = new BackupService(db as unknown as Database.Database, path.join(dir, 'v2.sqlite'), backupsDir);

    await expect(service.stageRestore('missing-backup.sqlite')).rejects.toThrow();
    expect(fs.existsSync(markerPath)).toBe(false);
  });

  it('only removes expired .partial files, never fresh in-progress ones', () => {
    const backupsDir = path.join(dir, 'backups');
    fs.mkdirSync(backupsDir, { recursive: true });
    const freshPartial = path.join(backupsDir, 'backup-fresh.partial');
    const expiredPartial = path.join(backupsDir, 'backup-old.partial');
    fs.writeFileSync(freshPartial, 'x');
    fs.writeFileSync(expiredPartial, 'x');
    const now = Date.now();
    fs.utimesSync(freshPartial, new Date(now), new Date(now));
    fs.utimesSync(expiredPartial, new Date(now - 7 * 60 * 60 * 1000), new Date(now - 7 * 60 * 60 * 1000));

    const result = service.cleanupStaged();
    expect(result.removed).toBe(1);
    expect(fs.existsSync(freshPartial)).toBe(true);
    expect(fs.existsSync(expiredPartial)).toBe(false);
  });
});
