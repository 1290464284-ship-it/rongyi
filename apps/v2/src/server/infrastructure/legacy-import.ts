import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { Logger } from './logger';
import { backupSqliteFile, copySqliteFileReadonly, removeSqliteSidecars } from './sqlite-files';

export interface LegacyImportResult {
  imported: boolean;
  sourceExists: boolean;
  integrityOk: boolean;
  targetCreated: boolean;
  backupCreated?: string;
}

/**
 * Imports the legacy SQLite database into the V2 working copy with preflight
 * integrity checks. The original source database is never opened for writing:
 * the import uses a read-only connection plus `VACUUM INTO`, so neither the
 * source file nor its WAL/SHM sidecars are checkpointed, modified, or deleted.
 */
export function importLegacyDatabase(
  sourcePath: string,
  targetPath: string,
  logger?: Logger,
): LegacyImportResult {
  if (!fs.existsSync(sourcePath)) {
    return { imported: false, sourceExists: false, integrityOk: false, targetCreated: false };
  }

  let integrityOk = false;
  const sourceDb = new Database(sourcePath, { readonly: true });
  try {
    const integrity = sourceDb.pragma('integrity_check') as Array<{ integrity_check: string }>;
    integrityOk = integrity.length === 1 && integrity[0].integrity_check === 'ok';
  } finally {
    sourceDb.close();
  }

  if (!integrityOk) {
    logger?.error('legacy database integrity check failed', { action: 'legacy-import' });
    return { imported: false, sourceExists: true, integrityOk: false, targetCreated: false };
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  let backupCreated: string | undefined;
  if (fs.existsSync(targetPath)) {
    backupCreated = `${targetPath}.pre-import-${Date.now()}`;
    backupSqliteFile(targetPath, backupCreated, logger);
  }
  // 先复制到临时文件并完整校验，再原子替换目标：复制/校验失败时旧库保持不变，
  // 不会留下“半成品 v2.sqlite”导致下次启动误入恢复模式。
  const tempPath = `${targetPath}.import-tmp-${Date.now()}`;
  try {
    copySqliteFileReadonly(sourcePath, tempPath);
    // 只读连接的 integrity_check 会跳过 CHECK 约束（实测 better-sqlite3），
    // 因此临时目标必须用读写连接复查，避免脏旧库被放行后启动阶段才崩溃。
    const tempDb = new Database(tempPath);
    try {
      const integrity = tempDb.pragma('integrity_check') as Array<{ integrity_check: string }>;
      if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') {
        throw new Error('imported database integrity check failed');
      }
    } finally {
      tempDb.close();
      removeSqliteSidecars(tempPath);
    }
    removeSqliteSidecars(targetPath);
    if (fs.existsSync(targetPath)) fs.rmSync(targetPath, { force: true });
    fs.renameSync(tempPath, targetPath);
  } finally {
    if (fs.existsSync(tempPath)) {
      try {
        fs.rmSync(tempPath, { force: true });
      } catch {
        // best effort: 保留原始校验/复制错误
      }
    }
  }

  logger?.info('legacy database imported', { action: 'legacy-import', target: targetPath, backupCreated });
  return {
    imported: true,
    sourceExists: true,
    integrityOk: true,
    targetCreated: true,
    backupCreated,
  };
}
