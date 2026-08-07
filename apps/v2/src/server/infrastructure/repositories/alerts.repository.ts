// 业务告警仓储（M-04：由 core.repositories.ts 拆分）
import type Database from 'better-sqlite3';
import { tenantAnd } from '../tenant';
import type { AlertRepository } from '../../application/ports';

export class SqliteAlertRepository implements AlertRepository {
  constructor(private readonly db: Database.Database) {}

  open(clinicId?: string | null): Array<Record<string, unknown>> {
    const params = clinicId ? [clinicId] : [];
    return this.db.prepare(
      `SELECT * FROM BusinessAlert WHERE status = 'OPEN' AND deletedAt IS NULL${tenantAnd(clinicId)} ORDER BY createdAt DESC LIMIT 100`,
    ).all(...params) as Array<Record<string, unknown>>;
  }

  setStatus(id: string, status: string, userId: string | null, now: string, clinicId?: string | null): number {
    const params = clinicId ? [status, userId, now, now, id, clinicId] : [status, userId, now, now, id];
    return this.db.prepare(
      `UPDATE BusinessAlert SET status = ?, acknowledgedBy = ?, acknowledgedAt = ?, updatedAt = ?
       WHERE id = ? AND deletedAt IS NULL AND status IN ('OPEN', 'ACKNOWLEDGED')${tenantAnd(clinicId)}`,
    ).run(...params).changes;
  }
}
