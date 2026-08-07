import { describe, expect, it } from 'vitest';
import {
  AppError,
  ConflictError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
  asAppError,
} from './errors';

describe('errors', () => {
  it('creates typed application errors', () => {
    expect(new AppError('X', 'msg', 400).status).toBe(400);
    expect(new ValidationError('bad').code).toBe('VALIDATION_ERROR');
    expect(new NotFoundError().status).toBe(404);
    expect(new ConflictError('conflict').status).toBe(409);
    expect(new UnauthorizedError().status).toBe(401);
  });

  it('normalizes unknown errors', () => {
    expect(asAppError(new Error('boom')).status).toBe(500);
    expect(asAppError('string').message).toBe('string');
    expect(asAppError(new AppError('KEEP', 'keep', 422)).code).toBe('KEEP');
  });

  it('maps malformed and oversized request bodies to client errors', () => {
    const parseError = new SyntaxError('Unexpected token') as SyntaxError & { type?: string };
    parseError.type = 'entity.parse.failed';
    expect(asAppError(parseError)).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });

    const tooLarge = new Error('request entity too large') as Error & { type?: string };
    tooLarge.type = 'entity.too.large';
    expect(asAppError(tooLarge)).toMatchObject({ status: 413, code: 'PAYLOAD_TOO_LARGE' });
  });
});
