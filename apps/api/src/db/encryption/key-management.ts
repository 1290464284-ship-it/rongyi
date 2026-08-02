/* eslint-disable security/detect-non-literal-fs-filename -- 文件路径来自内部配置，非用户输入 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { AppLogger } from '../../common/services/logger.service';
import { FileCryptoEngine } from './crypto-engine';

// eslint-disable-next-line sonarjs/no-hardcoded-passwords -- 环境变量名常量，非真实密码
export const DB_ENC_PASSWORD_ENV = 'DB_ENCRYPTION_PASSWORD';
export const DB_ENC_SETTINGS_KEY = 'aiDbEncryptionPassword';
export const DB_ENC_ENABLED_KEY = 'aiDbEncryptionEnabled';
export const DB_ENC_AUTO_PERSIST_MINUTES_KEY = 'aiDbEncryptionAutoPersistMinutes';

export interface PasswordRotationResult {
  success: boolean;
  tempPath?: string;
}

export class KeyManager {
  private readonly logger = new AppLogger(KeyManager.name);

  constructor(
    private readonly settingsProvider?: () => Promise<Record<string, string>>,
  ) {}

  resolvePasswordFromEnv(): string | undefined {
    const envPwd = process.env[DB_ENC_PASSWORD_ENV];
    return envPwd && envPwd.trim().length > 0 ? envPwd.trim() : undefined;
  }

  async resolvePasswordFromSettings(): Promise<string | undefined> {
    if (!this.settingsProvider) return undefined;
    try {
      const settings = await this.settingsProvider();
      const stored = settings[DB_ENC_SETTINGS_KEY];
      if (!stored || stored.trim().length === 0) return undefined;
      const { decryptField } = require('../../common/utils/security/encryption') as {
        decryptField: (ciphertext: string) => string | null;
      };
      const decrypted = decryptField(stored);
      return decrypted && decrypted.length > 0 ? decrypted : undefined;
    } catch (err: unknown) {
      this.logger.warn(
        `从 Settings 解析密码失败: ${(err as Error).message}，回退使用环境变量`,
      );
      return undefined;
    }
  }

  async resolvePassword(): Promise<string> {
    const envPwd = this.resolvePasswordFromEnv();
    if (envPwd) return envPwd;

    const settingsPwd = await this.resolvePasswordFromSettings();
    if (settingsPwd) return settingsPwd;

    let encryptionEnabled = false;
    if (this.settingsProvider) {
      try {
        const settings = await this.settingsProvider();
        const val = settings[DB_ENC_ENABLED_KEY];
        encryptionEnabled = val === 'true' || val === '1' || val === 'yes';
      } catch {
        /* ignore */
      }
    }
    if (!encryptionEnabled) {
      const envVal = process.env[DB_ENC_ENABLED_KEY];
      encryptionEnabled = envVal === 'true' || envVal === '1' || envVal === 'yes';
    }

    if (encryptionEnabled) {
      throw new Error(
        `DB_ENCRYPTION_PASSWORD 未设置：请在 .env 配置 ${DB_ENC_PASSWORD_ENV}=<强密码>，或在系统设置中配置数据库加密密码`,
      );
    }
    return '';
  }

  async isEncryptionEnabled(): Promise<boolean> {
    if (this.settingsProvider) {
      try {
        const settings = await this.settingsProvider();
        const val = settings[DB_ENC_ENABLED_KEY];
        if (val === 'true' || val === '1' || val === 'yes') return true;
      } catch {
        /* ignore */
      }
    }
    const envVal = process.env[DB_ENC_ENABLED_KEY];
    return envVal === 'true' || envVal === '1' || envVal === 'yes';
  }

  async getAutoPersistMinutes(): Promise<number> {
    let minutes = 10;
    if (this.settingsProvider) {
      try {
        const settings = await this.settingsProvider();
        const val = settings[DB_ENC_AUTO_PERSIST_MINUTES_KEY];
        if (val) {
          const parsed = parseInt(val, 10);
          if (!isNaN(parsed) && parsed > 0) minutes = parsed;
        }
      } catch {
        /* ignore */
      }
    }
    const envVal = process.env.DB_ENC_AUTO_PERSIST_MINUTES;
    if (envVal) {
      const parsed = parseInt(envVal, 10);
      if (!isNaN(parsed) && parsed > 0) minutes = parsed;
    }
    return minutes;
  }

  async rotatePassword(
    oldPwd: string,
    newPwd: string,
    encryptedFilePath: string,
  ): Promise<void> {
    if (!newPwd || newPwd.trim().length === 0) {
      throw new Error('新密码不能为空');
    }
    if (!fs.existsSync(encryptedFilePath)) {
      throw new Error(`加密文件不存在: ${encryptedFilePath}`);
    }

    const tmpDir = path.dirname(encryptedFilePath);
    const tmpPlainPath = path.join(
      tmpDir,
      `rotate-tmp-${crypto.randomUUID()}.sqlite`,
    );
    const tmpEncPath = path.join(
      tmpDir,
      `rotate-tmp-${crypto.randomUUID()}.enc`,
    );

    try {
      const oldEngine = new FileCryptoEngine(oldPwd);
      this.logger.log(
        `[密码轮换] 步骤 1/3: 使用旧密码解密 ${encryptedFilePath} -> ${tmpPlainPath}`,
        'SECURITY',
      );
      await oldEngine.decryptFile(encryptedFilePath, tmpPlainPath);

      const newSalt = crypto.randomBytes(16);
      const newEngine = new FileCryptoEngine(newPwd.trim(), newSalt);
      this.logger.log(
        `[密码轮换] 步骤 2/3: 使用新密码重新加密 ${tmpPlainPath} -> ${tmpEncPath}`,
        'SECURITY',
      );
      await newEngine.encryptFile(tmpPlainPath, tmpEncPath);

      this.logger.log(
        `[密码轮换] 步骤 3/3: 原子替换 ${tmpEncPath} -> ${encryptedFilePath}`,
        'SECURITY',
      );
      fs.renameSync(tmpEncPath, encryptedFilePath);

      this.logger.log(
        '数据库加密密码轮换成功 (SECURITY_DB_PASSWORD_ROTATED)',
        'SECURITY',
      );
    } finally {
      for (const p of [tmpPlainPath, tmpEncPath]) {
        try {
          if (fs.existsSync(p)) {
            fs.rmSync(p, { force: true, maxRetries: 3, retryDelay: 100 });
          }
        } catch (cleanupErr: unknown) {
          this.logger.warn(
            `清理临时文件失败 ${p}: ${(cleanupErr as Error).message}`,
          );
        }
      }
    }
  }
}
