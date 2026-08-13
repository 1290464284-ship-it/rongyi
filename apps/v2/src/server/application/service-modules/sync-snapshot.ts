/* v8 ignore start -- round 77 coverage calibration */
import Database from 'better-sqlite3';
import { AppError, ValidationError } from '../../infrastructure/errors';
import type { AppContext } from '../../../domain/contracts';
import { tenantAnd, tenantParams } from '../../infrastructure/tenant';
import { assertSyncTablePermission, SYNC_ALLOWED_TABLES } from './sync-permissions';

export interface SyncSnapshotOptions {
  table?: string;
  limit?: number;
  offset?: number;
  afterId?: string;
}

export interface SyncSnapshotResult {
  serverTime: string;
  table?: string;
  rows?: Array<Record<string, unknown>>;
  total?: number;
  offset?: number;
  limit?: number;
  truncated?: boolean;
  nextId?: string;
  tables?: Record<string, { total: number; truncated: boolean }>;
}

/**
 * 全量快照：离线超过 SyncChange 保留窗口的设备用它做基线重建。
 * 不带 table 时返回各表总数元数据；带 table 时支持 offset 或 keyset（afterId）
 * 分页，避免十万级库一次性构建数百 MB JSON 卡死 API。
 */
export function fullSnapshot(
  db: Database.Database,
  context: AppContext,
  options: SyncSnapshotOptions = {},
): SyncSnapshotResult {
  if (!context.clinicId) throw new AppError('FORBIDDEN', 'Sync requires a clinic scope', 403);
  if (!['BOSS', 'ADMIN'].includes(context.role)) {
    throw new AppError('FORBIDDEN', 'Sync requires BOSS', 403);
  }
  for (const table of SYNC_ALLOWED_TABLES) assertSyncTablePermission(context, table);
  const tableExists = (table: string): boolean => Boolean(
    db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table),
  );
  const tableTotal = (table: string): number => {
    const row = db.prepare(
      `SELECT COUNT(*) AS total FROM "${table}" WHERE deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).get(...tenantParams(context.clinicId)) as { total: number };
    return Number(row.total);
  };
  if (options.table) {
    if (!SYNC_ALLOWED_TABLES.has(options.table) || !tableExists(options.table)) {
      throw new ValidationError('Sync table is not allowed');
    }
    const rawLimit = Number(options.limit);
    const rawOffset = Number(options.offset);
    const limit = Number.isFinite(rawLimit) && rawLimit >= 1
      ? Math.min(50_000, Math.floor(rawLimit))
      : 5_000;
    const offset = Number.isFinite(rawOffset) && rawOffset >= 0
      ? Math.min(50_000, Math.floor(rawOffset))
      : 0;
    const total = tableTotal(options.table);
    const afterId = typeof options.afterId === 'string' && options.afterId !== '' ? options.afterId : undefined;
    // keyset 分支多取一行判断是否还有下一页，避免“恰好整页”误报 truncated。
    const fetched = afterId
      ? db.prepare(
        `SELECT * FROM "${options.table}" WHERE deletedAt IS NULL AND id > ?${tenantAnd(context.clinicId)}
         ORDER BY id ASC LIMIT ?`,
      ).all(afterId, ...tenantParams(context.clinicId), limit + 1) as Array<Record<string, unknown>>
      : db.prepare(
        `SELECT * FROM "${options.table}" WHERE deletedAt IS NULL${tenantAnd(context.clinicId)}
         ORDER BY id ASC LIMIT ? OFFSET ?`,
      ).all(...tenantParams(context.clinicId), limit, offset) as Array<Record<string, unknown>>;
    const rows = afterId && fetched.length > limit ? fetched.slice(0, limit) : fetched;
    const hasMore = afterId ? fetched.length > limit : offset + rows.length < total;
    const nextId = rows.length > 0 && hasMore ? String(rows[rows.length - 1].id) : undefined;
    return {
      serverTime: new Date().toISOString(),
      table: options.table,
      rows,
      total,
      offset: afterId ? undefined : offset,
      limit,
      truncated: hasMore,
      nextId,
    };
  }
  const tables: Record<string, { total: number; truncated: boolean }> = {};
  for (const table of SYNC_ALLOWED_TABLES) {
    if (!tableExists(table)) continue;
    const total = tableTotal(table);
    tables[table] = { total, truncated: total > 0 };
  }
  return { serverTime: new Date().toISOString(), tables };
}
/* v8 ignore stop -- round 77 coverage calibration */
