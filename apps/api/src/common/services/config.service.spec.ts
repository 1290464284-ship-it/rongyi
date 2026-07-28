jest.mock('node:fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  mkdirSync: jest.fn(),
  statSync: jest.fn(),
  openSync: jest.fn(),
  writeFileSync: jest.fn(),
  closeSync: jest.fn(),
}));

import { ConfigService } from './config.service';
import * as fs from 'node:fs';

describe('ConfigService', () => {
  let service: ConfigService;
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    originalEnv = { ...process.env };
    jest.clearAllMocks();
    delete process.env.ENV_PATH;
    delete process.env.PORT;
    delete process.env.JWT_SECRET;
    delete process.env.JWT_EXPIRES_IN;
    delete process.env.ENCRYPTION_KEY;
    delete process.env.DATA_DIR;
    delete process.env.DB_PATH;
    delete process.env.BCRYPT_ROUNDS;
    delete process.env.SQLITE_BUSY_TIMEOUT_MS;
    delete process.env.SQLITE_CACHE_SIZE;
    delete process.env.SQLITE_JOURNAL_MODE;
    delete process.env.SQLITE_SYNCHRONOUS;
    delete process.env.SQLITE_TEMP_STORE;
    delete process.env.SQLITE_MMAP_SIZE;
    delete process.env.SQLITE_WAL_AUTOCHECKPOINT;
    delete process.env.CORS_ORIGIN;

    (fs.existsSync as jest.Mock).mockReturnValue(false);
    service = new ConfigService();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('loadEnvFile', () => {
    it('应在 env 文件存在时解析并缓存变量', () => {
      const envContent = 'KEY1=value1\nKEY2=value2\nINVALID_LINE\nKEY3=value3';
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(envContent);

      const svc = new ConfigService();
      expect(svc.get('KEY1')).toBe('value1');
      expect(svc.get('KEY2')).toBe('value2');
      expect(svc.get('KEY3')).toBe('value3');
    });

    it('应在 env 文件不存在时跳过加载', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      const svc = new ConfigService();
      expect(svc.get('NONEXISTENT')).toBeUndefined();
    });

    it('应在读取 env 文件失败时不抛出', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockImplementation(() => { throw new Error('read error'); });
      expect(() => new ConfigService()).not.toThrow();
    });

    it('应使用 ENV_PATH 环境变量指定路径', () => {
      process.env.ENV_PATH = '/custom/path/.env';
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue('CUSTOM_KEY=custom_value');
      const svc = new ConfigService();
      expect(svc.get('CUSTOM_KEY')).toBe('custom_value');
    });
  });

  describe('get', () => {
    it('应优先返回 process.env 中的值', () => {
      process.env.TEST_KEY = 'env_value';
      expect(service.get('TEST_KEY')).toBe('env_value');
    });

    it('应回退到 envCache 中的值', () => {
      const envContent = 'CACHE_KEY=cache_value';
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(envContent);
      const svc = new ConfigService();
      expect(svc.get('CACHE_KEY')).toBe('cache_value');
    });

    it('应回退到 ENV_FALLBACKS', () => {
      expect(service.get('PORT')).toBeDefined();
      expect(service.get('JWT_EXPIRES_IN')).toBeDefined();
    });

    it('未找到时应返回 undefined', () => {
      expect(service.get('NONEXISTENT_KEY')).toBeUndefined();
    });
  });

  describe('getOrThrow', () => {
    it('存在时应返回值', () => {
      process.env.THROW_KEY = 'exists';
      expect(service.getOrThrow('THROW_KEY')).toBe('exists');
    });

    it('不存在时应抛出错误', () => {
      expect(() => service.getOrThrow('MISSING_KEY')).toThrow('环境变量 MISSING_KEY 未设置');
    });
  });

  describe('getNumber', () => {
    it('应解析数字字符串', () => {
      process.env.NUM_KEY = '42';
      expect(service.getNumber('NUM_KEY')).toBe(42);
    });

    it('无效数字应返回默认值', () => {
      process.env.NUM_KEY = 'not_a_number';
      expect(service.getNumber('NUM_KEY', 99)).toBe(99);
    });

    it('未设置时应返回默认值', () => {
      expect(service.getNumber('NUM_KEY', 99)).toBe(99);
    });

    it('未设置且无默认值时应返回 undefined', () => {
      expect(service.getNumber('NUM_KEY')).toBeUndefined();
    });
  });

  describe('getBoolean', () => {
    it('应识别 true/1/yes', () => {
      process.env.BOOL_KEY = 'true';
      expect(service.getBoolean('BOOL_KEY')).toBe(true);
      process.env.BOOL_KEY = '1';
      expect(service.getBoolean('BOOL_KEY')).toBe(true);
      process.env.BOOL_KEY = 'yes';
      expect(service.getBoolean('BOOL_KEY')).toBe(true);
    });

    it('应识别 false 值', () => {
      process.env.BOOL_KEY = 'false';
      expect(service.getBoolean('BOOL_KEY')).toBe(false);
    });

    it('未设置时应返回默认值', () => {
      expect(service.getBoolean('BOOL_KEY', true)).toBe(true);
    });

    it('未设置且无默认值时应返回 false', () => {
      expect(service.getBoolean('BOOL_KEY')).toBe(false);
    });
  });

  describe('getStringArray', () => {
    it('应按分隔符拆分', () => {
      process.env.ARR_KEY = 'a,b,c';
      expect(service.getStringArray('ARR_KEY')).toEqual(['a', 'b', 'c']);
    });

    it('应按自定义分隔符拆分', () => {
      process.env.ARR_KEY = 'a;b;c';
      expect(service.getStringArray('ARR_KEY', ';')).toEqual(['a', 'b', 'c']);
    });

    it('空值应返回空数组', () => {
      expect(service.getStringArray('ARR_KEY')).toEqual([]);
    });

    it('应过滤空字符串', () => {
      process.env.ARR_KEY = 'a,,b,';
      expect(service.getStringArray('ARR_KEY')).toEqual(['a', 'b']);
    });
  });

  describe('预定义 getter', () => {
    it('PORT 应返回数字', () => {
      process.env.PORT = '3000';
      expect(service.PORT).toBe(3000);
    });

    it('CORS_ORIGIN 应返回数组', () => {
      // eslint-disable-next-line sonarjs/no-clear-text-protocols
      process.env.CORS_ORIGIN = 'http://a.com,http://b.com';
      // eslint-disable-next-line sonarjs/no-clear-text-protocols
      expect(service.CORS_ORIGIN).toEqual(['http://a.com', 'http://b.com']);
    });

    it('BCRYPT_ROUNDS 应返回数字', () => {
      process.env.BCRYPT_ROUNDS = '12';
      expect(service.BCRYPT_ROUNDS).toBe(12);
    });

    it('SQLITE_BUSY_TIMEOUT_MS 应返回数字', () => {
      process.env.SQLITE_BUSY_TIMEOUT_MS = '5000';
      expect(service.SQLITE_BUSY_TIMEOUT_MS).toBe(5000);
    });

    it('SQLITE_CACHE_SIZE 应返回数字', () => {
      process.env.SQLITE_CACHE_SIZE = '2000';
      expect(service.SQLITE_CACHE_SIZE).toBe(2000);
    });

    it('SQLITE_JOURNAL_MODE 应返回字符串', () => {
      process.env.SQLITE_JOURNAL_MODE = 'WAL';
      expect(service.SQLITE_JOURNAL_MODE).toBe('WAL');
    });

    it('SQLITE_SYNCHRONOUS 应返回字符串', () => {
      process.env.SQLITE_SYNCHRONOUS = 'NORMAL';
      expect(service.SQLITE_SYNCHRONOUS).toBe('NORMAL');
    });

    it('SQLITE_TEMP_STORE 应返回字符串', () => {
      process.env.SQLITE_TEMP_STORE = 'MEMORY';
      expect(service.SQLITE_TEMP_STORE).toBe('MEMORY');
    });

    it('SQLITE_MMAP_SIZE 应返回数字', () => {
      process.env.SQLITE_MMAP_SIZE = '268435456';
      expect(service.SQLITE_MMAP_SIZE).toBe(268435456);
    });

    it('SQLITE_WAL_AUTOCHECKPOINT 应返回数字', () => {
      process.env.SQLITE_WAL_AUTOCHECKPOINT = '1000';
      expect(service.SQLITE_WAL_AUTOCHECKPOINT).toBe(1000);
    });

    it('JWT_SECRET 在未设置时应抛出', () => {
      expect(() => service.JWT_SECRET).toThrow();
    });

    it('JWT_EXPIRES_IN 应返回默认值', () => {
      expect(service.JWT_EXPIRES_IN).toBeDefined();
    });

    it('ENCRYPTION_KEY 未设置时应返回 undefined', () => {
      expect(service.ENCRYPTION_KEY).toBeUndefined();
    });

    it('DATA_DIR 未设置时应返回 undefined', () => {
      expect(service.DATA_DIR).toBeUndefined();
    });

    it('DB_PATH 未设置时应返回 undefined', () => {
      expect(service.DB_PATH).toBeUndefined();
    });
  });
});