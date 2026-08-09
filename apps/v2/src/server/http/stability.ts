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
  logFileCount: number;
  logBytes: number;
}

const processStartedAt = Date.now();

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

export function stabilitySnapshot(
  dbPath: string,
  backupDir: string,
  logDir: string,
): StabilitySnapshot {
  const backups = dirStats(backupDir);
  const logs = dirStats(logDir);
  return {
    startedAt: new Date(processStartedAt).toISOString(),
    uptimeSeconds: Math.round((Date.now() - processStartedAt) / 1000),
    dbSizeBytes: fileSize(dbPath),
    walSizeBytes: fileSize(`${dbPath}-wal`),
    shmSizeBytes: fileSize(`${dbPath}-shm`),
    backupCount: backups.count,
    backupBytes: backups.bytes,
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
