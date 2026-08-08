import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { ConflictError } from './errors';

export interface IdempotencyScope {
  operation: string;
  userId?: string | null;
  clinicId?: string | null;
  requestId: string;
  /** 业务资源 ID（charge/card/debt/item 等）。同一个 requestId 用于不同资源时必须
   *  传不同的 resourceId，否则后一个操作会命中前一个操作的缓存响应（串号）。 */
  resourceId?: string | null;
}

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const IDEMPOTENCY_PROCESSING_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Executes a write operation at most once for a client-provided key.
 *
 * The key is scoped to the operation, user, clinic, and client request id so
 * the same request id cannot be replayed across unrelated operations.
 * Completed records are returned as-is until they expire. Expired completed
 * records are deleted lazily for the touched key only (no hot-path table
 * sweep). If the operation throws, the processing record is removed so the
 * client can retry — except on the async path, where business side effects
 * cannot be rolled back: the processing record is kept so a retry cannot
 * duplicate them (it stays until cleanupIdempotencyRecords removes it).
 */
export function withIdempotency<T>(
  db: Database.Database,
  scope: IdempotencyScope,
  fn: () => T | Promise<T>,
): T | Promise<T> {
  if (!scope?.requestId) return fn();

  const startedAt = new Date().toISOString();
  const key = scopeKey(scope);
  const existing = db.prepare('SELECT responseJson, status, expiresAt, updatedAt FROM IdempotencyRecord WHERE key = ?').get(key) as
    | { responseJson: string; status: string; expiresAt: string | null; updatedAt: string }
    | undefined;
  if (existing) {
    if (existing.status !== 'COMPLETED') throw new ConflictError('Operation is already in progress');
    if (existing.expiresAt !== null && existing.expiresAt <= startedAt) {
      // Lazy single-key cleanup: an expired COMPLETED record is a retry, not a replay.
      db.prepare('DELETE FROM IdempotencyRecord WHERE key = ? AND status = ?').run(key, 'COMPLETED');
    } else {
      const replayed = parseStoredResponse<T>(existing.responseJson);
      if (replayed !== undefined) return replayed;
      // 损坏的 COMPLETED 记录无法安全重放：删除并重跑，让操作恢复而不是永久 500。
      // 风险：原始写入可能已生效，仅在数据库被人工/异常改坏时走到这里。
      console.error('[idempotency] completed response is corrupt; deleting record and retrying operation', { key });
      db.prepare('DELETE FROM IdempotencyRecord WHERE key = ?').run(key);
    }
  }

  try {
    const expiresAt = new Date(Date.now() + IDEMPOTENCY_TTL_MS).toISOString();
    db.prepare(
      `INSERT INTO IdempotencyRecord (
         id, key, type, status, responseJson, result, userId, clinicId, operation,
         createdAt, updatedAt, deletedAt, expiresAt
       ) VALUES (?, ?, 'GENERIC', 'PROCESSING', '{}', '{}', ?, ?, ?, ?, ?, NULL, ?)`,
    ).run(randomUUID(), key, scope.userId ?? null, scope.clinicId ?? null, scope.operation, startedAt, startedAt, expiresAt);
  } catch (error) {
    const concurrent = db.prepare('SELECT responseJson, status, updatedAt FROM IdempotencyRecord WHERE key = ?').get(key) as
      | { responseJson: string; status: string; updatedAt: string }
      | undefined;
    if (concurrent) {
      if (concurrent.status !== 'COMPLETED') throw new ConflictError('Operation is already in progress');
      const replayed = parseStoredResponse<T>(concurrent.responseJson);
      if (replayed !== undefined) return replayed;
      console.error('[idempotency] concurrent completed response is corrupt; deleting record and retrying operation', { key });
      db.prepare('DELETE FROM IdempotencyRecord WHERE key = ?').run(key);
    }
    throw error;
  }

  // Async operations cannot be wrapped in a better-sqlite3 transaction
  // (db.transaction rejects promise returns with a TypeError), so the async
  // path keeps the legacy completion semantics: UPDATE on success. On failure
  // the PROCESSING record is intentionally KEPT (not deleted): the async
  // business writes may have partially taken effect and cannot be rolled
  // back, so a retry must not re-run the operation. cleanupIdempotencyRecords
  // removes the stuck PROCESSING record after the processing timeout.
  if (isAsyncFunction(fn)) {
    let result: T | Promise<T>;
    try {
      result = fn();
    } catch (error) {
      console.error('[idempotency] async operation failed; keeping PROCESSING record so a retry cannot duplicate side effects', {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    if (!isPromise(result)) return result;
    return result.then(
      (value) => {
        const completedAt = new Date().toISOString();
        db.prepare(
          `UPDATE IdempotencyRecord SET responseJson = ?, result = ?, status = 'COMPLETED', updatedAt = ? WHERE key = ?`,
        ).run(JSON.stringify(value), JSON.stringify(value), completedAt, key);
        return value;
      },
      (error: unknown) => {
        console.error('[idempotency] async operation rejected; keeping PROCESSING record so a retry cannot duplicate side effects', {
          key,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      },
    );
  }

  // Sync path: run the operation and the COMPLETED update inside one
  // transaction. If fn() or the update fails, better-sqlite3 rolls the whole
  // transaction back (including business writes fn committed through nested
  // transactions / SAVEPOINTs), the processing record is deleted, and the
  // error is rethrown so the client can retry without duplicating side effects.
  try {
    const runWithCompletion = db.transaction(() => {
      const value = fn();
      const completedAt = new Date().toISOString();
      db.prepare(
        `UPDATE IdempotencyRecord SET responseJson = ?, result = ?, status = 'COMPLETED', updatedAt = ? WHERE key = ?`,
      ).run(JSON.stringify(value), JSON.stringify(value), completedAt, key);
      return value;
    });
    return runWithCompletion();
  } catch (error) {
    db.prepare('DELETE FROM IdempotencyRecord WHERE key = ?').run(key);
    throw error;
  }
}

function scopeKey(scope: IdempotencyScope): string {
  return createHash('sha256')
    .update([scope.operation, scope.resourceId ?? '', scope.userId ?? '', scope.clinicId ?? '', scope.requestId].join('\0'))
    .digest('hex');
}

/**
 * Deletes idempotency records that are no longer meaningful:
 *  - COMPLETED records past their TTL (expiresAt <= now)
 *  - non-COMPLETED (PROCESSING) records stuck past the processing timeout
 * Runs off the write hot path (daily scheduled task).
 */
export function cleanupIdempotencyRecords(db: Database.Database): { deleted: number } {
  const now = new Date().toISOString();
  const staleBefore = new Date(Date.now() - IDEMPOTENCY_PROCESSING_TIMEOUT_MS).toISOString();
  const result = db.prepare(
    `DELETE FROM IdempotencyRecord
     WHERE (status = 'COMPLETED' AND expiresAt IS NOT NULL AND expiresAt <= ?)
        OR (status != 'COMPLETED' AND updatedAt IS NOT NULL AND updatedAt <= ?)`,
  ).run(now, staleBefore);
  return { deleted: result.changes };
}

function isPromise(value: unknown): value is Promise<unknown> {
  return typeof value === 'object' && value !== null && typeof (value as { then?: unknown }).then === 'function';
}

function isAsyncFunction(value: unknown): value is () => Promise<unknown> {
  return typeof value === 'function' && value.constructor?.name === 'AsyncFunction';
}

function parseStoredResponse<T>(raw: string): T | undefined {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}
