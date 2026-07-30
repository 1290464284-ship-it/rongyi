/* eslint-disable security/detect-non-literal-fs-filename -- 配置文件路径来自环境变量，非用户输入 */
import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  DEFAULT_API_PORT,
  DEFAULT_CORS_ORIGINS,
  ACCESS_TOKEN_EXPIRES_IN,
  BCRYPT_ROUNDS_DEFAULT,
  SQLITE_BUSY_TIMEOUT_MS,
  SQLITE_CACHE_SIZE,
  SQLITE_JOURNAL_MODE,
  SQLITE_SYNCHRONOUS,
  SQLITE_TEMP_STORE,
  SQLITE_MMAP_SIZE,
  SQLITE_WAL_AUTOCHECKPOINT,
} from '../../config/constants';

const ENV_FALLBACKS: Record<string, string> = {
  PORT: String(DEFAULT_API_PORT),
  CORS_ORIGIN: DEFAULT_CORS_ORIGINS.join(','),
  ACCESS_TOKEN_EXPIRES_IN,
};

@Injectable()
export class ConfigService {
  private readonly logger = new Logger(ConfigService.name);
  private envCache: Record<string, string> = {};

  constructor() {
    this.loadEnvFile();
  }

  private loadEnvFile(): void {
    const envPath = process.env.ENV_PATH || path.join(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
      try {
        const content = fs.readFileSync(envPath, 'utf8');
        content.split('\n').forEach((line) => {
          const match = line.match(/^([^=]+)=(.+)$/);
          if (match) {
            const [, key, value] = match;
            this.envCache[key.trim()] = value.trim();
          }
        });
      } catch (err: unknown) {
        this.logger.warn(`无法读取环境文件 ${envPath}: ${(err as Error).message}`);
      }
    }
  }

  get(key: string): string | undefined {
    return process.env[key] || this.envCache[key] || ENV_FALLBACKS[key];
  }

  getOrThrow(key: string): string {
    const value = this.get(key);
    if (!value) {
      throw new Error(`环境变量 ${key} 未设置`);
    }
    return value;
  }

  getNumber(key: string, defaultValue?: number): number | undefined {
    const value = this.get(key);
    if (value === undefined) return defaultValue;
    const num = parseInt(value, 10);
    return isNaN(num) ? defaultValue : num;
  }

  getBoolean(key: string, defaultValue?: boolean): boolean {
    const value = this.get(key);
    if (value === undefined) return defaultValue ?? false;
    return ['true', '1', 'yes'].includes(value.toLowerCase());
  }

  getStringArray(key: string, separator: string = ','): string[] {
    const value = this.get(key);
    if (!value) return [];
    return value.split(separator).map((s) => s.trim()).filter(Boolean);
  }

  get JWT_SECRET(): string {
    return this.getOrThrow('JWT_SECRET');
  }

  get ACCESS_TOKEN_EXPIRES_IN(): string {
    return this.get('ACCESS_TOKEN_EXPIRES_IN') || ACCESS_TOKEN_EXPIRES_IN;
  }

  get ENCRYPTION_KEY(): string | undefined {
    return this.get('ENCRYPTION_KEY');
  }

  get PORT(): number {
    return this.getNumber('PORT', DEFAULT_API_PORT) ?? DEFAULT_API_PORT;
  }

  get CORS_ORIGIN(): string[] {
    return this.getStringArray('CORS_ORIGIN');
  }

  get DATA_DIR(): string | undefined {
    return this.get('DATA_DIR');
  }

  get DB_PATH(): string | undefined {
    return this.get('DB_PATH');
  }

  get BCRYPT_ROUNDS(): number {
    return this.getNumber('BCRYPT_ROUNDS', BCRYPT_ROUNDS_DEFAULT) ?? BCRYPT_ROUNDS_DEFAULT;
  }

  get SQLITE_BUSY_TIMEOUT_MS(): number {
    return this.getNumber('SQLITE_BUSY_TIMEOUT_MS', SQLITE_BUSY_TIMEOUT_MS) ?? SQLITE_BUSY_TIMEOUT_MS;
  }

  get SQLITE_CACHE_SIZE(): number {
    return this.getNumber('SQLITE_CACHE_SIZE', SQLITE_CACHE_SIZE) ?? SQLITE_CACHE_SIZE;
  }

  get SQLITE_JOURNAL_MODE(): string {
    return this.get('SQLITE_JOURNAL_MODE') || SQLITE_JOURNAL_MODE;
  }

  get SQLITE_SYNCHRONOUS(): string {
    return this.get('SQLITE_SYNCHRONOUS') || SQLITE_SYNCHRONOUS;
  }

  get SQLITE_TEMP_STORE(): string {
    return this.get('SQLITE_TEMP_STORE') || SQLITE_TEMP_STORE;
  }

  get SQLITE_MMAP_SIZE(): number {
    return this.getNumber('SQLITE_MMAP_SIZE', SQLITE_MMAP_SIZE) ?? SQLITE_MMAP_SIZE;
  }

  get SQLITE_WAL_AUTOCHECKPOINT(): number {
    return this.getNumber('SQLITE_WAL_AUTOCHECKPOINT', SQLITE_WAL_AUTOCHECKPOINT) ?? SQLITE_WAL_AUTOCHECKPOINT;
  }
}
