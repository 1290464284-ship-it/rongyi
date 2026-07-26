import { InternalServerErrorException } from '@nestjs/common';

export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new InternalServerErrorException(message);
  }
}

export function assertNever(value: never, message?: string): never {
  const errorMessage = message ?? `穷尽性检查失败: 未处理的值 ${String(value)}`;
  throw new InternalServerErrorException(errorMessage);
}

export function assertDefined<T>(value: T | null | undefined, message?: string): T {
  if (value === null || value === undefined) {
    const errorMessage = message ?? '值不能为 null 或 undefined';
    throw new InternalServerErrorException(errorMessage);
  }
  return value;
}

export function assertIsFiniteNumber(value: number, message?: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    const errorMessage = message ?? `期望是有限数字，实际值: ${String(value)}`;
    throw new InternalServerErrorException(errorMessage);
  }
  return value;
}

export function assertPositiveNumber(value: number, message?: string): number {
  assertIsFiniteNumber(value, message);
  if (value <= 0) {
    const errorMessage = message ?? `期望是正数，实际值: ${value}`;
    throw new InternalServerErrorException(errorMessage);
  }
  return value;
}

export function assertNonNegativeNumber(value: number, message?: string): number {
  assertIsFiniteNumber(value, message);
  if (value < 0) {
    const errorMessage = message ?? `期望是非负数，实际值: ${value}`;
    throw new InternalServerErrorException(errorMessage);
  }
  return value;
}
