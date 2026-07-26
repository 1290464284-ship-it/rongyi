export interface OperationLogEntry {
  userId?: string;
  userName?: string;
  action: string;
  target?: string;
  detail?: string;
  ip?: string;
}

export interface OperationLogSink {
  create(data: OperationLogEntry): Promise<unknown>;
}

export const OPERATION_LOG_SINK = Symbol('OPERATION_LOG_SINK');
