/**
 * 类型安全的应用配置
 *
 * 定义 AppConfig 接口，集中管理所有环境变量。
 * 提供 loadAppConfig() 函数，可在 NestJS DI 启动前调用（db 初始化等场景）。
 * ConfigService 内部也使用此函数，确保类型一致。
 */

import {
  SQLITE_JOURNAL_MODE,
  SQLITE_SYNCHRONOUS,
  SQLITE_BUSY_TIMEOUT_MS,
  SQLITE_CACHE_SIZE,
  SQLITE_TEMP_STORE,
  SQLITE_MMAP_SIZE,
  SQLITE_WAL_AUTOCHECKPOINT,
} from './constants';

export interface DbConfig {
  path?: string;
}

export interface AppConfig {
  /** 服务端口 */
  port: number;
  /** CORS 允许的来源 */
  corsOrigins: string[];
  /** JWT 密钥 */
  jwtSecret: string;
  /** JWT 过期时间 */
  jwtExpiresIn: string;
  /** 加密密钥（用于字段级加密） */
  encryptionKey?: string;
  /** 数据目录 */
  dataDir?: string;
  /** 数据库配置 */
  db: DbConfig;
  /** bcrypt 轮数 */
  bcryptRounds: number;
  /** SQLite pragma 配置 */
  sqlite: {
    journalMode: string;
    synchronous: string;
    busyTimeoutMs: number;
    cacheSize: number;
    tempStore: string;
    mmapSize: number;
    walAutocheckpoint: number;
  };
  /** 异地备份目录 */
  backupRemoteDir?: string;
}

/**
 * 从 process.env 加载配置，返回类型安全的 AppConfig 对象。
 *
 * 此函数可在 NestJS DI 启动前调用（如 db 初始化），
 * 也可被 ConfigService 复用，确保全局配置读取逻辑一致。
 */
export function loadAppConfig(): AppConfig {
  const env = process.env;
  return {
    port: parseInt(env.PORT || '3001', 10),
    corsOrigins: (env.CORS_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean),
    jwtSecret: env.JWT_SECRET || '',
    jwtExpiresIn: env.ACCESS_TOKEN_EXPIRES_IN || '30m',
    encryptionKey: env.ENCRYPTION_KEY || undefined,
    dataDir: env.DATA_DIR || undefined,
    db: {
      path: env.DB_PATH || undefined,
    },
    bcryptRounds: parseInt(env.BCRYPT_ROUNDS || '10', 10),
    sqlite: {
      journalMode: env.SQLITE_JOURNAL_MODE || SQLITE_JOURNAL_MODE,
      synchronous: env.SQLITE_SYNCHRONOUS || SQLITE_SYNCHRONOUS,
      busyTimeoutMs: parseInt(env.SQLITE_BUSY_TIMEOUT_MS || String(SQLITE_BUSY_TIMEOUT_MS), 10),
      cacheSize: parseInt(env.SQLITE_CACHE_SIZE || String(SQLITE_CACHE_SIZE), 10),
      tempStore: env.SQLITE_TEMP_STORE || SQLITE_TEMP_STORE,
      mmapSize: parseInt(env.SQLITE_MMAP_SIZE || String(SQLITE_MMAP_SIZE), 10),
      walAutocheckpoint: parseInt(env.SQLITE_WAL_AUTOCHECKPOINT || String(SQLITE_WAL_AUTOCHECKPOINT), 10),
    },
    backupRemoteDir: env.BACKUP_REMOTE_DIR || undefined,
  };
}
