import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { AppError, NotFoundError, ValidationError, isSystematicSqliteError } from '../../infrastructure/errors';
import { SqliteRepository } from '../../infrastructure/repository';
import { stripProtectedWriteFields } from '../../infrastructure/security';
import { validatePayload } from '../../http/validation';
import { resourceRegistry } from '../../../domain/resources';
import type { AppContext } from '../../../domain/contracts';
import { tenantAnd, tenantParams } from '../../infrastructure/tenant';
import { recordSyncChange, type SyncChangeOperation } from '../../infrastructure/sync-change';
import { hashRefreshToken, newRefreshToken, safeJsonObject } from './common';
import type { SyncPushPayload, SyncPushResult } from './sync-push-queue';
import { sharedDbWriteQueue } from './serial-queue';

const SYNC_ALLOWED_TABLES = new Set([
  'Patient',
  'Appointment',
  'Treatment',
  'Charge',
  'InventoryItem',
  'FollowUp',
  'PurchaseOrder',
]);

const SYNC_RESOURCES: Record<string, string> = {
  Patient: 'patients',
  Appointment: 'appointments',
  Treatment: 'treatments',
  Charge: 'charges',
  InventoryItem: 'inventoryItems',
  FollowUp: 'followUps',
  PurchaseOrder: 'purchaseOrders',
};

export class SyncService {
  constructor(private readonly db: Database.Database) {}

  async push(payload: SyncPushPayload, context: AppContext): Promise<SyncPushResult> {
    return sharedDbWriteQueue(this.db)(() => this.executePush(payload, context));
  }

  pull(since: string, deviceId: string, deviceToken: string, context: AppContext): { changes: Array<Record<string, unknown>>; cursor: string; serverTime: string } {
    if (!context.clinicId) throw new AppError('FORBIDDEN', 'Sync requires a clinic scope', 403);
    if (!['BOSS', 'ADMIN'].includes(context.role)) {
      throw new AppError('FORBIDDEN', 'Sync requires BOSS', 403);
    }
    this.assertDevice(deviceId, deviceToken, context);
    // 游标支持两种格式：新格式 `createdAt|rowid`（复合键），旧格式为纯 createdAt
    // 时间戳。旧格式按 rowid 开区间（-1）解析：同毫秒的行可能被重复投递一次，但
    // 绝不丢变更——旧实现 `createdAt > since` 会永久跳过与游标同毫秒的后续行。
    const separator = since.lastIndexOf('|');
    const cursorTime = separator > 0 ? since.slice(0, separator) : since;
    const cursorRowid = separator > 0 ? Number(since.slice(separator + 1)) : -1;
    const changes = this.db.prepare(
      `SELECT id, tableName, recordId, operation, deviceId, clinicId, createdAt, rowid
       FROM SyncChange
       WHERE (createdAt > ? OR (createdAt = ? AND rowid > ?)) AND deviceId != ?${tenantAnd(context.clinicId)}
       ORDER BY createdAt ASC, rowid ASC
       LIMIT 1000`,
    ).all(cursorTime, cursorTime, cursorRowid, deviceId, ...tenantParams(context.clinicId)) as Array<Record<string, unknown>>;
    // 游标 = 本批最后一条的 (createdAt, rowid) 复合键；与 ORDER BY 完全一致，
    // 同毫秒并列 + 超 LIMIT 分页均不会丢变更。空批时游标保持入参 since，可继续以同一游标轮询。
    const last = changes[changes.length - 1];
    const cursor = last ? `${String(last.createdAt)}|${String(last.rowid)}` : since;
    return { changes, cursor, serverTime: new Date().toISOString() };
  }

