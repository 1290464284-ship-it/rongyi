export interface OperationLogEntry {
  userId?: string;
  userName?: string;
  action: string;
  target?: string;
  detail?: string;
  ip?: string;
  /**
   * 在 enqueue 时捕获的 clinicId。
   * 由于 BufferedWriter 的 flush 可能由定时器触发（不在原请求的 AsyncLocalStorage 上下文中），
   * 必须在入队时捕获 clinicId 并存入 entry，否则 flush 时 clinicContext.getClinicId() 会返回 null。
   * 对于无诊所上下文的操作（如登录失败），使用 'system' 哨兵值。
   */
  clinicId?: string;
}

export interface OperationLogSink {
  create(data: OperationLogEntry): Promise<unknown>;
}

export const OPERATION_LOG_SINK = Symbol('OPERATION_LOG_SINK');
