import * as fs from 'node:fs';
import * as path from 'node:path';
import { DbService } from '../../../db/db.service';
import { BusinessValidationException, BusinessNotFoundException } from '@common/errors';
import {
  isEncryptedBuffer,
  decryptBufferIfEncrypted,
  getBackupEncryptionKey,
  encryptBuffer,
} from '../../../common/utils/security/encryption';

// Re-export for consumers that need fine-grained encryption checks
export { isEncryptedBuffer };

// ─── Path Utilities ───────────────────────────────────────────────

/** 获取备份目录路径 */
export function getBackupDir(dbService: DbService): string {
  return path.join(path.dirname(dbService.db.name), 'backups');
}

/** 校验文件名不含路径穿越字符 */
export function validateBackupFilename(filename: string): void {
  if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
    throw new BusinessValidationException('非法的文件名');
  }
}

/** 解析并验证备份文件绝对路径不超出 backupDir */
export function resolveAndValidatePath(backupDir: string, filename: string): string {
  const backupPath = path.join(backupDir, filename);
  const resolvedDir = path.resolve(backupDir);
  const resolvedPath = path.resolve(backupPath);
  if (!resolvedPath.startsWith(resolvedDir + path.sep) && resolvedPath !== resolvedDir) {
    throw new BusinessValidationException('非法的文件路径');
  }
  return backupPath;
}

// ─── Encryption Utilities ─────────────────────────────────────────

/** 读取备份文件并自动解密（若已加密），返回明文 Buffer */
export function readAndDecryptBackup(filePath: string): Buffer {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path validated by caller via resolveAndValidatePath
  const fileData = fs.readFileSync(filePath);
  if (isEncryptedBuffer(fileData)) {
    const decrypted = decryptBufferIfEncrypted(fileData, getBackupEncryptionKey());
    if (!decrypted) {
      throw new BusinessValidationException(
        '备份文件解密失败，请检查 BACKUP_ENCRYPTION_KEY 或 ENCRYPTION_KEY 配置',
      );
    }
    return decrypted;
  }
  return fileData;
}

/** 加密并写入备份文件 */
export function encryptAndWriteBackup(filePath: string, plaintext: Buffer): void {
  const encrypted = encryptBuffer(plaintext, getBackupEncryptionKey());
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path validated by caller via resolveAndValidatePath
  fs.writeFileSync(filePath, encrypted, { mode: 0o600 });
}

// ─── Integrity Verification ──────────────────────────────────────

export interface IntegrityResult {
  ok: boolean;
  detail: string;
}

/** 对指定 SQLite 文件执行 PRAGMA integrity_check */
export function checkIntegrity(dbService: DbService, filePath: string): IntegrityResult {
  const testDb = dbService.openReadonly(filePath);
  try {
    const integrity = testDb.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    return { ok: integrity.integrity_check === 'ok', detail: integrity.integrity_check };
  } finally {
    testDb.close();
  }
}

/** 验证核心表可读，返回每张表的检查结果 */
export function verifyCoreTablesReadable(
  dbService: DbService,
  filePath: string,
): Array<{ table: string; ok: boolean; detail: string }> {
  const coreTables = ['User', 'Patient', 'Charge', 'Appointment', 'Visit'];
  const results: Array<{ table: string; ok: boolean; detail: string }> = [];
  const testDb = dbService.openReadonly(filePath);
  try {
    for (const table of coreTables) {
      try {
        const row = testDb.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get();
        results.push({ table, ok: true, detail: row ? 'readable' : 'empty' });
      } catch (err: unknown) {
        results.push({ table, ok: false, detail: err instanceof Error ? err.message : String(err) });
      }
    }
  } finally {
    testDb.close();
  }
  return results;
}

// ─── Record Lookup ───────────────────────────────────────────────

/** 按 ID 查询备份记录，未找到则抛 404 */
export function findBackupRecordById(
  dbService: DbService,
  id: string,
  clinicClause: string,
  clinicParams: unknown[],
): Record<string, unknown> {
  const record = dbService
    .prepare(`SELECT * FROM BackupRecord WHERE id = ?${clinicClause}`)
    .get(id, ...clinicParams) as Record<string, unknown> | undefined;
  if (!record) throw new BusinessNotFoundException('备份记录不存在');
  return record;
}
