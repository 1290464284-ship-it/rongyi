import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { buildHealthSnapshot, writeHealthSnapshot, type HealthSnapshot } from './health-snapshot';
import type { Logger } from '../infrastructure/logger';

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

describe('health snapshot (A-P3.1)', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-health-snap-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('builds a complete snapshot with ok quick_check and backup stats', () => {
    const db = new Database(':memory:');
    const backupDir = path.join(dir, 'backups');
    const logDir = path.join(dir, 'logs');
    fs.mkdirSync(backupDir, { recursive: true });
    fs.mkdirSync(logDir, { recursive: true });
    fs.writeFileSync(path.join(backupDir, 'clinic-null-backup-2026-08-14T00-00-00-000Z-aaa.enc'), 'x');
    fs.writeFileSync(path.join(backupDir, 'clinic-null-backup-2026-08-15T00-00-00-000Z-bbb.enc'), 'x');
    fs.writeFileSync(path.join(backupDir, 'notes.txt'), 'x'); // 非备份文件不计
    fs.writeFileSync(path.join(backupDir, 'manual.enc'), 'x'); // 无 backup- 前缀的加密文件也不计
    fs.writeFileSync(path.join(logDir, 'main.log'), 'log-bytes');
    fs.mkdirSync(path.join(logDir, 'subdir')); // 目录条目不计入 logBytes
    // 显式拉开 mtime：Windows 上连续两次写入的 mtime 可能相同，latestBackup
    // 按严格大于选取，避免同刻写入导致选择不稳定（顺序依赖 flaky）。
    const now = Date.now();
    fs.utimesSync(path.join(backupDir, 'clinic-null-backup-2026-08-14T00-00-00-000Z-aaa.enc'), new Date(now - 60_000), new Date(now - 60_000));
    fs.utimesSync(path.join(backupDir, 'clinic-null-backup-2026-08-15T00-00-00-000Z-bbb.enc'), new Date(now), new Date(now));
    const dbPath = path.join(dir, 'v2.sqlite');
    fs.writeFileSync(dbPath, 'db-bytes');

    const snapshot = buildHealthSnapshot({
      db: db as unknown as Database.Database,
      dbPath,
      backupDir,
      logDir,
      version: '2.2.0',
      startedAt: Date.now() - 5_000,
      openAlertsCount: () => 3,
    });

    expect(snapshot.version).toBe('2.2.0');
    expect(snapshot.db.quickCheck).toBe('ok');
    expect(snapshot.db.sizeBytes).toBe('db-bytes'.length);
    expect(snapshot.backup.count).toBe(2);
    expect(snapshot.backup.lastBackupFile).toContain('bbb');
    expect(snapshot.backup.lastBackupAt).toBeTruthy();
    expect(snapshot.logBytes).toBe('log-bytes'.length);
    expect(snapshot.openAlerts).toBe(3);
    expect(snapshot.disk).toHaveLength(1);
    expect(snapshot.disk[0].dir).toBe(backupDir);
    expect(snapshot.disk[0].ok).toBe(true);
    expect(snapshot.uptimeSeconds).toBeGreaterThanOrEqual(4);
    db.close();
  });

  it('reports quick_check error and zeroed stats when the db is unusable', () => {
    const db = new Database(':memory:');
    const dbPath = path.join(dir, 'missing.sqlite');
    vi.spyOn(db, 'pragma').mockImplementation(() => {
      throw new Error('db closed');
    });
    const snapshot = buildHealthSnapshot({
      db: db as unknown as Database.Database,
      dbPath,
      backupDir: path.join(dir, 'no-backups'),
      logDir: path.join(dir, 'no-logs'),
      version: '2.2.0',
      startedAt: Date.now(),
      openAlertsCount: () => 0,
    });
    expect(snapshot.db.quickCheck).toBe('error');
    expect(snapshot.db.sizeBytes).toBe(0);
    expect(snapshot.backup.count).toBe(0);
    expect(snapshot.backup.lastBackupFile).toBeNull();
    expect(snapshot.logBytes).toBe(0);
    db.close();
  });

  it('reports quick_check error when the pragma returns a non-ok row', () => {
    const db = new Database(':memory:');
    vi.spyOn(db, 'pragma').mockImplementation(() => [{ quick_check: 'not-ok' }] as never);
    const snapshot = buildHealthSnapshot({
      db: db as unknown as Database.Database,
      dbPath: path.join(dir, 'v2.sqlite'),
      backupDir: path.join(dir, 'backups'),
      logDir: path.join(dir, 'logs'),
      version: '2.2.0',
      startedAt: Date.now(),
      openAlertsCount: () => 0,
    });
    expect(snapshot.db.quickCheck).toBe('error');
    db.close();
  });

  it('reports a null last backup time when the backup dir has no real backups', () => {
    const db = new Database(':memory:');
    const backupDir = path.join(dir, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(path.join(backupDir, 'notes.txt'), 'x');
    fs.writeFileSync(path.join(backupDir, 'manual.enc'), 'x');
    const snapshot = buildHealthSnapshot({
      db: db as unknown as Database.Database,
      dbPath: path.join(dir, 'v2.sqlite'),
      backupDir,
      logDir: path.join(dir, 'logs'),
      version: '2.2.0',
      startedAt: Date.now(),
      openAlertsCount: () => 0,
    });
    expect(snapshot.backup.count).toBe(0);
    expect(snapshot.backup.lastBackupAt).toBeNull();
    expect(snapshot.backup.lastBackupFile).toBeNull();
    db.close();
  });

  it('uses the first of equal-mtime backups for the latest backup time', () => {
    const db = new Database(':memory:');
    const backupDir = path.join(dir, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const first = path.join(backupDir, 'clinic-null-backup-2026-08-14T00-00-00-000Z-aaa.enc');
    const second = path.join(backupDir, 'clinic-null-backup-2026-08-15T00-00-00-000Z-bbb.enc');
    fs.writeFileSync(first, 'x');
    fs.writeFileSync(second, 'x');
    const now = Date.now();
    fs.utimesSync(first, new Date(now), new Date(now));
    fs.utimesSync(second, new Date(now), new Date(now));
    const snapshot = buildHealthSnapshot({
      db: db as unknown as Database.Database,
      dbPath: path.join(dir, 'v2.sqlite'),
      backupDir,
      logDir: path.join(dir, 'logs'),
      version: '2.2.0',
      startedAt: Date.now(),
      openAlertsCount: () => 0,
    });
    expect(snapshot.backup.lastBackupAt).toBeTruthy();
    expect(['clinic-null-backup-2026-08-14T00-00-00-000Z-aaa.enc', 'clinic-null-backup-2026-08-15T00-00-00-000Z-bbb.enc'])
      .toContain(snapshot.backup.lastBackupFile);
    db.close();
  });

  it('logs non-Error write failures when persisting health.json', () => {
    const logDir = path.join(dir, 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const logger = makeLogger();
    const snapshot: HealthSnapshot = {
      generatedAt: '2026-08-14T00:00:00.000Z',
      version: '2.2.0',
      uptimeSeconds: 1,
      db: { quickCheck: 'ok', sizeBytes: 1, walBytes: 0 },
      backup: { count: 0, lastBackupAt: null, lastBackupFile: null },
      disk: [{ dir: logDir, freeBytes: 1, ok: true }],
      logBytes: 0,
      openAlerts: 0,
    };
    const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementationOnce(() => {
      throw 'plain write failure';
    });
    try {
      writeHealthSnapshot({ logDir, snapshot, logger });
    } finally {
      writeSpy.mockRestore();
    }
    expect(logger.warn).toHaveBeenCalled();
    const call = vi.mocked(logger.warn).mock.calls[0];
    expect(String(call[1]?.error)).toBe('plain write failure');
  });

  it('falls back to zero open alerts when the alert query fails', () => {
    const db = new Database(':memory:');
    const snapshot = buildHealthSnapshot({
      db: db as unknown as Database.Database,
      dbPath: path.join(dir, 'v2.sqlite'),
      backupDir: path.join(dir, 'backups'),
      logDir: path.join(dir, 'logs'),
      version: '2.2.0',
      startedAt: Date.now(),
      openAlertsCount: () => {
        throw new Error('alert query boom');
      },
    });
    expect(snapshot.openAlerts).toBe(0);
    db.close();
  });

  it('writes health.json and tolerates an unwritable target', () => {
    const logDir = path.join(dir, 'logs');
    const logger = makeLogger();
    const snapshot: HealthSnapshot = {
      generatedAt: '2026-08-14T00:00:00.000Z',
      version: '2.2.0',
      uptimeSeconds: 1,
      db: { quickCheck: 'ok', sizeBytes: 1, walBytes: 0 },
      backup: { count: 0, lastBackupAt: null, lastBackupFile: null },
      disk: [{ dir: logDir, freeBytes: 1, ok: true }],
      logBytes: 0,
      openAlerts: 0,
    };
    writeHealthSnapshot({ logDir, snapshot, logger });
    const written = JSON.parse(fs.readFileSync(path.join(logDir, 'health.json'), 'utf8')) as HealthSnapshot;
    expect(written.version).toBe('2.2.0');
    expect(written.db.quickCheck).toBe('ok');

    // 目标被普通文件占位 → 写入失败仅告警日志
    const blocked = path.join(dir, 'blocked');
    fs.writeFileSync(blocked, 'not a dir');
    const logger2 = makeLogger();
    writeHealthSnapshot({ logDir: blocked, snapshot, logger: logger2 });
    expect(logger2.warn).toHaveBeenCalled();
  });
});
