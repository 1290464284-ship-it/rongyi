import { AllExceptionsFilter } from './all-exceptions.filter';
import { HttpException, HttpStatus, ArgumentsHost } from '@nestjs/common';
import {
  BusinessException,
  BusinessNotFoundException,
  BusinessConflictException,
  BusinessForbiddenException,
  BusinessValidationException,
} from '../errors/business-exception';
import { ErrorCode } from '../errors/error-codes';
import { AppLogger } from '../services/logger.service';
import { SentryService } from '../monitoring/sentry.service';
import { Request, Response } from 'express';

type MockResponse = Response & {
  status: jest.Mock;
  json: jest.Mock;
};

type MockRequest = Request & {
  traceId?: string;
  method: string;
  url: string;
};

function createMockRequest(overrides: Partial<MockRequest> = {}): MockRequest {
  return {
    method: 'GET',
    url: '/api/test',
    traceId: 'test-trace-id',
    ...overrides,
  } as unknown as MockRequest;
}

function createMockResponse(): MockResponse {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res as unknown as MockResponse;
}

function createMockArgumentsHost(req: MockRequest, res: MockResponse): ArgumentsHost {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
      getNext: () => ({}),
    }),
    getArgs: () => [],
    getArgByIndex: () => {},
    switchToRpc: () => ({
      getData: () => ({}),
      getContext: () => ({}),
    }),
    switchToWs: () => ({
      getClient: () => ({}),
      getData: () => ({}),
    }),
    getType: () => 'http',
  } as unknown as ArgumentsHost;
}

function createMockLogger(): AppLogger {
  return {
    logError: jest.fn(),
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  } as unknown as AppLogger;
}

