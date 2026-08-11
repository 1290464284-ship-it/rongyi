// 欠费（Debt）仓储（M-04：由 core.repositories.ts 拆分）
import type Database from 'better-sqlite3';
import { ConflictError } from '../errors';
import { tenantAnd } from '../tenant';
import type { DebtRecord, DebtRepository } from '../../application/ports';

export class SqliteDebtRepository implements DebtRepository {
  constructor(private readonly db: Database.Database) {}

  findById(id: string, clinicId?: string | null): DebtRecord | null {
    const params = clinicId ? [id, clinicId] : [id];
    return (this.db.prepare(`SELECT * FROM Debt WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`).get(...params) as DebtRecord | undefined) ?? null;
  }

  findByCharge(chargeId: string, clinicId?: string | null): DebtRecord | null {
    const params = clinicId ? [chargeId, clinicId] : [chargeId];
    return (this.db.prepare(`SELECT * FROM Debt WHERE chargeId = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`).get(...params) as DebtRecord | undefined) ?? null;
  }

  updatePaid(id: string, paidAmount: number, status: string, updatedAt: string, previousPaidAmount: number, clinicId?: string | null): void {
    const params = clinicId
      ? [paidAmount, status, updatedAt, id, previousPaidAmount, clinicId]
      : [paidAmount, status, updatedAt, id, previousPaidAmount];
    const result = this.db.prepare(
      `UPDATE Debt SET paidAmount = ?, status = ?, updatedAt = ? WHERE id = ? AND deletedAt IS NULL AND paidAmount = ?${tenantAnd(clinicId)}`,
    ).run(...params);
    if (result.changes === 0) {
      throw new ConflictError('Debt payment state changed; retry');
    }
  }
}
