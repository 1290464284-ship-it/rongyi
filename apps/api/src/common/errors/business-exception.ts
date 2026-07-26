import {
  HttpException,
  HttpStatus,
  NotFoundException as NestNotFoundException,
  ConflictException as NestConflictException,
  ForbiddenException as NestForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { ErrorCode, errorMessages, LegacyErrorCode } from './error-codes';

export class BusinessException extends HttpException {
  public readonly code: string;

  constructor(
    code: LegacyErrorCode | string,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
  ) {
    super({ code, message }, status);
    this.code = code;
  }

  getErrorCode(): string {
    return this.code;
  }
}

function initException(
  instance: { errorCode: ErrorCode; details?: Record<string, unknown> },
  message: string | undefined,
  errorCode: ErrorCode,
  defaultMessage: string,
  details?: Record<string, unknown>,
): string {
  instance.errorCode = errorCode;
  instance.details = details;
  return message || defaultMessage;
}

export class BusinessNotFoundException extends NestNotFoundException {
  public readonly errorCode: ErrorCode;
  public readonly details?: Record<string, unknown>;

  constructor(
    message?: string,
    errorCode: ErrorCode = ErrorCode.NOT_FOUND,
    details?: Record<string, unknown>,
  ) {
    const resolvedMsg = message ?? errorMessages[errorCode];
    super(resolvedMsg);
    this.errorCode = errorCode;
    this.details = details;
  }
}

export class BusinessConflictException extends NestConflictException {
  public readonly errorCode: ErrorCode;
  public readonly details?: Record<string, unknown>;

  constructor(
    message?: string,
    errorCode: ErrorCode = ErrorCode.CONFLICT,
    details?: Record<string, unknown>,
  ) {
    super(message || errorMessages[errorCode]);
    initException(this, message, errorCode, errorMessages[errorCode], details);
  }

  getErrorDetails(): Record<string, unknown> | undefined {
    return this.details;
  }
}

export class BusinessForbiddenException extends NestForbiddenException {
  public readonly errorCode: ErrorCode;
  public readonly details?: Record<string, unknown>;

  constructor(
    message?: string,
    errorCode: ErrorCode = ErrorCode.FORBIDDEN,
    details?: Record<string, unknown>,
  ) {
    const msg = message || errorMessages[errorCode];
    super(msg);
    this.errorCode = errorCode;
    this.details = details;
  }

  hasDetails(): boolean {
    return !!this.details;
  }
}

export class BusinessValidationException extends BadRequestException {
  public readonly errorCode: ErrorCode;
  public readonly details?: Record<string, unknown>;

  constructor(
    message?: string,
    errorCode: ErrorCode = ErrorCode.VALIDATION_ERROR,
    details?: Record<string, unknown>,
  ) {
    super(message || errorMessages[errorCode]);
    this.errorCode = errorCode;
    this.details = details;
  }

  getFormattedMessage(): string {
    return `${this.errorCode}: ${this.message}`;
  }
}
