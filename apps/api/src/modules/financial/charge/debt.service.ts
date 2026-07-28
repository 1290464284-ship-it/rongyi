import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';
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
    super(dbService, clinicContext, 'DebtRecord', [], [], [], true, ['chargeId'], undefined, undefined, [
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

  /**
   * P1 修复：createDebtFromCharge 增加幂等性支持
   * 原先无幂等保护，客户端因网络超时重试时会创建重复欠费记录（虽然 chargeId UNIQUE 约束会阻止，
   * 但错误信息不友好且无法返回首次创建结果）。
   * 现在通过 dto.requestId 启用幂等：相同 requestId 重试时返回首次创建结果。
   * 同时将整个创建逻辑（校验+INSERT+审计）放入事务，保证原子性。
   */
  createDebtFromCharge(dto: CreateDebtFromChargeDto) {
    const clinicId = this.clinicContext.getClinicId();

    const doCreate = (db: IDatabase): DebtRecord => {
      const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
      const now = new Date().toISOString();

      // 1. 校验收费单存在
      const charge = db.prepare(`SELECT id FROM Charge WHERE id = ? AND deletedAt IS NULL${clinicClause}`).get(dto.chargeId, ...clinicParams) as { id: string } | undefined;
      if (!charge) {
        throw new BusinessNotFoundException("收费记录不存在");
      }

      // 2. 预检查：同一收费单不可重复创建欠费记录
      const existing = db.prepare(
        `SELECT id FROM DebtRecord WHERE chargeId = ? AND deletedAt IS NULL${clinicClause}`
      ).get(dto.chargeId, ...clinicParams) as { id: string } | undefined;
      if (existing) {
        throw new BusinessValidationException('该收费单已存在欠费记录，不能重复创建');
      }

      // 3. 计算金额（分）与状态
      const totalAmountCents = yuanToCents(dto.totalAmount);
      const debtAmountCents = yuanToCents(dto.debtAmount);
      const paidAmountCents = Math.max(0, totalAmountCents - debtAmountCents);
      const status = debtAmountCents <= 0 ? DebtStatus.PAID : paidAmountCents <= 0 ? DebtStatus.UNPAID : DebtStatus.PARTIAL;

      // 4. 直接 INSERT（cents 存储）
      const debtId = crypto.randomUUID();
      db.prepare(
        `INSERT INTO DebtRecord (id, chargeId, patientId, totalAmount, paidAmount, debtAmount, status, lastPaymentAt, remark, clinicId, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`
      ).run(
        debtId,
        dto.chargeId,
        dto.patientId,
        totalAmountCents,
        paidAmountCents,
        debtAmountCents,
        status,
        dto.remark || null,
        clinicId,
        now,
        now,
      );

      // 5. 审计日志
      this.logAudit(db, AuditLogType.DEBT_CREATE, debtId, "DebtRecord", {
        afterData: { chargeId: dto.chargeId, patientId: dto.patientId, totalAmount: dto.totalAmount, debtAmount: dto.debtAmount, status },
      });

      // 6. 读取并转换为元返回
      const row = db.prepare(
        `SELECT id, chargeId, patientId, totalAmount, paidAmount, debtAmount, status, lastPaymentAt, remark, createdAt, updatedAt FROM DebtRecord WHERE id = ?`
      ).get(debtId) as DebtRecord;
      row.totalAmount = centsToYuan(Number(row.totalAmount) || 0);
      row.paidAmount = centsToYuan(Number(row.paidAmount) || 0);
      row.debtAmount = centsToYuan(Number(row.debtAmount) || 0);
      return row;
    };

    // 选择执行策略：有 requestId 走幂等，否则走原事务
    const idempotencyKey = dto.requestId ? `debt-create:${clinicId}:${dto.chargeId}:${dto.requestId}` : null;
    return idempotencyKey
      ? this.idempotency.executeInTransaction(
          { key: idempotencyKey, type: 'DEBT_CREATE' },
          (db) => doCreate(db),
        )
      : this.dbService.transaction((db) => doCreate(db));
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
      const debtAmount = centsToYuan(debtAmountCents);

      if (debtAmountCents <= 0) {
        throw new BusinessValidationException('该欠费已结清');
      }

      if (debt.status === DebtStatus.CANCELLED) {
        throw new BusinessValidationException('该欠费记录已取消，不能还款');
      }

      const amountCents = yuanToCents(dto.amount);
      if (centsGreaterThan(amountCents, debtAmountCents)) {
        throw new BusinessValidationException(`还款金额不能超过欠款金额 ${debtAmount.toFixed(2)}`);
      }

      const newPaidCents = paidAmountCents + amountCents;
      const newDebtCents = debtAmountCents - amountCents;

      // amountCents > 0 且 paidAmountCents >= 0，还款后不可能回到 UNPAID
      const newStatus = centsLessThanOrEqual(newDebtCents, 0)
        ? DebtStatus.PAID
        : DebtStatus.PARTIAL;

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