function createMockSentryService(enabled = true): SentryService {
  return {
    isEnabled: jest.fn().mockReturnValue(enabled),
    captureException: jest.fn(),
    captureMessage: jest.fn(),
    init: jest.fn(),
    setTag: jest.fn(),
    withScope: jest.fn(),
  } as unknown as SentryService;
}

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  let logger: AppLogger;
  let sentryService: SentryService;
  let req: MockRequest;
  let res: MockResponse;
  let host: ArgumentsHost;
  let originalNodeEnv: string | undefined;

  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));

    logger = createMockLogger();
    sentryService = createMockSentryService(true);
    filter = new AllExceptionsFilter(logger, sentryService);
    req = createMockRequest();
    res = createMockResponse();
    host = createMockArgumentsHost(req, res);
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    jest.useRealTimers();
  });

  describe('BusinessException 处理', () => {
    it('正确处理 BusinessException', () => {
      const exception = new BusinessException(
        ErrorCode.NOT_FOUND,
        '资源不存在',
        HttpStatus.NOT_FOUND,
      );

      filter.catch(exception, host);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.NOT_FOUND,
          message: '资源不存在',
          errorCode: ErrorCode.NOT_FOUND,
          traceId: 'test-trace-id',
          path: '/api/test',
        }),
      );
    });

    it('BusinessException 的 code 和 message 正确提取', () => {
      const exception = new BusinessException(
        'CUSTOM_CODE',
        '自定义错误消息',
        HttpStatus.BAD_REQUEST,
      );

      filter.catch(exception, host);

      const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(jsonArg.errorCode).toBe(ErrorCode.UNKNOWN);
      expect(jsonArg.message).toBe('自定义错误消息');
    });

    it('BusinessException 使用 ErrorCode 数字错误码', () => {
      const exception = new BusinessException(
        ErrorCode.AUTH_LOGIN_FAILED,
        '登录失败',
        HttpStatus.UNAUTHORIZED,
      );

      filter.catch(exception, host);

      const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(jsonArg.errorCode).toBe(ErrorCode.AUTH_LOGIN_FAILED);
    });
  });

  describe('HttpException 处理', () => {
    it('处理带 code/message 格式的 HttpException', () => {
      const exception = new HttpException(
        { code: ErrorCode.VALIDATION_ERROR, message: '参数错误' },
        HttpStatus.BAD_REQUEST,
      );

      filter.catch(exception, host);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(jsonArg.errorCode).toBe(ErrorCode.VALIDATION_ERROR);
      expect(jsonArg.message).toBe('参数错误');
    });

    it('处理普通格式的 HttpException', () => {
      const exception = new HttpException('普通错误', HttpStatus.BAD_REQUEST);

      filter.catch(exception, host);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(jsonArg.message).toBe('普通错误');
      expect(jsonArg.errorCode).toBe(ErrorCode.BAD_REQUEST);
    });

    it('处理对象格式的 HttpException（不带 code）', () => {
      const exception = new HttpException(
        { error: 'Bad Request', message: '错误详情' },
        HttpStatus.BAD_REQUEST,
      );

      filter.catch(exception, host);

      const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(jsonArg.message).toEqual({ error: 'Bad Request', message: '错误详情' });
      expect(jsonArg.errorCode).toBe(ErrorCode.BAD_REQUEST);
    });

    it('PAYLOAD_TOO_LARGE 状态码自动设置错误码', () => {
      const exception = new HttpException('Payload too large', HttpStatus.PAYLOAD_TOO_LARGE);

      filter.catch(exception, host);

      const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(jsonArg.errorCode).toBe(ErrorCode.PAYLOAD_TOO_LARGE);
    });

    it('UNSUPPORTED_MEDIA_TYPE 状态码自动设置错误码', () => {
      const exception = new HttpException(
        'Unsupported media type',
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      );

      filter.catch(exception, host);

      const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(jsonArg.errorCode).toBe(ErrorCode.UNSUPPORTED_MEDIA_TYPE);
    });

    it('TOO_MANY_REQUESTS 状态码自动设置错误码', () => {
      const exception = new HttpException('Too many requests', HttpStatus.TOO_MANY_REQUESTS);

      filter.catch(exception, host);

      const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(jsonArg.errorCode).toBe(ErrorCode.RATE_LIMITED);
    });
  });

  describe('SQLite 错误处理', () => {
    function createSqliteError(message: string, code = 'SQLITE_ERROR'): Error {
      const err = new Error(message);
      (err as any).code = code;
      (err as any).errno = 1;
      return err;
    }

    it('UNIQUE constraint failed 错误', () => {
      const err = createSqliteError('UNIQUE constraint failed: users.email');

      filter.catch(err, host);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
      const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(jsonArg.errorCode).toBe(ErrorCode.CONFLICT_UNIQUE_CONSTRAINT);
      expect(jsonArg.message).toBe('资源已存在，请检查唯一性约束');
    });

    it('FOREIGN KEY constraint failed 错误', () => {
      const err = createSqliteError('FOREIGN KEY constraint failed');

      filter.catch(err, host);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(jsonArg.errorCode).toBe(ErrorCode.DB_FOREIGN_KEY_CONSTRAINT);
      expect(jsonArg.message).toBe('关联数据不存在，请检查引用');
    });

    it('CHECK constraint failed 错误', () => {
      const err = createSqliteError('CHECK constraint failed: age_check');

      filter.catch(err, host);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(jsonArg.errorCode).toBe(ErrorCode.DB_CHECK_CONSTRAINT);
      expect(jsonArg.message).toBe('数据不满足校验条件');
    });

    it('NOT NULL constraint failed 错误', () => {
      const err = createSqliteError('NOT NULL constraint failed: users.name');

      filter.catch(err, host);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(jsonArg.errorCode).toBe(ErrorCode.DB_NOT_NULL_CONSTRAINT);
      expect(jsonArg.message).toBe('必填字段不能为空');
    });

    it('database is locked 错误', () => {
      const err = createSqliteError('database is locked');

      filter.catch(err, host);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
      const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(jsonArg.errorCode).toBe(ErrorCode.DB_BUSY_TIMEOUT);
      expect(jsonArg.message).toBe('数据库繁忙，请稍后再试');
    });

    it('SQLITE_BUSY 错误', () => {
      const err = createSqliteError('SQLITE_BUSY: database is busy', 'SQLITE_BUSY');

      filter.catch(err, host);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
      const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(jsonArg.errorCode).toBe(ErrorCode.DB_BUSY_TIMEOUT);
    });

    it('SQLITE_LOCKED 错误', () => {
      const err = createSqliteError('SQLITE_LOCKED', 'SQLITE_LOCKED');

      filter.catch(err, host);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
      const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(jsonArg.errorCode).toBe(ErrorCode.DB_LOCKED);
      expect(jsonArg.message).toBe('数据被锁定，请稍后再试');
    });

    it('database table is locked 错误', () => {
      const err = createSqliteError('database table is locked: users');

      filter.catch(err, host);

      const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(jsonArg.errorCode).toBe(ErrorCode.DB_LOCKED);
    });

    it('database disk image is malformed 错误', () => {
      const err = createSqliteError('database disk image is malformed');

      filter.catch(err, host);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(jsonArg.errorCode).toBe(ErrorCode.DB_CORRUPT);
      expect(jsonArg.message).toBe('数据库损坏，请联系管理员');
    });

    it('attempt to write a readonly database 错误', () => {
      const err = createSqliteError('attempt to write a readonly database');

      filter.catch(err, host);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
      const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(jsonArg.errorCode).toBe(ErrorCode.DB_READONLY);
      expect(jsonArg.message).toBe('数据库只读，无法写入');
    });

    it('SQLITE_READONLY 错误', () => {
      const err = createSqliteError('SQLITE_READONLY', 'SQLITE_READONLY');

      filter.catch(err, host);

      const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(jsonArg.errorCode).toBe(ErrorCode.DB_READONLY);
    });

    it('SQLITE_IOERR 错误', () => {
      const err = createSqliteError('SQLITE_IOERR: disk I/O error', 'SQLITE_IOERR');

      filter.catch(err, host);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(jsonArg.errorCode).toBe(ErrorCode.DB_IO_ERROR);
      expect(jsonArg.message).toBe('数据库读写错误，请联系管理员');
    });

    it('disk I/O error 错误', () => {
      const err = createSqliteError('disk I/O error');

      filter.catch(err, host);

      const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(jsonArg.errorCode).toBe(ErrorCode.DB_IO_ERROR);
    });

    it('未匹配的 SQLite 错误使用通用数据库错误', () => {
      const err = createSqliteError('some other sqlite error', 'SQLITE_ERROR');

      filter.catch(err, host);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(jsonArg.errorCode).toBe(ErrorCode.DB_ERROR);
      expect(jsonArg.message).toBe('数据库错误');
    });

    it('SQLite 错误上报到 Sentry', () => {
      const err = createSqliteError('UNIQUE constraint failed: users.email');

      filter.catch(err, host);

      expect(sentryService.captureException).toHaveBeenCalled();
    });
  });

  describe('未知错误处理', () => {
    it('普通 Error 作为内部错误处理', () => {
      const err = new Error('something went wrong');

      filter.catch(err, host);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(jsonArg.errorCode).toBe(ErrorCode.UNKNOWN);
      expect(jsonArg.message).toBe('服务器内部错误');
    });

    it('字符串异常转换为 Error', () => {
      filter.catch('string error', host);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(jsonArg.errorCode).toBe(ErrorCode.UNKNOWN);
    });

    it('对象异常转换为 Error', () => {
      filter.catch({ foo: 'bar' }, host);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(jsonArg.errorCode).toBe(ErrorCode.UNKNOWN);
    });

    it('数字异常转换为 Error', () => {
      filter.catch(500, host);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    });
  });

  describe('验证错误标准化', () => {
    it('Bad Request with message array 标准化为参数校验失败', () => {
      const exception = new HttpException(
        {
          statusCode: HttpStatus.BAD_REQUEST,
          message: ['邮箱格式不正确', '密码不能为空'],
          error: 'Bad Request',
        },
        HttpStatus.BAD_REQUEST,
      );

      filter.catch(exception, host);

      const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(jsonArg.message).toBe('参数校验失败');
      expect(jsonArg.errorCode).toBe(ErrorCode.VALIDATION_ERROR);
      expect(jsonArg.errors).toEqual(['邮箱格式不正确', '密码不能为空']);
    });

    it('只有 error 为 Bad Request 且 message 是数组时才标准化', () => {
      const exception = new HttpException(
        {
          statusCode: HttpStatus.BAD_REQUEST,
          message: '单个错误消息',
          error: 'Bad Request',
        },
        HttpStatus.BAD_REQUEST,
      );

      filter.catch(exception, host);

      const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(jsonArg.errors).toBeUndefined();
    });

    it('非 Bad Request 的数组消息不标准化', () => {
      const exception = new HttpException(
        {
          statusCode: HttpStatus.FORBIDDEN,
          message: ['权限不足'],
          error: 'Forbidden',
        },
        HttpStatus.FORBIDDEN,
      );

      filter.catch(exception, host);

      const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(jsonArg.errors).toBeUndefined();
    });
  });

  describe('环境变量控制 stack 返回', () => {
    function createFilterWithEnv(env: string): AllExceptionsFilter {
      const originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = env;
      jest.resetModules();
      const { AllExceptionsFilter: FilterClass } = require('./all-exceptions.filter');
      process.env.NODE_ENV = originalNodeEnv;
      const mockLogger = createMockLogger();
      const mockSentry = createMockSentryService(false);
      return new FilterClass(mockLogger, mockSentry);
    }

    it('开发环境返回 stack', () => {
      const devFilter = createFilterWithEnv('development');
      const err = new Error('test error');

      devFilter.catch(err, host);

      const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(jsonArg.stack).toBeDefined();
      expect(jsonArg.stack).toContain('test error');
    });

    it('生产环境不返回 stack', () => {
      const prodFilter = createFilterWithEnv('production');
      const err = new Error('test error');

      prodFilter.catch(err, host);

      const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(jsonArg.stack).toBeUndefined();
    });

    it('test 环境返回 stack', () => {
      const testFilter = createFilterWithEnv('test');
      const err = new Error('test error');

      testFilter.catch(err, host);

      const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(jsonArg.stack).toBeDefined();
    });
  });

  describe('Sentry 上报', () => {
    it('500 错误上报到 Sentry', () => {
      const err = new Error('internal error');

      filter.catch(err, host);

      expect(sentryService.captureException).toHaveBeenCalled();
      const callArg = (sentryService.captureException as jest.Mock).mock.calls[0];
      expect(callArg[0]).toBe(err);
      expect(callArg[1]).toMatchObject({
        traceId: 'test-trace-id',
        method: 'GET',
        url: '/api/test',
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        errorCode: String(ErrorCode.UNKNOWN),
      });
    });

    it('SQLite 错误上报到 Sentry', () => {
      const err = new Error('UNIQUE constraint failed');
      (err as any).code = 'SQLITE_CONSTRAINT';

      filter.catch(err, host);

      expect(sentryService.captureException).toHaveBeenCalled();
    });

    it('Sentry 未启用时不上报', () => {
      const disabledSentry = createMockSentryService(false);
      const filterWithDisabledSentry = new AllExceptionsFilter(logger, disabledSentry);
      const err = new Error('internal error');

      filterWithDisabledSentry.catch(err, host);

      expect(disabledSentry.captureException).not.toHaveBeenCalled();
    });

    it('没有 sentryService 时不上报', () => {
      const filterWithoutSentry = new AllExceptionsFilter(logger);
      const err = new Error('internal error');

      filterWithoutSentry.catch(err, host);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    });

    it('BusinessException 不上报 Sentry', () => {
      const exception = new BusinessException(
        ErrorCode.NOT_FOUND,
        '资源不存在',
        HttpStatus.NOT_FOUND,
      );

      filter.catch(exception, host);

      expect(sentryService.captureException).not.toHaveBeenCalled();
    });

    it('普通 HttpException 不上报 Sentry', () => {
      const exception = new HttpException('bad request', HttpStatus.BAD_REQUEST);

      filter.catch(exception, host);

      expect(sentryService.captureException).not.toHaveBeenCalled();
    });
  });

  describe('traceId 传递', () => {
    it('从 request 中获取 traceId 并传递到响应', () => {
      req.traceId = 'custom-trace-id';

      const err = new Error('test');
      filter.catch(err, host);

      const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(jsonArg.traceId).toBe('custom-trace-id');
    });

    it('没有 traceId 时使用 unknown', () => {
      req.traceId = undefined;

      const err = new Error('test');
      filter.catch(err, host);

      const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(jsonArg.traceId).toBe('unknown');
    });

    it('traceId 传递到日志', () => {
      req.traceId = 'log-trace-id';

      const err = new Error('test');
      filter.catch(err, host);

      expect(logger.logError).toHaveBeenCalledWith(
        'log-trace-id',
        expect.any(String),
        expect.any(Error),
      );
    });

    it('traceId 传递到 Sentry', () => {
      req.traceId = 'sentry-trace-id';

      const err = new Error('test');
      filter.catch(err, host);

      const callArg = (sentryService.captureException as jest.Mock).mock.calls[0];
      expect(callArg[1].traceId).toBe('sentry-trace-id');
    });
  });

  describe('响应体结构', () => {
    it('包含 statusCode, message, timestamp, path, traceId', () => {
      const err = new Error('test');
      filter.catch(err, host);

      const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(jsonArg).toHaveProperty('statusCode');
      expect(jsonArg).toHaveProperty('message');
      expect(jsonArg).toHaveProperty('timestamp');
      expect(jsonArg).toHaveProperty('path');
      expect(jsonArg).toHaveProperty('traceId');
    });

    it('有错误码时包含 errorCode', () => {
      const err = new Error('test');
      filter.catch(err, host);

      const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(jsonArg).toHaveProperty('errorCode');
      expect(typeof jsonArg.errorCode).toBe('number');
    });

    it('timestamp 是 ISO 格式字符串', () => {
      const err = new Error('test');
      filter.catch(err, host);

      const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(jsonArg.timestamp).toBe('2024-01-01T00:00:00.000Z');
    });

    it('path 是请求的 url', () => {
      req.url = '/api/custom/path';
      const err = new Error('test');
      filter.catch(err, host);

      const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(jsonArg.path).toBe('/api/custom/path');
    });
  });

  describe('日志记录', () => {
    it('所有错误都记录日志', () => {
      const exception = new BusinessException(
        ErrorCode.NOT_FOUND,
        '资源不存在',
        HttpStatus.NOT_FOUND,
      );

      filter.catch(exception, host);

      expect(logger.logError).toHaveBeenCalled();
    });

    it('日志包含 traceId', () => {
      req.traceId = 'test-log-trace';
      const err = new Error('test');

      filter.catch(err, host);

      expect(logger.logError).toHaveBeenCalledWith(
        'test-log-trace',
        expect.any(String),
        expect.any(Error),
      );
    });

    it('日志消息包含方法和路径和状态码', () => {
      req.method = 'POST';
      req.url = '/api/users';
      const err = new Error('test');

      filter.catch(err, host);

      const logArgs = (logger.logError as jest.Mock).mock.calls[0];
      expect(logArgs[1]).toContain('POST');
      expect(logArgs[1]).toContain('/api/users');
      expect(logArgs[1]).toContain('500');
    });
  });

  describe('新数字错误码异常类', () => {
    it('BusinessNotFoundException 正确处理', () => {
      const exception = new BusinessNotFoundException('用户不存在');

      filter.catch(exception, host);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
      const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(jsonArg.success).toBe(false);
      expect(jsonArg.errorCode).toBe(ErrorCode.NOT_FOUND);
      expect(jsonArg.message).toBe('用户不存在');
      expect(jsonArg.statusCode).toBe(HttpStatus.NOT_FOUND);
    });

    it('BusinessConflictException 正确处理', () => {
      const exception = new BusinessConflictException('资源已存在');

      filter.catch(exception, host);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
      const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(jsonArg.errorCode).toBe(ErrorCode.CONFLICT);
      expect(jsonArg.message).toBe('资源已存在');
    });

    it('BusinessForbiddenException 正确处理', () => {
      const exception = new BusinessForbiddenException('无权访问');

      filter.catch(exception, host);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.FORBIDDEN);
      const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(jsonArg.errorCode).toBe(ErrorCode.FORBIDDEN);
      expect(jsonArg.message).toBe('无权访问');
    });

    it('BusinessValidationException 正确处理', () => {
      const exception = new BusinessValidationException('参数无效');

      filter.catch(exception, host);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(jsonArg.errorCode).toBe(ErrorCode.VALIDATION_ERROR);
      expect(jsonArg.message).toBe('参数无效');
    });

    it('异常类使用默认错误消息', () => {
      const exception = new BusinessNotFoundException();

      filter.catch(exception, host);

      const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(jsonArg.message).toBe('资源不存在');
      expect(jsonArg.errorCode).toBe(ErrorCode.NOT_FOUND);
    });

    it('异常类支持 details 字段', () => {
      const details = { field: 'email', reason: 'already exists' };
      const exception = new BusinessConflictException(
        '邮箱已被注册',
        ErrorCode.DUPLICATE_ENTRY,
        details,
      );

      filter.catch(exception, host);

      const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(jsonArg.errorCode).toBe(ErrorCode.DUPLICATE_ENTRY);
      expect(jsonArg.details).toEqual(details);
    });

    it('自定义错误码的异常类', () => {
      const exception = new BusinessNotFoundException(
        '患者不存在',
        ErrorCode.NOT_FOUND,
      );

      filter.catch(exception, host);

      const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(jsonArg.errorCode).toBe(ErrorCode.NOT_FOUND);
      expect(jsonArg.message).toBe('患者不存在');
    });
  });

  describe('统一响应格式', () => {
    it('响应包含 success 字段且为 false', () => {
      const err = new Error('test');
      filter.catch(err, host);

      const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(jsonArg.success).toBe(false);
    });

    it('未知错误包含 errorCode 数字字段', () => {
      const err = new Error('test');
      filter.catch(err, host);

      const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(jsonArg.errorCode).toBe(ErrorCode.UNKNOWN);
      expect(typeof jsonArg.errorCode).toBe('number');
    });

    it('普通 HttpException 根据状态码设置 errorCode', () => {
      const exception = new HttpException('not found', HttpStatus.NOT_FOUND);
      filter.catch(exception, host);

      const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(jsonArg.errorCode).toBe(ErrorCode.NOT_FOUND);
    });

    it('errorCode 字段统一输出数字格式', () => {
      const exception = new BusinessException(
        ErrorCode.NOT_FOUND,
        '资源不存在',
        HttpStatus.NOT_FOUND,
      );

      filter.catch(exception, host);

      const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(typeof jsonArg.errorCode).toBe('number');
      expect(jsonArg.errorCode).toBe(ErrorCode.NOT_FOUND);
    });

    it('响应体不包含重复的 code 字段', () => {
      const exception = new BusinessNotFoundException('用户不存在');

      filter.catch(exception, host);

      const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(jsonArg.code).toBeUndefined();
      expect(jsonArg.errorCode).toBeDefined();
    });
  });
});
