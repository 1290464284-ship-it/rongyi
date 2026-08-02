/* eslint-disable security/detect-non-literal-fs-filename -- 文件路径来自内部配置；TODO: 逐步修复 lint 问题 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { AppLogger } from '../../common/services/logger.service';
import { FileCryptoEngine } from './crypto-engine';
import { KeyManager } from './key-management';

export interface TransparentDbBootOptions {
  encryptedPath: string;
  password: string;
  inMemory?: boolean;
  backupDir?: string;
  autoPersistMinutes?: number;
  onPersistCallback?: () => void;
}

export interface TransparentDbHandle {
  tempPlainPath: string;
  shutdown: () => Promise<void>;
  persist: () => Promise<void>;
  health: { salt: string; aes: string };
  cancelAutoPersist: () => void;
  autoPersistTimer?: NodeJS.Timeout | null;
}

let autoPersistTimers: Array<{ timer: NodeJS.Timeout; path: string }> = [];

export function cancelAllAutoPersistTimers(): void {
  for (const entry of autoPersistTimers) {
    try { clearInterval(entry.timer); } catch { /* ignore */ }
  }
  autoPersistTimers = [];
}

function generateTempDbPath(): string {
  const ramdiskPath = process.env.DB_ENC_RAMDISK;
  if (ramdiskPath && fs.existsSync(ramdiskPath)) {
    return path.join(ramdiskPath, `dental-db-${crypto.randomUUID()}.sqlite`);
  }
  return path.join(os.tmpdir(), `dental-db-${crypto.randomUUID()}.sqlite`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class TransparentEncryptedDb {
  private readonly logger = new AppLogger(TransparentEncryptedDb.name);
  private handle: TransparentDbHandle | null = null;
  private shutdownCalled = false;

  constructor(private readonly keyManager?: KeyManager) {}

  async boot(options: TransparentDbBootOptions): Promise<TransparentDbHandle> {
    const {
      encryptedPath,
      password,
      inMemory = false,
      backupDir,
      autoPersistMinutes = 10,
      onPersistCallback,
    } = options;

    if (this.handle) {
      this.logger.warn('boot() 已被调用，跳过重复启动');
      return this.handle;
    }

    this.shutdownCalled = false;
    this.logger.log('启动透明加密数据库 (DB_ENC_INIT)', 'SECURITY');

    const tempPlainPath = inMemory ? ':memory:' : generateTempDbPath();
    const encFileExists = fs.existsSync(encryptedPath);

    if (inMemory) {
      this.logger.debug('inMemory 模式：跳过文件级加解密');
    } else if (encFileExists) {
      this.logger.debug(`检测到加密文件，解密到临时路径: ${tempPlainPath}`);
      const engine = new FileCryptoEngine(password);
      await engine.decryptFile(encryptedPath, tempPlainPath);
    } else {
      this.logger.debug('加密文件不存在，将创建新的临时数据库（首次启动）');
      const tempDir = path.dirname(tempPlainPath);
      if (!fs.existsSync(tempDir)) {
        await fs.promises.mkdir(tempDir, { recursive: true });
      }
    }

    if (backupDir && !fs.existsSync(backupDir)) {
      try {
        await fs.promises.mkdir(backupDir, { recursive: true });
      } catch (err: unknown) {
        this.logger.warn(`创建备份目录失败 ${backupDir}: ${(err as Error).message}`);
      }
    }

    let autoPersistTimer: NodeJS.Timeout | null = null;
    if (autoPersistMinutes > 0 && !inMemory) {
      autoPersistTimer = setInterval(() => {
        if (!this.shutdownCalled) {
          this.logger.debug(
            `[心跳持久化] 触发自动持久化 (每 ${autoPersistMinutes} 分钟)`,
          );
          internalPersist().catch((err: unknown) => {
            this.logger.error(
              `心跳持久化失败: ${(err as Error).message}`,
              'SECURITY',
            );
          });
        }
      }, autoPersistMinutes * 60 * 1000);
      autoPersistTimer.unref();
      autoPersistTimers.push({ timer: autoPersistTimer, path: encryptedPath });
    }

    const internalPersist = async (): Promise<void> => {
      if (this.shutdownCalled) {
        this.logger.debug('persist() 跳过：shutdown 已调用');
        return;
      }
      if (inMemory) {
        this.logger.debug('inMemory 模式，跳过 persist()');
        return;
      }
      if (!fs.existsSync(tempPlainPath)) {
        this.logger.warn('persist() 跳过：临时文件不存在');
        return;
      }
      const encDir = path.dirname(encryptedPath);
      if (!fs.existsSync(encDir)) {
        await fs.promises.mkdir(encDir, { recursive: true });
      }
      const tmpEncPath = `${encryptedPath}.tmp.enc`;
      try {
        const engine = new FileCryptoEngine(password);
        await engine.encryptFile(tempPlainPath, tmpEncPath);
        fs.renameSync(tmpEncPath, encryptedPath);
        this.logger.debug(
          `persist() 完成: ${tempPlainPath} -> ${encryptedPath}`,
        );
        if (onPersistCallback) {
          try { onPersistCallback(); } catch { /* ignore */ }
        }
      } finally {
        try {
          if (fs.existsSync(tmpEncPath)) {
            fs.rmSync(tmpEncPath, { force: true });
          }
        } catch {
          /* ignore */
        }
      }
    };

    const _handle: TransparentDbHandle = {
      tempPlainPath,
      health: {
        salt: 'PBKDF2(600000, sha512, 16B-salt) -> 32B',
        aes: 'AES-256-GCM, 12B-IV, 16B-authTag',
      },
      get autoPersistTimer() {
        return autoPersistTimer;
      },
      cancelAutoPersist: () => {
        if (autoPersistTimer) {
          clearInterval(autoPersistTimer);
          autoPersistTimer = null;
          autoPersistTimers = autoPersistTimers.filter(
            (e) => e.path !== encryptedPath,
          );
        }
      },
      persist: internalPersist,
      shutdown: async (): Promise<void> => {
        if (this.shutdownCalled) {
          this.logger.debug('shutdown() 幂等跳过：已调用过');
          return;
        }
        this.shutdownCalled = true;
        this.logger.log('关闭透明加密数据库 (DB_ENC_SHUTDOWN)', 'SECURITY');

        if (autoPersistTimer) {
          clearInterval(autoPersistTimer);
          autoPersistTimer = null;
          autoPersistTimers = autoPersistTimers.filter(
            (e) => e.path !== encryptedPath,
          );
        }

        if (!inMemory && fs.existsSync(tempPlainPath)) {
          try {
            await internalPersist();
          } catch (persistErr: unknown) {
            this.logger.warn(
              `shutdown 阶段 persist() 失败: ${(persistErr as Error).message}`,
            );
          }
        }

        if (!inMemory && fs.existsSync(tempPlainPath)) {
          const maxRetries = 3;
          for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
              fs.rmSync(tempPlainPath, { force: true, maxRetries: 0 });
              this.logger.debug(
                `临时文件已删除 (尝试 ${attempt}/${maxRetries}): ${tempPlainPath}`,
              );
              break;
            } catch (err: unknown) {
              if (attempt < maxRetries) {
                this.logger.warn(
                  `删除临时文件失败 (尝试 ${attempt}/${maxRetries})，等待 300ms 后重试: ${(err as Error).message}`,
                );
                await sleep(300);
              } else {
                this.logger.warn(
                  `删除临时文件最终失败，使用 force:true 兜底: ${(err as Error).message}`,
                );
                try {
                  fs.rmSync(tempPlainPath, { force: true });
                } catch (finalErr: unknown) {
                  this.logger.error(
                    `临时文件删除完全失败: ${(finalErr as Error).message}`,
                  );
                }
              }
            }
          }
        }
      },
    };

    this.handle = _handle;
    return _handle;
  }
}

