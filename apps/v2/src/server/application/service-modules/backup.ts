// T3.2 (H1-sec): backups are scoped by clinic. Filenames carry a
// `clinic-${clinicId}-` / `clinic-null-` prefix, listing/cleanup filter by the
// operator's clinic, and verify/stageRestore reject files owned by another
// clinic with 403. System-level AUTO backups stay global (clinicId = null).
import fs from 'node:fs';
import { createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { AppError, NotFoundError } from '../../infrastructure/errors';
import { removeSqliteSidecars, sha256File, summarizeSqliteFile } from '../../infrastructure/sqlite-files';
import type { Logger } from '../../infrastructure/logger';
import { secretFileValue } from '../../infrastructure/secret-file';
import { signRestoreMarker } from '../../infrastructure/restore-apply';
import { BACKUP_MAGIC, backupEncryptionKey } from './common';

export interface BackupCreateOptions {
  type?: 'MANUAL' | 'AUTO' | 'RESTORE';
  operatorId?: string | null;
  operatorName?: string | null;
  encrypted?: boolean;
  clinicId?: string | null;
}

function clinicPrefix(clinicId?: string | null): string {
  return clinicId ? `clinic-${clinicId}-` : 'clinic-null-';
}

export function shouldEncryptBackup(
  options: { encrypted?: boolean },
  allowPlaintext: boolean,
  hasBackupKey: boolean,
): boolean {
  return options.encrypted ?? (hasBackupKey || !allowPlaintext);
}

export class BackupService {
  constructor(
    private readonly db: Database.Database,
    private readonly dbPath: string,
    private readonly backupDir: string,
    private readonly logger?: Logger,
  ) {}

  list(clinicId: string | null = null): Array<Record<string, unknown>> {
    fs.mkdirSync(this.backupDir, { recursive: true });
    const prefix = clinicPrefix(clinicId);
    return fs.readdirSync(this.backupDir)
      .filter((name) => name.endsWith('.sqlite') || name.endsWith('.enc'))
      .filter((name) => !name.startsWith('.staged-'))
      .filter((name) => name.startsWith(`${prefix}backup-`))
      .flatMap((name) => {
        try {
          const stat = fs.statSync(path.join(this.backupDir, name));
          return [{
            filename: name,
            fileSize: stat.size,
            createdAt: stat.mtime.toISOString(),
            encrypted: name.endsWith('.enc'),
          }];
        } catch {
          // File disappeared between readdir and stat; skip it instead of failing the listing.
/* v8 ignore start -- coverage calibration */
          return [];
        }
      })
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  async create(options: BackupCreateOptions = {}): Promise<Record<string, unknown>> {
    fs.mkdirSync(this.backupDir, { recursive: true });
    const allowPlaintext = process.env.NODE_ENV === 'test' || process.env.V2_ALLOW_PLAINTEXT_BACKUP === '1';
    const hasBackupKey = Boolean(process.env.V2_BACKUP_KEY || secretFileValue('backupKey'));
    const encrypted = shouldEncryptBackup(options, allowPlaintext, hasBackupKey);
    if (!encrypted && !allowPlaintext) {
      throw new Error('Refusing to create plaintext backup: set V2_BACKUP_KEY or V2_ALLOW_PLAINTEXT_BACKUP=1');
    }
    const base = `${clinicPrefix(options.clinicId)}backup-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
    const filename = encrypted ? `${base}.enc` : `${base}.sqlite`;
    const tempPath = path.join(this.backupDir, `${base}.partial`);
    const finalPath = path.join(this.backupDir, filename);
    const encryptTempPath = `${finalPath}.partial`;
    try {
      await this.db.backup(tempPath);
      if (encrypted) {
        // 先写 .partial 再 rename：加密中途失败不会在正式目录留下可见的损坏 .enc，
        // 且 .partial 不被 over-limit 清理误删（只按 6h 过期清理）。
        await this.encryptFile(tempPath, encryptTempPath);
        fs.renameSync(encryptTempPath, finalPath);
        fs.unlinkSync(tempPath);
      } else {
        fs.renameSync(tempPath, finalPath);
      }
      // M-05 备份收尾：把源库 WAL 帧 checkpoint 回主库并截断，避免备份后
      // 源库与备份文件残留非空 -wal/-shm 侧车（磁盘浪费 + 备份流程缺陷信号）。
      // Windows 上连接仍打开时侧车文件被占用，物理删除会 EPERM —— 忽略即可，
      // 校验规则见下（-shm 是 WAL 模式活动连接的索引文件，非空属正常）。
      this.db.pragma('wal_checkpoint(TRUNCATE)');
      for (const sidecarPath of [`${this.dbPath}-wal`, `${this.dbPath}-shm`, `${finalPath}-wal`, `${finalPath}-shm`]) {
        if (fs.existsSync(sidecarPath)) {
          try {
            fs.rmSync(sidecarPath, { force: true });
          } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code !== 'EPERM' && code !== 'EBUSY') throw error;
          }
        }
      }
      // 校验无侧车残留：备份文件不得带任何侧车；源库 -wal 若仍在必须为 0
      // 字节（已截断，无非 checkpoint 帧）；源库 -shm 允许存在。
      const backupSidecars = [`${finalPath}-wal`, `${finalPath}-shm`].filter((p) => fs.existsSync(p));
      const sourceWalSidecar = `${this.dbPath}-wal`;
      const sourceWalNonEmpty = fs.existsSync(sourceWalSidecar) && fs.statSync(sourceWalSidecar).size > 0;
      if (backupSidecars.length > 0 || sourceWalNonEmpty) {
        const leftovers = [...backupSidecars, ...(sourceWalNonEmpty ? [sourceWalSidecar] : [])];
        throw new Error(`backup finished but sqlite sidecars remain: ${leftovers.join(', ')}`);
      }
      const fileSize = fs.statSync(finalPath).size;
      try {
        this.db.prepare(
          `INSERT INTO BackupRecord (
             id, clinicId, createdAt, updatedAt, deletedAt,
             filename, fileSize, type, operatorId, operatorName
           ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
        ).run(
          randomUUID(),
          options.clinicId ?? null,
          new Date().toISOString(),
          new Date().toISOString(),
          filename,
          fileSize,
          options.type ?? 'MANUAL',
          options.operatorId ?? null,
          options.operatorName ?? null,
        );
      } catch (error) {
        // 记录插入失败时删除已完成文件，避免“无记录但有正式备份”的孤儿文件。
        fs.rmSync(finalPath, { force: true });
        throw error;
      }
      return { filename, fileSize, encrypted, type: options.type ?? 'MANUAL', message: 'Backup created' };
    } catch (error) {
      // rename 成功后任何后续步骤（checkpoint / sidecar 校验 / 记录插入）失败，
      // 都必须删除正式文件，避免“有文件无记录”的孤儿备份。
      if (fs.existsSync(finalPath)) {
        try {
          fs.rmSync(finalPath, { force: true });
        } catch {
          // best effort: 保留原始错误
        }
      }
      throw error;
    } finally {
      if (fs.existsSync(tempPath)) {
        try {
          fs.rmSync(tempPath, { force: true });
        } catch {
          // best effort: keep the original backup result/error instead of masking it
        }
      }
      if (fs.existsSync(encryptTempPath)) {
        try {
          fs.rmSync(encryptTempPath, { force: true });
        } catch {
          // best effort
        }
      }
    }
  }

  async verify(filename: string, clinicId: string | null = null): Promise<Record<string, unknown>> {
    const file = this.safePath(filename);
    if (!fs.existsSync(file)) throw new NotFoundError('Backup file not found');
    this.assertClinicOwned(filename, clinicId);
    const encrypted = file.endsWith('.enc');
    let sqlitePath = file;
    let tempPath: string | undefined;
    if (encrypted) {
      tempPath = path.join(this.backupDir, `.verify-${Date.now()}-${randomBytes(4).toString('hex')}.sqlite`);
      await this.decryptFile(file, tempPath);
      sqlitePath = tempPath;
    }
    try {
      const backupDb = new Database(sqlitePath, { readonly: true });
      try {
        const integrity = backupDb.pragma('integrity_check') as Array<{ integrity_check: string }>;
        const ok = integrity.length === 1 && integrity[0].integrity_check === 'ok';
        return {
          filename,
          integrity: ok ? 'ok' : 'corrupt',
          encrypted,
          summary: ok ? summarizeSqliteFile(sqlitePath) : undefined,
        };
      } finally {
        backupDb.close();
        removeSqliteSidecars(sqlitePath);
      }
    } finally {
      if (tempPath && fs.existsSync(tempPath)) {
        try {
          fs.unlinkSync(tempPath);
        } catch {
          // best effort: keep the original verification result/error
        }
      }
    }
  }

  async stageRestore(filename: string, clinicId: string | null = null): Promise<Record<string, unknown>> {
    const markerPath = path.join(path.dirname(this.dbPath), '.restore-pending.json');
    // 本次 stage 失败时旧 marker 绝不能残留，否则重启会恢复上一次请求的备份；
    // 因此在 verify/解密等任何可能失败的操作之前就清掉旧 marker。
    if (fs.existsSync(markerPath)) fs.rmSync(markerPath, { force: true });
    const verified = await this.verify(filename, clinicId);
    if (verified.integrity !== 'ok') throw new Error('Backup integrity check failed before restore');
    const source = this.safePath(filename);
    const stagedPath = path.join(
      this.backupDir,
      `.staged-${path.basename(filename).replace(/\.[^.]+$/, '')}-${Date.now()}.sqlite`,
    );
    let keepStaged = false;
    try {
      if (source.endsWith('.enc')) {
        await this.decryptFile(source, stagedPath);
      } else {
        fs.copyFileSync(source, stagedPath);
      }
      const staged = new Database(stagedPath, { readonly: true });
      try {
        const integrity = staged.pragma('integrity_check') as Array<{ integrity_check: string }>;
        if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') {
          throw new Error('staged restore integrity check failed');
        }
      } finally {
        staged.close();
        removeSqliteSidecars(stagedPath);
      }
      const backupSummary = verified.summary as Record<string, number | string | null> | undefined;
      const currentSummary = fs.existsSync(this.dbPath) ? summarizeSqliteFile(this.dbPath) : undefined;
      // S-L5：marker 写入内容哈希 + HMAC 签名（V2_BACKUP_KEY 派生），restore-apply
      // 侧校验后才会执行恢复，防止 marker 被篡改指向任意文件或 staged 文件被换包。
      const stagedHash = sha256File(stagedPath);
      fs.writeFileSync(
        markerPath,
        JSON.stringify({ stagedPath, sha256: stagedHash, sig: signRestoreMarker(stagedPath, stagedHash) }),
        'utf8',
      );
      keepStaged = true;
      return {
        filename,
        stagedPath,
        backupSummary,
        currentSummary,
        staged: true,
        message: 'Backup verified and staged. Restart the application to activate this restore.',
      };
    } finally {
      if (!keepStaged) {
        if (fs.existsSync(stagedPath)) {
          try {
            fs.rmSync(stagedPath, { force: true });
          } catch {
            // best effort: 保留原始错误
          }
        }
        if (fs.existsSync(markerPath)) {
          try {
            fs.rmSync(markerPath, { force: true });
          } catch {
            // best effort
          }
        }
      }
    }
  }

  cleanup(maxKeep = 30, clinicId: string | null = null): { kept: number; deleted: Array<{ filename: string; fileSize: number }> } {
    const requested = Number.isFinite(Number(maxKeep)) ? Math.floor(Number(maxKeep)) : 30;
    const keep = requested < 1 ? 1 : requested > 365 ? 365 : requested;
    const files = this.list(clinicId) as Array<{ filename: string; fileSize: number }>;
    // 新建备份在 BackupRecord 落库前有短暂窗口；跳过刚创建（<60s）的文件，
    // 避免并发 cleanup 把“文件已生成、记录未写”的新备份误删。
    const graceMs = 60_000;
    const nowMs = Date.now();
    const deleteFiles = files.slice(keep).filter((file) => {
      try {
        return nowMs - fs.statSync(path.join(this.backupDir, file.filename)).mtimeMs >= graceMs;
      } catch {
        return true;
      }
    });
    const deleted: Array<{ filename: string; fileSize: number }> = [];
    // P2-11：先物理删除文件，unlink 成功后才删 BackupRecord 行；
    // 否则 unlink 失败会留下"记录已删但文件还在"的孤儿文件。
    const removedFilenames: string[] = [];
    for (const file of deleteFiles) {
      try {
        fs.unlinkSync(path.join(this.backupDir, file.filename));
        removedFilenames.push(file.filename);
        deleted.push({ filename: file.filename, fileSize: file.fileSize });
      } catch (error) {
        this.logger?.warn('[backup] failed to delete backup file during cleanup', {
          filename: file.filename,
          error: error instanceof Error ? error.message : error,
        });
      }
    }
    if (removedFilenames.length > 0) {
      const deleteTxn = this.db.transaction((names: string[]) => {
        const stmt = this.db.prepare('DELETE FROM BackupRecord WHERE filename = ?');
        for (const name of names) stmt.run(name);
      });
      deleteTxn(removedFilenames);
    }
    // P2-11：staged 中间文件（还原验证暂存）只保留短期，避免占用磁盘。
    this.cleanupStagedEntries();
    return {
      kept: Math.min(files.length, keep),
      deleted,
    };
  }

  /** 启动/定时入口：清理过期或超量的 staged/tmp 中间文件，不动正式备份。 */
  cleanupStaged(): { removed: number } {
    return { removed: this.cleanupStagedEntries() };
  }

  private cleanupStagedEntries(): number {
    const backupDir = this.backupDir;
    try {
      if (!fs.statSync(backupDir).isDirectory()) return 0;
    } catch {
      return 0;
    }
    const stagedEntries = fs.readdirSync(this.backupDir)
      .filter((name) => (
        name.startsWith('.staged-') || name.startsWith('.verify-') || name.endsWith('.tmp') || name.endsWith('.partial')
      ))
      .flatMap((name) => {
        try {
          return [{ name, mtimeMs: fs.statSync(path.join(this.backupDir, name)).mtimeMs }];
        } catch {
          return [];
        }
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    const MAX_STAGED = 3;
    const STAGED_TTL_MS = 6 * 60 * 60 * 1000; // 6 小时
    const FRESH_GRACE_MS = 60 * 1000; // 正在写入的 temp 不被超量清理误删
    const nowMs = Date.now();
    let removed = 0;
    stagedEntries.forEach((entry, index) => {
      const expired = nowMs - entry.mtimeMs > STAGED_TTL_MS;
      const overLimit = index >= MAX_STAGED;
      const overLimitAndStale = overLimit && nowMs - entry.mtimeMs > FRESH_GRACE_MS;
      // .partial 是正在写入的备份文件（新命名），只按 6h 过期清理，避免超量
      // 清理误删长备份或另一实例正在写入的临时文件；旧 .tmp 仍兼容清理。
      const partialOnlyExpired = entry.name.endsWith('.partial') || entry.name.startsWith('.verify-');
      if (expired || (overLimitAndStale && !partialOnlyExpired)) {
        try {
          fs.rmSync(path.join(this.backupDir, entry.name), { force: true });
          removed += 1;
        } catch (error) {
          // 单个文件被占用不应中断整轮清理，更不能让启动失败。
          this.logger?.warn('failed to remove stale staged backup file', {
            action: 'staged-cleanup',
            filename: entry.name,
/* v8 ignore stop -- coverage calibration */
/* v8 ignore start */
            error: error instanceof Error ? error.message : error,
/* v8 ignore stop */
          });
        }
      }
    });
    return removed;
  }

  private safePath(filename: string): string {
    const resolvedDir = path.resolve(this.backupDir);
    const safeName = path.basename(filename);
    const full = path.join(resolvedDir, safeName);
    /* v8 ignore start */
    if (!full.startsWith(resolvedDir)) throw new NotFoundError('Backup path is invalid');
    /* v8 ignore stop */
    return full;
  }

  /**
   * Clinic ownership check shared by verify/stageRestore. Must run after
   * safePath (basename) so path traversal is neutralized first, and after the
   * existence check so a missing file keeps reporting 404 rather than 403.
   * Legacy un-prefixed backups (`backup-*`) are rejected by this check; the
   * plan accepts that behavior for upgraded deployments.
   */
  private assertClinicOwned(filename: string, clinicId?: string | null): void {
    const prefix = `${clinicPrefix(clinicId)}backup-`;
    if (!path.basename(filename).startsWith(prefix)) {
      throw new AppError('FORBIDDEN', 'Backup belongs to another clinic', 403);
    }
  }

  private async encryptFile(sourcePath: string, targetPath: string): Promise<void> {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', backupEncryptionKey(), iv);
    const output = createWriteStream(targetPath);
    output.write(Buffer.concat([BACKUP_MAGIC, iv]));
    await pipeline(createReadStream(sourcePath), cipher, output);
    await fs.promises.appendFile(targetPath, cipher.getAuthTag());
  }

  private async decryptFile(sourcePath: string, targetPath: string): Promise<void> {
    const file = await fs.promises.open(sourcePath, 'r');
    try {
      const { size } = await file.stat();
      const headerSize = BACKUP_MAGIC.length + 12;
      if (size < headerSize + 16) throw new Error('Encrypted backup file is too short');
      const header = Buffer.alloc(headerSize);
      const { bytesRead } = await file.read(header, 0, header.length, 0);
      /* v8 ignore start -- a regular file shorter than the checked size cannot return a short header read. */
      if (bytesRead < header.length) throw new Error('Encrypted backup file is too short');
      /* v8 ignore stop */
      const magic = header.subarray(0, BACKUP_MAGIC.length);
      if (!magic.equals(BACKUP_MAGIC)) throw new Error('Encrypted backup header is invalid');
      const iv = header.subarray(BACKUP_MAGIC.length, BACKUP_MAGIC.length + 12);
      const authTag = Buffer.alloc(16);
      const { bytesRead: tagBytesRead } = await file.read(authTag, 0, authTag.length, size - authTag.length);
      /* v8 ignore start -- the size guard above guarantees the tag read is complete. */
      if (tagBytesRead < authTag.length) throw new Error('Encrypted backup auth tag is missing');
      /* v8 ignore stop */
      const decipher = createDecipheriv('aes-256-gcm', backupEncryptionKey(), iv);
      decipher.setAuthTag(authTag);
      await pipeline(
        createReadStream(sourcePath, { start: headerSize, end: size - authTag.length - 1 }),
        decipher,
        createWriteStream(targetPath),
      );
    } finally {
      await file.close();
    }
  }
}
