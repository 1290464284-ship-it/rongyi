import { SetMetadata } from '@nestjs/common';

export interface OperationLogOptions {
  action: string;
  target?: string;
  detail?: (args: unknown[], result: unknown) => string;
  extractUserId?: (args: unknown[]) => string;
}

export const OPERATION_LOG_KEY = 'operation_log';
export const OperationLog = (options: OperationLogOptions) =>
  SetMetadata(OPERATION_LOG_KEY, options);
