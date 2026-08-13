import { describe, expect, it } from 'vitest';
import {
  AppError,
  ConflictError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
  asAppError,
  isSystematicSqliteError,
} from './errors';

describe('errors', () => {
  it('creates typed application errors', () => {
    expect(new AppError('X', 'msg', 400)).toMatchObject({ name: 'AppError', code: 'X', message: 'msg', status: 400 });
    expect(new ValidationError('bad')).toMatchObject({ code: 'VALIDATION_ERROR', message: 'bad', status: 400 });
    expect(new NotFoundError()).toMatchObject({ code: 'NOT_FOUND', message: 'Resource not found', status: 404 });
    expect(new ConflictError('conflict')).toMatchObject({ code: 'CONFLICT', message: 'conflict', status: 409 });
    expect(new UnauthorizedError()).toMatchObject({ code: 'UNAUTHORIZED', message: 'Unauthorized', status: 401 });
  });

  it('normalizes unknown errors', () => {
    expect(asAppError(new Error('boom'))).toMatchObject({ code: 'INTERNAL_ERROR', message: 'boom', status: 500 });
    expect(asAppError('string')).toMatchObject({ code: 'INTERNAL_ERROR', message: 'string', status: 500 });
    expect(asAppError(new AppError('KEEP', 'keep', 422))).toMatchObject({
      name: 'AppError',
      code: 'KEEP',
      message: 'keep',
      status: 422,
    });
  });

  it('maps malformed and oversized request bodies to client errors', () => {
    const parseError = new SyntaxError('Unexpected token') as SyntaxError & { type?: string };
    parseError.type = 'entity.parse.failed';
    expect(asAppError(parseError)).toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
      message: '请求体不是有效的 JSON',
    });

    const tooLarge = new Error('request entity too large') as Error & { type?: string };
    tooLarge.type = 'entity.too.large';
    expect(asAppError(tooLarge)).toMatchObject({ status: 413, code: 'PAYLOAD_TOO_LARGE', message: '请求内容过大' });
  });

  it('normalizes CORS rejections and systematic SQLite errors', () => {
    expect(asAppError(new Error('Not allowed by CORS'))).toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
      message: 'Not allowed by CORS',
    });
    for (const code of ['SQLITE_BUSY', 'SQLITE_FULL', 'SQLITE_IOERR', 'SQLITE_CORRUPT', 'SQLITE_LOCKED']) {
      const error = new Error('storage') as Error & { code?: string };
      error.code = code;
      expect(isSystematicSqliteError(error)).toBe(true);
    }
    expect(isSystematicSqliteError(new Error('storage'))).toBe(false);
    expect(isSystematicSqliteError('not-an-error')).toBe(false);
  });
});
