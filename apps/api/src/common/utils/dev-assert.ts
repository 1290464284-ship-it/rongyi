import { InternalServerErrorException } from '@nestjs/common';

const isDev = process.env.NODE_ENV !== 'production';

export function devAssert(condition: unknown, message: string): void {
  if (isDev && !condition) {
    throw new InternalServerErrorException(`[开发环境断言] ${message}`);
  }
}
