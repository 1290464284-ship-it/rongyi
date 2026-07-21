import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '@nestjs/common';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const logger = new Logger('Encryption');

/**
 * Get the encryption key from environment variable ENCRYPTION_KEY.
 *
 * IMPORTANT: This key MUST be set before any data is encrypted. If you start
 * the server without ENCRYPTION_KEY, write encrypted data, then restart
 * without the same key, all encrypted fields become permanently unreadable.
 *
 * To generate a key: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 * Set it in .env: ENCRYPTION_KEY=<the-64-char-hex-key>
 *
 * On first launch with no key configured, a new key is generated, printed to
 * stderr, and the process REFUSES TO START until ENCRYPTION_KEY is set.
 */

/** Optional legacy key for decrypting data encrypted with a previous key */
let _legacyKey: Buffer | null = null;
let _key: Buffer | null = null;

export function setLegacyEncryptionKey(key: string): void {
  if (key.length === 64 && /^[a-f0-9]{64}$/i.test(key)) {
    _legacyKey = Buffer.from(key, 'hex');
  } else {
    _legacyKey = crypto.createHash('sha256').update(key).digest();
  }
}

/** Try the active key first, then the legacy key. Returns {plaintext, needsReencrypt} */
function decryptWithFallback(ciphertext: string): { plaintext: string | null; needsReencrypt: boolean } | null {
  if (!ciphertext || !ciphertext.includes(':')) return null;

  const parts = ciphertext.split(':');
  if (parts.length !== 3) return null;
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = Buffer.from(parts[2], 'hex');

  const tryKey = (key: Buffer): string | null => {
    try {
      const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH } as any);
      (decipher as any).setAuthTag(authTag);
      return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    } catch (e) {
      logger.debug(`解密失败: ${(e as Error).message}`);
      return null;
    }
  };

  const activeResult = tryKey(getEncryptionKey());
  if (activeResult !== null) {
    return { plaintext: activeResult, needsReencrypt: false };
  }

  if (_legacyKey) {
    const legacyResult = tryKey(_legacyKey);
    if (legacyResult !== null) {
      return { plaintext: legacyResult, needsReencrypt: true };
    }
  }

  return null;
}

function getEncryptionKey(): Buffer {
  if (_key) return _key;

  // Check .encryption-key file first (auto-generated safety net)
  let envKey = process.env.ENCRYPTION_KEY;
  if (!envKey) {
    try {
      const keyFile = path.join(process.cwd(), '.encryption-key');
      if (fs.existsSync(keyFile)) {
        envKey = fs.readFileSync(keyFile, 'utf8').trim();
        logger.warn('从 .encryption-key 文件加载密钥，建议复制到 .env');
      }
    } catch (readErr) {
      logger.warn(`读取 .encryption-key 文件失败: ${(readErr as Error).message}`);
    }
  }

  if (envKey && envKey.length >= 12) {
    if (envKey.length === 64 && /^[a-f0-9]{64}$/i.test(envKey)) {
      _key = Buffer.from(envKey, 'hex');
    } else {
      _key = crypto.createHash('sha256').update(envKey).digest();
    }
    return _key;
  }

  // No key configured — abort
  const newKeyHex = crypto.randomBytes(32).toString('hex');
  const msg = [
    '',
    '========================================',
    '严重错误: ENCRYPTION_KEY 未配置！',
    '',
    '已为您生成一个新的加密密钥:',
    `  ENCRYPTION_KEY=${newKeyHex}`,
    '',
    '请将上述行添加到 .env 文件后重新启动。',
    '如果不保存此密钥，已有的加密数据将永久无法解密。',
    '========================================',
    '',
  ].join('\n');
  logger.error(msg);
  try {
    const keyFilePath = path.join(process.cwd(), '.encryption-key');
    // P1 修复（密钥文件无权限保护）：mode 0o600 仅属主可读写
    fs.writeFileSync(keyFilePath, newKeyHex + '\n', { mode: 0o600 });
    logger.error(`密钥已保存到 ${keyFilePath}，请复制到 .env 文件中`);
  } catch (writeErr) {
    logger.error(`保存 .encryption-key 文件失败: ${(writeErr as Error).message}`);
  }
  process.exit(1);
}

/**
 * Encrypt plaintext → hex-encoded ciphertext (IV + authTag + encrypted).
 * Output format: `<iv_hex>:<authTag_hex>:<ciphertext_hex>`
 */
