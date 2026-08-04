import fs from 'node:fs';
import Database from 'better-sqlite3';
import type DatabaseType from 'better-sqlite3';

export function removeSqliteSidecars(dbPath: string): void {
  for (const suffix of ['-wal', '-shm']) {
    const sidecar = `${dbPath}${suffix}`;
    if (fs.existsSync(sidecar)) {
      fs.rmSync(sidecar, { force: true });
    }
  }
}

export function backupSqliteFile(sourcePath: string, backupPath: string): void {
  let current: DatabaseType.Database | undefined;
  try {
    current = new Database(sourcePath);
    current.prepare('VACUUM INTO ?').run(backupPath);
  } catch {
    fs.copyFileSync(sourcePath, backupPath);
  } finally {
    current?.close();
  }
}
