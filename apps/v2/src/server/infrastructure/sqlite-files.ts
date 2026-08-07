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
    // 先 checkpoint(TRUNCATE)：把 WAL 中已提交帧刷回主库文件并截断 WAL。
    // checkpoint 返回 (busy, log, checkpointed)；只要 busy != 0 或仍有未
    // checkpoint 的 WAL 帧（checkpointed < log），说明有活跃读连接占用，
    // 此时任何"备份"都可能缺数据，直接抛错而不是裸拷贝回退。
    const checkpointRows = current.pragma('wal_checkpoint(TRUNCATE)') as Array<{ busy: number; log: number; checkpointed: number }>;
    const cp = checkpointRows[checkpointRows.length - 1];
    if (!cp || Number(cp.busy) !== 0 || Number(cp.checkpointed) < Number(cp.log)) {
      throw new Error(
        `WAL checkpoint not clean: busy=${cp?.busy ?? 'n/a'}, log=${cp?.log ?? 'n/a'}, checkpointed=${cp?.checkpointed ?? 'n/a'}`,
      );
    }
    try {
      current.prepare('VACUUM INTO ?').run(backupPath);
    } catch (err) {
      // checkpoint 已成功（主库文件已含全部已提交数据），此时 VACUUM INTO
      // 失败可以安全回退到裸文件拷贝：副本与 checkpoint 后的主库一致，
      // 不会静默丢掉 WAL 帧。
      logger?.warn('VACUUM INTO backup failed, falling back to plain file copy (checkpoint already completed)', {
        action: 'sqlite-backup',
        source: sourcePath,
        target: backupPath,
        error: err,
      });
      fs.copyFileSync(sourcePath, backupPath);
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('WAL checkpoint not clean')) {
      logger?.warn('SQLite backup skipped: WAL checkpoint busy (another connection is reading); no partial copy created', {
        action: 'sqlite-backup',
        source: sourcePath,
        target: backupPath,
        error: err.message,
      });
      throw err;
    }
    throw err;
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
