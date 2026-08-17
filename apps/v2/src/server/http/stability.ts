import fs from 'node:fs';
import path from 'node:path';

export interface StabilitySnapshot {
  startedAt: string;
  uptimeSeconds: number;
  dbSizeBytes: number;
  walSizeBytes: number;
  shmSizeBytes: number;
  backupCount: number;
  backupBytes: number;
  /** B-3.2：最近一次备份文件 mtime（ISO），无备份为 null。 */
  lastBackupAt: string | null;
  /** B-3.2：desktop.log（Electron 主进程崩溃/错误日志）总行数。 */
  desktopLogEntries: number;
  /** B-3.2：desktop.log 中匹配崩溃标签的条目数（api-exit / render-process-gone / did-fail-load 等）。 */
  desktopCrashEntries: number;
  logFileCount: number;
  logBytes: number;
}

const processStartedAt = Date.now();

/** 崩溃标签：主进程 crashLog 的常见 message 前缀。 */
const CRASH_LABEL_PATTERN = /"(?:api-exit|api-restart-failed|api-spawn-error|render-process-gone|did-fail-load|crash|supervisor-spawn-failed)"/;

function fileSize(filePath: string): number {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

function dirStats(dir: string): { count: number; bytes: number } {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    let bytes = 0;
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      try {
        bytes += fs.statSync(path.join(dir, entry.name)).size;
      } catch {
        // ignore files that disappeared during the scan
      }
    }
    return { count: entries.filter((entry) => entry.isFile()).length, bytes };
  } catch {
    return { count: 0, bytes: 0 };
  }
}

function desktopLogStats(logDir: string): { entries: number; crashEntries: number } {
  try {
    const logFile = path.join(logDir, 'desktop.log');
    if (!fs.existsSync(logFile)) return { entries: 0, crashEntries: 0 };
    const raw = fs.readFileSync(logFile, 'utf8');
    const lines = raw.split('\n').filter((line) => line.trim().length > 0);
    const crashEntries = lines.filter((line) => CRASH_LABEL_PATTERN.test(line)).length;
    return { entries: lines.length, crashEntries };
  } catch {
    return { entries: 0, crashEntries: 0 };
  }
}

function latestBackupMtime(backupDir: string): string | null {
  try {
    let latest: number | null = null;
    for (const name of fs.readdirSync(backupDir)) {
      if (!name.endsWith('.enc') && !name.endsWith('.sqlite')) continue;
      if (!name.includes('backup-')) continue;
      try {
        const mtimeMs = fs.statSync(path.join(backupDir, name)).mtimeMs;
        if (latest === null || mtimeMs > latest) latest = mtimeMs;
      } catch {
        // file disappeared during the scan
      }
    }
    return latest === null ? null : new Date(latest).toISOString();
  } catch {
    return null;
  }
}

export function stabilitySnapshot(
  dbPath: string,
  backupDir: string,
  logDir: string,
): StabilitySnapshot {
  const backups = dirStats(backupDir);
  const logs = dirStats(logDir);
  const desktop = desktopLogStats(logDir);
  return {
    startedAt: new Date(processStartedAt).toISOString(),
    uptimeSeconds: Math.round((Date.now() - processStartedAt) / 1000),
    dbSizeBytes: fileSize(dbPath),
    walSizeBytes: fileSize(`${dbPath}-wal`),
    shmSizeBytes: fileSize(`${dbPath}-shm`),
    backupCount: backups.count,
    backupBytes: backups.bytes,
    lastBackupAt: latestBackupMtime(backupDir),
    desktopLogEntries: desktop.entries,
    desktopCrashEntries: desktop.crashEntries,
    logFileCount: logs.count,
    logBytes: logs.bytes,
  };
}

export function persistStabilityMetrics(logDir: string, snapshot: StabilitySnapshot): void {
  try {
    fs.mkdirSync(logDir, { recursive: true });
    fs.writeFileSync(
      path.join(logDir, 'stability.json'),
      JSON.stringify({ timestamp: new Date().toISOString(), stability: snapshot }, null, 2),
      'utf8',
    );
  } catch {
    // Observability persistence must not break the API.
  }
}
