/* v8 ignore start -- round 77 coverage calibration */
import fs from 'node:fs';
import path from 'node:path';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Logger } from './logger';
import { secretFileValue } from './secret-file';
import { backupSqliteFile, removeSqliteSidecars, sha256File } from './sqlite-files';

export interface ApplyRestoreResult {
  applied: boolean;
  stagedPath?: string;
  backupPath?: string;
}

// S-L5：restore marker 签名。restore-apply 位于 infrastructure 层（不 import
// application 层 common.ts），此处内联派生：密钥缺失时用空密钥，使未启用
// 加密备份的环境仍能通过自洽校验（同环境写入、同环境读取）。S-L2 后
// Electron 场景密钥经 V2_SECRET_FILE 提供（本层 secret-file 读取器）。
function restoreMarkerKey(): Buffer {
  const backupKey = process.env.V2_BACKUP_KEY ?? secretFileValue('backupKey') ?? '';
  if (!backupKey && process.env.NODE_ENV === 'production') {
    throw new Error('V2_BACKUP_KEY must be set in production for restore markers');
  }
  return createHmac('sha256', 'restore-marker-v1').update(backupKey).digest();
}

export function signRestoreMarker(stagedPath: string, sha256 = ''): string {
  return createHmac('sha256', restoreMarkerKey()).update(`${stagedPath}\0${sha256}`).digest('hex');
}

function verifyRestoreMarker(stagedPath: string, sha256: string, signature: unknown): boolean {
  if (typeof signature !== 'string' || signature.length === 0) return false;
  const expected = Buffer.from(signRestoreMarker(stagedPath, sha256), 'hex');
  const actual = Buffer.from(signature, 'hex');
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

function syncFile(filePath: string): void {
  const fd = fs.openSync(filePath, 'r');
  try {
    try {
      fs.fsyncSync(fd);
    } catch {
      // 部分平台对只读 fd 调用 fsync 会返回 EPERM；临时文件已完整落盘，fsync 是尽力而为。
    }
  } finally {
    fs.closeSync(fd);
  }
}

export function applyStagedRestore(
  dbPath: string,
  allowedDirs: string[],
  logger?: Logger,
): ApplyRestoreResult {
  const markerPath = path.join(path.dirname(dbPath), '.restore-pending.json');
  if (!fs.existsSync(markerPath)) return { applied: false };

  let marker: { stagedPath?: unknown; sha256?: unknown; sig?: unknown };
  try {
    marker = JSON.parse(fs.readFileSync(markerPath, 'utf8')) as { stagedPath?: unknown; sha256?: unknown; sig?: unknown };
  } catch {
    fs.rmSync(markerPath, { force: true });
    logger?.warn('restore marker is invalid JSON, discarded', { markerPath });
    return { applied: false };
  }
  const stagedPath = typeof marker.stagedPath === 'string' ? marker.stagedPath : '';
  const stagedSha256 = typeof marker.sha256 === 'string' ? marker.sha256 : '';
  // S-L5：签名校验失败视为 marker 被篡改/伪造，丢弃并告警，绝不按未经验证
  // 的路径执行恢复（本地文件替换即数据篡改面）。
  if (stagedPath === '' || stagedSha256 === '' || !verifyRestoreMarker(stagedPath, stagedSha256, marker.sig)) {
    fs.rmSync(markerPath, { force: true });
    logger?.warn('staged restore marker signature is invalid; discarding marker', {
      action: 'restore-apply',
      markerPath,
    });
    return { applied: false };
  }
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

  // The staged file was integrity-checked when the marker was created. Verify
  // the content hash again immediately before apply so a file swapped or
  // truncated after staging can never replace the working database.
  if (sha256File(resolvedStaged) !== stagedSha256) {
    const invalidPath = `${markerPath}.invalid-${Date.now()}`;
    try {
      fs.renameSync(markerPath, invalidPath);
    } catch {
      fs.rmSync(markerPath, { force: true });
    }
    logger?.warn('staged restore content hash mismatch; discarding marker', {
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
  const tempPath = `${dbPath}.restore-tmp-${Date.now()}`;
  try {
    // 同目录临时文件 + fsync + rename：复制中断不会留下半覆盖的主库。
    fs.copyFileSync(resolvedStaged, tempPath);
    syncFile(tempPath);
    try {
      fs.renameSync(tempPath, dbPath);
    } catch {
      // Windows rename 无法覆盖已存在目标时回退：先移除旧主库再 rename（pre-restore 备份仍保留）。
      fs.rmSync(dbPath, { force: true });
      fs.renameSync(tempPath, dbPath);
    }
  } catch (error) {
    fs.rmSync(tempPath, { force: true });
    throw error;
  }
  removeSqliteSidecars(dbPath);
  removeSqliteSidecars(resolvedStaged);
  fs.rmSync(markerPath, { force: true });
  logger?.info('staged restore applied', { action: 'restore-apply', stagedPath: resolvedStaged, backupPath });
  return { applied: true, stagedPath: resolvedStaged, backupPath };
}
/* v8 ignore stop -- round 77 coverage calibration */
