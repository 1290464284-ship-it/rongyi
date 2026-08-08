import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { ConflictError, NotFoundError, ValidationError } from '../../../infrastructure/errors';
import { withIdempotency } from '../../../infrastructure/idempotency';
import { tenantAnd, tenantParams } from '../../../infrastructure/tenant';
import { recordSyncChange } from '../../../infrastructure/sync-change';
import { touchSearchIndex } from '../../../infrastructure/search-index';
import { SqliteChargeRepository } from '../../../infrastructure/repositories/charge.repository';
import {
  SqliteDebtRepository,
  SqliteMemberCardRepository,
} from '../../../infrastructure/repositories/core.repositories';
import type { AppContext } from '../../../../domain/contracts';
import type {
  ChargeRepository,
  DebtRepository,
  MemberCardRepository,
} from '../../ports';
import {
  assertDoctorExists,
  assertPatientExists,
  assertVisitExists,
  generateDocumentNumber,
} from '../common';

const PAY_METHODS = new Set([
  'CASH',
  'WECHAT',
  'ALIPAY',
  'CARD',
  'DEBT',
  'MEMBER_CARD',
  'UNIONPAY',
  'INSURANCE',
  'OTHER',
]);

/** 防御性兜底上限：1 亿元（分） */
const MAX_CHARGE_SUBTOTAL = 100_000_000_00;

function assertSafeSubtotal(price: number, quantity: number): number {
  const subtotal = Math.round(price * quantity);
  if (!Number.isSafeInteger(subtotal) || subtotal > MAX_CHARGE_SUBTOTAL) {
    throw new ValidationError('Charge item subtotal exceeds maximum allowed amount');
  }
  return subtotal;
}

export class ChargeService {
  private readonly db: Database.Database;
  private readonly chargeRepository: ChargeRepository;
  private readonly memberCardRepository: MemberCardRepository;
  private readonly debtRepository: DebtRepository;

  constructor(
    db: Database.Database,
    chargeRepository?: ChargeRepository,
    memberCardRepository?: MemberCardRepository,
    debtRepository?: DebtRepository,
  ) {
    this.db = db;
    this.chargeRepository = chargeRepository ?? new SqliteChargeRepository(db);
    this.memberCardRepository = memberCardRepository ?? new SqliteMemberCardRepository(db);
    this.debtRepository = debtRepository ?? new SqliteDebtRepository(db);
  }

  async create(input: {
    patientId: string;
    visitId?: string;
    doctorId?: string;
    items: Array<{ name: string; category: string; price: number; quantity: number; teethNumbers?: string[]; costType?: 'SERVICE' | 'MATERIAL' }>;
    discount?: number;
    remark?: string;
    discountPlanSnapshot?: Record<string, unknown> | null;
  }, context: AppContext): Promise<Record<string, unknown>> {
    if (!input.items?.length) throw new ValidationError('At least one charge item is required');
    if (!input.patientId || typeof input.patientId !== 'string') {
      throw new ValidationError('patientId is required');
    }
    assertPatientExists(this.db, input.patientId, context.clinicId);
    if (input.doctorId) assertDoctorExists(this.db, input.doctorId, context.clinicId);
    if (input.visitId) assertVisitExists(this.db, input.visitId, input.patientId, context.clinicId);
    for (const item of input.items) {
      if (typeof item.name !== 'string' || !item.name.trim() || typeof item.category !== 'string' || !item.category.trim()) {
        throw new ValidationError('Charge item name and category are required');
      }
      if (!Number.isSafeInteger(item.price) || item.price <= 0) {
        throw new ValidationError('Charge item price must be a positive integer in cents');
      }
      if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) {
        throw new ValidationError('Charge item quantity must be positive');
      }
      if (item.quantity > 1_000_000) {
        throw new ValidationError('Charge item quantity must not exceed 1000000');
      }
      if (item.costType !== undefined && item.costType !== 'SERVICE' && item.costType !== 'MATERIAL') {
        throw new ValidationError('Charge item costType must be SERVICE or MATERIAL');
      }
      assertSafeSubtotal(item.price, item.quantity);
    }
    const now = context.now().toISOString();
    const id = randomUUID();
    const number = generateDocumentNumber('CHG');
    const baseTotal = input.items.reduce((sum, item) => sum + assertSafeSubtotal(item.price, item.quantity), 0);
    const discount = Math.round(input.discount ?? 0);
    if (!Number.isInteger(input.discount ?? 0) || discount < 0 || discount > baseTotal) {
      throw new ValidationError('Discount must be a non-negative integer cents value not exceeding the charge total');
    }
    const totalAmount = baseTotal - discount;

