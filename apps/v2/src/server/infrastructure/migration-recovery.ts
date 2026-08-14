import fs from 'node:fs';
import path from 'node:path';
import type { Logger } from './logger';

/**
 * 迁移失败时的自动回滚：恢复 dataDir/pre-migration/ 下最新的快照到 dbPath。
 * 只在「本次启动确实尝试过迁移且 runMigrations 抛错」时调用，回滚丢失的
 * 数据窗口 ≈ 迁移开始到失败的几秒，风险可控。失败后的半迁移库改名留存
 * （.failed-<ts>），供事后诊断，不删除。
 */
export function restoreLatestMigrationSnapshot(dataDir: string, dbPath: string, logger: Logger): boolean {
  const snapshotDir = path.join(dataDir, 'pre-migration');
  let candidates: string[] = [];
  try {
    candidates = fs.readdirSync(snapshotDir)
      .filter((name) => /^pre-\d+\.sqlite$/.test(name))
      .map((name) => path.join(snapshotDir, name))
      .sort((a, b) => {
        try {
          return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
        } catch {
          return 0;
        }
      });
  } catch {
    return false;
  }
  const newest = candidates[0];
  if (!newest) return false;
  try {
    const failedCopy = `${dbPath}.failed-${Date.now()}`;
    // 1. 半迁移库改名留证（不删除，供人工排查）
    fs.renameSync(dbPath, failedCopy);
    // 2. 清除 WAL/SHM 侧车（与 restore-apply 的既有逻辑一致）
    for (const suffix of ['-wal', '-shm']) {
      try {
        fs.rmSync(`${dbPath}${suffix}`, { force: true });
      } catch {
        // best effort
      }
    }
    // 3. 快照原子落位
    fs.copyFileSync(newest, dbPath);
    logger.error('migration failed; rolled back to pre-migration snapshot', {
      action: 'migration-rollback',
      snapshot: newest,
      failedCopy,
    });
    // 4. 失败副本保留上限 3，超出清最旧
    pruneFailedCopies(dbPath, 3);
    return true;
  } catch (error) {
    logger.error('migration rollback failed', { action: 'migration-rollback', error });
    return false;
  }
}

/** 清理 .failed-* 副本，最多保留 keep 个（按 mtime 最旧优先删）。 */
export function pruneFailedCopies(dbPath: string, keep: number): number {
  const dir = path.dirname(dbPath);
  const base = path.basename(dbPath);
  let removed = 0;
  try {
    const copies = fs.readdirSync(dir)
      .filter((name) => name.startsWith(`${base}.failed-`))
      .map((name) => path.join(dir, name))
      .sort((a, b) => {
        try {
          return fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs;
        } catch {
          return 0;
        }
      });
    while (copies.length > keep) {
      const oldest = copies.shift();
      if (!oldest) break;
      try {
        fs.rmSync(oldest, { force: true });
        removed += 1;
      } catch {
        // 单个文件清理失败继续尝试下一个
      }
    }
  } catch {
    // best effort
  }
  return removed;
}
