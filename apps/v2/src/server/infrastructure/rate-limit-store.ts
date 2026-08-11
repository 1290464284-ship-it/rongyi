import type Database from 'better-sqlite3';
import type { Statement } from 'better-sqlite3';
import type { RateLimitStore, RateLimitWindow } from '../http/rate-limit';

/**
 * DB-backed rate limit store so multiple processes sharing the same SQLite
 * database enforce the same windows (multi-instance/multi-clinic friendly).
 * Rows expire with the window and are pruned lazily once per minute.
 */
export class SqliteRateLimitStore implements RateLimitStore {
  private readonly getStmt: Statement;
  private readonly setStmt: Statement;
  private readonly incrementStmt: Statement;
  private readonly deleteStmt: Statement;
  private readonly pruneStmt: Statement;
  private lastPrunedAt = 0;

  constructor(db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS RateLimitWindow (
        key TEXT PRIMARY KEY,
        count INTEGER NOT NULL,
        resetAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_rate_limit_window_reset
        ON RateLimitWindow(resetAt);
    `);
    this.getStmt = db.prepare('SELECT count, resetAt FROM RateLimitWindow WHERE key = ?');
    this.setStmt = db.prepare(
      `INSERT INTO RateLimitWindow (key, count, resetAt, updatedAt)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET count = excluded.count, resetAt = excluded.resetAt, updatedAt = excluded.updatedAt`,
    );
    // Atomic cross-process increment: read-modify-write happens inside one
    // SQLite statement, so two API processes sharing the database cannot both
    // persist the same stale count and overshoot the configured limit.
    this.incrementStmt = db.prepare(
      `INSERT INTO RateLimitWindow (key, count, resetAt, updatedAt)
       VALUES (?, 1, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN RateLimitWindow.resetAt <= ? THEN 1 ELSE RateLimitWindow.count + 1 END,
         resetAt = CASE WHEN RateLimitWindow.resetAt <= ? THEN excluded.resetAt ELSE RateLimitWindow.resetAt END,
         updatedAt = excluded.updatedAt
       RETURNING count, resetAt`,
    );
    this.deleteStmt = db.prepare('DELETE FROM RateLimitWindow WHERE key = ?');
    this.pruneStmt = db.prepare('DELETE FROM RateLimitWindow WHERE resetAt <= ?');
  }

  get(key: string): RateLimitWindow | undefined {
    this.pruneIfStale();
    const row = this.getStmt.get(key) as { count: number; resetAt: number } | undefined;
    return row ? { count: row.count, resetAt: row.resetAt } : undefined;
  }

  set(key: string, window: RateLimitWindow): void {
    this.setStmt.run(key, window.count, window.resetAt, Date.now());
  }

  increment(key: string, windowMs: number, now = Date.now()): RateLimitWindow {
    this.pruneIfStale(now);
    const row = this.incrementStmt.get(key, now + windowMs, now, now, now) as { count: number; resetAt: number };
    return { count: row.count, resetAt: row.resetAt };
  }

  delete(key: string): void {
    this.deleteStmt.run(key);
  }

  pruneIfStale(now = Date.now()): void {
    if (now - this.lastPrunedAt < 60_000) return;
    this.lastPrunedAt = now;
    this.pruneStmt.run(now);
  }
}
