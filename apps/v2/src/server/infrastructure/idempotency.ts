import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { AppError, ConflictError } from './errors';
import { isDbWriteActive } from './db-write-queue';

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

function logIdempotency(message: string, meta: Record<string, unknown>): void {
  // 幂等是跨请求的基础设施路径，单独接 Logger 会引入额外依赖；统一前缀 + 结构化
  // 元数据，保证与 [idempotency] 相关的输出可 grep、可进日志采集。
  console.error(`[idempotency] ${message}`, meta);
}

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
  options?: { keepProcessingOnAppError?: boolean },
): T | Promise<T> {
  if (!scope?.requestId) {
    if (isAsyncFunction(fn)) return fn();
    if (isDbWriteActive(db)) {
      // 同一条连接上已有显式 BEGIN（sync push / bulk import / resolveConflict）时，
      // 直接 503，避免嵌套事务污染外层写路径。
      throw new AppError('DB_BUSY', 'Database write is in progress; retry the request', 503);
    }
    // 无 requestId 时没有幂等记录，但仍用 BEGIN IMMEDIATE 包裹同步写入，
    // 保证“金额/积分/流水”等复合操作要么全部提交要么整体回滚。
    db.exec('BEGIN IMMEDIATE');
    try {
      const value = fn();
      if (isPromise(value)) {
        throw new Error('Idempotent write must complete synchronously; use an async callback for promises');
      }
      db.exec('COMMIT');
      return value;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  if (isDbWriteActive(db)) {
    // 同一连接上已有显式 BEGIN（sync push / bulk import / resolveConflict）时，
    // 任何幂等写都必须直接 503：先写 PROCESSING 记录会混入外层事务。
    throw new AppError('DB_BUSY', 'Database write is in progress; retry the request', 503);
  }

  const startedAt = new Date().toISOString();
  const key = scopeKey(scope);
  const existing = db.prepare('SELECT responseJson, status, expiresAt, updatedAt FROM IdempotencyRecord WHERE key = ?').get(key) as
    | { responseJson: string; status: string; expiresAt: string | null; updatedAt: string }
    | undefined;
  if (existing) {
    const replayed = replayCompletedOrDelete<T>(db, key, existing, startedAt);
    if (replayed !== undefined) return replayed;
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
      const replayed = replayCompletedOrDelete<T>(db, key, concurrent, startedAt);
      if (replayed !== undefined) return replayed;
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
      if (error instanceof AppError && !options?.keepProcessingOnAppError) {
        // 已知业务错误（校验/冲突/未找到）对应的写路径在事务内回滚，可安全删除 PROCESSING 供重试。
        db.prepare('DELETE FROM IdempotencyRecord WHERE key = ?').run(key);
      } else {
        logIdempotency('async operation failed; keeping PROCESSING record so a retry cannot duplicate side effects', {
          key,
          error: error instanceof Error ? error.message : String(error),
        });
      }
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
        if (error instanceof AppError && !options?.keepProcessingOnAppError) {
          // 已知业务错误一定伴随事务回滚，删除 PROCESSING 避免 30 分钟假锁。
          db.prepare('DELETE FROM IdempotencyRecord WHERE key = ?').run(key);
        } else {
          logIdempotency('async operation rejected; keeping PROCESSING record so a retry cannot duplicate side effects', {
            key,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        throw error;
      },
    );
  }

  // Sync path: run the operation and the COMPLETED update inside one
  // BEGIN IMMEDIATE transaction. Acquiring the write lock up front avoids
  // SQLITE_BUSY_SNAPSHOT on multi-process writers and lets the business-layer
  // optimistic guards (paidAmount/stock/balance) surface as 409 instead of 500.
  // If fn() or the update fails, ROLLBACK reverts business writes (including
  // nested transactions / SAVEPOINTs), the processing record is deleted, and
  // the error is rethrown so the client can retry without duplicating effects.
  try {
    if (isDbWriteActive(db)) {
      // 同一连接上已有 async 写路径持有显式 BEGIN（sync push / bulk import /
      // resolveConflict），同步路径此时 BEGIN 会嵌套并污染事务；返回可重试 503。
      throw new AppError('DB_BUSY', 'Database write is in progress; retry the request', 503);
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      const value = fn();
      if (isPromise(value)) {
        // 非 async 回调返回 Promise 会走同步路径，序列化后会错误标记
        // COMPLETED；直接失败回滚，要求调用方改用 async 回调。
        throw new Error('Idempotent write must complete synchronously; use an async callback for promises');
      }
      const completedAt = new Date().toISOString();
      db.prepare(
        `UPDATE IdempotencyRecord SET responseJson = ?, result = ?, status = 'COMPLETED', updatedAt = ? WHERE key = ?`,
      ).run(JSON.stringify(value), JSON.stringify(value), completedAt, key);
      db.exec('COMMIT');
      return value;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
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

function replayCompletedOrDelete<T>(
  db: Database.Database,
  key: string,
  row: { responseJson: string; status: string; expiresAt?: string | null },
  now: string,
): T | undefined {
  if (row.status !== 'COMPLETED') {
    throw new ConflictError('Operation is already in progress; use a new requestId or wait for the current operation to finish');
  }
  // Lazy single-key cleanup: an expired COMPLETED record is a retry, not a replay.
  if (row.expiresAt !== null && row.expiresAt !== undefined && row.expiresAt <= now) {
    db.prepare('DELETE FROM IdempotencyRecord WHERE key = ? AND status = ?').run(key, 'COMPLETED');
    return undefined;
  }
  const replayed = parseStoredResponse<T>(row.responseJson);
  if (replayed !== undefined) return replayed;
  // 损坏的 COMPLETED 记录无法安全重放：删除并重跑，让操作恢复而不是永久 500。
  // 风险：原始写入可能已生效，仅在数据库被人工/异常改坏时走到这里。
  logIdempotency('completed response is corrupt; deleting record and retrying operation', { key });
  db.prepare('DELETE FROM IdempotencyRecord WHERE key = ?').run(key);
  return undefined;
}
