import fs from 'node:fs';
import path from 'node:path';
import type { Logger } from './logger';
import { backupSqliteFile, removeSqliteSidecars } from './sqlite-files';

export interface ApplyRestoreResult {
  applied: boolean;
  stagedPath?: string;
  backupPath?: string;
}

export function applyStagedRestore(
  dbPath: string,
  allowedDirs: string[],
  logger?: Logger,
): ApplyRestoreResult {
  const markerPath = path.join(path.dirname(dbPath), '.restore-pending.json');
  if (!fs.existsSync(markerPath)) return { applied: false };

  let marker: { stagedPath?: unknown };
  try {
    marker = JSON.parse(fs.readFileSync(markerPath, 'utf8')) as { stagedPath?: unknown };
  } catch {
    fs.rmSync(markerPath, { force: true });
    console.warn('restore marker is invalid JSON, discarded:', markerPath);
    return { applied: false };
  }
  const stagedPath = typeof marker.stagedPath === 'string' ? marker.stagedPath : '';
  const resolvedStaged = path.resolve(stagedPath);
  const allowed = allowedDirs.map((dir) => path.resolve(dir));
  if (!allowed.some((dir) => resolvedStaged === dir || resolvedStaged.startsWith(dir + path.sep)) || !fs.existsSync(resolvedStaged)) {
    const invalidPath = `${markerPath}.invalid-${Date.now()}`;
    try {
      fs.renameSync(markerPath, invalidPath);
    } catch {
      fs.rmSync(markerPath, { force: true });
    }
    logger?.warn('staged restore marker is invalid or staged file is missing; skipping restore', {
      action: 'restore-apply',
      markerPath: invalidPath,
      stagedPath: resolvedStaged,
    });
    return { applied: false };
  }

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  let backupPath: string | undefined;
  if (fs.existsSync(dbPath)) {
    backupPath = `${dbPath}.pre-restore-${Date.now()}`;
    backupSqliteFile(dbPath, backupPath);
  }
  removeSqliteSidecars(dbPath);
  fs.copyFileSync(resolvedStaged, dbPath);
  removeSqliteSidecars(dbPath);
  removeSqliteSidecars(resolvedStaged);
  fs.rmSync(markerPath, { force: true });
  logger?.info('staged restore applied', { action: 'restore-apply', stagedPath: resolvedStaged, backupPath });
  return { applied: true, stagedPath: resolvedStaged, backupPath };
}
