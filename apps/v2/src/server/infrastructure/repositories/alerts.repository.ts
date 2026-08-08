// 业务告警仓储（M-04：由 core.repositories.ts 拆分）
import type Database from 'better-sqlite3';
import { tenantAnd } from '../tenant';
import type { AlertRepository } from '../../application/ports';

export class SqliteAlertRepository implements AlertRepository {
  constructor(private readonly db: Database.Database) {}

  open(
    clinicId?: string | null,
    options?: { page?: number; pageSize?: number },
  ): { items: Array<Record<string, unknown>>; total: number; page: number; pageSize: number; truncated?: boolean } {
    const rawPage = Number(options?.page);
    const rawPageSize = Number(options?.pageSize);
    const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
    const pageSize = Number.isFinite(rawPageSize) && rawPageSize >= 1 ? Math.min(100, Math.floor(rawPageSize)) : 100;
    const offset = (page - 1) * pageSize;
    const params: Array<string | number> = clinicId ? [clinicId] : [];
    const where = `WHERE status = 'OPEN' AND deletedAt IS NULL${tenantAnd(clinicId)}`;
    const total = Number((this.db.prepare(
      `SELECT COUNT(*) AS total FROM BusinessAlert ${where}`,
    ).get(...params) as { total: number }).total);
    const items = this.db.prepare(
      `SELECT * FROM BusinessAlert ${where} ORDER BY createdAt DESC LIMIT ? OFFSET ?`,
    ).all(...params, pageSize, offset) as Array<Record<string, unknown>>;
    return { items, total, page, pageSize, truncated: total > offset + items.length };
  }

  setStatus(id: string, status: string, userId: string | null, now: string, clinicId?: string | null): number {
    const params = clinicId ? [status, userId, now, now, id, clinicId] : [status, userId, now, now, id];
    return this.db.prepare(
      `UPDATE BusinessAlert SET status = ?, acknowledgedBy = ?, acknowledgedAt = ?, updatedAt = ?
       WHERE id = ? AND deletedAt IS NULL AND status IN ('OPEN', 'ACKNOWLEDGED')${tenantAnd(clinicId)}`,
    ).run(...params).changes;
  }
}
