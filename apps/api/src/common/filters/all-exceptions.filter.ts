import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { AppLogger, sanitizeObject, sanitizeString } from '../services/logger.service';

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

function isSqliteUniqueError(err: Error): boolean {
  return err.message?.includes('UNIQUE constraint failed');
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private logger: AppLogger) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const traceId = req.traceId || 'unknown';

    let status: number;
    let message: unknown;
    let errorCode: string | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const resp = exception.getResponse();
      if (typeof resp === 'object' && resp !== null && 'code' in resp) {
        const r = resp as { code: string; message: string };
        errorCode = r.code;
        message = r.message;
      } else {
        message = resp;
      }
    } else if (exception instanceof Error && isSqliteUniqueError(exception)) {
      status = HttpStatus.CONFLICT;
      message = '资源已存在，请检查唯一性约束';
      errorCode = 'UNIQUE_CONFLICT';
    } else {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = '服务器内部错误';
    }

    const sanitizedMessage = typeof message === 'string'
      ? sanitizeString(message)
      : sanitizeObject(message);

    const logMsg = exception instanceof Error ? exception : message;
    this.logger.logError(traceId, `${req.method} ${req.url} ${status}`, logMsg);

    const responseBody: Record<string, unknown> = {
      statusCode: status,
      message: sanitizedMessage,
      timestamp: new Date().toISOString(),
      path: req.url,
      traceId,
    };

    if (errorCode) {
      responseBody.code = errorCode;
    }

    if (isValidationError(sanitizedMessage)) {
      responseBody.errors = sanitizedMessage.message;
      responseBody.message = '参数校验失败';
    }

    res.status(status).json(responseBody);
  }
}
