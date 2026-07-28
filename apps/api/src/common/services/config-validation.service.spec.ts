import { ConfigValidationService } from './config-validation.service';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';

describe('ConfigValidationService', () => {
  let service: ConfigValidationService;
  let configService: ConfigService;
  let configGetMock: jest.Mock;
  let processExitSpy: jest.SpyInstance;
  let loggerErrorSpy: jest.SpyInstance;
  let loggerWarnSpy: jest.SpyInstance;
  let loggerLogSpy: jest.SpyInstance;

  const VALID_JWT_SECRET = 'mySuperSecretKey1234567890abcdefghij';
  const VALID_ENCRYPTION_KEY = 'a1b2c3d4e5f607182930a1b2c3d4e5f607182930a1b2c3d4e5f607182930abcd';

  beforeEach(() => {
    configGetMock = jest.fn();
    configService = {
      get: configGetMock,
    } as unknown as ConfigService;

    service = new ConfigValidationService(configService);

    processExitSpy = jest.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    loggerErrorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    loggerWarnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    loggerLogSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.NODE_ENV;
  });

  function setConfigValues(values: Record<string, string | undefined>) {
    configGetMock.mockImplementation((key: string) => values[key]);
  }

  describe('validate()', () => {
    describe('JWT_SECRET 校验', () => {
      it('JWT_SECRET 未设置时应返回 error', () => {
        setConfigValues({ JWT_SECRET: undefined, NODE_ENV: 'development' });
        const result = service.validate();
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('JWT_SECRET 未设置');
      });

      it('JWT_SECRET 使用弱值时应返回 error', () => {
        setConfigValues({ JWT_SECRET: 'password', NODE_ENV: 'development' });
        const result = service.validate();
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('JWT_SECRET 使用了默认弱值，请更换为随机字符串');
      });

      it('JWT_SECRET 使用弱值（不区分大小写）时应返回 error', () => {
        setConfigValues({ JWT_SECRET: 'PASSWORD', NODE_ENV: 'development' });
        const result = service.validate();
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('JWT_SECRET 使用了默认弱值，请更换为随机字符串');
      });

      it('生产环境 JWT_SECRET 长度不足32时应返回 warning', () => {
        process.env.NODE_ENV = 'production';
        setConfigValues({
          JWT_SECRET: 'short-secret-1234567890',
          ENCRYPTION_KEY: VALID_ENCRYPTION_KEY,
          NODE_ENV: 'production',
          ADMIN_INITIAL_PASSWORD: 'StrongPass123',
        });
        const result = service.validate();
        expect(result.valid).toBe(true);
        expect(result.warnings).toContain('JWT_SECRET 长度不足 32 字符，生产环境建议使用更长的密钥');
      });

      it('开发环境 JWT_SECRET 长度不足32时不应返回 warning', () => {
        process.env.NODE_ENV = 'development';
        setConfigValues({ JWT_SECRET: 'short-secret-1234567890', NODE_ENV: 'development' });
        const result = service.validate();
        expect(result.warnings).not.toContain(expect.stringContaining('JWT_SECRET 长度不足'));
      });

      it('JWT_SECRET 全相同字符时应返回 error', () => {
        setConfigValues({ JWT_SECRET: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', NODE_ENV: 'development' });
        const result = service.validate();
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('JWT_SECRET 强度不足：全部由相同字符组成');
      });

      it('JWT_SECRET 顺序字符（数字）时应返回 error', () => {
        setConfigValues({ JWT_SECRET: '1234567', NODE_ENV: 'development' });
        const result = service.validate();
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('JWT_SECRET 强度不足：为顺序字符（如 123456、abcdef）');
      });

      it('JWT_SECRET 顺序字符（字母）时应返回 error', () => {
        setConfigValues({ JWT_SECRET: 'abcdefghij', NODE_ENV: 'development' });
        const result = service.validate();
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('JWT_SECRET 强度不足：为顺序字符（如 123456、abcdef）');
      });

      it('JWT_SECRET 顺序字符（倒序数字）时应返回 error', () => {
        setConfigValues({ JWT_SECRET: '9876543210', NODE_ENV: 'development' });
        const result = service.validate();
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('JWT_SECRET 强度不足：为顺序字符（如 123456、abcdef）');
      });

      it('JWT_SECRET 只有字母无数字时应返回 error', () => {
        setConfigValues({ JWT_SECRET: 'abcdefghijklmnopqrstuvwxyzabcd', NODE_ENV: 'development' });
        const result = service.validate();
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('JWT_SECRET 字符多样性不足：长度小于 48 位时必须同时包含字母和数字');
      });

      it('JWT_SECRET 只有数字无字母时应返回 error', () => {
        setConfigValues({ JWT_SECRET: '12345678901234567890123456789012', NODE_ENV: 'development' });
        const result = service.validate();
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('JWT_SECRET 字符多样性不足：长度小于 48 位时必须同时包含字母和数字');
      });

      it('JWT_SECRET 长度 >= 48 位时不检查字符多样性', () => {
        const longSecret = 'a'.repeat(48);
        setConfigValues({ JWT_SECRET: longSecret, NODE_ENV: 'development' });
        const result = service.validate();
        expect(result.errors).not.toContain(expect.stringContaining('字符多样性不足'));
      });
    });

    describe('ENCRYPTION_KEY 校验', () => {
      beforeEach(() => {
        setConfigValues({ JWT_SECRET: VALID_JWT_SECRET, NODE_ENV: 'development' });
      });

      it('生产环境 ENCRYPTION_KEY 未设置时应返回 error', () => {
        process.env.NODE_ENV = 'production';
        setConfigValues({ JWT_SECRET: VALID_JWT_SECRET, ENCRYPTION_KEY: undefined, NODE_ENV: 'production' });
        const result = service.validate();
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('ENCRYPTION_KEY 未设置（生产环境必填）');
      });

      it('开发环境 ENCRYPTION_KEY 未设置时不应返回 error', () => {
        process.env.NODE_ENV = 'development';
        setConfigValues({ JWT_SECRET: VALID_JWT_SECRET, ENCRYPTION_KEY: undefined, NODE_ENV: 'development' });
        const result = service.validate();
        expect(result.errors).not.toContain(expect.stringContaining('ENCRYPTION_KEY 未设置'));
      });

      it('ENCRYPTION_KEY 格式错误（非64位十六进制）时应返回 error', () => {
        setConfigValues({ JWT_SECRET: VALID_JWT_SECRET, ENCRYPTION_KEY: 'invalid-key', NODE_ENV: 'development' });
        const result = service.validate();
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('ENCRYPTION_KEY 格式不正确，必须是 64 位十六进制字符串');
      });

      it('ENCRYPTION_KEY 长度不足64位时应返回 error', () => {
        setConfigValues({ JWT_SECRET: VALID_JWT_SECRET, ENCRYPTION_KEY: 'a1b2c3d4', NODE_ENV: 'development' });
        const result = service.validate();
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('ENCRYPTION_KEY 格式不正确，必须是 64 位十六进制字符串');
      });

      it('ENCRYPTION_KEY 全相同字符时应返回 error', () => {
        const allSameKey = 'a'.repeat(64);
        setConfigValues({ JWT_SECRET: VALID_JWT_SECRET, ENCRYPTION_KEY: allSameKey, NODE_ENV: 'development' });
        const result = service.validate();
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('ENCRYPTION_KEY 强度不足：全部由相同字符组成');
      });

      it('ENCRYPTION_KEY 包含非十六进制字符时应返回格式错误', () => {
        const invalidKey = 'g'.repeat(64);
        setConfigValues({ JWT_SECRET: VALID_JWT_SECRET, ENCRYPTION_KEY: invalidKey, NODE_ENV: 'development' });
        const result = service.validate();
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('ENCRYPTION_KEY 格式不正确，必须是 64 位十六进制字符串');
      });
    });

    describe('NODE_ENV 校验', () => {
      beforeEach(() => {
        setConfigValues({ JWT_SECRET: VALID_JWT_SECRET, ENCRYPTION_KEY: VALID_ENCRYPTION_KEY });
      });

      it('NODE_ENV 为未知值时应返回 warning', () => {
        setConfigValues({ JWT_SECRET: VALID_JWT_SECRET, ENCRYPTION_KEY: VALID_ENCRYPTION_KEY, NODE_ENV: 'staging' });
        const result = service.validate();
        expect(result.warnings).toContain('NODE_ENV 为未知值: staging');
      });

      it('NODE_ENV 为 development 时不应返回 warning', () => {
        setConfigValues({ JWT_SECRET: VALID_JWT_SECRET, ENCRYPTION_KEY: VALID_ENCRYPTION_KEY, NODE_ENV: 'development' });
        const result = service.validate();
        expect(result.warnings).not.toContain(expect.stringContaining('NODE_ENV'));
      });

      it('NODE_ENV 为 production 时不应返回 warning', () => {
        setConfigValues({ JWT_SECRET: VALID_JWT_SECRET, ENCRYPTION_KEY: VALID_ENCRYPTION_KEY, NODE_ENV: 'production' });
        const result = service.validate();
        expect(result.warnings).not.toContain(expect.stringContaining('NODE_ENV'));
      });

      it('NODE_ENV 为 test 时不应返回 warning', () => {
        setConfigValues({ JWT_SECRET: VALID_JWT_SECRET, ENCRYPTION_KEY: VALID_ENCRYPTION_KEY, NODE_ENV: 'test' });
        const result = service.validate();
        expect(result.warnings).not.toContain(expect.stringContaining('NODE_ENV'));
      });

      it('NODE_ENV 未设置时默认为 development', () => {
        setConfigValues({ JWT_SECRET: VALID_JWT_SECRET, ENCRYPTION_KEY: VALID_ENCRYPTION_KEY, NODE_ENV: undefined });
        const result = service.validate();
        expect(result.warnings).not.toContain(expect.stringContaining('NODE_ENV'));
      });
    });

    describe('PORT 校验', () => {
      beforeEach(() => {
        setConfigValues({ JWT_SECRET: VALID_JWT_SECRET, ENCRYPTION_KEY: VALID_ENCRYPTION_KEY, NODE_ENV: 'development' });
      });

      it('PORT 为无效字符串时应返回 error', () => {
        setConfigValues({ JWT_SECRET: VALID_JWT_SECRET, ENCRYPTION_KEY: VALID_ENCRYPTION_KEY, NODE_ENV: 'development', PORT: 'not-a-number' });
        const result = service.validate();
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('PORT 无效: not-a-number');
      });

      it('PORT 小于1时应返回 error', () => {
        setConfigValues({ JWT_SECRET: VALID_JWT_SECRET, ENCRYPTION_KEY: VALID_ENCRYPTION_KEY, NODE_ENV: 'development', PORT: '0' });
        const result = service.validate();
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('PORT 无效: 0');
      });

      it('PORT 大于65535时应返回 error', () => {
        setConfigValues({ JWT_SECRET: VALID_JWT_SECRET, ENCRYPTION_KEY: VALID_ENCRYPTION_KEY, NODE_ENV: 'development', PORT: '70000' });
        const result = service.validate();
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('PORT 无效: 70000');
      });

      it('PORT 为有效端口时不应返回 error', () => {
        setConfigValues({ JWT_SECRET: VALID_JWT_SECRET, ENCRYPTION_KEY: VALID_ENCRYPTION_KEY, NODE_ENV: 'development', PORT: '3000' });
        const result = service.validate();
        expect(result.errors).not.toContain(expect.stringContaining('PORT'));
      });

      it('PORT 未设置时不应返回 error', () => {
        setConfigValues({ JWT_SECRET: VALID_JWT_SECRET, ENCRYPTION_KEY: VALID_ENCRYPTION_KEY, NODE_ENV: 'development', PORT: undefined });
        const result = service.validate();
        expect(result.errors).not.toContain(expect.stringContaining('PORT'));
      });
    });

    describe('有效配置', () => {
      it('所有配置有效时应返回 valid=true 和空 errors', () => {
        setConfigValues({
          JWT_SECRET: VALID_JWT_SECRET,
          ENCRYPTION_KEY: VALID_ENCRYPTION_KEY,
          NODE_ENV: 'development',
          PORT: '3000',
        });
        const result = service.validate();
        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
      });
    });
  });

  describe('validateJwtSecretOrExit()', () => {
    it('有效密钥时不调用 process.exit', () => {
      setConfigValues({ JWT_SECRET: VALID_JWT_SECRET });
      expect(() => service.validateJwtSecretOrExit()).not.toThrow();
      expect(processExitSpy).not.toHaveBeenCalled();
    });

    it('JWT_SECRET 未设置时应调用 process.exit(1)', () => {
      setConfigValues({ JWT_SECRET: undefined });
      expect(() => service.validateJwtSecretOrExit()).toThrow();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('JWT_SECRET 为弱值时应调用 process.exit(1)', () => {
      setConfigValues({ JWT_SECRET: 'password' });
      expect(() => service.validateJwtSecretOrExit()).toThrow();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('JWT_SECRET 长度不足时应调用 process.exit(1)', () => {
      setConfigValues({ JWT_SECRET: 'short123' });
      expect(() => service.validateJwtSecretOrExit()).toThrow();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('JWT_SECRET 全相同字符时应调用 process.exit(1)', () => {
      setConfigValues({ JWT_SECRET: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });
      expect(() => service.validateJwtSecretOrExit()).toThrow();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('JWT_SECRET 顺序字符时应调用 process.exit(1)', () => {
      setConfigValues({ JWT_SECRET: 'abcdefghijklmnopqrstuvwxyz12' });
      expect(() => service.validateJwtSecretOrExit()).toThrow();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('JWT_SECRET 多样性不足时应调用 process.exit(1)', () => {
      setConfigValues({ JWT_SECRET: 'abcdefghijklmnopqrstuvwxyzabcd' });
      expect(() => service.validateJwtSecretOrExit()).toThrow();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('validateEncryptionKeyOrExit()', () => {
    it('有效密钥时不调用 process.exit', () => {
      setConfigValues({ ENCRYPTION_KEY: VALID_ENCRYPTION_KEY });
      expect(() => service.validateEncryptionKeyOrExit()).not.toThrow();
      expect(processExitSpy).not.toHaveBeenCalled();
    });

    it('ENCRYPTION_KEY 未设置时应调用 process.exit(1)', () => {
      setConfigValues({ ENCRYPTION_KEY: undefined });
      expect(() => service.validateEncryptionKeyOrExit()).toThrow();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('ENCRYPTION_KEY 格式错误时应调用 process.exit(1)', () => {
      setConfigValues({ ENCRYPTION_KEY: 'invalid-key' });
      expect(() => service.validateEncryptionKeyOrExit()).toThrow();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('ENCRYPTION_KEY 全相同字符时应调用 process.exit(1)', () => {
      const allSameKey = 'a'.repeat(64);
      setConfigValues({ ENCRYPTION_KEY: allSameKey });
      expect(() => service.validateEncryptionKeyOrExit()).toThrow();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('validateAllOrExit()', () => {
    it('应调用 validateJwtSecretOrExit、validateEncryptionKeyOrExit 和 validateAdminInitialPasswordOrExit', () => {
      const jwtSpy = jest.spyOn(service, 'validateJwtSecretOrExit').mockImplementation(() => {});
      const encSpy = jest.spyOn(service, 'validateEncryptionKeyOrExit').mockImplementation(() => {});
      const adminSpy = jest.spyOn(service, 'validateAdminInitialPasswordOrExit').mockImplementation(() => {});

      service.validateAllOrExit();

      expect(jwtSpy).toHaveBeenCalled();
      expect(encSpy).toHaveBeenCalled();
      expect(adminSpy).toHaveBeenCalled();
    });
  });

  describe('validateAdminInitialPasswordOrExit()', () => {
    it('生产环境未设置 ADMIN_INITIAL_PASSWORD 时应调用 process.exit(1)', () => {
      process.env.NODE_ENV = 'production';
      setConfigValues({ NODE_ENV: 'production', ADMIN_INITIAL_PASSWORD: undefined });
      expect(() => service.validateAdminInitialPasswordOrExit()).toThrow();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('生产环境 ADMIN_INITIAL_PASSWORD 复杂度不足时应调用 process.exit(1)', () => {
      process.env.NODE_ENV = 'production';
      setConfigValues({ NODE_ENV: 'production', ADMIN_INITIAL_PASSWORD: '12345678' });
      expect(() => service.validateAdminInitialPasswordOrExit()).toThrow();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('生产环境 ADMIN_INITIAL_PASSWORD 复杂度符合要求时不退出', () => {
      process.env.NODE_ENV = 'production';
      setConfigValues({ NODE_ENV: 'production', ADMIN_INITIAL_PASSWORD: 'SecurePass1' });
      expect(() => service.validateAdminInitialPasswordOrExit()).not.toThrow();
      expect(processExitSpy).not.toHaveBeenCalled();
    });

    it('开发环境未设置 ADMIN_INITIAL_PASSWORD 时应记录警告日志', () => {
      process.env.NODE_ENV = 'development';
      setConfigValues({ NODE_ENV: 'development', ADMIN_INITIAL_PASSWORD: undefined });
      expect(() => service.validateAdminInitialPasswordOrExit()).not.toThrow();
      expect(loggerWarnSpy).toHaveBeenCalled();
    });

    it('开发环境 ADMIN_INITIAL_PASSWORD 复杂度不足时应记录警告日志', () => {
      process.env.NODE_ENV = 'development';
      setConfigValues({ NODE_ENV: 'development', ADMIN_INITIAL_PASSWORD: '12345678' });
      expect(() => service.validateAdminInitialPasswordOrExit()).not.toThrow();
      expect(loggerWarnSpy).toHaveBeenCalled();
    });
  });

  describe('ADMIN_INITIAL_PASSWORD 校验', () => {
    beforeEach(() => {
      setConfigValues({ JWT_SECRET: VALID_JWT_SECRET, ENCRYPTION_KEY: VALID_ENCRYPTION_KEY });
    });

    it('生产环境未设置 ADMIN_INITIAL_PASSWORD 时应返回 error', () => {
      process.env.NODE_ENV = 'production';
      setConfigValues({
        JWT_SECRET: VALID_JWT_SECRET,
        ENCRYPTION_KEY: VALID_ENCRYPTION_KEY,
        NODE_ENV: 'production',
        ADMIN_INITIAL_PASSWORD: undefined,
      });
      const result = service.validate();
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('生产环境必须设置 ADMIN_INITIAL_PASSWORD');
    });

    it('生产环境 ADMIN_INITIAL_PASSWORD 复杂度不足时应返回 error', () => {
      process.env.NODE_ENV = 'production';
      setConfigValues({
        JWT_SECRET: VALID_JWT_SECRET,
        ENCRYPTION_KEY: VALID_ENCRYPTION_KEY,
        NODE_ENV: 'production',
        ADMIN_INITIAL_PASSWORD: '12345678',
      });
      const result = service.validate();
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('ADMIN_INITIAL_PASSWORD 复杂度不足'))).toBe(true);
    });

    it('生产环境 ADMIN_INITIAL_PASSWORD 复杂度符合要求时不应返回 error', () => {
      process.env.NODE_ENV = 'production';
      setConfigValues({
        JWT_SECRET: VALID_JWT_SECRET,
        ENCRYPTION_KEY: VALID_ENCRYPTION_KEY,
        NODE_ENV: 'production',
        ADMIN_INITIAL_PASSWORD: 'SecurePass1',
      });
      const result = service.validate();
      expect(result.errors).not.toContain(expect.stringContaining('ADMIN_INITIAL_PASSWORD'));
    });

    it('开发环境未设置 ADMIN_INITIAL_PASSWORD 时应返回 warning', () => {
      process.env.NODE_ENV = 'development';
      setConfigValues({
        JWT_SECRET: VALID_JWT_SECRET,
        ENCRYPTION_KEY: VALID_ENCRYPTION_KEY,
        NODE_ENV: 'development',
        ADMIN_INITIAL_PASSWORD: undefined,
      });
      const result = service.validate();
      expect(result.warnings).toContain('未配置 ADMIN_INITIAL_PASSWORD，开发环境将使用默认密码');
    });
  });

  describe('onModuleInit()', () => {
    it('有错误时应抛出 Error', () => {
      setConfigValues({ JWT_SECRET: undefined, NODE_ENV: 'development' });
      expect(() => service.onModuleInit()).toThrow('配置校验失败，请检查环境变量');
    });

    it('无错误时应正常返回', () => {
      setConfigValues({
        JWT_SECRET: VALID_JWT_SECRET,
        ENCRYPTION_KEY: VALID_ENCRYPTION_KEY,
        NODE_ENV: 'development',
      });
      expect(() => service.onModuleInit()).not.toThrow();
      expect(loggerLogSpy).toHaveBeenCalledWith('配置校验通过');
    });

    it('有 warnings 时应记录 warn 日志', () => {
      setConfigValues({
        JWT_SECRET: VALID_JWT_SECRET,
        ENCRYPTION_KEY: VALID_ENCRYPTION_KEY,
        NODE_ENV: 'staging',
      });
      service.onModuleInit();
      expect(loggerWarnSpy).toHaveBeenCalled();
    });

    it('有错误时应记录 error 日志', () => {
      setConfigValues({ JWT_SECRET: undefined, NODE_ENV: 'development' });
      try {
        service.onModuleInit();
      } catch {
        // ignore
      }
      expect(loggerErrorSpy).toHaveBeenCalled();
    });
  });
});
