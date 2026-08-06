import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { AppError } from '../../infrastructure/errors';
import { SqliteRepository } from '../../infrastructure/repository';
import { stripProtectedWriteFields } from '../../infrastructure/security';
import { validatePayload } from '../../http/validation';
import { resourceRegistry } from '../../../domain/resources';
import type { AppContext } from '../../../domain/contracts';
import { tenantAnd, tenantParams } from '../../infrastructure/tenant';
import { recordSyncChange, type SyncChangeOperation } from '../../infrastructure/sync-change';
import { hashRefreshToken, newRefreshToken } from './common';

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

  pull(since: string, deviceId: string, deviceToken: string, context: AppContext): { changes: Array<Record<string, unknown>>; cursor: string; serverTime: string } {
    if (!context.clinicId) throw new AppError('FORBIDDEN', 'Sync requires a clinic scope', 403);
    if (!['BOSS'].includes(context.role)) {
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

  async push(payload: {
    deviceId: string;
    deviceToken: string;
    changes: Array<{
      tableName: string;
      recordId: string;
      operation: string;
      updatedAt: string;
      data?: Record<string, unknown>;
    }>;
  }, context: AppContext): Promise<{
    accepted: number;
    failed: number;
    errors: Array<{ recordId: string; error: string }>;
  }> {
    if (!context.clinicId) throw new AppError('FORBIDDEN', 'Sync requires a clinic scope', 403);
    if (!['BOSS'].includes(context.role)) {
      throw new AppError('FORBIDDEN', 'Sync requires BOSS', 403);
    }
    this.assertDevice(payload.deviceId, payload.deviceToken, context);
    let accepted = 0;
    const errors: Array<{ recordId: string; error: string }> = [];
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
        this.db.exec('BEGIN');
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
          if (change.tableName === 'Charge' && change.operation !== 'DELETE') {
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
          try {
            const repo = new SqliteRepository(this.db, definition, { emitSyncChange: false });
            if (change.operation === 'DELETE') {
              if (!(await repo.findById(change.recordId, context))) {
                throw new Error(`Sync record not found: ${change.recordId}`);
              }
              await repo.softDelete(change.recordId, context);
            } else {
              if (!change.data || typeof change.data !== 'object') {
                throw new Error('Sync change requires row data');
              }
              const existing = await repo.findById(change.recordId, context);
              const payloadRow = stripProtectedWriteFields(validatePayload(
                definition,
                change.data,
                existing ? { partial: true } : {},
              ));
              const entity = { id: change.recordId, ...payloadRow };
              if (existing) await repo.update(entity, context);
              else await repo.insert(entity, context);
            }
            this.record(change.tableName, change.recordId, change.operation, payload.deviceId, context.clinicId);
            batchAccepted += 1;
          } catch (error) {
            /* v8 ignore start -- systematic SQLite errors carry a `code` (SQLITE_FULL/BUSY/IOERR/...) and abort the batch */
            if (error instanceof Error && 'code' in error) throw error;
            /* v8 ignore stop */
            /* v8 ignore start -- non-Error rejection is defensive; current repositories throw Error instances. */
            errors.push({ recordId: change.recordId, error: error instanceof Error ? error.message : String(error) });
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
        if (!(error instanceof Error && 'code' in error)) throw error;
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
    return { accepted, failed: errors.length, errors };
  }

  registerDevice(deviceId: string, name: string, context: AppContext): { deviceId: string; token: string } {
    if (!context.clinicId) throw new AppError('FORBIDDEN', 'Sync requires a clinic scope', 403);
    if (!['BOSS'].includes(context.role)) {
      throw new AppError('FORBIDDEN', 'Sync requires BOSS', 403);
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