let globalEncryptedDbInstance: TransparentEncryptedDb | null = null;
let globalDbHandle: TransparentDbHandle | null = null;

export async function initEncryptedDbIfEnabled(
  settingsProvider?: () => Promise<Record<string, string>>,
): Promise<{
  enabled: boolean;
  tempPlainPath?: string;
  shutdown?: () => Promise<void>;
  persist?: () => Promise<void>;
}> {
  const keyMgr = new KeyManager(settingsProvider);
  const enabled = await keyMgr.isEncryptionEnabled();
  if (!enabled) {
    return { enabled: false };
  }
  const password = await keyMgr.resolvePassword();
  if (!password) {
    throw new Error('DB_ENCRYPTION_PASSWORD 未设置，无法启用数据库加密');
  }
  const autoPersistMinutes = await keyMgr.getAutoPersistMinutes();

  const { getDbPath } = require('../paths') as { getDbPath: () => string };
  const encryptedPath = `${getDbPath()}.enc`;

  globalEncryptedDbInstance = new TransparentEncryptedDb(keyMgr);
  globalDbHandle = await globalEncryptedDbInstance.boot({
    encryptedPath,
    password,
    autoPersistMinutes,
  });

  return {
    enabled: true,
    tempPlainPath: globalDbHandle.tempPlainPath,
    shutdown: () => globalDbHandle!.shutdown(),
    persist: () => globalDbHandle!.persist(),
  };
}

export function getGlobalEncryptedDbHandle(): TransparentDbHandle | null {
  return globalDbHandle;
}

export function clearGlobalEncryptedDbHandle(): void {
  globalDbHandle = null;
  globalEncryptedDbInstance = null;
  cancelAllAutoPersistTimers();
}
