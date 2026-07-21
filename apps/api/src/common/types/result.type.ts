/**
 * 统一操作结果类型
 */
export interface OperationResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

export function success<T>(data: T): OperationResult<T> {
  return { success: true, data };
}

export function failure(error: string, code?: string): OperationResult {
  return { success: false, error, code };
}

/**
 * 分页结果类型
 */
export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export function pageResult<T>(items: T[], total: number, page: number, pageSize: number): PageResult<T> {
  return { items, total, page, pageSize };
}
