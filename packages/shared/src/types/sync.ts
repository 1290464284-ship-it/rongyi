/**
 * 离线同步相关类型定义（前后端共享）
 */

/** 同步变更操作类型 */
export type SyncOperation = 'INSERT' | 'UPDATE' | 'DELETE';

/** 同步变更记录 */
export interface SyncChangeRecord {
  id: string;
  tableName: string;
  recordId: string;
  operation: SyncOperation;
  deviceId: string;
  clinicId: string;
  createdAt: string;
}

/** 客户端推送的变更数据 */
export interface SyncPushChange {
  tableName: string;
  recordId: string;
  operation: SyncOperation;
  data?: Record<string, unknown>;
  updatedAt: string;
}

/** 客户端推送请求体 */
export interface SyncPushPayload {
  deviceId: string;
  changes: SyncPushChange[];
}

/** 服务端拉取响应体 */
export interface SyncPullResult {
  changes: SyncChangeRecord[];
  serverTime: string;
}

/** 同步统计结果 */
export interface SyncResult {
  pushed: number;
  pulled: number;
  conflicts: number;
}

/** 同步状态 */
export type SyncStatus = 'synced' | 'pending' | 'syncing' | 'error';
