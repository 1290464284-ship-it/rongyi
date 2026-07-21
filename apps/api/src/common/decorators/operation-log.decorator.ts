import { SetMetadata } from '@nestjs/common';

export interface OperationLogOptions {
  action: string;
  target?: string;
  detail?: (args: any[], result: any) => string;
  extractUserId?: (args: any[]) => string;
}

export const OPERATION_LOG_KEY = 'operation_log';
export const OperationLog = (options: OperationLogOptions) =>
  SetMetadata(OPERATION_LOG_KEY, options);
