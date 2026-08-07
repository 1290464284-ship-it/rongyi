// 审计日志服务（M-04：由 auth.ts 拆分）
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

export interface AuditLogInput {
  userId?: string | null;
  userName?: string | null;
  action: string;
  target?: string | null;
  detail?: string | null;
  ip?: string | null;
  traceId?: string | null;
  clinicId?: string | null;
}

export class AuditService {
  constructor(private readonly db: Database.Database) {}

  cleanup(beforeIso: string): number {
    const result = this.db.prepare('DELETE FROM OperationLog WHERE createdAt < ?').run(beforeIso);
    return result.changes;
  }

  log(input: AuditLogInput): void {
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO OperationLog (
         id, userId, userName, action, target, detail, ip, traceId,
         clinicId, createdAt, updatedAt, deletedAt
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    ).run(
      randomUUID(),
      input.userId ?? null,
      input.userName ?? null,
      input.action,
      input.target ?? null,
      input.detail ?? null,
      input.ip ?? null,
      input.traceId ?? null,
      input.clinicId ?? null,
      now,
      now,
    );
  }
}