export function encryptField(plaintext: string | null | undefined): string | null {
  if (!plaintext) return null;
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH } as any);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = (cipher as any).getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt hex-encoded ciphertext → plaintext.
 * Tries active key first, then legacy key (if configured via LEGACY_ENCRYPTION_KEY env var).
 * If decrypted with legacy key, returns the plaintext (caller should re-encrypt).
 *
 * Returns null for null/undefined input, or the raw ciphertext on total failure
 * (so that the UI shows garbage rather than silently hiding data).
 */
export function decryptField(ciphertext: string | null | undefined): string | null {
  if (!ciphertext) return null;
  const result = decryptWithFallback(ciphertext);
  if (!result) {
    logger.warn(`解密失败，输入格式不正确或密钥不匹配: ${ciphertext?.substring(0, 30)}...`);
    return null;
  }
  return result.plaintext;
}

/**
 * Decrypt + detect if the data needs re-encryption (was encrypted with legacy key).
 */
export function decryptFieldWithFlag(ciphertext: string | null | undefined): { plaintext: string | null; needsReencrypt: boolean } {
  if (!ciphertext) return { plaintext: null, needsReencrypt: false };
  const result = decryptWithFallback(ciphertext);
  if (!result) {
    logger.warn(`解密失败，输入格式不正确或密钥不匹配: ${ciphertext?.substring(0, 30)}...`);
    return { plaintext: null, needsReencrypt: false };
  }
  return result;
}

// ===== 备份文件加密/解密 =====
const BACKUP_MAGIC = Buffer.from('DBAK');
const BACKUP_VERSION = 1;

/** Encrypt a Buffer (for backup files). Returns Buffer with magic header. */
export function encryptBuffer(data: Buffer): Buffer {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH } as any);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const authTag = (cipher as any).getAuthTag();
  // Format: magic(4) + version(1) + iv(12) + authTag(16) + ciphertext
  return Buffer.concat([BACKUP_MAGIC, Buffer.from([BACKUP_VERSION]), iv, authTag, encrypted]);
}

/** Check if a Buffer is encrypted (has DBAK magic header) */
export function isEncryptedBuffer(data: Buffer): boolean {
  return data.length >= 5 && data.slice(0, 4).equals(BACKUP_MAGIC);
}

/** Decrypt a Buffer. Returns null if not encrypted or decryption fails. Call isEncryptedBuffer first. */
export function decryptBufferIfEncrypted(data: Buffer): Buffer | null {
  if (!isEncryptedBuffer(data)) return null;
  if (data.length < 33) return null;
  const version = data[4];
  if (version !== BACKUP_VERSION) {
    logger.error(`不支持的备份加密版本: ${version}`);
    return null;
  }
  const iv = data.slice(5, 17);
  const authTag = data.slice(17, 33);
  const encrypted = data.slice(33);
  try {
    const key = getEncryptionKey();
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH } as any);
    (decipher as any).setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  } catch (e) {
    logger.error(`备份解密失败: ${(e as Error).message}`);
    return null;
  }
}

/**
 * Batch re-encrypt all encrypted fields in the database from legacy to active key.
 * Call this after setting LEGACY_ENCRYPTION_KEY to migrate old data.
 */
export function migrateEncryptedData(dbService: any): { migrated: number; errors: number } {
  if (!_legacyKey) return { migrated: 0, errors: 0 };

  let migrated = 0;
  let errors = 0;

  const tables = [{ table: 'Patient', field: 'idCard' }];

  for (const { table, field } of tables) {
    try {
      const rows = dbService.prepare(
        `SELECT id, ${field} FROM ${table} WHERE ${field} IS NOT NULL AND ${field} != ''`
      ).all() as Array<{ id: string; [key: string]: string }>;

      for (const row of rows) {
        try {
          const result = decryptWithFallback(row[field]);
          if (result && result.needsReencrypt) {
            const newCiphertext = encryptField(result.plaintext);
            dbService.prepare(`UPDATE ${table} SET ${field} = ? WHERE id = ?`)
              .run(newCiphertext, row.id);
            migrated++;
          }
        } catch (e) {
          logger.warn(`迁移数据失败，行ID: ${row.id}, 错误: ${(e as Error).message}`);
          errors++;
        }
      }
    } catch (e) {
      logger.debug(`表 ${table} 可能不存在: ${(e as Error).message}`);
    }
  }

  return { migrated, errors };
}
