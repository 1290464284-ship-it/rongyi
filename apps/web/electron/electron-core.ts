import { app, dialog, safeStorage } from 'electron';
import { writeFileSync, existsSync, mkdirSync, readFileSync, statSync, unlinkSync, renameSync } from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { ELECTRON_LOG_ROTATION } from '../src/config/constants';

export const isDev = !app.isPackaged;

const logPath = join(app.getPath('userData'), 'app.log');

const configDir = join(app.getPath('userData'), 'config');
const secretPath = join(configDir, 'secrets.json');

// Re-export logPath for use in main.ts error messages
export { logPath };

function join(...segments: string[]): string {
  return path.join(...segments);
}

// ===== Electron 日志（带轮转） =====

const rotateLogIfNeeded = (): void => {
  try {
    if (!existsSync(logPath)) return;
    const stats = statSync(logPath);
    if (stats.size >= ELECTRON_LOG_ROTATION.MAX_LOG_SIZE_BYTES) {
      for (let i = ELECTRON_LOG_ROTATION.MAX_LOG_FILES - 1; i > 0; i--) {
        const oldPath = `${logPath}.${i}`;
        const newPath = `${logPath}.${i + 1}`;
        if (existsSync(oldPath)) {
          if (i === ELECTRON_LOG_ROTATION.MAX_LOG_FILES - 1) {
            unlinkSync(oldPath);
          } else {
            renameSync(oldPath, newPath);
          }
        }
      }
      renameSync(logPath, `${logPath}.1`);
    }
  } catch (err) {
    console.warn('日志轮转失败:', (err as Error).message);
  }
};

export const log = (msg: string): void => {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${msg}\n`;
  try {
    rotateLogIfNeeded();
    writeFileSync(logPath, line, { flag: 'a' });
  } catch {
    console.log(line);
  }
};

// ===== 密钥存储（safeStorage 加固） =====
// v2 格式：{ version: 2, encrypted: true, jwtSecret: <DPAPI 密文 base64>, encryptionKey: <同左> }
// 兼容 v1 明文格式：读取后立即用 safeStorage 加密重写
// 注意：mode 0o600 在 Windows 上无效，真正的保护来自 safeStorage（Windows DPAPI / macOS Keychain）
interface SecretsFile {
  version?: number;
  encrypted?: boolean;
  jwtSecret?: string;
  encryptionKey?: string;
}

function readSecretsFile(): SecretsFile {
  if (!existsSync(secretPath)) return {};
  try {
    return JSON.parse(readFileSync(secretPath, 'utf-8')) as SecretsFile;
  } catch {
    return {};
  }
}

function writeSecretsFile(jwtSecret: string, encryptionKey: string, useEncryption: boolean): void {
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
  const payload: SecretsFile = useEncryption
    ? {
        version: 2,
        encrypted: true,
        jwtSecret: safeStorage.encryptString(jwtSecret).toString('base64'),
        encryptionKey: safeStorage.encryptString(encryptionKey).toString('base64'),
      }
    : { version: 2, encrypted: false, jwtSecret, encryptionKey };
  writeFileSync(secretPath, JSON.stringify(payload), { mode: 0o600 });
}

function decodeStoredSecret(value: string | undefined, encrypted: boolean): string | null {
  if (!value || typeof value !== 'string') return null;
  if (!encrypted) return value;
  try {
    return safeStorage.decryptString(Buffer.from(value, 'base64'));
  } catch (err) {
    log(`解密存储密钥失败（系统凭据可能已变更）: ${(err as Error).message}`);
    return null;
  }
}

export function loadOrCreateSecrets(): { jwtSecret: string; encryptionKey: string } {
  try {
    // 必须在 app ready 后调用（startApi 在 whenReady 内触发，满足前提）
    const canEncrypt = safeStorage.isEncryptionAvailable();
    if (!canEncrypt) {
      log('警告: 当前系统不支持 safeStorage 加密，密钥将以明文存储（mode 0o600）');
    }
    const stored = readSecretsFile();
    const wasEncrypted = stored.encrypted === true;

    let jwtSecret = decodeStoredSecret(stored.jwtSecret, wasEncrypted);
    let encryptionKey = decodeStoredSecret(stored.encryptionKey, wasEncrypted);

    // 历史 bug 兼容：旧版以 base64 生成 encryptionKey，但 API 强校验 64 位 hex，
    // 该密钥从未通过 API 启动校验（API 直接退出），因此可安全重新生成
    if (encryptionKey && !/^[a-f0-9]{64}$/i.test(encryptionKey)) {
      log('检测到非 hex 格式的历史 encryptionKey（API 无法使用），重新生成');
      encryptionKey = null;
    }

    let changed = false;
    if (!jwtSecret) {
      jwtSecret = crypto.randomBytes(32).toString('hex');
      log('生成新的JWT密钥并保存');
      changed = true;
    }
    if (!encryptionKey) {
      encryptionKey = crypto.randomBytes(32).toString('hex');
      log('生成新的数据加密密钥并保存');
      changed = true;
    }

    // 需要重写：新生成密钥 / v1 明文迁移到加密 / 加密能力状态变化
    if (changed || wasEncrypted !== canEncrypt) {
      writeSecretsFile(jwtSecret, encryptionKey, canEncrypt);
      if (!wasEncrypted && canEncrypt && !changed) {
        log('已将明文 secrets.json 迁移为 safeStorage 加密存储');
      }
    }
    return { jwtSecret, encryptionKey };
  } catch (err) {
    const msg = `获取应用密钥失败: ${(err as Error).message}`;
    log(msg);
    dialog.showErrorBox('密钥错误', msg + '\n\n无法读取或创建密钥文件，应用将退出。');
    app.quit();
    throw new Error(msg);
  }
}

// ===== 全局错误处理 =====

export function setupErrorHandlers(): void {
  process.on('uncaughtException', (err) => {
    log('UNCAUGHT EXCEPTION: ' + err.message + '\n' + (err.stack || ''));
    dialog.showErrorBox('错误', '应用程序发生未处理的错误:\n\n' + err.message + '\n\n日志文件路径: ' + logPath);
  });

  process.on('unhandledRejection', (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    log('UNHANDLED REJECTION: ' + msg);
  });

  app.on('render-process-gone', (_event, _webContents, details) => {
    log('RENDER PROCESS GONE: reason=' + details.reason + ' exitCode=' + details.exitCode);
  });

  app.on('child-process-gone', (_event, details) => {
    log('CHILD PROCESS GONE: type=' + details.type + ' reason=' + details.reason + ' exitCode=' + details.exitCode);
  });
}
