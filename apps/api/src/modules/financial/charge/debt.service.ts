import { Injectable } from '@nestjs/common';
import { DbService } from '../../../db/db.service';
import { IDatabase } from '../../../db/db.interface';
import { BaseService } from '../../../common/services/base.service';
import { ClinicContextService } from '../../../common/services/clinic-context.service';
import { DebtRecord } from './entities/debt.entity';
import { QueryDebtDto, CreateDebtFromChargeDto, PayDebtDto } from './dto/debt.dto';
import { IdempotencyService } from '../../../common/services/idempotency.service';
import { yuanToCents, centsToYuan, centsGreaterThan, centsLessThanOrEqual } from '../../../common/utils/format/money.utils';
import { DebtStatus, AuditLogType } from '../../../common/constants';
import { BusinessNotFoundException, BusinessValidationException } from '@common/errors';

@Injectable()
export class DebtService extends BaseService<DebtRecord> {
  constructor(
    dbService: DbService,
    clinicContext: ClinicContextService,
    private idempotency: IdempotencyService,
  ) {
    super(dbService, clinicContext, 'DebtRecord', [], [], [], true, [], undefined, undefined, [
      'totalAmount', 'paidAmount', 'debtAmount',
    ]);
  }

  listDebts(dto: QueryDebtDto) {
    const filters: Record<string, unknown> = {};
    if (dto.patientId) filters.patientId = dto.patientId;
    if (dto.status) filters.status = dto.status;

    return this.findMany({
      page: dto.page,
      pageSize: dto.pageSize,
      filters,
      sortBy: 'createdAt',
      sortOrder: 'DESC',
    });
  }

  debtStats() {
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();

    const row = this.dbService.prepare(
      `SELECT
        COALESCE(SUM(debtAmount), 0) as totalDebt,
        COALESCE(COUNT(*), 0) as totalCount
       FROM DebtRecord
       WHERE deletedAt IS NULL AND status != '${DebtStatus.PAID}' AND status != '${DebtStatus.CANCELLED}'${clinicClause}`
    ).get(...clinicParams) as { totalDebt: number; totalCount: number };

    return {
      totalDebt: centsToYuan(row.totalDebt),
      totalCount: row.totalCount,
    };
  }

  getDebt(id: string) {
    return this.findOne(id);
  }

  async createDebtFromCharge(dto: CreateDebtFromChargeDto) {
    // Verify charge exists
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    const charge = this.dbService.prepare(`SELECT id FROM Charge WHERE id = ? AND deletedAt IS NULL${clinicClause}`).get(dto.chargeId, ...clinicParams) as { id: string } | undefined;
    if (!charge) {
      throw new BusinessNotFoundException("收费记录不存在");
    }

    const totalAmountCents = yuanToCents(dto.totalAmount);
    const debtAmountCents = yuanToCents(dto.debtAmount);
    const paidAmountCents = totalAmountCents - debtAmountCents;
    const status = paidAmountCents <= 0 ? DebtStatus.UNPAID : (paidAmountCents < totalAmountCents ? DebtStatus.PARTIAL : DebtStatus.PAID);

    try {
      const debt = await this.create({
        chargeId: dto.chargeId,
        patientId: dto.patientId,
        totalAmount: dto.totalAmount,
        paidAmount: centsToYuan(Math.max(0, paidAmountCents)),
        debtAmount: dto.debtAmount,
        status,
        remark: dto.remark || null,
      });

      this.logAudit(this.dbService, AuditLogType.DEBT_CREATE, debt.id, "DebtRecord", {
        afterData: { chargeId: dto.chargeId, patientId: dto.patientId, totalAmount: dto.totalAmount, debtAmount: dto.debtAmount, status },
      });

      return debt;
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes('UNIQUE constraint failed') && e.message.includes('chargeId')) {
        throw new BusinessValidationException('该收费单已存在欠费记录，不能重复创建');
      }
      throw e;
    }
  }

  async payDebt(id: string, dto: PayDebtDto, _operatorId?: string) {
    if (typeof dto.amount !== 'number' || !Number.isFinite(dto.amount) || dto.amount <= 0) {
      throw new BusinessValidationException('还款金额必须为有效正数');
    }

    const doPay = (db: IDatabase) => {
      const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();

      const debt = db.prepare(
        `SELECT id, chargeId, patientId, totalAmount, paidAmount, debtAmount, status, lastPaymentAt, remark, clinicId, createdAt, updatedAt, deletedAt FROM DebtRecord WHERE id = ? AND deletedAt IS NULL${clinicClause}`
      ).get(id, ...clinicParams) as Record<string, unknown> | undefined;

      if (!debt) throw new BusinessNotFoundException('欠费记录不存在');

      const debtAmountCents = Number(debt.debtAmount) || 0;
      const paidAmountCents = Number(debt.paidAmount) || 0;
      const _totalAmountCents = Number(debt.totalAmount) || 0;
      const debtAmount = centsToYuan(debtAmountCents);

      if (debtAmountCents <= 0) {
        throw new BusinessValidationException('该欠费已结清');
      }

      const amountCents = yuanToCents(dto.amount);
      if (centsGreaterThan(amountCents, debtAmountCents)) {
        throw new BusinessValidationException(`还款金额不能超过欠款金额 ${debtAmount.toFixed(2)}`);
      }

      const newPaidCents = paidAmountCents + amountCents;
      const newDebtCents = debtAmountCents - amountCents;

      const newStatus = centsLessThanOrEqual(newDebtCents, 0)
        ? DebtStatus.PAID
        : (centsLessThanOrEqual(newPaidCents, 0) ? DebtStatus.UNPAID : DebtStatus.PARTIAL);

      const now = new Date().toISOString();

      const updateResult = db.prepare(
        `UPDATE DebtRecord SET paidAmount = ?, debtAmount = ?, status = ?, lastPaymentAt = ?, updatedAt = ? WHERE id = ?${clinicClause} AND deletedAt IS NULL AND debtAmount >= ?`
      ).run(newPaidCents, newDebtCents, newStatus, now, now, id, ...clinicParams, amountCents);

      if (updateResult.changes === 0) {
        const currentDebt = db.prepare(
          `SELECT debtAmount, status FROM DebtRecord WHERE id = ?${clinicClause} AND deletedAt IS NULL`
        ).get(id, ...clinicParams) as Record<string, unknown> | undefined;
        if (!currentDebt) throw new BusinessNotFoundException('欠费记录不存在');
        if (Number(currentDebt.debtAmount) < amountCents) {
          throw new BusinessValidationException('欠款金额不足，可能存在并发修改，请刷新后重试');
        }
        throw new BusinessValidationException('还款失败：并发冲突，请刷新后重试');
      }

      const updatedPaidAmount = centsToYuan(newPaidCents);
      const updatedDebtAmount = centsToYuan(newDebtCents);

      this.logAudit(db, AuditLogType.DEBT_PAY, id, "DebtRecord", {
        afterData: { amount: dto.amount, status: newStatus, paidAmount: updatedPaidAmount, debtAmount: updatedDebtAmount },
      });
      return;
    };

    const idempotencyKey = dto.requestId ? `debt-pay:${id}:${dto.requestId}` : null;
    if (idempotencyKey) {
      await this.idempotency.executeInTransaction(
        { key: idempotencyKey, type: 'DEBT_PAY' },
        (db) => doPay(db),
      );
      return this.findOne(id);
    }

    this.dbService.transaction((db) => doPay(db));
    return this.findOne(id);
  }
}