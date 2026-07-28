import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode, errorMessages, mapLegacyToErrorCode } from './error-codes';

/**
 * 业务异常基类 —— 所有自定义业务异常必须继承此类。
 *
 * 使用规范：
 *  1. 错误码统一使用 ErrorCode 数字枚举（如 ErrorCode.NOT_FOUND），禁止传字符串旧码。
 *  2. 状态码与 HTTP 语义保持一致（4xx 客户端错误 / 5xx 服务端错误）。
 *  3. 需要额外上下文时通过 details 字段携带，禁止在 message 中拼接敏感信息。
 *  4. 抛出前务必记录审计日志或业务日志，包含 traceId、userId、clinicId。
 */
export class BusinessException extends HttpException {
  /** 原始错误码（新代码应始终为数字 ErrorCode；兼容层可能传入字符串） */
  public readonly code: ErrorCode | string;
  /** 规范后的数字错误码，过滤器统一使用此字段 */
  public readonly errorCode: ErrorCode;

  constructor(
    code: ErrorCode | string,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
  ) {
    super({ code, message }, status);
    this.code = code;
    this.errorCode =
      typeof code === 'number' ? code : mapLegacyToErrorCode(code);
  }

  getErrorCode(): ErrorCode | string {
    return this.code;
  }

  getNumericErrorCode(): ErrorCode {
    return this.errorCode;
  }
}

/**
 * 资源不存在异常 —— 用于单条记录查询返回空、外键引用缺失等场景。
 *
 * 使用规范：
 *  - 默认错误码：ErrorCode.NOT_FOUND（1004）
 *  - 如需区分业务实体，可传具体错误码（如 ErrorCode.PATIENT_NOT_FOUND）
 *  - 禁止在 message 中暴露表名或字段名
 */
export class BusinessNotFoundException extends BusinessException {
  public readonly details?: Record<string, unknown>;

  constructor(
    message?: string,
    errorCode: ErrorCode = ErrorCode.NOT_FOUND,
    details?: Record<string, unknown>,
  ) {
    super(errorCode, message ?? errorMessages[errorCode], HttpStatus.NOT_FOUND);
    this.details = details;
  }
}

/**
 * 资源冲突异常 —— 用于唯一约束冲突、乐观锁失败、重复提交等场景。
 *
 * 使用规范：
 *  - 默认错误码：ErrorCode.CONFLICT（1005）
 *  - 并发场景应提示用户"资源已被修改，请刷新后重试"
 */
export class BusinessConflictException extends BusinessException {
  public readonly details?: Record<string, unknown>;

  constructor(
    message?: string,
    errorCode: ErrorCode = ErrorCode.CONFLICT,
    details?: Record<string, unknown>,
  ) {
    super(errorCode, message ?? errorMessages[errorCode], HttpStatus.CONFLICT);
    this.details = details;
  }

  getErrorDetails(): Record<string, unknown> | undefined {
    return this.details;
  }
}

/**
 * 权限不足异常 —— 用于角色守卫拦截、跨诊所数据访问、敏感操作鉴权失败等场景。
 *
 * 使用规范：
 *  - 默认错误码：ErrorCode.FORBIDDEN（1003）
 *  - 禁止在 message 中泄露存在但无权限的资源信息
 */
export class BusinessForbiddenException extends BusinessException {
  public readonly details?: Record<string, unknown>;

  constructor(
    message?: string,
    errorCode: ErrorCode = ErrorCode.FORBIDDEN,
    details?: Record<string, unknown>,
  ) {
    super(errorCode, message ?? errorMessages[errorCode], HttpStatus.FORBIDDEN);
    this.details = details;
  }

  hasDetails(): boolean {
    return !!this.details;
  }
}

/**
 * 参数校验异常 —— 用于 DTO 校验失败、业务规则校验失败、状态机非法转移等场景。
 *
 * 使用规范：
 *  - 默认错误码：ErrorCode.VALIDATION_ERROR（1006）
 *  - 如需告知用户具体字段错误，可通过 details 携带字段级信息
 */
export class BusinessValidationException extends BusinessException {
  public readonly details?: Record<string, unknown>;

  constructor(
    message?: string,
    errorCode: ErrorCode = ErrorCode.VALIDATION_ERROR,
    details?: Record<string, unknown>,
  ) {
    super(errorCode, message ?? errorMessages[errorCode], HttpStatus.BAD_REQUEST);
    this.details = details;
  }

  getFormattedMessage(): string {
    return `${this.errorCode}: ${this.message}`;
  }
}
