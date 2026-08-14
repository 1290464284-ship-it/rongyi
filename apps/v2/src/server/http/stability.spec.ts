import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { persistStabilityMetrics, stabilitySnapshot } from './stability';

describe('stability snapshot', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-stability-spec-'));
    fs.writeFileSync(path.join(dir, 'v2.sqlite'), 'db');
    fs.writeFileSync(path.join(dir, 'v2.sqlite-wal'), 'wal');
    fs.mkdirSync(path.join(dir, 'backups'));
    fs.mkdirSync(path.join(dir, 'logs'));
    fs.writeFileSync(path.join(dir, 'logs', 'v2.log'), 'log');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reports db/wal/log/backup sizes and uptime', () => {
    const snapshot = stabilitySnapshot(
      path.join(dir, 'v2.sqlite'),
      path.join(dir, 'backups'),
      path.join(dir, 'logs'),
    );
    expect(snapshot.dbSizeBytes).toBeGreaterThan(0);
    expect(snapshot.walSizeBytes).toBeGreaterThan(0);
    expect(snapshot.logFileCount).toBe(1);
    expect(snapshot.logBytes).toBeGreaterThan(0);
    expect(snapshot.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(snapshot.lastBackupAt).toBeNull();
    expect(snapshot.desktopLogEntries).toBe(0);
    expect(snapshot.desktopCrashEntries).toBe(0);
  });

  it('counts desktop crash entries and the latest backup time (B-3.2)', () => {
    const backupFile = path.join(dir, 'backups', 'clinic-null-backup-2026-08-14T00-00-00-000Z-x.enc');
    fs.writeFileSync(backupFile, 'x');
    const now = Date.now();
    fs.utimesSync(backupFile, new Date(now), new Date(now));
    // 覆盖 latestBackupMtime 的过滤与比较分支：非备份扩展名跳过、
    // 无 backup- 前缀跳过；两份同 mtime 备份保证第二次比较走
    // 「不大于 latest」的 else 分支（严格大于才会替换）。
    fs.writeFileSync(path.join(dir, 'backups', 'notes.txt'), 'x');
    fs.writeFileSync(path.join(dir, 'backups', 'manual.sqlite'), 'x');
    const sameMtimeBackup = path.join(dir, 'backups', 'clinic-null-backup-2026-08-13T00-00-00-000Z-same.enc');
    fs.writeFileSync(sameMtimeBackup, 'x');
    fs.utimesSync(sameMtimeBackup, new Date(now), new Date(now));
    fs.writeFileSync(path.join(dir, 'logs', 'desktop.log'), [
      '{"timestamp":"2026-08-14T00:00:00.000Z","message":"api-exit","stack":"..."}',
      '{"timestamp":"2026-08-14T00:00:01.000Z","message":"state.tray-show-api-error","stack":"..."}',
      '{"timestamp":"2026-08-14T00:00:02.000Z","message":"render-process-gone","stack":"..."}',
      '',
    ].join('\n'));

    const snapshot = stabilitySnapshot(
      path.join(dir, 'v2.sqlite'),
      path.join(dir, 'backups'),
      path.join(dir, 'logs'),
    );
    expect(snapshot.lastBackupAt).toBeTruthy();
    // 文件系统 mtime 精度差异（NTFS/FAT）允许 5s 容差
    expect(Math.abs(Date.parse(snapshot.lastBackupAt as string) - now)).toBeLessThan(5000);
    expect(snapshot.desktopLogEntries).toBe(3);
    // api-exit 与 render-process-gone 命中崩溃标签；tray 条目不算
    expect(snapshot.desktopCrashEntries).toBe(2);
  });

  it('treats an unreadable desktop.log as zero entries', () => {
    // desktop.log 被目录占位：existsSync 通过，readFileSync 抛错 → 走 catch 归零
    fs.mkdirSync(path.join(dir, 'logs', 'desktop.log'));
    const snapshot = stabilitySnapshot(
      path.join(dir, 'v2.sqlite'),
      path.join(dir, 'backups'),
      path.join(dir, 'logs'),
    );
    expect(snapshot.desktopLogEntries).toBe(0);
    expect(snapshot.desktopCrashEntries).toBe(0);
  });

  it('persists stability json without throwing', () => {
    expect(() => persistStabilityMetrics(
      path.join(dir, 'logs'),
      stabilitySnapshot(path.join(dir, 'v2.sqlite'), path.join(dir, 'backups'), path.join(dir, 'logs')),
    )).not.toThrow();
    expect(fs.existsSync(path.join(dir, 'logs', 'stability.json'))).toBe(true);
  });
});
