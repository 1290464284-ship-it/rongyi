/**
 * 备份文件加解密（AES-256-GCM，带 BACKUP_MAGIC 头与 16 字节 auth tag）。
 * 独立模块：BackupService 只保留薄委托，使 backup.ts 保持在
 * architecture.spec.ts 的 450 行维护性上限内。
 */
import fs from 'node:fs';
import { createReadStream, createWriteStream } from 'node:fs';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { BACKUP_MAGIC, backupEncryptionKey } from './common';

export async function encryptBackupFile(sourcePath: string, targetPath: string): Promise<void> {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', backupEncryptionKey(), iv);
  const output = createWriteStream(targetPath);
  output.write(Buffer.concat([BACKUP_MAGIC, iv]));
  await pipeline(createReadStream(sourcePath), cipher, output);
  await fs.promises.appendFile(targetPath, cipher.getAuthTag());
}

export async function decryptBackupFile(sourcePath: string, targetPath: string): Promise<void> {
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
