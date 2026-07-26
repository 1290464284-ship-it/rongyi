import { join, dirname } from 'node:path';
import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
import { logger } from '../common/utils/infra/log';
import {
  DEFAULT_API_PORT,
  DEFAULT_CORS_ORIGINS,
  JWT_EXPIRES_IN,
} from '../config/constants';

const ENV_FALLBACKS: Record<string, string> = {
  PORT: String(DEFAULT_API_PORT),
  CORS_ORIGIN: DEFAULT_CORS_ORIGINS.join(','),
  JWT_EXPIRES_IN,
};

function ensureDir(dir: string): void {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err: unknown) {
    logger.warn(`无法创建目录 ${dir}: ${(err as Error).message}`);
  }
}

/** 诊所数据与备份根目录（优先 DATA_DIR / DB_PATH） */
export function getDataDir(): string {
  if (process.env.DATA_DIR) {
    ensureDir(process.env.DATA_DIR);
    return process.env.DATA_DIR;
  }
  if (process.env.DB_PATH) {
    const dir = dirname(process.env.DB_PATH);
    ensureDir(dir);
    return dir;
  }
  // 开发默认：apps/api/data（不再写入 resources 或 data）
  const dataDir = join(__dirname, '../../data');
  ensureDir(dataDir);
  return dataDir;
}

export function getDbPath(): string {
  if (process.env.DB_PATH) {
    ensureDir(dirname(process.env.DB_PATH));
    return process.env.DB_PATH;
  }
  return join(getDataDir(), 'dental.sqlite');
}

export function ensureEnvFile(envPath: string): void {
  // Electron 已通过环境变量注入 JWT_SECRET 时，不必再写文件密钥
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 16) {
    return;
  }
  const envDir = dirname(envPath);
  ensureDir(envDir);
  if (fs.existsSync(envPath)) {
    return;
  }
  const jwtSecret = crypto.randomBytes(32).toString('hex');
  const encryptionKey = crypto.randomBytes(32).toString('hex');
  const lines = [
    'JWT_SECRET=' + jwtSecret,
    'ENCRYPTION_KEY=' + encryptionKey,
    'JWT_EXPIRES_IN=' + ENV_FALLBACKS.JWT_EXPIRES_IN,
    'PORT=' + ENV_FALLBACKS.PORT,
    'CORS_ORIGIN=' + ENV_FALLBACKS.CORS_ORIGIN,
  ];
  try {
    fs.writeFileSync(envPath, lines.join('\n') + '\n', { mode: 0o600 });
    fs.chmodSync(envPath, 0o600);
    console.log('[Setup] 已创建 .env，并生成 JWT_SECRET 和 ENCRYPTION_KEY');
  } catch (writeErr) {
    console.error(
      '[Setup] 无法写入 .env (' + envPath + ')，将使用进程环境变量: ' + (writeErr as Error).message,
    );
    process.env.JWT_SECRET = jwtSecret;
    process.env.JWT_EXPIRES_IN = ENV_FALLBACKS.JWT_EXPIRES_IN;
    process.env.PORT = ENV_FALLBACKS.PORT;
    process.env.CORS_ORIGIN = ENV_FALLBACKS.CORS_ORIGIN;
  }
}

export function getEnvPath(): string {
  if (process.env.ENV_PATH) {
    ensureEnvFile(process.env.ENV_PATH);
    return process.env.ENV_PATH;
  }
  const envPath = join(getDataDir(), '.env');
  ensureEnvFile(envPath);
  return envPath;
}

function copyDbFiles(srcDb: string, destDb: string): void {
  ensureDir(dirname(destDb));
  fs.copyFileSync(srcDb, destDb);
  for (const suffix of ['-wal', '-shm']) {
    const src = srcDb + suffix;
    if (fs.existsSync(src)) {
      try {
        fs.copyFileSync(src, destDb + suffix);
      } catch (err: unknown) {
        logger.warn(`无法复制数据库辅助文件 ${src}: ${(err as Error).message}`);
      }
    }
  }
}

/**
 * 若新路径尚无库，从旧版路径复制（不删除旧文件）。
 * 候选：LEGACY_DB_PATH、resources/api/data、apps/api/data
 */
export function migrateLegacyDatabaseIfNeeded(): void {
  const dest = getDbPath();
  if (fs.existsSync(dest)) {
    return;
  }

  const resourcesPath =
    (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath ||
    process.env.RESOURCES_PATH ||
    '';

  const candidates = [
    process.env.LEGACY_DB_PATH,
    resourcesPath ? join(resourcesPath, 'api', 'data', 'dental.sqlite') : '',
    join(__dirname, '../../data/dental.sqlite'),
  ].filter((p): p is string => Boolean(p));

  for (const src of candidates) {
    if (!fs.existsSync(src)) continue;
    try {
      console.log(`[DB] 检测到旧库，正在迁移: ${src} -> ${dest}`);
      copyDbFiles(src, dest);
      const marker = join(getDataDir(), 'migration-marker.json');
      fs.writeFileSync(
        marker,
        JSON.stringify(
          {
            migratedAt: new Date().toISOString(),
            from: src,
            to: dest,
          },
          null,
          2,
        ),
      );
      console.log('[DB] 旧库迁移完成（旧文件已保留，未删除）');
      return;
    } catch (err: unknown) {
      console.error('[DB] 旧库迁移失败:', err);
    }
  }
}
