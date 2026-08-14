import fs from 'node:fs';
import path from 'node:path';
import { createDecipheriv, createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const BACKUP_MAGIC = Buffer.from('DENTALV2ENC1');

function backupKey() {
  const key = process.env.V2_BACKUP_KEY;
  if (!key) throw new Error('V2_BACKUP_KEY is required to restore an encrypted backup');
  return createHash('sha256').update(key).digest();
}

function readFullySync(fd, buffer, position) {
  let offset = 0;
  while (offset < buffer.length) {
    const read = fs.readSync(fd, buffer, offset, buffer.length - offset, position + offset);
    if (read <= 0) throw new Error('Encrypted backup file is truncated');
    offset += read;
  }
}

function decryptFile(sourcePath, targetPath) {
  const fdIn = fs.openSync(sourcePath, 'r');
  const fdOut = fs.openSync(targetPath, 'w', 0o600);
  try {
    const header = Buffer.alloc(BACKUP_MAGIC.length + 12);
    readFullySync(fdIn, header, 0);
    if (!header.subarray(0, BACKUP_MAGIC.length).equals(BACKUP_MAGIC)) {
      throw new Error('Encrypted backup header is invalid');
    }
    const stat = fs.fstatSync(fdIn);
    if (stat.size < header.length + 16) throw new Error('Encrypted backup file is too short');
    const iv = header.subarray(BACKUP_MAGIC.length);
    const authTag = Buffer.alloc(16);
    readFullySync(fdIn, authTag, stat.size - 16);
    const decipher = createDecipheriv('aes-256-gcm', backupKey(), iv);
    decipher.setAuthTag(authTag);
    const totalEncrypted = stat.size - header.length - 16;
    const chunk = Buffer.alloc(1024 * 1024);
    let position = header.length;
    let remaining = totalEncrypted;
    while (remaining > 0) {
      const toRead = Math.min(chunk.length, remaining);
      const read = fs.readSync(fdIn, chunk, 0, toRead, position);
      if (read <= 0) throw new Error('Encrypted backup file is truncated');
      const decrypted = decipher.update(chunk.subarray(0, read));
      if (decrypted.length > 0) fs.writeSync(fdOut, decrypted);
      position += read;
      remaining -= read;
    }
    fs.writeSync(fdOut, decipher.final());
  } finally {
    fs.closeSync(fdIn);
    fs.closeSync(fdOut);
  }
}

const [backupArg, targetArg] = process.argv.slice(2);
if (!backupArg || !targetArg) {
  console.error('Usage: pnpm --filter @dental/v2 restore:backup <backup.sqlite|backup.sqlite.enc> <target.sqlite>');
  process.exit(1);
}

const backupPath = path.resolve(backupArg);
const targetPath = path.resolve(targetArg);
if (!fs.existsSync(backupPath)) {
  console.error(`Backup not found: ${backupPath}`);
  process.exit(1);
}

const tempPath = path.join(path.dirname(targetPath), `.restore-${Date.now()}.sqlite`);
try {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  if (backupPath.endsWith('.enc')) {
    decryptFile(backupPath, tempPath);
  } else {
    fs.copyFileSync(backupPath, tempPath);
  }

  const db = new Database(tempPath, { readonly: true });
  let integrityOk = false;
  try {
    const integrity = db.pragma('integrity_check');
    integrityOk = Array.isArray(integrity) && integrity.length === 1 && integrity[0].integrity_check === 'ok';
  } finally {
    db.close();
  }
  if (!integrityOk) {
    throw new Error('Restore backup failed integrity check');
  }

  if (fs.existsSync(targetPath)) {
    const backupTarget = `${targetPath}.pre-restore-${Date.now()}`;
    fs.copyFileSync(targetPath, backupTarget);
    console.log(`Previous database preserved at ${backupTarget}`);
  }
  fs.copyFileSync(tempPath, targetPath);
  console.log(`Restored ${backupPath} -> ${targetPath}`);
} finally {
  fs.rmSync(tempPath, { force: true });
}
