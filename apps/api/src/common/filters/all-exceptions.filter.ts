import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { AppLogger, sanitizeObject, sanitizeString } from '../services/logger.service';
import { BusinessException } from '../errors/business-exception';
import { LegacyErrorCode, ErrorCode } from '../errors/error-codes';
import { SentryService } from '../monitoring/sentry.service';

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
  code: LegacyErrorCode;
  message: string;
};

const sqliteErrorHandlers: SqliteErrorHandler[] = [
  {
    test: (err) => err.message.includes('UNIQUE constraint failed'),
    status: HttpStatus.CONFLICT,
    code: LegacyErrorCode.CONFLICT_UNIQUE_CONSTRAINT,
    message: '资源已存在，请检查唯一性约束',
  },
  {
    test: (err) => err.message.includes('FOREIGN KEY constraint failed'),
    status: HttpStatus.BAD_REQUEST,
    code: LegacyErrorCode.DB_FOREIGN_KEY_CONSTRAINT,
    message: '关联数据不存在，请检查引用',
  },
  {
    test: (err) => err.message.includes('CHECK constraint failed'),
    status: HttpStatus.BAD_REQUEST,
    code: LegacyErrorCode.DB_CHECK_CONSTRAINT,
    message: '数据不满足校验条件',
  },
  {
    test: (err) => err.message.includes('NOT NULL constraint failed'),
    status: HttpStatus.BAD_REQUEST,
    code: LegacyErrorCode.DB_NOT_NULL_CONSTRAINT,
    message: '必填字段不能为空',
  },
  {
    test: (err) =>
      err.message.includes('database is locked') ||
      err.message.includes('SQLITE_BUSY'),
    status: HttpStatus.SERVICE_UNAVAILABLE,
    code: LegacyErrorCode.DB_BUSY_TIMEOUT,
    message: '数据库繁忙，请稍后再试',
  },
  {
    test: (err) =>
      err.message.includes('SQLITE_LOCKED') ||
      err.message.includes('database table is locked'),
    status: HttpStatus.CONFLICT,
    code: LegacyErrorCode.DB_LOCKED,
    message: '数据被锁定，请稍后再试',
  },
  {
    test: (err) => err.message.includes('database disk image is malformed'),
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    code: LegacyErrorCode.DB_CORRUPT,
    message: '数据库损坏，请联系管理员',
  },
  {
    test: (err) =>
      err.message.includes('attempt to write a readonly database') ||
      err.message.includes('SQLITE_READONLY'),
    status: HttpStatus.SERVICE_UNAVAILABLE,
    code: LegacyErrorCode.DB_READONLY,
    message: '数据库只读，无法写入',
  },
  {
    test: (err) =>
      err.message.includes('SQLITE_IOERR') ||
      err.message.includes('disk I/O error'),
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    code: LegacyErrorCode.DB_IO_ERROR,
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

    let status: number;
    let message: unknown;
    let errorCode: string | undefined;
    let numericErrorCode: number | undefined;
    let details: Record<string, unknown> | undefined;
    let stack: string | undefined;
    let shouldReportToSentry = false;

    if (exception instanceof BusinessException) {
      status = exception.getStatus();
      errorCode = exception.getErrorCode();
      const resp = exception.getResponse() as { code: string; message: string };
      message = resp.message;
    } else if (exception instanceof HttpException && hasErrorCode(exception)) {
      status = exception.getStatus();
      numericErrorCode = exception.errorCode;
      details = exception.details;
      const resp = exception.getResponse();
      if (typeof resp === 'string') {
        message = resp;
      } else if (typeof resp === 'object' && resp !== null && 'message' in resp) {
        message = (resp).message;
      } else {
        message = resp;
      }
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const resp = exception.getResponse();
      if (typeof resp === 'object' && resp !== null && 'code' in resp) {
        const r = resp as { code: string; message: string };
        errorCode = r.code;
        message = r.message;
      } else {
        message = resp;
      }
      if (status === HttpStatus.PAYLOAD_TOO_LARGE) {
        errorCode = LegacyErrorCode.PAYLOAD_TOO_LARGE;
      } else if (status === HttpStatus.UNSUPPORTED_MEDIA_TYPE) {
        errorCode = LegacyErrorCode.UNSUPPORTED_MEDIA_TYPE;
      } else if (status === HttpStatus.TOO_MANY_REQUESTS) {
        errorCode = LegacyErrorCode.RATE_LIMITED;
      } else if (status === HttpStatus.NOT_FOUND) {
        numericErrorCode = ErrorCode.NOT_FOUND;
      } else if (status === HttpStatus.FORBIDDEN) {
        numericErrorCode = ErrorCode.FORBIDDEN;
      } else if (status === HttpStatus.UNAUTHORIZED) {
        numericErrorCode = ErrorCode.UNAUTHORIZED;
      } else if (status === HttpStatus.CONFLICT) {
        numericErrorCode = ErrorCode.CONFLICT;
      } else if (status === HttpStatus.BAD_REQUEST) {
        numericErrorCode = ErrorCode.BAD_REQUEST;
      }
    } else if (exception instanceof Error && (isSqliteError(exception) || matchSqliteError(exception))) {
      const handler = matchSqliteError(exception);
      if (handler) {
        status = handler.status;
        errorCode = handler.code;
        message = handler.message;
      } else {
        status = HttpStatus.INTERNAL_SERVER_ERROR;
        errorCode = LegacyErrorCode.DB_ERROR;
        message = '数据库错误';
      }
      numericErrorCode = ErrorCode.DATA_INTEGRITY_ERROR;
      stack = exception.stack;
      shouldReportToSentry = true;
    } else {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = '服务器内部错误';
      errorCode = LegacyErrorCode.INTERNAL_ERROR;
      numericErrorCode = ErrorCode.UNKNOWN;
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
        errorCode: errorCode || String(numericErrorCode),
      });
    }

    const responseBody: Record<string, unknown> = {
      success: false,
      statusCode: status,
      message: sanitizedMessage,
      timestamp: new Date().toISOString(),
      path: req.url,
      traceId,
    };

    if (errorCode) {
      responseBody.code = errorCode;
    }

    if (numericErrorCode !== undefined) {
      responseBody.errorCode = numericErrorCode;
    }

    if (details) {
      responseBody.details = details;
    }

    if (isValidationError(sanitizedMessage)) {
      responseBody.errors = sanitizedMessage.message;
      responseBody.message = '参数校验失败';
      responseBody.code = LegacyErrorCode.VALIDATION_ERROR;
      responseBody.errorCode = ErrorCode.VALIDATION_ERROR;
    }

    if (isDev && stack) {
      responseBody.stack = stack;
    }

    res.status(status).json(responseBody);
  }
}
