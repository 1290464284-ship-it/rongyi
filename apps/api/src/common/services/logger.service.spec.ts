import { AppLogger, sanitizeObject, sanitizeString, shutdownLogger } from './logger.service';
import { runWithContext, generateTraceId } from '../utils/context/async-context';

describe('logger.service 日志服务', () => {
  let logger: AppLogger;
  let originalNodeEnv: string | undefined;
  let originalLogLevel: string | undefined;
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;
  let consoleDebugSpy: jest.SpyInstance;

  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV;
    originalLogLevel = process.env.LOG_LEVEL;
    process.env.NODE_ENV = 'test';
    process.env.LOG_LEVEL = 'debug';
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));

    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    consoleDebugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});

    logger = new AppLogger('TestContext');
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    process.env.LOG_LEVEL = originalLogLevel;
    jest.useRealTimers();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleDebugSpy.mockRestore();
    shutdownLogger();
  });

  describe('sanitizeObject 对象脱敏', () => {
    it('应正确脱敏敏感字段', () => {
      const obj = {
        username: 'testuser',
        password: 'secret123',
        email: 'test@example.com',
        profile: {
          phone: '13800138000',
          age: 25,
        },
      };
      const result = sanitizeObject(obj) as Record<string, unknown>;
      expect(result.username).toBe('testuser');
      expect(result.password).toBe('***');
      expect(result.email).toBe('***');
      expect((result.profile as Record<string, unknown>).phone).toBe('***');
      expect((result.profile as Record<string, unknown>).age).toBe(25);
    });

    it('应处理 null 值', () => {
      expect(sanitizeObject(null)).toBeNull();
    });

    it('应处理非对象值', () => {
      expect(sanitizeObject('string')).toBe('string');
      expect(sanitizeObject(123)).toBe(123);
      expect(sanitizeObject(undefined)).toBeUndefined();
    });

    it('应处理数组', () => {
      const arr = [
        { password: 'secret1', name: 'a' },
        { password: 'secret2', name: 'b' },
      ];
      const result = sanitizeObject(arr) as Array<Record<string, unknown>>;
      expect(result[0].password).toBe('***');
      expect(result[0].name).toBe('a');
      expect(result[1].password).toBe('***');
      expect(result[1].name).toBe('b');
    });

    it('应限制最大递归深度', () => {
      const deep: Record<string, unknown> = { level1: { level2: { level3: 'deep' } } };
      const result = sanitizeObject(deep, 9) as Record<string, unknown>;
      expect(result.level1).toBe('[Max Depth Reached]');
    });

    it('应正确脱敏 idCard 字段', () => {
      const obj = { idCard: '110101199001011234', name: '张三' };
      const result = sanitizeObject(obj) as Record<string, unknown>;
      expect(result.idCard).toBe('***');
      expect(result.name).toBe('张三');
    });

    it('应正确脱敏 token 字段', () => {
      const obj = { token: 'abc123', refreshToken: 'xyz789' };
      const result = sanitizeObject(obj) as Record<string, unknown>;
      expect(result.token).toBe('***');
      expect(result.refreshToken).toBe('***');
    });
  });

  describe('sanitizeString 字符串脱敏', () => {
    it('应脱敏 JSON 字符串中的敏感字段', () => {
      const str = '{"password":"secret123","username":"test"}';
      const result = sanitizeString(str);
      expect(result).toContain('"password":"***"');
      expect(result).toContain('"username":"test"');
    });

    it('应对空字符串直接返回', () => {
      expect(sanitizeString('')).toBe('');
    });

    it('应对不含敏感字段的字符串保持不变', () => {
      const str = '{"name":"test","age":25}';
      expect(sanitizeString(str)).toBe(str);
    });

    it('应脱敏 phone 字段', () => {
      const str = '{"phone":"13800138000"}';
      const result = sanitizeString(str);
      expect(result).toContain('"phone":"***"');
    });
  });

  describe('AppLogger 基础功能', () => {
    it('应能创建带上下文的 logger 实例', () => {
      const log = new AppLogger('MyContext');
      expect(log).toBeDefined();
      expect(typeof log.log).toBe('function');
    });

    it('setContext 应设置上下文', () => {
      const log = new AppLogger();
      log.setContext('NewContext');
      log.log('test message');
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it('log 方法应输出 info 级别日志', () => {
      logger.log('test info message');
      expect(consoleLogSpy).toHaveBeenCalled();
      const allOutput = consoleLogSpy.mock.calls[0].join(' ');
      expect(allOutput).toContain('INFO');
      expect(allOutput).toContain('test info message');
      expect(allOutput).toContain('[TestContext]');
    });

    it('warn 方法应输出 warn 级别日志', () => {
      logger.warn('test warn message');
      expect(consoleWarnSpy).toHaveBeenCalled();
      const allOutput = consoleWarnSpy.mock.calls[0].join(' ');
      expect(allOutput).toContain('WARN');
      expect(allOutput).toContain('test warn message');
    });

    it('error 方法应输出 error 级别日志', () => {
      logger.error('test error message');
      expect(consoleErrorSpy).toHaveBeenCalled();
      const allOutput = consoleErrorSpy.mock.calls[0].join(' ');
      expect(allOutput).toContain('ERROR');
      expect(allOutput).toContain('test error message');
    });

    it('debug 方法应输出 debug 级别日志', () => {
      logger.debug('test debug message');
      expect(consoleDebugSpy).toHaveBeenCalled();
      const allOutput = consoleDebugSpy.mock.calls[0].join(' ');
      expect(allOutput).toContain('DEBUG');
      expect(allOutput).toContain('test debug message');
    });

    it('error 方法应支持 Error 对象参数', () => {
      const err = new Error('test error');
      logger.error('something failed', err);
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('error 方法应支持字符串错误参数', () => {
      logger.error('something failed', 'stack trace string');
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  describe('日志级别过滤', () => {
    beforeEach(() => {
      process.env.LOG_LEVEL = 'warn';
      jest.resetModules();
    });

    afterEach(() => {
      process.env.LOG_LEVEL = originalLogLevel;
    });

    it('warn 级别应过滤 info 和 debug 日志', () => {
      const { AppLogger: LoggerClass } = require('./logger.service');
      const log = new LoggerClass('FilterTest');
      log.debug('debug message');
      log.log('info message');
      log.warn('warn message');
      log.error('error message');

      expect(consoleDebugSpy).not.toHaveBeenCalled();
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('error 级别只输出 error 错误', () => {
      process.env.LOG_LEVEL = 'error';
      jest.resetModules();
      const { AppLogger: LoggerClass } = require('./logger.service');
      const log = new LoggerClass('ErrorTest');
      log.debug('debug');
      log.log('info');
      log.warn('warn');
      log.error('error');

      expect(consoleDebugSpy).not.toHaveBeenCalled();
      expect(consoleLogSpy).not.toHaveBeenCalled();
      expect(consoleWarnSpy).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  describe('异步上下文 traceId 追踪', () => {
    it('应从 async context 中获取 traceId', () => {
      const traceId = generateTraceId();
      runWithContext({ traceId, userId: 'user-123', clinicId: 'clinic-456' }, () => {
        logger.log('test with context');
        expect(consoleLogSpy).toHaveBeenCalled();
        const allOutput = consoleLogSpy.mock.calls[0].join(' ');
        expect(allOutput).toContain(traceId.slice(0, 8));
      });
    });

    it('应从 async context 中获取 userId', () => {
      const traceId = generateTraceId();
      runWithContext({ traceId, userId: 'user-123' }, () => {
        logger.log('test with user');
        expect(consoleLogSpy).toHaveBeenCalled();
        const allOutput = consoleLogSpy.mock.calls[0].join(' ');
        expect(allOutput).toContain('user-123');
      });
    });

    it('应从 async context 中获取 clinicId', () => {
      const traceId = generateTraceId();
      runWithContext({ traceId, clinicId: 'clinic-789' }, () => {
        logger.log('test with clinic');
        expect(consoleLogSpy).toHaveBeenCalled();
        const allOutput = consoleLogSpy.mock.calls[0].join(' ');
        expect(allOutput).toContain('clinic-789');
      });
    });
  });

  describe('对象日志', () => {
    it('应记录对象并脱敏', () => {
      const obj = { username: 'test', password: 'secret123', email: 'test@test.com' };
      logger.log(obj);
      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls[0].join(' ');
      expect(output).toContain('username');
      expect(output).not.toContain('secret123');
    });
  });

  describe('logRequest 请求日志', () => {
    it('应记录请求完成日志', () => {
      const traceId = generateTraceId();
      logger.logRequest(traceId, 'GET', '/api/users', 200, 150);
      expect(consoleLogSpy).toHaveBeenCalled();
      const allOutput = consoleLogSpy.mock.calls[0].join(' ');
      expect(allOutput).toContain('GET');
      expect(allOutput).toContain('/api/users');
      expect(allOutput).toContain('200');
      expect(allOutput).toContain('150ms');
      expect(allOutput).toContain(traceId.slice(0, 8));
    });

    it('logRequest 应包含 userId 和 clinicId', () => {
      const traceId = generateTraceId();
      runWithContext({ traceId, userId: 'user-1', clinicId: 'clinic-1' }, () => {
        logger.logRequest(traceId, 'POST', '/api/test', 201, 50);
        expect(consoleLogSpy).toHaveBeenCalled();
        const allOutput = consoleLogSpy.mock.calls[0].join(' ');
        expect(allOutput).toContain('user-1');
        expect(allOutput).toContain('clinic-1');
      });
    });
  });

  describe('logError 错误日志', () => {
    it('应记录错误日志', () => {
      const traceId = generateTraceId();
      const err = new Error('test error message');
      logger.logError(traceId, 'Something went wrong', err);
      expect(consoleErrorSpy).toHaveBeenCalled();
      const allOutput = consoleErrorSpy.mock.calls[0].join(' ');
      expect(allOutput).toContain('ERROR');
      expect(allOutput).toContain('Something went wrong');
      expect(allOutput).toContain(traceId.slice(0, 8));
    });

    it('logError 应包含 userId 和 clinicId', () => {
      const traceId = generateTraceId();
      const err = new Error('test error');
      runWithContext({ traceId, userId: 'user-err', clinicId: 'clinic-err' }, () => {
        logger.logError(traceId, 'Error occurred', err);
        expect(consoleErrorSpy).toHaveBeenCalled();
        const allOutput = consoleErrorSpy.mock.calls[0].join(' ');
        expect(allOutput).toContain('user-err');
        expect(allOutput).toContain('clinic-err');
      });
    });

    it('logError 应处理 null/undefined error', () => {
      const traceId = generateTraceId();
      expect(() => {
        logger.logError(traceId, 'Error with null', null);
      }).not.toThrow();
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  describe('生产环境 JSON 输出', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
      jest.resetModules();
    });

    afterEach(() => {
      process.env.NODE_ENV = originalNodeEnv;
    });

    it('生产环境应输出 JSON 格式', () => {
      const { AppLogger: LoggerClass } = require('./logger.service');
      const log = new LoggerClass('ProdTest');
      log.log('prod test');
      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed.level).toBe('info');
      expect(parsed.message).toBe('prod test');
      expect(parsed.context).toBe('ProdTest');
      expect(parsed.timestamp).toBeDefined();
    });

    it('生产环境 debug 级别应输出 JSON', () => {
      process.env.LOG_LEVEL = 'debug';
      jest.resetModules();
      const { AppLogger: LoggerClass } = require('./logger.service');
      const log = new LoggerClass('ProdDebug');
      log.debug('prod debug message');
      expect(consoleDebugSpy).toHaveBeenCalled();
      const output = consoleDebugSpy.mock.calls[0][0];
      expect(() => JSON.parse(output)).not.toThrow();
      const parsed = JSON.parse(output);
      expect(parsed.level).toBe('debug');
    });

    it('生产环境 error 级别在 info 日志级别下应被过滤', () => {
      process.env.LOG_LEVEL = 'info';
      jest.resetModules();
      const { AppLogger: LoggerClass } = require('./logger.service');
      const log = new LoggerClass('ProdFilter');
      log.debug('should be filtered');
      expect(consoleDebugSpy).not.toHaveBeenCalled();
    });
  });

  describe('shutdownLogger 关闭日志', () => {
    it('应能正常关闭日志系统', () => {
      expect(() => {
        shutdownLogger();
      }).not.toThrow();
    });
  });

  describe('更多日志功能测试', () => {
    it('应处理空消息', () => {
      logger.log('');
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it('应处理数字消息', () => {
      logger.log(42);
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it('应处理布尔消息', () => {
      logger.log(true);
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it('应处理 null 消息', () => {
      logger.log(null);
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it('应处理 undefined 消息', () => {
      logger.log(undefined);
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it('debug 级别在 info 日志级别下应被过滤', () => {
      process.env.LOG_LEVEL = 'info';
      jest.resetModules();
      const { AppLogger: LoggerClass } = require('./logger.service');
      const log = new LoggerClass('FilterDebug');
      log.debug('debug message');
      expect(consoleDebugSpy).not.toHaveBeenCalled();
    });

    it('log 方法应输出到控制台', () => {
      logger.log('test message');
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it('logError 应正确处理 Error 对象', () => {
      const traceId = generateTraceId();
      const err = new Error('test error');
      logger.logError(traceId, 'Error occurred', err);
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('logError 应正确处理非 Error 对象', () => {
      const traceId = generateTraceId();
      logger.logError(traceId, 'Error occurred', 'not an error object');
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('空上下文应正常工作', () => {
      const log = new AppLogger();
      log.log('test without context');
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it('生产环境错误日志应输出 JSON', () => {
      process.env.NODE_ENV = 'production';
      jest.resetModules();
      const { AppLogger: LoggerClass } = require('./logger.service');
      const log = new LoggerClass('ProdError');
      log.error('prod error');
      expect(consoleErrorSpy).toHaveBeenCalled();
      const output = consoleErrorSpy.mock.calls[0][0];
      expect(() => JSON.parse(output)).not.toThrow();
    });

    it('生产环境警告日志应输出 JSON', () => {
      process.env.NODE_ENV = 'production';
      jest.resetModules();
      const { AppLogger: LoggerClass } = require('./logger.service');
      const log = new LoggerClass('ProdWarn');
      log.warn('prod warning');
      expect(consoleWarnSpy).toHaveBeenCalled();
      const output = consoleWarnSpy.mock.calls[0][0];
      expect(() => JSON.parse(output)).not.toThrow();
    });

    it('生产环境 error 级别应输出 JSON', () => {
      process.env.NODE_ENV = 'production';
      process.env.LOG_LEVEL = 'error';
      jest.resetModules();
      const { AppLogger: LoggerClass } = require('./logger.service');
      const log = new LoggerClass('ProdErrorLevel');
      log.error('test error', new Error('err'));
      expect(consoleErrorSpy).toHaveBeenCalled();
      const lastCall = consoleErrorSpy.mock.calls[consoleErrorSpy.mock.calls.length - 1];
      const output = lastCall[0];
      expect(() => JSON.parse(output)).not.toThrow();
    });
  });

  describe('writeLog 内部方法测试', () => {
    it('error 方法在非生产环境应输出 stack trace', () => {
      const err = new Error('test error');
      logger.error('something failed', err);
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(consoleErrorSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('未知 LOG_LEVEL 应回退到 info', () => {
      process.env.LOG_LEVEL = 'unknown_level';
      jest.resetModules();
      const { AppLogger: LoggerClass } = require('./logger.service');
      const log = new LoggerClass('FallbackTest');
      log.debug('test');
      log.log('test info');
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it('getLogLevel 应对 verbose 级别返回 0', () => {
      process.env.LOG_LEVEL = 'verbose';
      jest.resetModules();
      const { AppLogger: LoggerClass } = require('./logger.service');
      const log = new LoggerClass('VerboseTest');
      log.debug('test verbose');
      expect(consoleDebugSpy).toHaveBeenCalled();
    });
  });
});
