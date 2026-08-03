import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { ConflictError } from './errors';

/**
 * Executes a write operation at most once for a client-provided key.
 *
 * The operation body is only executed when no completed record exists. If the
 * body throws, the processing record is removed so the client can retry.
 */
export function withIdempotency<T>(
  db: Database.Database,
  key: string | undefined,
  fn: () => T,
): T {
  if (!key) return fn();

  const now = new Date().toISOString();
  const existing = db.prepare('SELECT responseJson FROM IdempotencyRecord WHERE key = ?').get(key) as
    | { responseJson: string }
    | undefined;
  if (existing) {
    return JSON.parse(existing.responseJson) as T;
  }

  try {
    db.prepare(
      `INSERT INTO IdempotencyRecord (
         id, key, responseJson, clinicId, createdAt, updatedAt, deletedAt
       ) VALUES (?, ?, '{}', NULL, ?, ?, NULL)`,
    ).run(randomUUID(), key, now, now);
  } catch (error) {
    const concurrent = db.prepare('SELECT responseJson FROM IdempotencyRecord WHERE key = ?').get(key) as
      | { responseJson: string }
      | undefined;
    if (concurrent) return JSON.parse(concurrent.responseJson) as T;
    throw error;
  }

  try {
    const result = fn();
    db.prepare(
      'UPDATE IdempotencyRecord SET responseJson = ?, updatedAt = ? WHERE key = ?',
    ).run(JSON.stringify(result), now, key);
    return result;
  } catch (error) {
    db.prepare('DELETE FROM IdempotencyRecord WHERE key = ?').run(key);
    throw error;
  }
}

