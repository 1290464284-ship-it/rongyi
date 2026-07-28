jest.mock('node:fs', () => ({
  mkdirSync: jest.fn(),
  existsSync: jest.fn(),
  writeFileSync: jest.fn(),
  chmodSync: jest.fn(),
  copyFileSync: jest.fn(),
}));

jest.mock('node:crypto', () => ({
  randomBytes: jest.fn().mockReturnValue({
    toString: () => 'mock-hex-secret-0123456789abcdef',
  }),
}));

jest.mock('../common/utils/infra/log', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

import * as fs from 'node:fs';
import { logger } from '../common/utils/infra/log';
import {
  getDataDir,
  getDbPath,
  ensureEnvFile,
  getEnvPath,
  migrateLegacyDatabaseIfNeeded,
} from './paths';

const mockFs = fs as jest.Mocked<typeof fs>;
const mockLogger = logger as jest.Mocked<typeof logger>;

describe('Database Paths', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.DATA_DIR;
    delete process.env.DB_PATH;
    delete process.env.ENV_PATH;
    delete process.env.LEGACY_DB_PATH;
    delete process.env.RESOURCES_PATH;
    delete process.env.JWT_SECRET;
    mockFs.mkdirSync.mockImplementation((() => {}) as any);
    mockFs.existsSync.mockReturnValue(false);
    mockFs.writeFileSync.mockImplementation((() => {}) as any);
    mockFs.chmodSync.mockImplementation((() => {}) as any);
    mockFs.copyFileSync.mockImplementation((() => {}) as any);
  });

  describe('getDataDir', () => {
    it('优先使用 DATA_DIR 环境变量', () => {
      process.env.DATA_DIR = '/custom/data';
      const result = getDataDir();
      expect(result).toBe('/custom/data');
      expect(mockFs.mkdirSync).toHaveBeenCalledWith('/custom/data', { recursive: true });
    });

    it('使用 DB_PATH 的目录当 DATA_DIR 未设置时', () => {
      process.env.DB_PATH = '/opt/db/dental.sqlite';
      const result = getDataDir();
      expect(result).toBe('/opt/db');
      expect(mockFs.mkdirSync).toHaveBeenCalledWith('/opt/db', { recursive: true });
    });

    it('回退到默认 data 目录', () => {
      const result = getDataDir();
      expect(result).toMatch(/data$/);
    });

    it('mkdirSync 失败时应记录警告但不抛出', () => {
      mockFs.mkdirSync.mockImplementation((() => { throw new Error('permission denied'); }) as any);
      process.env.DATA_DIR = '/protected/dir';
      const result = getDataDir();
      expect(result).toBe('/protected/dir');
      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });

  describe('getDbPath', () => {
    it('使用 DB_PATH 环境变量', () => {
      process.env.DB_PATH = '/custom/db.sqlite';
      const result = getDbPath();
      expect(result).toBe('/custom/db.sqlite');
    });

    it('回退到 getDataDir 下的 dental.sqlite', () => {
      const result = getDbPath();
      expect(result).toMatch(/dental\.sqlite$/);
    });
  });

  describe('ensureEnvFile', () => {
    it('JWT_SECRET 已存在且长度足够时直接返回', () => {
      process.env.JWT_SECRET = 'a'.repeat(32);
      ensureEnvFile('/some/path/.env');
      expect(mockFs.writeFileSync).not.toHaveBeenCalled();
    });

    it('JWT_SECRET 太短时应生成新密钥', () => {
      process.env.JWT_SECRET = 'short';
      mockFs.existsSync.mockReturnValue(false);
      ensureEnvFile('/test/.env');
      expect(mockFs.writeFileSync).toHaveBeenCalledTimes(1);
      expect(mockFs.chmodSync).toHaveBeenCalledWith('/test/.env', 0o600);
    });

    it('.env 文件已存在时跳过写入', () => {
      mockFs.existsSync.mockReturnValue(true);
      ensureEnvFile('/existing/.env');
      expect(mockFs.writeFileSync).not.toHaveBeenCalled();
    });

    it('写入失败时回退到环境变量', () => {
      mockFs.existsSync.mockReturnValue(false);
      mockFs.writeFileSync.mockImplementation((() => { throw new Error('write failed'); }) as any);
      ensureEnvFile('/fail/.env');
      expect(process.env.JWT_SECRET).toBeDefined();
      expect(process.env.JWT_EXPIRES_IN).toBeDefined();
      expect(process.env.PORT).toBeDefined();
      expect(process.env.CORS_ORIGIN).toBeDefined();
    });
  });

  describe('getEnvPath', () => {
    it('使用 ENV_PATH 环境变量', () => {
      process.env.ENV_PATH = '/custom/.env';
      const result = getEnvPath();
      expect(result).toBe('/custom/.env');
    });

    it('回退到 getDataDir 下的 .env', () => {
      const result = getEnvPath();
      expect(result).toMatch(/\.env$/);
    });
  });

  describe('migrateLegacyDatabaseIfNeeded', () => {
    it('目标数据库已存在时跳过迁移', () => {
      mockFs.existsSync.mockReturnValue(true);
      migrateLegacyDatabaseIfNeeded();
      expect(mockFs.copyFileSync).not.toHaveBeenCalled();
    });

    it('候选路径均不存在时不执行迁移', () => {
      mockFs.existsSync.mockReturnValue(false);
      migrateLegacyDatabaseIfNeeded();
      expect(mockFs.copyFileSync).not.toHaveBeenCalled();
    });

    it('LEGACY_DB_PATH 存在时应复制文件', () => {
      process.env.LEGACY_DB_PATH = '/old/db.sqlite';
      mockFs.existsSync.mockImplementation(((path: string) => {
        const normalized = path.replace(/\\/g, '/');
        return normalized === '/old/db.sqlite';
      }) as any);
      migrateLegacyDatabaseIfNeeded();
      expect(mockFs.copyFileSync).toHaveBeenCalled();
    });

    it('resourcesPath 候选存在时应复制', () => {
      const originalResourcesPath = (process as any).resourcesPath;
      (process as any).resourcesPath = '/app/resources';
      mockFs.existsSync.mockImplementation(((path: string) => {
        const normalized = path.replace(/\\/g, '/');
        return normalized === '/app/resources/api/data/dental.sqlite';
      }) as any);
      migrateLegacyDatabaseIfNeeded();
      expect(mockFs.copyFileSync).toHaveBeenCalled();
      (process as any).resourcesPath = originalResourcesPath;
    });

    it('迁移失败时应记录错误且不抛出', () => {
      process.env.LEGACY_DB_PATH = '/old/db.sqlite';
      mockFs.existsSync.mockImplementation(((path: string) => {
        const normalized = path.replace(/\\/g, '/');
        return normalized === '/old/db.sqlite';
      }) as any);
      mockFs.copyFileSync.mockImplementation((() => { throw new Error('copy failed'); }) as any);
      expect(() => migrateLegacyDatabaseIfNeeded()).not.toThrow();
    });

    it('WAL/SHM 文件存在时应一并复制', () => {
      process.env.LEGACY_DB_PATH = '/old/db.sqlite';
      mockFs.existsSync.mockImplementation(((path: string) => {
        const normalized = path.replace(/\\/g, '/');
        if (normalized === '/old/db.sqlite') return true;
        if (normalized === '/old/db.sqlite-wal') return true;
        if (normalized === '/old/db.sqlite-shm') return false;
        return false;
      }) as any);
      migrateLegacyDatabaseIfNeeded();
      expect(mockFs.copyFileSync).toHaveBeenCalledTimes(2);
    });

    it('复制 WAL/SHM 失败时应记录警告', () => {
      process.env.LEGACY_DB_PATH = '/old/db.sqlite';
      mockFs.existsSync.mockImplementation(((path: string) => {
        const normalized = path.replace(/\\/g, '/');
        if (normalized === '/old/db.sqlite') return true;
        if (normalized === '/old/db.sqlite-wal') return true;
        return false;
      }) as any);
      let callCount = 0;
      mockFs.copyFileSync.mockImplementation(((..._args: any[]) => {
        callCount++;
        if (callCount === 2) throw new Error('wal copy failed');
      }) as any);
      migrateLegacyDatabaseIfNeeded();
      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });
});