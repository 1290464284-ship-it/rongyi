import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { AppLogger, sanitizeObject, sanitizeString } from '../services/logger.service';
import { BusinessException } from '../errors/business-exception';
import { ErrorCode, mapLegacyToErrorCode } from '../errors/error-codes';
import { SentryService } from '../monitoring/sentry.service';
import { getRequestContext, als } from '../utils/context/async-context';

const isDev = process.env.NODE_ENV !== 'production';

interface ValidationErrorResponse {
  statusCode: number;
  message: string[];
  error: string;
}

function isValidationError(body: unknown): body is ValidationErrorResponse {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  return Array.isArray(b.message) && b.error === 'Bad Request';
}

interface SqliteErrorLike extends Error {
  code?: string;
  errno?: number;
}

function isSqliteError(err: unknown): err is SqliteErrorLike {
  if (!(err instanceof Error)) return false;
  const e = err as SqliteErrorLike;
  return typeof e.code === 'string' && e.code.startsWith('SQLITE_');
}

type SqliteErrorHandler = {
  test: (err: Error) => boolean;
  status: number;
  errorCode: ErrorCode;
  message: string;
};

const sqliteErrorHandlers: SqliteErrorHandler[] = [
  {
    test: (err) => err.message.includes('UNIQUE constraint failed'),
    status: HttpStatus.CONFLICT,
    errorCode: ErrorCode.CONFLICT_UNIQUE_CONSTRAINT,
    message: '资源已存在，请检查唯一性约束',
  },
  {
    test: (err) => err.message.includes('FOREIGN KEY constraint failed'),
    status: HttpStatus.BAD_REQUEST,
    errorCode: ErrorCode.DB_FOREIGN_KEY_CONSTRAINT,
    message: '关联数据不存在，请检查引用',
  },
  {
    test: (err) => err.message.includes('CHECK constraint failed'),
    status: HttpStatus.BAD_REQUEST,
    errorCode: ErrorCode.DB_CHECK_CONSTRAINT,
    message: '数据不满足校验条件',
  },
  {
    test: (err) => err.message.includes('NOT NULL constraint failed'),
    status: HttpStatus.BAD_REQUEST,
    errorCode: ErrorCode.DB_NOT_NULL_CONSTRAINT,
    message: '必填字段不能为空',
  },
  {
    test: (err) =>
      err.message.includes('database is locked') ||
      err.message.includes('SQLITE_BUSY'),
    status: HttpStatus.SERVICE_UNAVAILABLE,
    errorCode: ErrorCode.DB_BUSY_TIMEOUT,
    message: '数据库繁忙，请稍后再试',
  },
  {
    test: (err) =>
      err.message.includes('SQLITE_LOCKED') ||
      err.message.includes('database table is locked'),
    status: HttpStatus.CONFLICT,
    errorCode: ErrorCode.DB_LOCKED,
    message: '数据被锁定，请稍后再试',
  },
  {
    test: (err) => err.message.includes('database disk image is malformed'),
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    errorCode: ErrorCode.DB_CORRUPT,
    message: '数据库损坏，请联系管理员',
  },
  {
    test: (err) =>
      err.message.includes('attempt to write a readonly database') ||
      err.message.includes('SQLITE_READONLY'),
    status: HttpStatus.SERVICE_UNAVAILABLE,
    errorCode: ErrorCode.DB_READONLY,
    message: '数据库只读，无法写入',
  },
  {
    test: (err) =>
      err.message.includes('SQLITE_IOERR') ||
      err.message.includes('disk I/O error'),
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    errorCode: ErrorCode.DB_IO_ERROR,
    message: '数据库读写错误，请联系管理员',
  },
];

function matchSqliteError(err: Error): SqliteErrorHandler | null {
  for (const handler of sqliteErrorHandlers) {
    if (handler.test(err)) return handler;
  }
  return null;
}

function toError(exception: unknown): Error {
  if (exception instanceof Error) return exception;
  if (typeof exception === 'string') return new Error(exception);
  try {
    return new Error(JSON.stringify(exception));
  } catch {
    return new Error(String(exception));
  }
}

interface HasErrorCode {
  errorCode: ErrorCode;
  details?: Record<string, unknown>;
}

function hasErrorCode(exception: unknown): exception is HasErrorCode {
  if (!exception || typeof exception !== 'object') return false;
  return 'errorCode' in (exception as Record<string, unknown>);
}

