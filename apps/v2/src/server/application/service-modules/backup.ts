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
import { removeSqliteSidecars, summarizeSqliteFile } from '../../infrastructure/sqlite-files';
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

export class BackupService {
  constructor(
    private readonly db: Database.Database,
    private readonly dbPath: string,
    private readonly backupDir: string,
  ) {}

  list(clinicId: string | null = null): Array<Record<string, unknown>> {
    fs.mkdirSync(this.backupDir, { recursive: true });
    const prefix = clinicPrefix(clinicId);
    return fs.readdirSync(this.backupDir)
      .filter((name) => name.endsWith('.sqlite') || name.endsWith('.enc'))
      .filter((name) => !name.startsWith('.staged-'))
      .filter((name) => name.startsWith(`${prefix}backup-`))
      .map((name) => {
        const stat = fs.statSync(path.join(this.backupDir, name));
        return {
          filename: name,
          fileSize: stat.size,
          createdAt: stat.mtime.toISOString(),
          encrypted: name.endsWith('.enc'),
        };
      })
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  async create(options: BackupCreateOptions = {}): Promise<Record<string, unknown>> {
    fs.mkdirSync(this.backupDir, { recursive: true });
    const allowPlaintext = process.env.NODE_ENV === 'test' || process.env.V2_ALLOW_PLAINTEXT_BACKUP === '1';
    const encrypted = options.encrypted ?? (Boolean(process.env.V2_BACKUP_KEY) || !allowPlaintext);
    if (!encrypted && !allowPlaintext) {
      throw new Error('Refusing to create plaintext backup: set V2_BACKUP_KEY or V2_ALLOW_PLAINTEXT_BACKUP=1');
    }
    const base = `${clinicPrefix(options.clinicId)}backup-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
    const filename = encrypted ? `${base}.enc` : `${base}.sqlite`;
    const tempPath = path.join(this.backupDir, `${base}.tmp`);
    const finalPath = path.join(this.backupDir, filename);
    try {
      await this.db.backup(tempPath);
      if (encrypted) {
        await this.encryptFile(tempPath, finalPath);
        fs.unlinkSync(tempPath);
      } else {
        fs.renameSync(tempPath, finalPath);
      }
      const fileSize = fs.statSync(finalPath).size;
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
      return { filename, fileSize, encrypted, type: options.type ?? 'MANUAL', message: 'Backup created' };
    } finally {
      if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true });
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
      if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    }
  }

  async stageRestore(filename: string, clinicId: string | null = null): Promise<Record<string, unknown>> {
    const verified = await this.verify(filename, clinicId);
    if (verified.integrity !== 'ok') throw new Error('Backup integrity check failed before restore');
    const source = this.safePath(filename);
    const stagedPath = path.join(
      this.backupDir,
      `.staged-${path.basename(filename).replace(/\.[^.]+$/, '')}-${Date.now()}.sqlite`,
    );
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
    const markerPath = path.join(path.dirname(this.dbPath), '.restore-pending.json');
    // S-L5：marker 写入 HMAC 签名（V2_BACKUP_KEY 派生），restore-apply 侧校验后
    // 才执行恢复，防止本地 marker 被篡改指向任意文件。
    fs.writeFileSync(markerPath, JSON.stringify({ stagedPath, sig: signRestoreMarker(stagedPath) }), 'utf8');
    return {
      filename,
      stagedPath,
      backupSummary,
      currentSummary,
      staged: true,
      message: 'Backup verified and staged. Restart the application to activate this restore.',
    };
  }

  cleanup(maxKeep = 30, clinicId: string | null = null): { kept: number; deleted: Array<{ filename: string; fileSize: number }> } {
    const requested = Number.isFinite(Number(maxKeep)) ? Math.floor(Number(maxKeep)) : 30;
    const keep = requested < 1 ? 1 : requested > 365 ? 365 : requested;
    const files = this.list(clinicId) as Array<{ filename: string; fileSize: number }>;
    const deleteFiles = files.slice(keep);
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
        console.warn('[backup] failed to delete backup file during cleanup:', file.filename, error instanceof Error ? error.message : error);
      }
    }
    if (removedFilenames.length > 0) {
      const deleteTxn = this.db.transaction((names: string[]) => {
        const stmt = this.db.prepare('DELETE FROM BackupRecord WHERE filename = ?');
        for (const name of names) stmt.run(name);
      });
      deleteTxn(removedFilenames);
    }
    // P2-11：staged 中间文件（还原验证暂存）只保留短期，避免占用磁盘；
    // 数量上限 3 份，超出即清理最旧的。
    const stagedEntries = fs.readdirSync(this.backupDir)
      .filter((name) => name.startsWith('.staged-') || name.endsWith('.tmp'))
      .map((name) => ({ name, mtimeMs: fs.statSync(path.join(this.backupDir, name)).mtimeMs }))
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    const MAX_STAGED = 3;
    const STAGED_TTL_MS = 6 * 60 * 60 * 1000; // 6 小时
    const nowMs = Date.now();
    stagedEntries.forEach((entry, index) => {
      const expired = nowMs - entry.mtimeMs > STAGED_TTL_MS;
      const overLimit = index >= MAX_STAGED;
      if (expired || overLimit) fs.rmSync(path.join(this.backupDir, entry.name), { force: true });
    });
    return {
      kept: Math.min(files.length, keep),
      deleted,
    };
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