  /**
   * 全量快照：离线超过 SyncChange 保留窗口的设备用它做基线重建。
   * 不带 table 时返回各表总数元数据；带 table 时按 offset/limit 分页返回，
   * 避免十万级库一次性构建数百 MB JSON 卡死 API。
   */
  fullSnapshot(
    context: AppContext,
    options: { table?: string; limit?: number; offset?: number } = {},
  ): {
    serverTime: string;
    table?: string;
    rows?: Array<Record<string, unknown>>;
    total?: number;
    offset?: number;
    limit?: number;
    truncated?: boolean;
    tables?: Record<string, { total: number; truncated: boolean }>;
  } {
    if (!context.clinicId) throw new AppError('FORBIDDEN', 'Sync requires a clinic scope', 403);
    if (!['BOSS', 'ADMIN'].includes(context.role)) {
      throw new AppError('FORBIDDEN', 'Sync requires BOSS', 403);
    }
    const tableExists = (table: string): boolean => Boolean(
      this.db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table),
    );
    const tableTotal = (table: string): number => {
      const row = this.db.prepare(
        `SELECT COUNT(*) AS total FROM "${table}" WHERE deletedAt IS NULL${tenantAnd(context.clinicId)}`,
      ).get(...tenantParams(context.clinicId)) as { total: number };
      return Number(row.total);
    };

