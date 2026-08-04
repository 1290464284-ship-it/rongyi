import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { Logger } from './logger';
import { backupSqliteFile, removeSqliteSidecars } from './sqlite-files';

export interface LegacyImportResult {
  imported: boolean;
  sourceExists: boolean;
  integrityOk: boolean;
  targetCreated: boolean;
  backupCreated?: string;
}

/**
 * Imports the legacy SQLite database into the V2 working copy with preflight
 * integrity checks. The original source database is never modified.
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
    backupSqliteFile(targetPath, backupCreated);
  }
  removeSqliteSidecars(targetPath);
  if (fs.existsSync(targetPath)) fs.rmSync(targetPath, { force: true });
  backupSqliteFile(sourcePath, targetPath);
  removeSqliteSidecars(sourcePath);

  const targetDb = new Database(targetPath, { readonly: true });
  try {
    const integrity = targetDb.pragma('integrity_check') as Array<{ integrity_check: string }>;
    if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') {
      throw new Error('imported database integrity check failed');
    }
  } finally {
    targetDb.close();
    removeSqliteSidecars(targetPath);
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
