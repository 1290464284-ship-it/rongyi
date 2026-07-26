import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Logger } from '@nestjs/common';
import { getDataDir } from '../../../db/paths';

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
 * On first launch with no key configured, a new key is generated, written to
 * a restricted file, and the process REFUSES TO START until ENCRYPTION_KEY is set.
 */

/** Typed error for encryption/decryption failures. */
export class EncryptionError extends Error {
  constructor(
    message: string,
    public readonly code: 'E_NULL_INPUT' | 'E_DECRYPT_FAILED' | 'E_KEY_MISSING' | 'E_KEY_WRITE_FAILED',
  ) {
    super(message);
    this.name = 'EncryptionError';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, EncryptionError);
    }
  }
}

/** Optional legacy key for decrypting data encrypted with a previous key */
let _legacyKey: Buffer | null = null;
let _key: Buffer | null = null;

export function setLegacyEncryptionKey(key: string): void {
  if (key.length === 64 && /^[a-f0-9]{64}$/i.test(key)) {
    _legacyKey = Buffer.from(key, 'hex');
  } else {
    throw new EncryptionError('Legacy encryption key must be a 64-character hex string', 'E_KEY_MISSING');
  }
}

/** Try the active key first, then the legacy key. Returns {plaintext, needsReencrypt} */
function decryptWithFallback(ciphertext: string): { plaintext: string; needsReencrypt: boolean } {
  if (!ciphertext?.includes(':')) {
    throw new EncryptionError('Invalid ciphertext format', 'E_DECRYPT_FAILED');
  }

  const parts = ciphertext.split(':');
  if (parts.length !== 3) {
    throw new EncryptionError(
      `Invalid ciphertext format: expected 3 parts, got ${parts.length}`,
      'E_DECRYPT_FAILED',
    );
  }
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = Buffer.from(parts[2], 'hex');

  const tryKey = (key: Buffer): string | null => {
    try {
      const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH } as crypto.CipherGCMOptions);
      (decipher).setAuthTag(authTag);
      return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    } catch (err: unknown) {
      logger.debug(`解密失败: ${(err as Error).message}`);
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

  throw new EncryptionError(
    `Decryption failed: active key${(_legacyKey ? ' and legacy key' : '')} did not match`,
    'E_DECRYPT_FAILED',
  );
}

function getEncryptionKey(): Buffer {
  if (_key) return _key;

  // Check .encryption-key file first (auto-generated safety net)
  let envKey = process.env.ENCRYPTION_KEY;
  if (!envKey) {
    try {
      const keyFile = path.join(getDataDir(), '.encryption-key');
      if (fs.existsSync(keyFile)) {
        envKey = fs.readFileSync(keyFile, 'utf8').trim();
        logger.debug('从 .encryption-key 文件加载密钥，建议复制到 .env');
      }
    } catch (readErr) {
      logger.debug(`读取 .encryption-key 文件失败: ${(readErr as Error).message}`);
    }
  }

  if (envKey && envKey.length >= 32) {
    if (envKey.length === 64 && /^[a-f0-9]{64}$/i.test(envKey)) {
      _key = Buffer.from(envKey, 'hex');
    } else {
      _key = crypto.createHash('sha256').update(envKey).digest();
    }
    return _key;
  }

  // No key configured — generate and persist securely, then abort
  const newKeyHex = crypto.randomBytes(32).toString('hex');
  try {
    const keyFilePath = path.join(getDataDir(), '.encryption-key');
    fs.writeFileSync(keyFilePath, newKeyHex + '\n', { mode: 0o600 });
    fs.chmodSync(keyFilePath, 0o600);
    logger.warn(
      `未配置 ENCRYPTION_KEY，已生成新密钥并保存到 ${keyFilePath}，请将其设置到环境变量后重新启动`,
    );
  } catch (writeErr) {
    logger.error(`保存 .encryption-key 文件失败: ${(writeErr as Error).message}`);
  }
  process.exit(1);
}

/**
 * Encrypt plaintext → hex-encoded ciphertext (IV + authTag + encrypted).
 * Output format: `<iv_hex>:<authTag_hex>:<ciphertext_hex>`
 *
 * Throws EncryptionError for null/undefined input.
 */
export function encryptField(plaintext: string | null | undefined): string | null {
  if (plaintext === null || plaintext === undefined) {
    throw new EncryptionError('Cannot encrypt null or undefined value', 'E_NULL_INPUT');
  }
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH } as crypto.CipherGCMOptions);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = (cipher).getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt hex-encoded ciphertext → plaintext.
 * Tries active key first, then legacy key (if configured via setLegacyEncryptionKey).
 * If decrypted with legacy key, returns the plaintext (caller should re-encrypt).
 *
 * Returns null for null/undefined input.
 * Throws EncryptionError when ciphertext is malformed or no key can decrypt it.
 */
export function decryptField(ciphertext: string | null | undefined): string | null {
  if (ciphertext === null || ciphertext === undefined) {
    return null;
  }
  const result = decryptWithFallback(ciphertext);
  return result.plaintext;
}

/**
 * Decrypt + detect if the data needs re-encryption (was encrypted with legacy key).
 *
 * Returns { plaintext: null, needsReencrypt: false } for null/undefined input.
 * Throws EncryptionError when ciphertext is malformed or no key can decrypt it.
 */
export function decryptFieldWithFlag(ciphertext: string | null | undefined): { plaintext: string | null; needsReencrypt: boolean } {
  if (ciphertext === null || ciphertext === undefined) {
    return { plaintext: null, needsReencrypt: false };
  }
  return decryptWithFallback(ciphertext);
}

// ===== 备份文件加密/解密 =====
const BACKUP_MAGIC = Buffer.from('DBAK');
const BACKUP_VERSION = 1;

/** Encrypt a Buffer (for backup files). Returns Buffer with magic header. */
export function encryptBuffer(data: Buffer): Buffer {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH } as crypto.CipherGCMOptions);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const authTag = (cipher).getAuthTag();
  // Format: magic(4) + version(1) + iv(12) + authTag(16) + ciphertext
  return Buffer.concat([BACKUP_MAGIC, Buffer.from([BACKUP_VERSION]), iv, authTag, encrypted]);
}

/** Check if a Buffer is encrypted (has DBAK magic header) */
export function isEncryptedBuffer(data: Buffer): boolean {
  return data.length >= 5 && Buffer.from(data.subarray(0, 4)).equals(BACKUP_MAGIC);
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
  const iv = Buffer.from(data.subarray(5, 17));
  const authTag = Buffer.from(data.subarray(17, 33));
  const encrypted = Buffer.from(data.subarray(33));
  try {
    const key = getEncryptionKey();
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH } as crypto.CipherGCMOptions);
    (decipher).setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  } catch (err: unknown) {
    throw new EncryptionError(`备份解密失败: ${(err as Error).message}`, 'E_DECRYPT_FAILED');
  }
}

