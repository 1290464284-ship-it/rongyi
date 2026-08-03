import fs from 'node:fs';
import type Database from 'better-sqlite3';

export function deepHealth(db: Database.Database, backupDir: string): Record<string, unknown> {
  const integrity = db.pragma('integrity_check') as Array<{ integrity_check: string }>;
  const dbHealthy = integrity.length === 1 && integrity[0].integrity_check === 'ok';
  let diskFreeBytes = 0;
  let backupWritable = false;
  try {
    fs.mkdirSync(backupDir, { recursive: true });
    const probe = `${backupDir}/.v2-health-probe`;
    fs.writeFileSync(probe, 'ok');
    fs.rmSync(probe, { force: true });
    backupWritable = true;
  } catch {
    backupWritable = false;
  }
  try {
    diskFreeBytes = fs.statfsSync(backupDir).bavail * fs.statfsSync(backupDir).bsize;
  } catch {
    diskFreeBytes = 0;
  }
  return {
    database: dbHealthy ? 'ok' : 'corrupt',
    backupDirectory: backupWritable ? 'ok' : 'not-writable',
    diskFreeBytes,
    timestamp: new Date().toISOString(),
  };
}

