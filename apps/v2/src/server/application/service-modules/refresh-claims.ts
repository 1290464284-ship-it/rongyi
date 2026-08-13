// 跨实例 refresh 轮换的 DB claim 缓存（B-M9）：从 auth.service.ts 抽取，
// 保持「5 秒窗口内并发/重复 refresh 返回同一新会话、跨进程一致」的语义。
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { AuthSession } from './common';
import { decryptRefreshClaim, encryptRefreshClaim, refreshClaimKey } from './auth-refresh-claim';

export function readRefreshClaimStore(
  db: Database.Database,
  tokenHash: string,
  userId: string,
  isSessionStillValid: (session: AuthSession) => boolean,
): AuthSession | null {
  const key = refreshClaimKey(tokenHash, userId);
  const row = db.prepare(
    `SELECT responseJson, expiresAt FROM IdempotencyRecord
     WHERE key = ? AND operation = 'auth.refresh' AND status = 'COMPLETED'
     ORDER BY createdAt DESC LIMIT 1`,
  ).get(key) as { responseJson: string; expiresAt: string | null } | undefined;
  if (!row?.expiresAt || new Date(row.expiresAt).getTime() <= Date.now()) return null;
  try {
    const session = decryptRefreshClaim(row.responseJson, tokenHash);
    if (!session) return null;
    if (!isSessionStillValid(session)) return null;
    return session;
  } catch {
    return null;
  }
}

export function writeRefreshClaimStore(
  db: Database.Database,
  tokenHash: string,
  userId: string,
  session: AuthSession,
  ttlMs: number,
): void {
  const key = refreshClaimKey(tokenHash, userId);
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  db.prepare(
    `DELETE FROM IdempotencyRecord WHERE key = ? AND operation = 'auth.refresh'`,
  ).run(key);
  db.prepare(
    `INSERT INTO IdempotencyRecord (
       id, key, type, status, responseJson, result, userId, clinicId, operation,
       createdAt, updatedAt, deletedAt, expiresAt
     ) VALUES (?, ?, 'GENERIC', 'COMPLETED', ?, ?, ?, NULL, 'auth.refresh', ?, ?, NULL, ?)`,
  ).run(randomUUID(), key, encryptRefreshClaim(session, tokenHash), '{}', userId, now, now, expiresAt);
}

export function clearUserRefreshClaimsStore(db: Database.Database, userId: string): void {
  try {
    db.prepare(
      `DELETE FROM IdempotencyRecord WHERE operation = 'auth.refresh' AND userId = ?`,
    ).run(userId);
  } catch {
    // 缓存清理为尽力而为；会话族吊销与标记已用是权威路径
  }
}
