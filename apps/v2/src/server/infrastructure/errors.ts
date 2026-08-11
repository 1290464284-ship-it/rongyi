/**
 * Uniform application error type.
 *
 * 错误码注册表（Round7 M9）——新增错误码时必须同步登记：
 *
 * | code                 | status | 可重试 | 说明 |
 * |----------------------|--------|--------|------|
 * | VALIDATION_ERROR     | 400    | 否     | 参数/请求体校验失败（details 白名单暴露） |
 * | PAYLOAD_TOO_LARGE    | 413    | 否     | 请求体超过大小限制 |
 * | UNAUTHORIZED         | 401    | 否     | 未认证 / 凭证无效 / 会话失效 |
 * | FORBIDDEN            | 403    | 否     | 权限不足 |
 * | NOT_FOUND            | 404    | 否     | 资源不存在 |
 * | CONFLICT             | 409    | 否     | 状态冲突（重复创建、唯一键冲突等） |
 * | INTERNAL_ERROR       | 500    | 是     | 未知内部错误（响应不泄露细节，凭 traceId 检索日志） |
 *
 * 约定：5xx 只暴露 INTERNAL_ERROR + traceId；业务层可用更多 5xx 子类码
 * （如 DB_UNAVAILABLE / BACKUP_FAILED）但 message 必须保持用户可读且不含
 * 内部细节。前端按上表判断可重试性；排障凭 traceId 在 v2.log 中检索。
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
  if (error instanceof Error && error.message === 'Not allowed by CORS') {
    return new AppError('FORBIDDEN', 'Not allowed by CORS', 403);
  }
  if (error instanceof Error) {
    return new AppError('INTERNAL_ERROR', error.message, 500);
  }
  return new AppError('INTERNAL_ERROR', String(error), 500);
}

/**
 * 只有 SQLite 的系统级错误（磁盘满、忙、IO 损坏等）才允许中止整批事务；
 * AppError/ValidationError 等业务错误必须按单行失败继续处理。
 */
export function isSystematicSqliteError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = String((error as { code?: unknown }).code ?? '');
  return /^SQLITE_(FULL|BUSY|IOERR|CORRUPT|CANTOPEN|NOMEM|LOCKED)/.test(code);
}
