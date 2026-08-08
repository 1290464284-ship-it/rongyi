// HR 仓储（考勤/请假，M-04：由 core.repositories.ts 拆分）
import type Database from 'better-sqlite3';
import { tenantAnd } from '../tenant';
import type { HrRepository } from '../../application/ports';

export class SqliteHrRepository implements HrRepository {
  constructor(private readonly db: Database.Database) {}

  attendance(
    workDate?: string,
    clinicId?: string | null,
    options?: { page?: number; pageSize?: number },
  ): { items: Array<Record<string, unknown>>; total: number; page: number; pageSize: number; truncated?: boolean } {
    const rawPage = Number(options?.page);
    const rawPageSize = Number(options?.pageSize);
    const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
    const pageSize = Number.isFinite(rawPageSize) && rawPageSize >= 1 ? Math.min(200, Math.floor(rawPageSize)) : 200;
    const offset = (page - 1) * pageSize;
    const tenantValues: Array<string | number> = clinicId ? [clinicId] : [];
    const tenantClause = tenantAnd(clinicId);
    const where = workDate
      ? `WHERE workDate = ? AND deletedAt IS NULL${tenantClause}`
      : `WHERE deletedAt IS NULL${tenantClause}`;
    const orderBy = workDate ? 'ORDER BY checkIn' : 'ORDER BY workDate DESC, checkIn';
    const baseParams: Array<string | number> = workDate ? [workDate, ...tenantValues] : tenantValues;
    const total = Number((this.db.prepare(
      `SELECT COUNT(*) AS total FROM Attendance ${where}`,
    ).get(...baseParams) as { total: number }).total);
    const items = this.db.prepare(
      `SELECT * FROM Attendance ${where} ${orderBy} LIMIT ? OFFSET ?`,
    ).all(...baseParams, pageSize, offset) as Array<Record<string, unknown>>;
    return { items, total, page, pageSize, truncated: total > offset + items.length };
  }

  approveLeave(id: string, status: string, reviewerId: string, now: string, clinicId?: string | null): number {
    const params = clinicId ? [status, reviewerId, now, now, id, clinicId] : [status, reviewerId, now, now, id];
    return this.db.prepare(
      `UPDATE LeaveRequest SET status = ?, reviewerId = ?, reviewedAt = ?, updatedAt = ?
       WHERE id = ? AND deletedAt IS NULL AND status = 'PENDING'${tenantAnd(clinicId)}`,
    )
      .run(...params).changes;
  }
}
