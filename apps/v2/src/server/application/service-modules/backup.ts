import fs from 'node:fs';
import { createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { NotFoundError } from '../../infrastructure/errors';
import { removeSqliteSidecars, summarizeSqliteFile } from '../../infrastructure/sqlite-files';
import { BACKUP_MAGIC, backupEncryptionKey } from './common';

export interface BackupCreateOptions {
  type?: 'MANUAL' | 'AUTO' | 'RESTORE';
  operatorId?: string | null;
  operatorName?: string | null;
  encrypted?: boolean;
}

export class BackupService {
  constructor(
    private readonly db: Database.Database,
    private readonly dbPath: string,
    private readonly backupDir: string,
  ) {}

  list(): Array<Record<string, unknown>> {
    fs.mkdirSync(this.backupDir, { recursive: true });
    return fs.readdirSync(this.backupDir)
      .filter((name) => name.endsWith('.sqlite') || name.endsWith('.enc'))
      .filter((name) => !name.startsWith('.staged-'))
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
    const encrypted = options.encrypted ?? Boolean(process.env.V2_BACKUP_KEY);
    const base = `backup-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
    const filename = encrypted ? `${base}.enc` : `${base}.sqlite`;
    const tempPath = path.join(this.backupDir, `${base}.tmp`);
    const finalPath = path.join(this.backupDir, filename);
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
      null,
      new Date().toISOString(),
      new Date().toISOString(),
      filename,
      fileSize,
      options.type ?? 'MANUAL',
      options.operatorId ?? null,
      options.operatorName ?? null,
    );
    return { filename, fileSize, encrypted, type: options.type ?? 'MANUAL', message: 'Backup created' };
  }

  async verify(filename: string): Promise<Record<string, unknown>> {
    const file = this.safePath(filename);
    if (!fs.existsSync(file)) throw new NotFoundError('Backup file not found');
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

  async stageRestore(filename: string): Promise<Record<string, unknown>> {
    const verified = await this.verify(filename);
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
    fs.writeFileSync(markerPath, JSON.stringify({ stagedPath }), 'utf8');
    return {
      filename,
      stagedPath,
      backupSummary,
      currentSummary,
      message: 'Backup verified and staged. Restart the application to activate this restore.',
    };
  }

  cleanup(maxKeep = 30): { kept: number; deleted: Array<{ filename: string; fileSize: number }> } {
    const requested = Number.isFinite(Number(maxKeep)) ? Math.floor(Number(maxKeep)) : 30;
    const keep = requested < 1 ? 1 : requested > 365 ? 365 : requested;
    const files = this.list() as Array<{ filename: string; fileSize: number }>;
    const deleteFiles = files.slice(keep);
    const deleted: Array<{ filename: string; fileSize: number }> = [];
    for (const file of deleteFiles) {
      fs.unlinkSync(path.join(this.backupDir, file.filename));
      this.db.prepare('DELETE FROM BackupRecord WHERE filename = ?').run(file.filename);
      deleted.push({ filename: file.filename, fileSize: file.fileSize });
    }
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
