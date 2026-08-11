import type Database from 'better-sqlite3';
import { NotFoundError, ValidationError } from '../../../infrastructure/errors';
import { withIdempotency } from '../../../infrastructure/idempotency';
import { tenantAnd, tenantParams } from '../../../infrastructure/tenant';
import { trackResourceWrite } from '../../../infrastructure/write-tracking';
import { SqliteDebtRepository } from '../../../infrastructure/repositories/core.repositories';
import type { AppContext } from '../../../../domain/contracts';
import type { DebtRepository } from '../../ports';

export class DebtService {
  private readonly db: Database.Database;
  private readonly debtRepository: DebtRepository;

  constructor(db: Database.Database, debtRepository?: DebtRepository) {
    this.db = db;
    this.debtRepository = debtRepository ?? new SqliteDebtRepository(db);
  }

  async pay(debtId: string, amount: number, context: AppContext, requestId?: string): Promise<Record<string, unknown>> {
    const executePay = this.db.transaction((debtId: string, amount: number, context: AppContext) => {
      const debt = this.debtRepository.findById(debtId, context.clinicId);
      if (!debt) throw new NotFoundError('Debt record not found');
      const remaining = Number(debt.totalAmount) - Number(debt.paidAmount);
      if (!Number.isSafeInteger(amount) || amount <= 0 || amount > remaining) throw new ValidationError('Invalid debt payment amount');
      const paid = Number(debt.paidAmount) + amount;
      const status = paid >= Number(debt.totalAmount) ? 'PAID' : 'PARTIAL';
      this.debtRepository.updatePaid(debtId, paid, status, context.now().toISOString(), Number(debt.paidAmount), context.clinicId);
      const charge = this.db.prepare(
        `SELECT id, totalAmount, paidAmount
         FROM Charge WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
      ).get(debt.chargeId, ...tenantParams(context.clinicId)) as {
        id: string;
        totalAmount: number;
        paidAmount: number;
      } | undefined;
      if (charge) {
        const chargePaid = Math.min(Number(charge.totalAmount), Number(charge.paidAmount) + amount);
        const chargeStatus = chargePaid >= Number(charge.totalAmount) ? 'PAID' : chargePaid > 0 ? 'PARTIAL' : 'UNPAID';
        this.db.prepare(
          `UPDATE Charge
           SET paidAmount = ?, status = ?, updatedAt = ?
           WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
        ).run(chargePaid, chargeStatus, context.now().toISOString(), charge.id, ...tenantParams(context.clinicId));
        // P2-3：直接改库的路径统一维护同步与搜索索引。
        trackResourceWrite(this.db, { tableName: 'Charge', recordId: charge.id, operation: 'UPDATE', clinicId: context.clinicId ?? null });
      }
      return { id: debtId, paidAmount: paid, status };
    });
    return await withIdempotency(this.db, {
      operation: 'debt.pay',
      resourceId: debtId,
      userId: context.userId,
      clinicId: context.clinicId,
      requestId: requestId ?? '',
    }, () => executePay(debtId, amount, context));
  }
}
