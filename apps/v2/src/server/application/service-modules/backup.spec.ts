import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
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

  it('does not throw when the backup path is blocked by a regular file', () => {
    const backupsDir = path.join(dir, 'backups');
    fs.writeFileSync(backupsDir, 'not a directory');
    expect(service.cleanupStaged()).toEqual({ removed: 0 });
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

  it('keeps over-limit .partial files inside the freshness grace', () => {
    const backupsDir = path.join(dir, 'backups');
    fs.mkdirSync(backupsDir, { recursive: true });
    const now = Date.now();
    for (let i = 0; i < 5; i += 1) {
      const partial = path.join(backupsDir, `bulk-${i}.partial`);
      fs.writeFileSync(partial, 'x');
      // 120 秒：超过 60s 新鲜期，但远未到 6h 过期
      fs.utimesSync(partial, new Date(now - 120_000), new Date(now - 120_000));
    }
    const result = service.cleanupStaged();
    expect(result.removed).toBe(0);
    for (let i = 0; i < 5; i += 1) {
      expect(fs.existsSync(path.join(backupsDir, `bulk-${i}.partial`))).toBe(true);
    }
  });

  it('tolerates EBUSY sidecar removals and rejects other unlink errors', async () => {
    const backupsDir = path.join(dir, 'backups');
    fs.mkdirSync(backupsDir, { recursive: true });
    const dbPath = path.join(dir, 'src.sqlite');
    const db = new Database(dbPath);
    db.exec('CREATE TABLE BackupRecord (id TEXT, clinicId TEXT, createdAt TEXT, updatedAt TEXT, deletedAt TEXT, filename TEXT, fileSize INTEGER, type TEXT, operatorId TEXT, operatorName TEXT)');
    db.exec('CREATE TABLE t (id TEXT)');
    const dbService = new BackupService(db as unknown as Database.Database, dbPath, backupsDir);
    // 空侧车 + EBUSY：跳过且校验通过
    fs.writeFileSync(`${dbPath}-wal`, '');
    const originalRm = fs.rmSync.bind(fs);
    const spyBusy = vi.spyOn(fs, 'rmSync').mockImplementation((p: fs.PathLike, options?: fs.RmOptions) => {
      if (String(p).endsWith('-wal')) {
        throw Object.assign(new Error('busy'), { code: 'EBUSY' });
      }
      return originalRm(p, options);
    });
    try {
      const result = await dbService.create({});
      expect(result.filename).toMatch(/clinic-null-backup-.*\.sqlite/);
    } finally {
      spyBusy.mockRestore();
    }
    // 其它错误码：直接外抛
    const spyEacces = vi.spyOn(fs, 'rmSync').mockImplementation((p: fs.PathLike, options?: fs.RmOptions) => {
      if (String(p).endsWith('-wal')) {
        throw Object.assign(new Error('denied'), { code: 'EACCES' });
      }
      return originalRm(p, options);
    });
    try {
      await expect(dbService.create({})).rejects.toThrow('denied');
    } finally {
      spyEacces.mockRestore();
    }
    db.close();
  });

  it('fails when a non-empty source wal survives cleanup', async () => {
    const backupsDir = path.join(dir, 'backups');
    fs.mkdirSync(backupsDir, { recursive: true });
    const dbPath = path.join(dir, 'src.sqlite');
    const db = new Database(dbPath);
    db.exec('CREATE TABLE BackupRecord (id TEXT, clinicId TEXT, createdAt TEXT, updatedAt TEXT, deletedAt TEXT, filename TEXT, fileSize INTEGER, type TEXT, operatorId TEXT, operatorName TEXT)');
    const dbService = new BackupService(db as unknown as Database.Database, dbPath, backupsDir);
    fs.writeFileSync(`${dbPath}-wal`, 'pending-frames');
    const originalRm = fs.rmSync.bind(fs);
    const spy = vi.spyOn(fs, 'rmSync').mockImplementation((p: fs.PathLike, options?: fs.RmOptions) => {
      if (String(p).endsWith('-wal')) {
        throw Object.assign(new Error('locked'), { code: 'EPERM' });
      }
      return originalRm(p, options);
    });
    // backup() 自身会截断真实 wal：用 stat 模拟"截断后仍非空"的守卫场景
    const originalStat = fs.statSync.bind(fs);
    const spyStat = vi.spyOn(fs, 'statSync').mockImplementation((p: fs.PathLike) => {
      const result = originalStat(p);
      if (String(p).endsWith('-wal')) return Object.assign(result, { size: 123 });
      return result;
    });
    try {
      await expect(dbService.create({})).rejects.toThrow('sidecars remain');
      // 外抛前必须清掉已落盘的正式备份文件
      const leftovers = fs.readdirSync(backupsDir).filter((name) => name.startsWith('clinic-null-backup-'));
      expect(leftovers).toEqual([]);
    } finally {
      spy.mockRestore();
      spyStat.mockRestore();
    }
    db.close();
  });

  it('cleans up the encryption temp file when the final rename fails', async () => {
    const backupsDir = path.join(dir, 'backups');
    fs.mkdirSync(backupsDir, { recursive: true });
    const prevKey = process.env.V2_BACKUP_KEY;
    process.env.V2_BACKUP_KEY = 'test-key';
    const dbPath = path.join(dir, 'src.sqlite');
    const db = new Database(dbPath);
    db.exec('CREATE TABLE BackupRecord (id TEXT, clinicId TEXT, createdAt TEXT, updatedAt TEXT, deletedAt TEXT, filename TEXT, fileSize INTEGER, type TEXT, operatorId TEXT, operatorName TEXT)');
    const dbService = new BackupService(db as unknown as Database.Database, dbPath, backupsDir);
    const originalRename = fs.renameSync.bind(fs);
    const spy = vi.spyOn(fs, 'renameSync').mockImplementation((from: fs.PathLike, to: fs.PathLike) => {
      if (String(to).endsWith('.enc')) {
        throw new Error('rename failed');
      }
      return originalRename(from, to);
    });
    try {
      await expect(dbService.create({ encrypted: true })).rejects.toThrow('rename failed');
      const leftovers = fs.readdirSync(backupsDir).filter((name) => name !== '.');
      expect(leftovers).toEqual([]);
    } finally {
      spy.mockRestore();
      if (prevKey === undefined) delete process.env.V2_BACKUP_KEY;
      else process.env.V2_BACKUP_KEY = prevKey;
    }
    db.close();
  });

  it('skips staged cleanup when the stage failure happens before writing', async () => {
    const backupsDir = path.join(dir, 'backups');
    fs.mkdirSync(backupsDir, { recursive: true });
    const corrupt = path.join(backupsDir, 'clinic-null-backup-corrupt.sqlite');
    fs.writeFileSync(corrupt, 'not a database');
    const db = new Database(':memory:');
    const dbService = new BackupService(db as unknown as Database.Database, path.join(dir, 'v2.sqlite'), backupsDir);
    await expect(dbService.stageRestore('clinic-null-backup-corrupt.sqlite')).rejects.toThrow();
    expect(fs.readdirSync(backupsDir).filter((name) => name.startsWith('.staged-'))).toEqual([]);
  });

  it('retries marker cleanup in the finally path after a cleanup failure', async () => {
    const backupsDir = path.join(dir, 'backups');
    fs.mkdirSync(backupsDir, { recursive: true });
    const markerPath = path.join(dir, '.restore-pending.json');
    fs.writeFileSync(markerPath, 'stale');
    const db = new Database(':memory:');
    const dbService = new BackupService(db as unknown as Database.Database, path.join(dir, 'v2.sqlite'), backupsDir);
    const originalRm = fs.rmSync.bind(fs);
    const spy = vi.spyOn(fs, 'rmSync').mockImplementation((p: fs.PathLike, options?: fs.RmOptions) => {
      if (String(p).endsWith('.restore-pending.json')) {
        throw Object.assign(new Error('marker locked'), { code: 'EACCES' });
      }
      return originalRm(p, options);
    });
    try {
      await expect(dbService.stageRestore('missing-backup.sqlite')).rejects.toThrow('marker locked');
    } finally {
      spy.mockRestore();
    }
  });

  it('removes the staged file and marker when the marker write fails late', async () => {
    const backupsDir = path.join(dir, 'backups');
    fs.mkdirSync(backupsDir, { recursive: true });
    const dbPath = path.join(dir, 'src.sqlite');
    const db = new Database(dbPath);
    db.exec('CREATE TABLE BackupRecord (id TEXT, clinicId TEXT, createdAt TEXT, updatedAt TEXT, deletedAt TEXT, filename TEXT, fileSize INTEGER, type TEXT, operatorId TEXT, operatorName TEXT)');
    db.exec('CREATE TABLE t (id TEXT)');
    const dbService = new BackupService(db as unknown as Database.Database, dbPath, backupsDir);
    const backup = await dbService.create({});
    const originalWrite = fs.writeFileSync.bind(fs);
    const spy = vi.spyOn(fs, 'writeFileSync').mockImplementation((p: fs.PathOrFileDescriptor, data: string | NodeJS.ArrayBufferView, options?: fs.WriteFileOptions) => {
      if (String(p).endsWith('.restore-pending.json')) {
        originalWrite(p, data, options);
        throw new Error('late marker failure');
      }
      return originalWrite(p, data, options);
    });
    try {
      await expect(dbService.stageRestore(String(backup.filename))).rejects.toThrow('late marker failure');
      // finally 清掉 staged 文件与已写入的 marker
      expect(fs.readdirSync(backupsDir).filter((name) => name.startsWith('.staged-'))).toEqual([]);
      expect(fs.existsSync(path.join(dir, '.restore-pending.json'))).toBe(false);
    } finally {
      spy.mockRestore();
    }
    db.close();
  });

  it('logs unlink failures during backup cleanup', () => {
    const backupsDir = path.join(dir, 'backups');
    fs.mkdirSync(backupsDir, { recursive: true });
    const now = Date.now();
    for (let i = 0; i < 3; i += 1) {
      const file = path.join(backupsDir, `clinic-null-backup-old-${i}.sqlite`);
      fs.writeFileSync(file, 'x');
      fs.utimesSync(file, new Date(now - 3600_000), new Date(now - 3600_000));
    }
    const logger = { warn: vi.fn() };
    const db = new Database(':memory:');
    db.exec('CREATE TABLE BackupRecord (id TEXT, clinicId TEXT, createdAt TEXT, updatedAt TEXT, deletedAt TEXT, filename TEXT, fileSize INTEGER, type TEXT, operatorId TEXT, operatorName TEXT)');
    const dbService = new BackupService(db as unknown as Database.Database, path.join(dir, 'v2.sqlite'), backupsDir, logger as never);
    const originalUnlink = fs.unlinkSync.bind(fs);
    const spyError = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {
      throw new Error('unlink failed');
    });
    try {
      const result = dbService.cleanup(1);
      expect(result.deleted).toEqual([]);
    } finally {
      spyError.mockRestore();
    }
    const spyString = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {
      throw 'unlink-string';
    });
    try {
      dbService.cleanup(1);
    } finally {
      spyString.mockRestore();
    }
    expect(logger.warn).toHaveBeenCalledWith('[backup] failed to delete backup file during cleanup', expect.objectContaining({ error: 'unlink failed' }));
    expect(logger.warn).toHaveBeenCalledWith('[backup] failed to delete backup file during cleanup', expect.objectContaining({ error: 'unlink-string' }));
    expect(originalUnlink).toBeDefined();
  });

  it('skips backup files that vanish between readdir and stat during listing', () => {
    const backupsDir = path.join(dir, 'backups');
    fs.mkdirSync(backupsDir, { recursive: true });
    fs.writeFileSync(path.join(backupsDir, 'clinic-null-backup-vanish.sqlite'), 'x');
    const originalStat = fs.statSync.bind(fs);
    const spy = vi.spyOn(fs, 'statSync').mockImplementation((p: fs.PathLike) => {
      if (String(p).endsWith('clinic-null-backup-vanish.sqlite')) throw new Error('gone');
      return originalStat(p);
    });
    try {
      expect(service.list()).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it('treats a file as deletable when its grace-period stat fails during cleanup', () => {
    const backupsDir = path.join(dir, 'backups');
    fs.mkdirSync(backupsDir, { recursive: true });
    const now = Date.now();
    const newer = path.join(backupsDir, 'clinic-null-backup-newer.sqlite');
    const older = path.join(backupsDir, 'clinic-null-backup-older.sqlite');
    fs.writeFileSync(newer, 'x');
    fs.writeFileSync(older, 'x');
    fs.utimesSync(newer, new Date(now - 3600_000), new Date(now - 3600_000));
    fs.utimesSync(older, new Date(now - 7200_000), new Date(now - 7200_000));
    const db = new Database(':memory:');
    db.exec('CREATE TABLE BackupRecord (id TEXT, clinicId TEXT, createdAt TEXT, updatedAt TEXT, deletedAt TEXT, filename TEXT, fileSize INTEGER, type TEXT, operatorId TEXT, operatorName TEXT)');
    const dbService = new BackupService(db as unknown as Database.Database, path.join(dir, 'v2.sqlite'), backupsDir);
    const originalStat = fs.statSync.bind(fs);
    const statCounts = new Map<string, number>();
    const spy = vi.spyOn(fs, 'statSync').mockImplementation((p: fs.PathLike) => {
      const key = String(p);
      if (key.endsWith('clinic-null-backup-older.sqlite')) {
        const seen = (statCounts.get(key) ?? 0) + 1;
        statCounts.set(key, seen);
        if (seen >= 2) throw new Error('gone mid-cleanup');
      }
      return originalStat(p);
    });
    try {
      const result = dbService.cleanup(1);
      expect(result.deleted.map((file) => file.filename)).toEqual(['clinic-null-backup-older.sqlite']);
      expect(fs.existsSync(older)).toBe(false);
      expect(fs.existsSync(newer)).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('returns zero when the backup directory is missing', () => {
    expect(service.cleanupStaged()).toEqual({ removed: 0 });
  });

  it('skips staged entries that vanish between listing and stat', () => {
    const backupsDir = path.join(dir, 'backups');
    fs.mkdirSync(backupsDir, { recursive: true });
    const vanished = path.join(backupsDir, '.staged-vanish.sqlite');
    fs.writeFileSync(vanished, 'x');
    const originalStat = fs.statSync.bind(fs);
    const spy = vi.spyOn(fs, 'statSync').mockImplementation((p: fs.PathLike) => {
      if (String(p).endsWith('.staged-vanish.sqlite')) throw new Error('gone');
      return originalStat(p);
    });
    try {
      expect(service.cleanupStaged()).toEqual({ removed: 0 });
      expect(fs.existsSync(vanished)).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('logs a warning when a stale staged file cannot be removed', () => {
    const backupsDir = path.join(dir, 'backups');
    fs.mkdirSync(backupsDir, { recursive: true });
    const stale = path.join(backupsDir, '.staged-stale.sqlite');
    fs.writeFileSync(stale, 'x');
    const now = Date.now();
    fs.utimesSync(stale, new Date(now - 7 * 60 * 60 * 1000), new Date(now - 7 * 60 * 60 * 1000));
    const logger = { warn: vi.fn() };
    const db = new Database(':memory:');
    const dbService = new BackupService(db as unknown as Database.Database, path.join(dir, 'v2.sqlite'), backupsDir, logger as never);
    const originalRm = fs.rmSync.bind(fs);
    const spy = vi.spyOn(fs, 'rmSync').mockImplementation((p: fs.PathLike, options?: fs.RmOptions) => {
      if (String(p).endsWith('.staged-stale.sqlite')) throw new Error('rm boom');
      return originalRm(p, options);
    });
    try {
      const result = dbService.cleanupStaged();
      expect(result.removed).toBe(0);
      expect(logger.warn).toHaveBeenCalledWith(
        'failed to remove stale staged backup file',
        expect.objectContaining({ action: 'staged-cleanup', filename: '.staged-stale.sqlite' }),
      );
    } finally {
      spy.mockRestore();
    }
  });
});

// ---- 边缘分支测试（自 services-edge.spec.ts 聚合文件迁移）----
// stageRestore 需要真实文件库读取备份摘要 → 独立 describe + 真实 db 文件。
describe('BackupService edge branches', () => {
  let db: Database.Database;
  let dataDir: string;

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-backup-edge-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('covers backup missing, corrupt, encrypted, and restore branches', async () => {
    const backupDir = path.join(dataDir, 'edge-backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const service = new BackupService(db, path.join(dataDir, 'v2.sqlite'), backupDir);
    await expect(service.verify('missing.sqlite')).rejects.toThrow('Backup file not found');

    process.env.V2_BACKUP_KEY = 'edge-backup-key-0123456789abcdef';
    const encrypted = await service.create({ type: 'AUTO', encrypted: true, operatorId: 'u1', operatorName: 'U1' });
    expect(String(encrypted.filename)).toMatch(/\.enc$/);
    await expect(service.stageRestore('missing.sqlite')).rejects.toThrow('Backup file not found');
    const shortPath = path.join(backupDir, 'clinic-null-backup-short.enc');
    fs.writeFileSync(shortPath, 'too short');
    await expect(service.verify('clinic-null-backup-short.enc')).rejects.toThrow('too short');
    const badMagicPath = path.join(backupDir, 'clinic-null-backup-bad.enc');
    fs.writeFileSync(badMagicPath, Buffer.alloc(100));
    await expect(service.verify('clinic-null-backup-bad.enc')).rejects.toThrow('header is invalid');

    const plain = await service.create({ type: 'MANUAL', encrypted: false });
    const corruptPlainPath = path.join(backupDir, 'clinic-null-backup-corrupt.sqlite');
    const corruptPlainDb = new Database(corruptPlainPath);
    corruptPlainDb.exec('CREATE TABLE BackupSample (id TEXT PRIMARY KEY)');
    corruptPlainDb.close();
    const corruptBuffer = fs.readFileSync(corruptPlainPath);
    corruptBuffer[20] ^= 0xff;
    fs.writeFileSync(corruptPlainPath, corruptBuffer);
    await expect(service.stageRestore('clinic-null-backup-corrupt.sqlite')).rejects.toThrow('Backup integrity check failed before restore');

    const stagedResult = await service.stageRestore(String(plain.filename));
    expect(fs.existsSync(`${stagedResult.stagedPath}-wal`)).toBe(false);
    expect(fs.existsSync(`${stagedResult.stagedPath}-shm`)).toBe(false);
    expect(fs.existsSync(`${path.join(backupDir, String(plain.filename))}-wal`)).toBe(false);
    expect(fs.existsSync(`${path.join(backupDir, String(plain.filename))}-shm`)).toBe(false);
    expect(stagedResult.backupSummary).toMatchObject({
      Patient: expect.any(Number),
      Charge: expect.any(Number),
    });
    expect(stagedResult.currentSummary).toMatchObject({
      User: expect.any(Number),
    });
    const noCurrentService = new BackupService(db, path.join(dataDir, 'missing-v2.sqlite'), backupDir);
    const stagedNoCurrent = await noCurrentService.stageRestore(String(plain.filename));
    expect(stagedNoCurrent.currentSummary).toBeUndefined();
    const originalCopy = fs.copyFileSync.bind(fs);
    const copySpy = vi.spyOn(fs, 'copyFileSync').mockImplementation(((source: string, target: string) => {
      originalCopy(source, target);
      const stagedBuffer = fs.readFileSync(target);
      stagedBuffer[20] ^= 0xff;
      fs.writeFileSync(target, stagedBuffer);
    }) as unknown as typeof fs.copyFileSync);
    await expect(service.stageRestore(String(plain.filename))).rejects.toThrow('staged restore integrity check failed');
    copySpy.mockRestore();
    expect(service.cleanup(1).kept).toBe(1);
    delete process.env.V2_BACKUP_KEY;

    const noKeyService = new BackupService(db, path.join(dataDir, 'v2.sqlite'), path.join(dataDir, 'no-key-backups'));
    await expect(noKeyService.create({ encrypted: true })).rejects.toThrow('V2_BACKUP_KEY is required');
  });

  it('scopes backups, listing, restore, and cleanup by clinic (T3.2)', async () => {
    const backupDir = path.join(dataDir, 'clinic-scoped-backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const service = new BackupService(db, path.join(dataDir, 'v2.sqlite'), backupDir);

    const clinicA = await service.create({ clinicId: 'clinic-a' });
    expect(String(clinicA.filename)).toMatch(/^clinic-clinic-a-backup-/);
    const globalBackup = await service.create({});
    expect(String(globalBackup.filename)).toMatch(/^clinic-null-backup-/);
    const clinicB = await service.create({ clinicId: 'clinic-b' });
    expect(String(clinicB.filename)).toMatch(/^clinic-clinic-b-backup-/);
    // 清理有 60s 新建宽限；把最早一份 clinic-a 备份的 mtime 调旧，确保测试可删除。
    const oldMtime = new Date(Date.now() - 120_000);
    fs.utimesSync(path.join(backupDir, String(clinicA.filename)), oldMtime, oldMtime);

    const listedA = service.list('clinic-a').map((entry) => String(entry.filename));
    expect(listedA).toContain(String(clinicA.filename));
    expect(listedA).not.toContain(String(clinicB.filename));
    expect(listedA).not.toContain(String(globalBackup.filename));
    const listedNull = service.list().map((entry) => String(entry.filename));
    expect(listedNull).toContain(String(globalBackup.filename));
    expect(listedNull).not.toContain(String(clinicA.filename));

    await expect(service.verify(String(clinicB.filename), 'clinic-a'))
      .rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    await expect(service.stageRestore(String(clinicB.filename), 'clinic-a'))
      .rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    await expect(service.stageRestore(String(clinicA.filename), 'clinic-b'))
      .rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    const verified = await service.verify(String(clinicB.filename), 'clinic-b');
    expect(verified.integrity).toBe('ok');

    await service.create({ clinicId: 'clinic-a' });
    const cleanupA = service.cleanup(1, 'clinic-a');
    expect(cleanupA.deleted).toHaveLength(1);
    expect(cleanupA.deleted[0].filename.startsWith('clinic-clinic-a-backup-')).toBe(true);
    expect(fs.existsSync(path.join(backupDir, String(clinicB.filename)))).toBe(true);
    expect(fs.existsSync(path.join(backupDir, String(globalBackup.filename)))).toBe(true);
  });
});
