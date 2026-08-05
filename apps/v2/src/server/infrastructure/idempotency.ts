import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { ConflictError } from './errors';

export interface IdempotencyScope {
  operation: string;
  userId?: string | null;
  clinicId?: string | null;
  requestId: string;
}

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const IDEMPOTENCY_PROCESSING_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Executes a write operation at most once for a client-provided key.
 *
 * The key is scoped to the operation, user, clinic, and client request id so
 * the same request id cannot be replayed across unrelated operations.
 * Completed records are returned as-is until they expire. If the operation
 * throws, the processing record is removed so the client can retry.
 */
export function withIdempotency<T>(
  db: Database.Database,
  scope: IdempotencyScope,
  fn: () => T | Promise<T>,
): T | Promise<T> {
  if (!scope?.requestId) return fn();

  const startedAt = new Date().toISOString();
  db.prepare('DELETE FROM IdempotencyRecord WHERE expiresAt IS NOT NULL AND expiresAt <= ?').run(startedAt);
  const key = scopeKey(scope);
  const existing = db.prepare('SELECT responseJson, status, updatedAt FROM IdempotencyRecord WHERE key = ?').get(key) as
    | { responseJson: string; status: string; updatedAt: string }
    | undefined;
  if (existing) {
    if (existing.status !== 'COMPLETED') throw new ConflictError('Operation is already in progress');
    return JSON.parse(existing.responseJson) as T;
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
      return JSON.parse(concurrent.responseJson) as T;
    }
    throw error;
  }

  let result: T | Promise<T>;
  try {
    result = fn();
  } catch (error) {
    db.prepare('DELETE FROM IdempotencyRecord WHERE key = ?').run(key);
    throw error;
  }
  if (isPromise(result)) {
    return result.then(
      (value) => {
        const completedAt = new Date().toISOString();
        db.prepare(
          `UPDATE IdempotencyRecord SET responseJson = ?, result = ?, status = 'COMPLETED', updatedAt = ? WHERE key = ?`,
        ).run(JSON.stringify(value), JSON.stringify(value), completedAt, key);
        return value;
      },
      (error: unknown) => {
        db.prepare('DELETE FROM IdempotencyRecord WHERE key = ?').run(key);
        throw error;
      },
    );
  }
  try {
    const completedAt = new Date().toISOString();
    db.prepare(
      `UPDATE IdempotencyRecord SET responseJson = ?, result = ?, status = 'COMPLETED', updatedAt = ? WHERE key = ?`,
    ).run(JSON.stringify(result), JSON.stringify(result), completedAt, key);
    return result;
  } catch (error) {
    db.prepare('DELETE FROM IdempotencyRecord WHERE key = ?').run(key);
    throw error;
  }
}

function scopeKey(scope: IdempotencyScope): string {
  return createHash('sha256')
    .update([scope.operation, scope.userId ?? '', scope.clinicId ?? '', scope.requestId].join('\0'))
    .digest('hex');
}

/**
 * Deletes idempotency records stuck in a non-COMPLETED state past the
 * processing timeout. Runs off the write hot path (daily scheduled task).
 */
export function cleanupIdempotencyRecords(db: Database.Database): { deleted: number } {
  const staleBefore = new Date(Date.now() - IDEMPOTENCY_PROCESSING_TIMEOUT_MS).toISOString();
  const result = db.prepare(
    "DELETE FROM IdempotencyRecord WHERE status != 'COMPLETED' AND updatedAt IS NOT NULL AND updatedAt <= ?",
  ).run(staleBefore);
  return { deleted: result.changes };
}

function isPromise(value: unknown): value is Promise<unknown> {
  return typeof value === 'object' && value !== null && typeof (value as { then?: unknown }).then === 'function';
}