    if (options.table) {
      if (!SYNC_ALLOWED_TABLES.has(options.table) || !tableExists(options.table)) {
        throw new ValidationError('Sync table is not allowed');
      }
      const limit = Math.min(50_000, Math.max(1, Math.floor(Number(options.limit) || 5_000)));
      const offset = Math.max(0, Math.floor(Number(options.offset) || 0));
      const total = tableTotal(options.table);
      const rows = this.db.prepare(
        `SELECT * FROM "${options.table}" WHERE deletedAt IS NULL${tenantAnd(context.clinicId)}
         ORDER BY id ASC LIMIT ? OFFSET ?`,
      ).all(...tenantParams(context.clinicId), limit, offset) as Array<Record<string, unknown>>;
      return {
        serverTime: new Date().toISOString(),
        table: options.table,
        rows,
        total,
        offset,
        limit,
        truncated: offset + rows.length < total,
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

  private async executePush(payload: SyncPushPayload, context: AppContext): Promise<SyncPushResult> {
    if (!context.clinicId) throw new AppError('FORBIDDEN', 'Sync requires a clinic scope', 403);
    if (!['BOSS', 'ADMIN'].includes(context.role)) {
      throw new AppError('FORBIDDEN', 'Sync requires BOSS', 403);
    }
    this.assertDevice(payload.deviceId, payload.deviceToken, context);
    let accepted = 0;
    const errors: Array<{ recordId: string; error: string }> = [];
    const conflicts: Array<{ recordId: string; message: string }> = [];
    // 每 500 条一个事务批。注意：better-sqlite3 的 db.transaction 会拒绝返回 Promise 的
    // 回调（TypeError: Transaction function cannot return a promise），而 apply 路径是
    // async repository 方法（其 SQL 在已 resolve 的微任务链中同步执行），因此这里用显式
    // BEGIN/COMMIT/ROLLBACK 实现等价的批事务：整批要么全部生效、要么整体回滚。
    for (let offset = 0; offset < payload.changes.length; offset += 500) {
      const batch = payload.changes.slice(offset, offset + 500);
      // 本批已记录单条 error 的下标；系统性错误回滚后按此去重，避免重复记账。
      const failedIndexes = new Set<number>();
      let batchAccepted = 0;
      let inTransaction = false;
      try {
        this.db.exec('BEGIN IMMEDIATE');
        inTransaction = true;
        for (let index = 0; index < batch.length; index += 1) {
          const change = batch[index];
          if (!SYNC_ALLOWED_TABLES.has(change.tableName)) {
            errors.push({ recordId: change.recordId, error: 'Table is not allowed for sync' });
            failedIndexes.add(index);
            continue;
          }
          if (!['INSERT', 'UPDATE', 'DELETE'].includes(change.operation)) {
            errors.push({ recordId: change.recordId, error: 'Sync operation must be INSERT, UPDATE, or DELETE' });
            failedIndexes.add(index);
            continue;
          }
          if (change.tableName === 'Charge') {
            errors.push({ recordId: change.recordId, error: 'Charge writes are disabled in sync; use charge APIs' });
            failedIndexes.add(index);
            continue;
          }
          const resourceName = SYNC_RESOURCES[change.tableName];
          const definition = resourceRegistry.get(resourceName);
          /* v8 ignore start */
          if (!definition) {
            errors.push({ recordId: change.recordId, error: `Resource is not defined: ${resourceName}` });
            failedIndexes.add(index);
            continue;
          }
          /* v8 ignore stop */
          let wrote = false;
          try {
            const repo = new SqliteRepository(this.db, definition, { emitSyncChange: false });
            if (change.operation === 'DELETE') {
              const existingForDelete = await repo.findById(change.recordId, context);
              if (!existingForDelete) {
                throw new Error(`Sync record not found: ${change.recordId}`);
              }
              if (this.isStaleRemote(change, existingForDelete)) {
                this.registerConflict(change, existingForDelete, payload.deviceId, context);
                conflicts.push({ recordId: change.recordId, message: 'Conflict: remote delete is older than local version' });
                failedIndexes.add(index);
                continue;
              }
              await repo.softDelete(change.recordId, context);
            } else {
              if (!change.data || typeof change.data !== 'object') {
                throw new Error('Sync change requires row data');
              }
              const existing = await repo.findById(change.recordId, context);
              if (existing && this.isStaleRemote(change, existing)) {
                this.registerConflict(change, existing, payload.deviceId, context);
                conflicts.push({ recordId: change.recordId, message: 'Conflict: remote change is older than local version' });
                failedIndexes.add(index);
                continue;
              }
              const payloadRow = stripProtectedWriteFields(validatePayload(
                definition,
                change.data,
                existing ? { partial: true } : {},
              ), undefined, resourceName);
              const entity = { id: change.recordId, ...payloadRow };
              if (existing) await repo.update(entity, context);
              else await repo.insert(entity, context);
            }
            // B-M1：业务写入已完成（批事务内），此后 record() 若失败，客户端
            // 收到错误后不应盲目重试——写入可能已生效，重试可能造成重复变更。
            wrote = true;
            this.record(change.tableName, change.recordId, change.operation, payload.deviceId, context.clinicId);
            batchAccepted += 1;
          } catch (error) {
            /* v8 ignore start -- systematic SQLite errors carry a `code` (SQLITE_FULL/BUSY/IOERR/...) and abort the batch */
            if (isSystematicSqliteError(error)) throw error;
            /* v8 ignore stop */
            /* v8 ignore start -- non-Error rejection is defensive; current repositories throw Error instances. */
            const baseMessage = error instanceof Error ? error.message : String(error);
            errors.push({
              recordId: change.recordId,
              error: wrote ? `${baseMessage}（业务写入可能已生效，请勿直接重试）` : baseMessage,
            });
            /* v8 ignore stop */
            failedIndexes.add(index);
          }
        }
        this.db.exec('COMMIT');
        inTransaction = false;
        accepted += batchAccepted;
        /* v8 ignore start -- systematic SQLite errors are not reproducible in unit tests: roll back the batch, mark every not-yet-recorded item as failed, and abort remaining batches */
      } catch (error) {
        if (inTransaction) {
          try {
            this.db.exec('ROLLBACK');
          } catch {
            // Preserve the original error if ROLLBACK itself fails.
          }
        }
        if (!(error instanceof Error) || !isSystematicSqliteError(error)) throw error;
        const message = error.message;
        for (let index = 0; index < batch.length; index += 1) {
          if (!failedIndexes.has(index)) {
            errors.push({ recordId: batch[index].recordId, error: message });
          }
        }
        break;
        /* v8 ignore stop */
      }
    }
    return { accepted, failed: errors.length, errors, conflicts };
  }

  listConflicts(context: AppContext): Array<Record<string, unknown>> {
    if (!context.clinicId) throw new AppError('FORBIDDEN', 'Sync requires a clinic scope', 403);
    if (!['BOSS', 'ADMIN'].includes(context.role)) {
      throw new AppError('FORBIDDEN', 'Sync requires BOSS', 403);
    }
    const rows = this.db.prepare(
      `SELECT * FROM SyncConflict
       WHERE status = 'PENDING' AND deletedAt IS NULL${tenantAnd(context.clinicId)}
       ORDER BY createdAt ASC`,
    ).all(...tenantParams(context.clinicId)) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      ...row,
      localSnapshot: safeJsonObject(row.localSnapshotJson),
      remoteSnapshot: safeJsonObject(row.remoteSnapshotJson),
    }));
  }

  async resolveConflict(id: string, resolution: string, context: AppContext): Promise<Record<string, unknown>> {
    return sharedDbWriteQueue(this.db)(() => this.executeResolveConflict(id, resolution, context));
  }

  private async executeResolveConflict(id: string, resolution: string, context: AppContext): Promise<Record<string, unknown>> {
    if (!context.clinicId) throw new AppError('FORBIDDEN', 'Sync requires a clinic scope', 403);
    if (!['BOSS', 'ADMIN'].includes(context.role)) {
      throw new AppError('FORBIDDEN', 'Sync requires BOSS', 403);
    }
    if (!['KEEP_LOCAL', 'KEEP_REMOTE'].includes(resolution)) {
      throw new ValidationError('resolution must be KEEP_LOCAL or KEEP_REMOTE');
    }
    const row = this.db.prepare(
      `SELECT * FROM SyncConflict
       WHERE id = ? AND status = 'PENDING' AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).get(id, ...tenantParams(context.clinicId)) as Record<string, unknown> | undefined;
    if (!row) throw new NotFoundError('Sync conflict not found');

    const resourceName = SYNC_RESOURCES[String(row.tableName)];
    const definition = resourceRegistry.get(resourceName);
    if (!definition) throw new NotFoundError('Sync conflict table is not supported');

    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (resolution === 'KEEP_REMOTE') {
        const remoteSnapshot = safeJsonObject(row.remoteSnapshotJson);
        const repo = new SqliteRepository(this.db, definition, { emitSyncChange: false });
        if (String(row.remoteOperation) === 'DELETE') {
          const existing = await repo.findById(String(row.recordId), context);
          if (existing) await repo.softDelete(String(row.recordId), context);
        } else {
          const payloadRow = stripProtectedWriteFields(validatePayload(
            definition,
            remoteSnapshot,
            { partial: true },
          ), undefined, resourceName);
          const existing = await repo.findById(String(row.recordId), context);
          if (existing) await repo.update({ id: String(row.recordId), ...payloadRow }, context);
          else await repo.insert({ id: String(row.recordId), ...payloadRow }, context);
        }
        this.record(String(row.tableName), String(row.recordId), String(row.remoteOperation), 'server', context.clinicId);
      } else {
        this.record(String(row.tableName), String(row.recordId), String(row.localOperation), 'server', context.clinicId);
      }

      const now = new Date().toISOString();
      this.db.prepare(
        `UPDATE SyncConflict
         SET status = 'RESOLVED', resolution = ?, resolvedAt = ?, resolvedById = ?, updatedAt = ?, deletedAt = ?
         WHERE id = ? AND status = 'PENDING'${tenantAnd(context.clinicId)}`,
      ).run(resolution, now, context.userId, now, now, id, ...tenantParams(context.clinicId));
      this.db.exec('COMMIT');
      return { ...row, resolution, resolvedAt: now, resolvedById: context.userId };
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // 保留原始错误；回滚失败只留日志面，不掩盖根因。
      }
      throw error;
    }
  }

  private isStaleRemote(
    change: { updatedAt?: string },
    existing: Record<string, unknown>,
  ): boolean {
    const local = String(existing.updatedAt ?? '');
    const remote = String(change.updatedAt ?? '');
    if (!local || !remote) return false;
    const localTime = Date.parse(local);
    const remoteTime = Date.parse(remote);
    return Number.isFinite(localTime) && Number.isFinite(remoteTime) && remoteTime < localTime;
  }

  private registerConflict(
    change: { tableName: string; recordId: string; operation: string; updatedAt?: string; data?: Record<string, unknown> },
    existing: Record<string, unknown>,
    deviceId: string,
    context: AppContext,
  ): void {
    const now = new Date().toISOString();
    // repo.findById 固定过滤 deletedAt IS NULL，冲突时 existing 一定是在行，
    // 本地权威状态即为 UPDATE（删除侧的冲突在 push DELETE 分支会先抛 NotFound）。
    this.db.prepare(
      `INSERT OR IGNORE INTO SyncConflict (
         id, clinicId, tableName, recordId, deviceId, localOperation, remoteOperation,
         localSnapshotJson, remoteSnapshotJson, localUpdatedAt, remoteUpdatedAt,
         status, resolution, resolvedAt, resolvedById, createdAt, updatedAt, deletedAt
       ) VALUES (?, ?, ?, ?, ?, 'UPDATE', ?, ?, ?, ?, ?, 'PENDING', NULL, NULL, NULL, ?, ?, NULL)`,
    ).run(
      randomUUID(),
      context.clinicId,
      change.tableName,
      change.recordId,
      deviceId,
      change.operation,
      JSON.stringify(existing),
      JSON.stringify(change.data ?? {}),
      String(existing.updatedAt ?? ''),
      String(change.updatedAt ?? ''),
      now,
      now,
    );
  }

  registerDevice(deviceId: string, name: string, context: AppContext): { deviceId: string; token: string } {
    if (!context.clinicId) throw new AppError('FORBIDDEN', 'Sync requires a clinic scope', 403);
    if (!['BOSS', 'ADMIN'].includes(context.role)) {
      throw new AppError('FORBIDDEN', 'Sync requires BOSS', 403);
    }
    // S-L4：两段式注册——设备已存在且属于其他用户时拒绝重绑（防止跨用户
    // 抢占设备令牌），随后再执行 upsert 轮换令牌。
    const existing = this.db.prepare(
      `SELECT id, userId FROM SyncDevice
       WHERE deviceId = ? AND active = 1 AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).get(deviceId, ...tenantParams(context.clinicId)) as { id: string; userId: string } | undefined;
    if (existing && existing.userId !== context.userId) {
      throw new AppError('CONFLICT', 'Device is already registered to another user', 409);
    }
    const token = newRefreshToken();
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO SyncDevice (
         id, clinicId, userId, deviceId, tokenHash, name, active,
         createdAt, updatedAt, deletedAt
       ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, NULL)
       ON CONFLICT(clinicId, deviceId) DO UPDATE SET
         tokenHash = excluded.tokenHash,
         name = excluded.name,
         active = 1,
         updatedAt = excluded.updatedAt`,
    ).run(randomUUID(), context.clinicId, context.userId, deviceId, hashRefreshToken(token), name, now, now);
    return { deviceId, token };
  }

  record(tableName: string, recordId: string, operation: string, deviceId: string, clinicId: string): void {
    recordSyncChange(this.db, {
      tableName,
      recordId,
      operation: operation as SyncChangeOperation,
      clinicId,
      deviceId,
    });
  }

  cleanup(before: string | undefined, context: AppContext): { deleted: number; cutoff: string } {
    if (!context.clinicId) throw new AppError('FORBIDDEN', 'Sync requires a clinic scope', 403);
    const cutoff = before ?? new Date(Date.now() - 90 * 86_400_000).toISOString();
    const result = this.db.prepare(
      `DELETE FROM SyncChange WHERE createdAt < ?${tenantAnd(context.clinicId)}`,
    ).run(cutoff, ...tenantParams(context.clinicId));
    return { deleted: result.changes, cutoff };
  }

  private assertDevice(deviceId: string, deviceToken: string, context: AppContext): void {
    if (!deviceId || !deviceToken || !context.clinicId) {
      throw new AppError('UNAUTHORIZED', 'Device credentials are required', 401);
    }
    const device = this.db.prepare(
      `SELECT id FROM SyncDevice WHERE deviceId = ? AND tokenHash = ? AND active = 1 AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).get(deviceId, hashRefreshToken(deviceToken), ...tenantParams(context.clinicId));
    if (!device) throw new AppError('UNAUTHORIZED', 'Device is not registered or active', 401);
  }
}
