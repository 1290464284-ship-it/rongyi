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

export function backupSqliteFile(
  sourcePath: string,
  backupPath: string,
  logger?: { warn(message: string, meta?: Record<string, unknown>): void },
): void {
  let current: DatabaseType.Database | undefined;
  try {
    current = new Database(sourcePath);
    current.prepare('VACUUM INTO ?').run(backupPath);
  } catch (err) {
    logger?.warn('VACUUM INTO backup failed, falling back to plain file copy (backup may be inconsistent with WAL)', {
      action: 'sqlite-backup',
      source: sourcePath,
      target: backupPath,
      error: err,
    });
    fs.copyFileSync(sourcePath, backupPath);
  } finally {
    current?.close();
  }
}

const SUMMARY_TABLES = [
  'Clinic',
  'User',
  'UserClinic',
  'Patient',
  'Appointment',
  'Charge',
  'MemberCard',
  'InventoryItem',
  'FollowUp',
  'PurchaseOrder',
];

export function summarizeSqliteFile(dbPath: string): Record<string, number | string | null> {
  const db = new Database(dbPath, { readonly: true });
  try {
    const summary: Record<string, number | string | null> = {};
    const hasTable = (table: string): boolean => Boolean(
      db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table),
    );
    for (const table of SUMMARY_TABLES) {
      if (hasTable(table)) {
        summary[table] = Number((db.prepare(`SELECT COUNT(*) AS c FROM "${table}"`).get() as { c: number }).c);
      }
    }
    if (hasTable('Charge')) {
      try {
        const row = db.prepare('SELECT MAX(paidAt) AS lastPaidAt FROM Charge WHERE paidAt IS NOT NULL').get() as {
          lastPaidAt: string | null;
        };
        summary.lastPaidAt = row.lastPaidAt ?? null;
      } catch {
        summary.lastPaidAt = null;
      }
    } else {
      summary.lastPaidAt = null;
    }
    return summary;
  } finally {
    db.close();
  }
}
