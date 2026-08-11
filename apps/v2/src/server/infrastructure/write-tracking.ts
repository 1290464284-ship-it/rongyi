import type Database from 'better-sqlite3';
import { recordSyncChange } from './sync-change';
import { SEARCH_UPSERT_SQL, touchSearchIndex } from './search-index';

export interface ResourceWrite {
  tableName: string;
  recordId: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  clinicId?: string | null;
  /** 搜索索引 resource；缺省等于 tableName，显式 null 表示不维护搜索索引。 */
  searchResource?: string | null;
  /** 是否记录 SyncChange（同步 push 场景传 false，避免回环）。缺省 true。 */
  emitSyncChange?: boolean;
}

/**
 * 统一写入门面：一次调用同时维护 SyncChange 与 SearchIndex。
 * 新业务写路径应优先使用它，避免“只写同步漏索引 / 只写索引漏同步”。
 */
export function trackResourceWrite(db: Database.Database, write: ResourceWrite): void {
  if (write.clinicId && write.emitSyncChange !== false) {
    recordSyncChange(db, {
      tableName: write.tableName,
      recordId: write.recordId,
      operation: write.operation,
      clinicId: write.clinicId,
    });
  }
  const resource = write.searchResource ?? write.tableName;
  if (SEARCH_UPSERT_SQL[resource]) {
    touchSearchIndex(db, resource, write.recordId, write.operation);
  }
}
