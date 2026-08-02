/* eslint-disable security/detect-non-literal-fs-filename -- 文件路径来自内部配置；TODO: 逐步修复 lint 问题 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { AppLogger } from '../../common/services/logger.service';

const MAGIC = Buffer.from('DENTAL_DB_ENC\0V1\n');
const MAGIC_LENGTH = MAGIC.length;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const ORIG_SIZE_LENGTH = 8;
const HEADER_HASH_LENGTH = 32;
const PBKDF2_ITERATIONS = 600_000;
const PBKDF2_DIGEST = 'sha512';
const KEY_LENGTH = 32;
const SALT2_LENGTH = 16;

const HEADER_FIXED_LENGTH =
  MAGIC_LENGTH + SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH + ORIG_SIZE_LENGTH;

const _logger = new AppLogger('FileCryptoEngine');

export const CryptoErrorCodes = {
  INVALID_DB_ENC_HEADER: 'INVALID_DB_ENC_HEADER',
  DB_ENC_TAMPERED: 'DB_ENC_TAMPERED',
  DB_ENC_AUTH_FAILED: 'DB_ENC_AUTH_FAILED',
} as const;

export type CryptoErrorCode = (typeof CryptoErrorCodes)[keyof typeof CryptoErrorCodes];

export class CryptoEngineError extends Error {
  constructor(
    message: string,
    public readonly code: CryptoErrorCode,
  ) {
    super(message);
    this.name = 'CryptoEngineError';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, CryptoEngineError);
    }
  }
}

const pbkdf2Async = promisify(crypto.pbkdf2);

export class FileCryptoEngine {
  private readonly logger = new AppLogger(FileCryptoEngine.name);

  constructor(
    private readonly password: string,
    private readonly salt?: Buffer,
  ) {}

  private async deriveKey(salt: Buffer): Promise<Buffer> {
    return pbkdf2Async(
      this.password,
      salt,
      PBKDF2_ITERATIONS,
      KEY_LENGTH,
      PBKDF2_DIGEST,
    );
  }

  async encryptFile(
    plainFilePath: string,
    encryptedFilePath: string,
  ): Promise<{
    sizeEncrypted: number;
    iv: Buffer;
    salt: Buffer;
    authTag: Buffer;
    headerHash: string;
  }> {
    const plainData = await fs.promises.readFile(plainFilePath);
    const salt = this.salt ?? crypto.randomBytes(SALT_LENGTH);
    const iv = crypto.randomBytes(IV_LENGTH);
    const salt2 = crypto.randomBytes(SALT2_LENGTH);
    const key = await this.deriveKey(salt);

    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    } as crypto.CipherGCMOptions);
    const ciphertext = Buffer.concat([cipher.update(plainData), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const origSize = Buffer.alloc(ORIG_SIZE_LENGTH);
    origSize.writeBigUInt64LE(BigInt(plainData.length), 0);

    const headerForHash = Buffer.concat([MAGIC, salt, iv, origSize, salt2]);
    const headerHash = crypto.createHash('sha256').update(headerForHash).digest();

    const header = Buffer.concat([MAGIC, salt, iv, authTag, origSize, salt2]);
    const encryptedData = Buffer.concat([header, ciphertext, headerHash]);

    const encDir = path.dirname(encryptedFilePath);
    if (!fs.existsSync(encDir)) {
      await fs.promises.mkdir(encDir, { recursive: true });
    }
    await fs.promises.writeFile(encryptedFilePath, encryptedData);

    this.logger.debug(
      `加密完成: ${plainFilePath} -> ${encryptedFilePath}, 大小: ${encryptedData.length} bytes`,
    );

    return {
      sizeEncrypted: encryptedData.length,
      iv,
      salt,
      authTag,
      headerHash: headerHash.toString('hex'),
    };
  }

  async decryptFile(
    encryptedFilePath: string,
    plainFilePath: string,
  ): Promise<{ sizeDecrypted: number; valid: boolean }> {
    const encryptedData = await fs.promises.readFile(encryptedFilePath);

    if (encryptedData.length < HEADER_FIXED_LENGTH + SALT2_LENGTH + HEADER_HASH_LENGTH) {
      throw new CryptoEngineError(
        '加密文件大小不足，无效的加密文件头',
        CryptoErrorCodes.INVALID_DB_ENC_HEADER,
      );
    }

    const fileMagic = encryptedData.subarray(0, MAGIC_LENGTH);
    if (!fileMagic.equals(MAGIC)) {
      throw new CryptoEngineError(
        '无效的加密文件 magic 标识',
        CryptoErrorCodes.INVALID_DB_ENC_HEADER,
      );
    }

    let offset = MAGIC_LENGTH;
    const salt = Buffer.from(encryptedData.subarray(offset, offset + SALT_LENGTH));
    offset += SALT_LENGTH;
    const iv = Buffer.from(encryptedData.subarray(offset, offset + IV_LENGTH));
    offset += IV_LENGTH;
    const authTag = Buffer.from(encryptedData.subarray(offset, offset + AUTH_TAG_LENGTH));
    offset += AUTH_TAG_LENGTH;
    const origSizeBuf = Buffer.from(encryptedData.subarray(offset, offset + ORIG_SIZE_LENGTH));
    offset += ORIG_SIZE_LENGTH;
    const salt2 = Buffer.from(encryptedData.subarray(offset, offset + SALT2_LENGTH));
    offset += SALT2_LENGTH;

    const headerHashOffset = encryptedData.length - HEADER_HASH_LENGTH;
    const storedHeaderHash = Buffer.from(encryptedData.subarray(headerHashOffset));
    const ciphertext = Buffer.from(encryptedData.subarray(offset, headerHashOffset));

    const headerForHash = Buffer.concat([MAGIC, salt, iv, origSizeBuf, salt2]);
    const computedHeaderHash = crypto.createHash('sha256').update(headerForHash).digest();

    if (!crypto.timingSafeEqual(computedHeaderHash, storedHeaderHash)) {
      this.logger.error('检测到加密文件篡改：headerHash 校验失败', 'SECURITY');
      throw new CryptoEngineError(
        '加密文件 headerHash 校验失败，文件可能被篡改',
        CryptoErrorCodes.DB_ENC_TAMPERED,
      );
    }

    const origSize = Number(origSizeBuf.readBigUInt64LE(0));
    const key = await this.deriveKey(salt);

    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv, {
        authTagLength: AUTH_TAG_LENGTH,
      } as crypto.CipherGCMOptions);
      decipher.setAuthTag(authTag);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

      if (plaintext.length !== origSize) {
        this.logger.error(
          `解密后大小不匹配: 期望 ${origSize}, 实际 ${plaintext.length}`,
          'SECURITY',
        );
        throw new CryptoEngineError(
          '解密后文件大小不匹配，认证失败',
          CryptoErrorCodes.DB_ENC_AUTH_FAILED,
        );
      }

      const plainDir = path.dirname(plainFilePath);
      if (!fs.existsSync(plainDir)) {
        await fs.promises.mkdir(plainDir, { recursive: true });
      }
      await fs.promises.writeFile(plainFilePath, plaintext);

      this.logger.debug(
        `解密完成: ${encryptedFilePath} -> ${plainFilePath}, 大小: ${plaintext.length} bytes`,
      );

      return { sizeDecrypted: plaintext.length, valid: true };
    } catch (err: unknown) {
      if (err instanceof CryptoEngineError) {
        throw err;
      }
      this.logger.error(
        `AES-GCM 认证失败: ${(err as Error).message}`,
        'SECURITY',
      );
      throw new CryptoEngineError(
        'AES-GCM 认证失败，密码错误或密文被篡改',
        CryptoErrorCodes.DB_ENC_AUTH_FAILED,
      );
    }
  }

  isEncryptedFile(filePath: string): boolean {
    try {
      if (!fs.existsSync(filePath)) return false;
      const fd = fs.openSync(filePath, 'r');
      try {
        const buf = Buffer.alloc(MAGIC_LENGTH);
        const bytesRead = fs.readSync(fd, buf, 0, MAGIC_LENGTH, 0);
        if (bytesRead < MAGIC_LENGTH) return false;
        return buf.equals(MAGIC);
      } finally {
        fs.closeSync(fd);
      }
    } catch (err: unknown) {
      this.logger.warn(`isEncryptedFile 检查失败: ${(err as Error).message}`);
      return false;
    }
  }
}
