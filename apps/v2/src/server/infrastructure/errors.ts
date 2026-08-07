/**
 * Uniform application error type.
 */

export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;
  traceId?: string;

  constructor(code: string, message: string, status = 400, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super('VALIDATION_ERROR', message, 400, details);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super('NOT_FOUND', message, 404);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super('CONFLICT', message, 409);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super('UNAUTHORIZED', message, 401);
  }
}

export function asAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof SyntaxError && 'type' in error && String((error as { type?: unknown }).type) === 'entity.parse.failed') {
    return new ValidationError('请求体不是有效的 JSON');
  }
  if (error instanceof Error && 'type' in error && String((error as { type?: unknown }).type) === 'entity.too.large') {
    return new AppError('PAYLOAD_TOO_LARGE', '请求内容过大', 413);
  }
  if (error instanceof Error) {
    return new AppError('INTERNAL_ERROR', error.message, 500);
  }
  return new AppError('INTERNAL_ERROR', String(error), 500);
}