    const chargeRun = this.db.transaction(() => {
      this.chargeRepository.create({
        id,
        clinicId: context.clinicId ?? null,
        createdAt: now,
        updatedAt: now,
        patientId: input.patientId,
        visitId: input.visitId ?? null,
        doctorId: input.doctorId ?? null,
        number,
        totalAmount,
        discount,
        status: 'UNPAID',
        remark: input.remark ?? null,
      });
      const insertItem = this.db.prepare(
        `INSERT INTO ChargeItem (
           id, chargeId, name, category, price, quantity, teethNumbers, subtotal, costType,
           clinicId, createdAt, updatedAt, deletedAt
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      );
      for (const item of input.items) {
        const subtotal = assertSafeSubtotal(item.price, item.quantity);
        insertItem.run(
          randomUUID(),
          id,
          item.name,
          item.category,
          item.price,
          item.quantity,
          JSON.stringify(item.teethNumbers ?? []),
          subtotal,
          item.costType ?? 'SERVICE',
          context.clinicId ?? null,
          now,
          now,
        );
      }
      if (input.discountPlanSnapshot) {
        this.db.prepare(
          `UPDATE Charge SET discountPlanSnapshotJson = ? WHERE id = ?`,
        ).run(JSON.stringify(input.discountPlanSnapshot), id);
        // P2-3：直接改库的路径也必须进同步队列
        if (context.clinicId) {
          recordSyncChange(this.db, { tableName: 'Charge', recordId: id, operation: 'UPDATE', clinicId: context.clinicId });
        }
      }
    });
    chargeRun();
    return { id, number, totalAmount, status: 'UNPAID' };
  }

  /**
   * 删除（作废）收费单：仅允许 UNPAID 状态且无任何收款/退款记录的收费单，
   * 软删除主记录与明细，保证财务数据可追溯。
   */
  async cancel(id: string, context: AppContext): Promise<{ id: string; status: string }> {
    const row = this.chargeRepository.findById(id, context.clinicId);
    if (!row) throw new NotFoundError('Charge not found');
    if (String(row.status) !== 'UNPAID' || Number(row.paidAmount ?? 0) > 0 || Number(row.refundedAmount ?? 0) > 0) {
      throw new ConflictError('Only unpaid charges can be deleted');
    }
    const now = context.now().toISOString();
    this.db.transaction(() => {
      this.db.prepare(
        `UPDATE Charge SET deletedAt = ?, updatedAt = ? WHERE id = ? AND deletedAt IS NULL`,
      ).run(now, now, id);
      touchSearchIndex(this.db, 'Charge', id, 'DELETE');
      this.db.prepare(
        `UPDATE ChargeItem SET deletedAt = ?, updatedAt = ? WHERE chargeId = ? AND deletedAt IS NULL`,
      ).run(now, now, id);
      // P2-3：取消收费单要通知同步端（删除记录）
      if (context.clinicId) {
        recordSyncChange(this.db, { tableName: 'Charge', recordId: id, operation: 'DELETE', clinicId: context.clinicId });
      }
    })();
    return { id, status: 'CANCELLED' };
  }

  async pay(id: string, amount: number, method: string, requestId?: string, context?: AppContext, payMethodName?: string): Promise<Record<string, unknown>> {
    return withIdempotency(this.db, {
      operation: 'charge.pay',
      resourceId: id,
      userId: context?.userId ?? null,
      clinicId: context?.clinicId ?? null,
      requestId: requestId ?? '',
    }, () => {
      const row = this.chargeRepository.findById(id, context?.clinicId ?? null);
      if (!row) throw new NotFoundError('Charge not found');
      const total = Number(row.totalAmount);
      const paid = Number(row.paidAmount);
      const status = String(row.status);
      if (status === 'CANCELLED' || status === 'REFUNDED') throw new ConflictError('Charge cannot be paid');
      const remaining = total - paid;
      if (!Number.isSafeInteger(amount) || amount <= 0 || amount > remaining) {
        throw new ValidationError('Payment amount must be a positive integer and not exceed the remaining balance');
      }
      if (!PAY_METHODS.has(method)) {
        throw new ValidationError('Invalid payment method');
      }
      const newPaid = paid + amount;
      const newStatus = newPaid >= total ? 'PAID' : 'PARTIAL';
      const now = context?.now().toISOString() ?? new Date().toISOString();
      const payRun = this.db.transaction(() => {
        let memberCardId: string | null = null;
        if (method === 'MEMBER_CARD') {
          const memberCard = this.memberCardRepository.findByPatient(String(row.patientId), context?.clinicId ?? null);
          if (!memberCard) throw new ConflictError('No active member card for patient');
          const balance = Number(memberCard.balance) - amount;
          if (balance < 0) throw new ConflictError('Insufficient member card balance');
          memberCardId = memberCard.id;
          this.memberCardRepository.updateConsume(memberCard.id, balance, amount, now, context?.clinicId ?? null);
          this.memberCardRepository.insertLog({
            id: randomUUID(),
            clinicId: row.clinicId ?? null,
            createdAt: now,
            updatedAt: now,
            cardId: memberCard.id,
            type: 'CONSUME',
            amount: -amount,
            balanceAfter: balance,
            remark: `Charge ${id}`,
          });
        }
        this.chargeRepository.updatePayment(id, newPaid, newStatus, now, method, memberCardId, context?.clinicId ?? null);
        this.db.prepare(
          `INSERT INTO PaymentLedger (
             id, clinicId, createdAt, updatedAt, deletedAt,
             chargeId, patientId, type, method, amount, cardId, operatorId,
             reversedAmount, relatedId, allocations
           ) VALUES (?, ?, ?, ?, NULL, ?, ?, 'PAY', ?, ?, ?, ?, 0, NULL, NULL)`,
        ).run(
          randomUUID(),
          row.clinicId ?? null,
          now,
          now,
          id,
          String(row.patientId),
          method,
          amount,
          memberCardId,
          context?.userId ?? null,
        );
        if (typeof payMethodName === 'string' && payMethodName.trim() !== '') {
          this.db.prepare(
            `UPDATE Charge SET payMethodName = ?, updatedAt = ? WHERE id = ? AND deletedAt IS NULL${tenantAnd(context?.clinicId ?? null)}`,
          ).run(payMethodName.trim(), now, id, ...tenantParams(context?.clinicId ?? null));
          // P2-3：直接改库的路径也必须进同步队列
          if (context?.clinicId) {
            recordSyncChange(this.db, { tableName: 'Charge', recordId: id, operation: 'UPDATE', clinicId: context.clinicId });
          }
        }
        const debt = this.debtRepository.findByCharge(id, context?.clinicId ?? null);
        if (debt) {
          const debtStatus = newPaid >= Number(debt.totalAmount) ? 'PAID' : newPaid > 0 ? 'PARTIAL' : 'UNPAID';
          this.debtRepository.updatePaid(debt.id, newPaid, debtStatus, now, context?.clinicId ?? null);
        } else if (method === 'DEBT' && newStatus === 'PARTIAL') {
          this.db.prepare(
            `INSERT INTO Debt (
               id, clinicId, createdAt, updatedAt, deletedAt,
               chargeId, patientId, totalAmount, paidAmount, status
             ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
          ).run(
            randomUUID(),
            row.clinicId ?? null,
            now,
            now,
            id,
            String(row.patientId),
            total,
            newPaid,
            newStatus,
          );
        }
      });
      payRun();
      return { id, paidAmount: newPaid, status: newStatus };
    });
  }

  async refund(
    id: string,
    amount: number,
    reason: string,
    context: AppContext,
    requestId?: string,
  ): Promise<Record<string, unknown>> {
    return withIdempotency(this.db, {
      operation: 'charge.refund',
      resourceId: id,
      userId: context.userId,
      clinicId: context.clinicId,
      requestId: requestId ?? '',
    }, () => {
      const row = this.chargeRepository.findById(id, context.clinicId);
      if (!row) throw new NotFoundError('Charge not found');
      const paid = Number(row.paidAmount);
      const refunded = Number(row.refundedAmount);
      const available = paid - refunded;
      if (!Number.isSafeInteger(amount) || amount <= 0 || amount > available) {
        throw new ValidationError('Refund amount must be a positive integer and not exceed the refundable amount');
      }
      const newRefunded = refunded + amount;
      const newStatus = newRefunded >= paid ? 'REFUNDED' : String(row.status);
      const now = context.now().toISOString();
      const refundId = randomUUID();
      const run = this.db.transaction(() => {
        this.chargeRepository.updateRefund(id, newRefunded, newStatus, now, context.clinicId);
        // 按 PaymentLedger LIFO 逐笔冲销会员卡支付（修复混合支付/多笔部分支付
        // 退款时整单按单一 payMethod 回充、导致卡余额回充金额错误的缺陷）。
        // 旧数据（迁移 146 前）已回填为单条合并流水，冲销上限 = paidAmount，有界安全。
        const payRows = this.db.prepare(
          `SELECT id, method, amount, cardId, reversedAmount
           FROM PaymentLedger
           WHERE chargeId = ? AND type = 'PAY' AND deletedAt IS NULL
           ORDER BY createdAt DESC, rowid DESC`,
        ).all(id) as Array<{ id: string; method: string; amount: number; cardId: string | null; reversedAmount: number }>;
        const allocations: Array<{ ledgerId: string; cardId: string; amount: number }> = [];
        let remaining = amount;
        for (const payRow of payRows) {
          if (remaining <= 0) break;
          if (payRow.method !== 'MEMBER_CARD') continue;
          const available = Number(payRow.amount) - Number(payRow.reversedAmount);
          if (available <= 0) continue;
          const take = Math.min(available, remaining);
          const memberCard = payRow.cardId
            ? this.memberCardRepository.findById(payRow.cardId, context.clinicId)
            : this.memberCardRepository.findByPatientForRefund(String(row.patientId), context.clinicId);
          if (!memberCard) throw new ConflictError('Member card used for payment is not found');
          const balance = Number(memberCard.balance) + take;
          this.memberCardRepository.updateBalanceRefund(memberCard.id, balance, now, context.clinicId);
          this.memberCardRepository.insertLog({
            id: randomUUID(),
            clinicId: row.clinicId ?? null,
            createdAt: now,
            updatedAt: now,
            cardId: memberCard.id,
            type: 'REFUND',
            amount: take,
            balanceAfter: balance,
            remark: reason,
          });
          this.db.prepare(
            `UPDATE PaymentLedger SET reversedAmount = reversedAmount + ?, updatedAt = ? WHERE id = ?`,
          ).run(take, now, payRow.id);
          allocations.push({ ledgerId: payRow.id, cardId: memberCard.id, amount: take });
          remaining -= take;
        }
        this.db.prepare(
          `INSERT INTO PaymentLedger (
             id, clinicId, createdAt, updatedAt, deletedAt,
             chargeId, patientId, type, method, amount, cardId, operatorId,
             reversedAmount, relatedId, allocations
           ) VALUES (?, ?, ?, ?, NULL, ?, ?, 'REFUND', ?, ?, NULL, ?, 0, ?, ?)`,
        ).run(
          randomUUID(),
          row.clinicId ?? null,
          now,
          now,
          id,
          String(row.patientId),
          'REFUND',
          amount,
          context.userId,
          refundId,
          allocations.length > 0 ? JSON.stringify(allocations) : null,
        );
        const debt = this.debtRepository.findByCharge(id, context.clinicId);
        if (debt && Number(debt.paidAmount) > 0) {
          const newDebtPaid = Math.max(0, Number(debt.paidAmount) - amount);
          const debtStatus = newDebtPaid >= Number(debt.totalAmount)
            ? 'PAID'
            : newDebtPaid > 0 ? 'PARTIAL' : 'UNPAID';
          this.debtRepository.updatePaid(debt.id, newDebtPaid, debtStatus, now, context.clinicId);
        }
        this.db.prepare(
          `INSERT INTO Refund (
             id, clinicId, createdAt, updatedAt, deletedAt,
             chargeId, patientId, amount, reason, operatorId
           ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
        ).run(refundId, row.clinicId ?? null, now, now, id, String(row.patientId), amount, reason, context.userId);
      });
      run();
      return { id: refundId, chargeId: id, amount, status: newStatus };
    });
  }
}
