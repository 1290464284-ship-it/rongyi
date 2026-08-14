import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { checkDiskFree } from './disk-monitor';
import type { Logger } from '../infrastructure/logger';

/**
 * A-P3.1：运维健康快照（health.json）。
 *
 * 无人值守多机部署的巡检入口：运维用 dsh-ssh 批量读取每台机器
 * userData/logs/health.json 一个文件即可判断机器是否健康。字段固定，
 * 供巡检脚本稳定解析。写入失败静默（可观测性不能拖垮 API）。
 */
export interface HealthSnapshot {
  generatedAt: string;
  version: string;
  uptimeSeconds: number;
  db: {
    quickCheck: 'ok' | 'error';
    sizeBytes: number;
    walBytes: number;
  };
  backup: {
    count: number;
    lastBackupAt: string | null;
    lastBackupFile: string | null;
  };
  disk: Array<{
    dir: string;
    freeBytes: number;
    ok: boolean;
  }>;
  logBytes: number;
  openAlerts: number;
}

function fileSize(filePath: string): number {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

function dirBytes(dir: string): number {
  try {
    let bytes = 0;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      try {
        bytes += fs.statSync(path.join(dir, entry.name)).size;
      } catch {
        // 扫描期间文件消失：跳过
      }
    }
    return bytes;
  } catch {
    return 0;
  }
}

function latestBackup(backupDir: string): { lastBackupAt: string | null; lastBackupFile: string | null; count: number } {
  try {
    let latestName: string | null = null;
    let latestMtime = 0;
    let count = 0;
    for (const name of fs.readdirSync(backupDir)) {
      if (!name.endsWith('.enc') && !name.endsWith('.sqlite')) continue;
      if (!name.includes('backup-')) continue;
      count += 1;
      try {
        const mtimeMs = fs.statSync(path.join(backupDir, name)).mtimeMs;
        if (mtimeMs > latestMtime) {
          latestMtime = mtimeMs;
          latestName = name;
        }
      } catch {
        // 文件消失：跳过
      }
    }
    return {
      lastBackupAt: latestName ? new Date(latestMtime).toISOString() : null,
      lastBackupFile: latestName,
      count,
    };
  } catch {
    return { lastBackupAt: null, lastBackupFile: null, count: 0 };
  }
}

export function buildHealthSnapshot(options: {
  db: Database.Database;
  dbPath: string;
  backupDir: string;
  logDir: string;
  version: string;
  startedAt: number;
  openAlertsCount: () => number;
}): HealthSnapshot {
  let quickCheck: 'ok' | 'error' = 'error';
  try {
    const rows = options.db.pragma('quick_check') as Array<{ quick_check: string }>;
    quickCheck = rows.length === 1 && rows[0].quick_check === 'ok' ? 'ok' : 'error';
  } catch {
    quickCheck = 'error';
  }
  const backup = latestBackup(options.backupDir);
  const diskResult = checkDiskFree(options.backupDir);
  let openAlerts = 0;
  try {
    openAlerts = options.openAlertsCount();
  } catch {
    openAlerts = 0;
  }
  return {
    generatedAt: new Date().toISOString(),
    version: options.version,
    uptimeSeconds: Math.round((Date.now() - options.startedAt) / 1000),
    db: {
      quickCheck,
      sizeBytes: fileSize(options.dbPath),
      walBytes: fileSize(`${options.dbPath}-wal`),
    },
    backup,
    disk: [{ dir: diskResult.dir, freeBytes: diskResult.freeBytes, ok: diskResult.ok }],
    logBytes: dirBytes(options.logDir),
    openAlerts,
  };
}

export function writeHealthSnapshot(options: {
  logDir: string;
  snapshot: HealthSnapshot;
  logger?: Logger;
}): void {
  try {
    fs.mkdirSync(options.logDir, { recursive: true });
    fs.writeFileSync(
      path.join(options.logDir, 'health.json'),
      `${JSON.stringify(options.snapshot, null, 2)}\n`,
      'utf8',
    );
  } catch (error) {
    options.logger?.warn('failed to write health snapshot', {
      action: 'health-snapshot',
      error: error instanceof Error ? error.message : error,
    });
  }
}
