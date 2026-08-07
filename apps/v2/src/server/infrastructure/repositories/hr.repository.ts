// HR 仓储（考勤/请假，M-04：由 core.repositories.ts 拆分）
import type Database from 'better-sqlite3';
import { tenantAnd } from '../tenant';
import type { HrRepository } from '../../application/ports';

export class SqliteHrRepository implements HrRepository {
  constructor(private readonly db: Database.Database) {}

  attendance(workDate?: string, clinicId?: string | null): Array<Record<string, unknown>> {
    if (workDate) {
      const params = clinicId ? [workDate, clinicId] : [workDate];
      return this.db.prepare(`SELECT * FROM Attendance WHERE workDate = ? AND deletedAt IS NULL${tenantAnd(clinicId)} ORDER BY checkIn`).all(...params) as Array<Record<string, unknown>>;
    }
    const params = clinicId ? [clinicId] : [];
    return this.db.prepare(`SELECT * FROM Attendance WHERE deletedAt IS NULL${tenantAnd(clinicId)} ORDER BY workDate DESC LIMIT 200`).all(...params) as Array<Record<string, unknown>>;
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