const httpStatusErrorCodeMap: Record<number, ErrorCode | undefined> = {
  [HttpStatus.NOT_FOUND]: ErrorCode.NOT_FOUND,
  [HttpStatus.FORBIDDEN]: ErrorCode.FORBIDDEN,
  [HttpStatus.UNAUTHORIZED]: ErrorCode.UNAUTHORIZED,
  [HttpStatus.CONFLICT]: ErrorCode.CONFLICT,
  [HttpStatus.BAD_REQUEST]: ErrorCode.BAD_REQUEST,
  [HttpStatus.PAYLOAD_TOO_LARGE]: ErrorCode.PAYLOAD_TOO_LARGE,
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: ErrorCode.UNSUPPORTED_MEDIA_TYPE,
  [HttpStatus.TOO_MANY_REQUESTS]: ErrorCode.RATE_LIMITED,
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(
    private logger: AppLogger,
    private sentryService?: SentryService,
  ) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const traceId = req.traceId || 'unknown';

    const currentContext = getRequestContext();
    const userId = req.user?.id;
    const clinicId = (req.user as Record<string, unknown>)?.clinicId as string | undefined;

    const hasContext = !!currentContext;
    if (hasContext) {
      if (!currentContext.userId && userId) {
        currentContext.userId = userId;
      }
      if (!currentContext.clinicId && clinicId) {
        currentContext.clinicId = clinicId;
      }
    } else {
      als.enterWith({ traceId, userId, clinicId, requestStart: new Date().toISOString() });
    }

    let status: number;
    let message: unknown;
    let errorCode: ErrorCode = ErrorCode.UNKNOWN;
    let details: Record<string, unknown> | undefined;
    let stack: string | undefined;
    let shouldReportToSentry = false;

    if (exception instanceof BusinessException) {
      status = exception.getStatus();
      errorCode = exception.errorCode;
      const resp = exception.getResponse() as { code: string; message: string };
      message = resp.message;
      details = (exception as unknown as { details?: Record<string, unknown> }).details;
    } else if (exception instanceof HttpException && hasErrorCode(exception)) {
      status = exception.getStatus();
      errorCode = exception.errorCode;
      details = exception.details;
      const resp = exception.getResponse();
      if (typeof resp === 'string') {
        message = resp;
      } else if (typeof resp === 'object' && 'message' in resp) {
        message = (resp).message;
      } else {
        message = resp;
      }
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const resp = exception.getResponse();
      let hasBodyCode = false;
      if (typeof resp === 'object' && 'code' in resp) {
        const r = resp as { code: string | number; message: string };
        errorCode = typeof r.code === 'number' ? (r.code) : mapLegacyToErrorCode(r.code);
        message = r.message;
        hasBodyCode = true;
      } else {
        message = resp;
      }
      if (!hasBodyCode) {
        const mappedCode = httpStatusErrorCodeMap[status];
        if (mappedCode !== undefined) {
          errorCode = mappedCode;
        }
      }
    } else if (exception instanceof Error && (isSqliteError(exception) || matchSqliteError(exception))) {
      const handler = matchSqliteError(exception);
      if (handler) {
        status = handler.status;
        errorCode = handler.errorCode;
        message = handler.message;
      } else {
        status = HttpStatus.INTERNAL_SERVER_ERROR;
        errorCode = ErrorCode.DB_ERROR;
        message = '数据库错误';
      }
      stack = exception.stack;
      shouldReportToSentry = true;
    } else {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = '服务器内部错误';
      errorCode = ErrorCode.UNKNOWN;
      const err = toError(exception);
      stack = err.stack;
      shouldReportToSentry = true;
    }

    const sanitizedMessage = typeof message === 'string'
      ? sanitizeString(message)
      : sanitizeObject(message);

    const errForLog = exception instanceof Error ? exception : toError(exception);
    this.logger.logError(traceId, `${req.method} ${req.url} ${status}`, errForLog);

    if (shouldReportToSentry && this.sentryService?.isEnabled()) {
      this.sentryService.captureException(exception, {
        traceId,
        method: req.method,
        url: req.url,
        statusCode: status,
        errorCode: String(errorCode),
        userId,
        clinicId,
      });
    }

    const responseBody: Record<string, unknown> = {
      success: false,
      statusCode: status,
      message: sanitizedMessage,
      // P0 修复：移除重复的 code 字段，统一使用 errorCode（与 BusinessException.errorCode 一致）
      // 前端不依赖 code 字段（已验证），保留两者会导致契约歧义
      errorCode,
      timestamp: new Date().toISOString(),
      path: req.url,
      traceId,
    };

    if (details) {
      // P2 修复：details 字段也需脱敏，防止敏感字段（idCard/phone 等）泄露
      responseBody.details = sanitizeObject(details);
    }

    if (isValidationError(sanitizedMessage)) {
      responseBody.errors = sanitizedMessage.message;
      responseBody.message = '参数校验失败';
      responseBody.errorCode = ErrorCode.VALIDATION_ERROR;
    }

    if (isDev && stack) {
      responseBody.stack = stack;
    }

    res.status(status).json(responseBody);
  }
}