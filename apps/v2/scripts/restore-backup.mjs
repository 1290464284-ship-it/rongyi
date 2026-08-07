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

function decryptFile(sourcePath, targetPath) {
  const data = fs.readFileSync(sourcePath);
  if (data.length < BACKUP_MAGIC.length + 12 + 16) throw new Error('Encrypted backup file is too short');
  if (!data.subarray(0, BACKUP_MAGIC.length).equals(BACKUP_MAGIC)) {
    throw new Error('Encrypted backup header is invalid');
  }
  const iv = data.subarray(BACKUP_MAGIC.length, BACKUP_MAGIC.length + 12);
  const authTag = data.subarray(data.length - 16);
  const encrypted = data.subarray(BACKUP_MAGIC.length + 12, data.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', backupKey(), iv);
  decipher.setAuthTag(authTag);
  fs.writeFileSync(targetPath, Buffer.concat([decipher.update(encrypted), decipher.final()]));
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
  fs.unlinkSync(tempPath);
  throw new Error('Restore backup failed integrity check');
}

if (fs.existsSync(targetPath)) {
  const backupTarget = `${targetPath}.pre-restore-${Date.now()}`;
  fs.copyFileSync(targetPath, backupTarget);
  console.log(`Previous database preserved at ${backupTarget}`);
}
fs.copyFileSync(tempPath, targetPath);
fs.unlinkSync(tempPath);
console.log(`Restored ${backupPath} -> ${targetPath}`);
