/**
 * A-P2：异地备份镜像（off-machine backup mirror）。
 * 独立模块：BackupService 只保留薄委托，使 backup.ts 保持在
 * architecture.spec.ts 的 450 行维护性上限内。
 */
import fs from 'node:fs';
import { createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { sha256File } from '../../infrastructure/sqlite-files';
import type { Logger } from '../../infrastructure/logger';

export interface MirrorResult {
  filename: string;
  target: string;
  fileSize: number;
  sha256: string;
}

/**
 * A-P2.1：把备份文件镜像复制到异地目录（网络共享/NAS/USB）。先写 .partial
 * 再 rename，中途失败不留半截文件；复制后 sha256 与源文件比对，不一致即
 * 删除 partial 并抛错（由 scheduler 捕获进告警，不阻塞主备份流程）。
 */
export async function mirrorBackupFile(
  source: string,
  mirrorDir: string,
): Promise<MirrorResult> {
  fs.mkdirSync(mirrorDir, { recursive: true });
  const target = path.join(mirrorDir, path.basename(source));
  const partial = `${target}.partial`;
  try {
    await pipeline(createReadStream(source), createWriteStream(partial));
    const sha256 = await sha256File(partial);
    const sourceSha = await sha256File(source);
    if (sha256 !== sourceSha) {
      throw new Error('mirror copy sha256 mismatch');
    }
    fs.renameSync(partial, target);
    return { filename: path.basename(source), target, fileSize: fs.statSync(target).size, sha256 };
  } catch (error) {
    try {
      fs.rmSync(partial, { force: true });
    } catch {
      // best effort: 保留原始错误
    }
    throw error;
  }
}

/**
 * A-P2.2：镜像目录独立保留策略。只清理文件名含 `backup-` 的正式备份
 * （.enc/.sqlite），按文件名时间戳排序保留最近 keep 份；删除失败仅记录
 * 日志不抛错（镜像清理失败不应影响主流程）。
 */
export function cleanupMirrorDir(
  mirrorDir: string,
  keep = 30,
  logger?: Logger,
): { kept: number; deleted: Array<string> } {
  const requested = Number.isFinite(Number(keep)) ? Math.floor(Number(keep)) : 30;
  const keepCount = requested < 1 ? 1 : requested > 365 ? 365 : requested;
  try {
    if (!fs.statSync(mirrorDir).isDirectory()) return { kept: 0, deleted: [] };
  } catch {
    return { kept: 0, deleted: [] };
  }
  const files = fs.readdirSync(mirrorDir)
    .filter((name) => (name.endsWith('.enc') || name.endsWith('.sqlite')) && name.includes('backup-'))
    .sort();
  const deleted: string[] = [];
  for (const name of files.slice(0, Math.max(0, files.length - keepCount))) {
    try {
      fs.rmSync(path.join(mirrorDir, name), { force: true });
      deleted.push(name);
    } catch (error) {
      logger?.warn('[backup] failed to delete mirror backup during cleanup', {
        filename: name,
        error: error instanceof Error ? error.message : error,
      });
    }
  }
  return { kept: files.length - deleted.length, deleted };
}
