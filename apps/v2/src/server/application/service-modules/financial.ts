import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { ConflictError, NotFoundError, ValidationError } from '../../infrastructure/errors';
import { withIdempotency } from '../../infrastructure/idempotency';
import { SqliteChargeRepository } from '../../infrastructure/repositories/charge.repository';
import {
  SqliteDebtRepository,
  SqliteInventoryRepository,
  SqliteMemberCardRepository,
  SqliteProcessingOrderRepository,
  SqlitePurchaseOrderRepository,
} from '../../infrastructure/repositories/core.repositories';
import type { AppContext } from '../../../domain/contracts';
import type {
  ChargeItemRecord,
  ChargeRepository,
  DebtRepository,
  InventoryRepository,
  MemberCardRecord,
  MemberCardRepository,
  ProcessingOrderRepository,
  PurchaseOrderRepository,
} from '../ports';
import { assertPatientExists } from './common';

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
    items: Array<{ name: string; category: string; price: number; quantity: number; teethNumbers?: string[] }>;
    discount?: number;
    remark?: string;
  }, context: AppContext): Promise<Record<string, unknown>> {
    if (!input.items?.length) throw new ValidationError('At least one charge item is required');
    if (!input.patientId || typeof input.patientId !== 'string') {
      throw new ValidationError('patientId is required');
    }
    assertPatientExists(this.db, input.patientId, context.clinicId);
    for (const item of input.items) {
      if (typeof item.name !== 'string' || !item.name.trim() || typeof item.category !== 'string' || !item.category.trim()) {
        throw new ValidationError('Charge item name and category are required');
      }
      if (!Number.isSafeInteger(item.price) || item.price <= 0) {
        throw new ValidationError('Charge item price must be a positive integer in cents');
      }
      if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
        throw new ValidationError('Charge item quantity must be positive');
      }
    }
    const now = context.now().toISOString();
    const id = randomUUID();
    const number = `CHG-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 8).toUpperCase()}`;
    const baseTotal = input.items.reduce((sum, item) => sum + Math.round(item.price * item.quantity), 0);
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
      for (const item of input.items) {
        const subtotal = Math.round(item.price * item.quantity);
        const record: ChargeItemRecord = {
          id: randomUUID(),
          chargeId: id,
          name: item.name,
          category: item.category,
          price: item.price,
          quantity: item.quantity,
          teethNumbers: item.teethNumbers ?? [],
          subtotal,
          clinicId: context.clinicId ?? null,
          createdAt: now,
          updatedAt: now,
        };
        this.chargeRepository.createItem(record);
      }
    });
    chargeRun();
    return { id, number, totalAmount, status: 'UNPAID' };
  }

  async pay(id: string, amount: number, method: string, requestId?: string, context?: AppContext): Promise<Record<string, unknown>> {
    return withIdempotency(this.db, {
      operation: 'charge.pay',
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
        if (row.payMethod === 'MEMBER_CARD') {
          const memberCard = row.memberCardId
            ? this.memberCardRepository.findById(String(row.memberCardId), context.clinicId)
            : this.memberCardRepository.findByPatientForRefund(String(row.patientId), context.clinicId);
          if (!memberCard) throw new ConflictError('Member card used for payment is not found');
          const balance = Number(memberCard.balance) + amount;
          this.memberCardRepository.updateBalanceRefund(memberCard.id, balance, now, context.clinicId);
          this.memberCardRepository.insertLog({
            id: randomUUID(),
            clinicId: row.clinicId ?? null,
            createdAt: now,
            updatedAt: now,
            cardId: memberCard.id,
            type: 'REFUND',
            amount,
            balanceAfter: balance,
            remark: reason,
          });
        }
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

export class MemberCardService {
  private readonly db: Database.Database;
  private readonly memberCardRepository: MemberCardRepository;

  constructor(db: Database.Database, memberCardRepository?: MemberCardRepository) {
    this.db = db;
    this.memberCardRepository = memberCardRepository ?? new SqliteMemberCardRepository(db);
  }

  create(
    input: { patientId: string; cardNo: string; status: string; level: string },
    context: AppContext,
  ): Record<string, unknown> {
    const cardNo = String(input.cardNo ?? '').trim();
    const patientId = String(input.patientId ?? '');
    if (!cardNo || !patientId) throw new ValidationError('patientId and cardNo are required');
    assertPatientExists(this.db, patientId, context.clinicId);
    if (!['ACTIVE', 'INACTIVE', 'DISABLED', 'FROZEN', 'EXPIRED'].includes(input.status)) {
      throw new ValidationError('Invalid member card status');
    }
    if (!['NORMAL', 'VIP', 'SVIP'].includes(input.level)) {
      throw new ValidationError('Invalid member card level');
    }
    const existing = this.db.prepare(
      'SELECT id FROM MemberCard WHERE cardNo = ? AND deletedAt IS NULL',
    ).get(cardNo) as { id: string } | undefined;
    if (existing) throw new ConflictError('Member card number already exists');
    const now = context.now().toISOString();
    const id = randomUUID();
    try {
      this.memberCardRepository.create({
        id,
        clinicId: context.clinicId,
        patientId,
        cardNo,
        balance: 0,
        totalRecharge: 0,
        totalConsume: 0,
        status: input.status,
        points: 0,
        totalPoints: 0,
        level: input.level,
        createdAt: now,
        updatedAt: now,
      });
    } catch (error) {
      if (error instanceof Error && /UNIQUE constraint failed/.test(error.message)) {
        throw new ConflictError('Member card number already exists');
      }
      throw error;
    }
    return { id, cardNo, balance: 0, status: input.status, level: input.level };
  }

  async recharge(cardId: string, amount: number, context: AppContext, requestId?: string): Promise<Record<string, unknown>> {
    return withIdempotency(this.db, {
      operation: 'member-card.recharge',
      userId: context.userId,
      clinicId: context.clinicId,
      requestId: requestId ?? '',
    }, () => {
      const card = this.card(cardId, context);
      this.assertActive(card);
      if (!Number.isSafeInteger(amount) || amount <= 0) throw new ValidationError('Recharge amount must be a positive integer in cents');
      const now = context.now().toISOString();
      const balance = Number(card.balance) + amount;
      this.memberCardRepository.updateRecharge(cardId, balance, amount, now, context.clinicId);
      this.log(cardId, 'RECHARGE', amount, balance, now, context.clinicId, null);
      return { cardId, balance, amount };
    });
  }

  async consume(cardId: string, amount: number, context: AppContext, requestId?: string): Promise<Record<string, unknown>> {
    return withIdempotency(this.db, {
      operation: 'member-card.consume',
      userId: context.userId,
      clinicId: context.clinicId,
      requestId: requestId ?? '',
    }, () => {
      const card = this.card(cardId, context);
      this.assertActive(card);
      if (!Number.isSafeInteger(amount) || amount <= 0) throw new ValidationError('Consume amount must be a positive integer in cents');
      const balance = Number(card.balance) - amount;
      if (balance < 0) throw new ConflictError('Insufficient member card balance');
      const now = context.now().toISOString();
      this.memberCardRepository.updateConsume(cardId, balance, amount, now, context.clinicId);
      this.log(cardId, 'CONSUME', -amount, balance, now, context.clinicId, null);
      return { cardId, balance, amount };
    });
  }

  async addPoints(cardId: string, points: number, context: AppContext, requestId?: string): Promise<Record<string, unknown>> {
    return withIdempotency(this.db, {
      operation: 'member-card.points',
      userId: context.userId,
      clinicId: context.clinicId,
      requestId: requestId ?? '',
    }, () => {
      const card = this.card(cardId, context);
      this.assertActive(card);
      if (!Number.isSafeInteger(points) || points === 0) {
        throw new ValidationError('Points must be a non-zero integer');
      }
      const after = Number(card.points) + points;
      if (after < 0) throw new ConflictError('Insufficient points');
      const now = context.now().toISOString();
      this.memberCardRepository.updatePoints(cardId, after, Number(card.totalPoints) + Math.max(0, points), now, context.clinicId);
      this.memberCardRepository.insertPointLog({
        id: randomUUID(),
        clinicId: context.clinicId ?? null,
        createdAt: now,
        updatedAt: now,
        cardId,
        type: points >= 0 ? 'ADD' : 'DEDUCT',
        points,
        pointsAfter: after,
      });
      return { cardId, points: after };
    });
  }

  private card(cardId: string, context: AppContext): MemberCardRecord {
    const row = this.memberCardRepository.findById(cardId, context.clinicId);
    if (!row) throw new NotFoundError('Member card not found');
    return row;
  }

  private assertActive(card: MemberCardRecord): void {
    if (String(card.status) !== 'ACTIVE') throw new ConflictError('Member card is not active');
  }

  private log(cardId: string, type: string, amount: number, balanceAfter: number, now: string, clinicId: string | null, remark: string | null): void {
    this.memberCardRepository.insertLog({
      id: randomUUID(),
      clinicId,
      createdAt: now,
      updatedAt: now,
      cardId,
      type,
      amount,
      balanceAfter,
      remark,
    });
  }
}

export class PurchaseOrderService {
  private readonly db: Database.Database;
  private readonly purchaseOrderRepository: PurchaseOrderRepository;
  private readonly inventoryRepository: InventoryRepository;

  constructor(
    db: Database.Database,
    purchaseOrderRepository?: PurchaseOrderRepository,
    inventoryRepository?: InventoryRepository,
  ) {
    this.db = db;
    this.purchaseOrderRepository = purchaseOrderRepository ?? new SqlitePurchaseOrderRepository(db);
    this.inventoryRepository = inventoryRepository ?? new SqliteInventoryRepository(db);
  }

  async receive(orderId: string, context: AppContext): Promise<Record<string, unknown>> {
    const order = this.purchaseOrderRepository.findById(orderId, context.clinicId);
    if (!order) throw new NotFoundError('Purchase order not found');
    if (order.status !== 'PENDING') throw new ConflictError('Purchase order is not pending');
    const now = context.now().toISOString();
    const items = this.purchaseOrderRepository.itemsByOrder(orderId, context.clinicId);
    const run = this.db.transaction(() => {
      this.purchaseOrderRepository.markReceived(orderId, now, now, context.clinicId);
      const missing: string[] = [];
      for (const item of items) {
        if (!item.itemId) continue;
        const current = this.inventoryRepository.findItem(item.itemId, context.clinicId);
        if (!current) {
          missing.push(item.name);
          continue;
        }
        const before = Number(current.stock);
        const after = before + Number(item.quantity);
        this.inventoryRepository.updateStock(item.itemId, after, now, context.clinicId);
        this.inventoryRepository.createTransaction({
          id: randomUUID(),
          clinicId: context.clinicId ?? null,
          itemId: item.itemId,
          type: 'IN',
          quantity: Number(item.quantity),
          beforeStock: before,
          afterStock: after,
          operatorId: context.userId,
          createdAt: now,
          updatedAt: now,
        });
      }
      if (missing.length > 0) {
        throw new ConflictError(`Purchase order contains missing inventory items: ${missing.join(', ')}`);
      }
    });
    run();
    return { id: orderId, status: 'RECEIVED' };
  }

  items(orderId: string, context: AppContext): Array<Record<string, unknown>> {
    const order = this.purchaseOrderRepository.findById(orderId, context.clinicId);
    if (!order) throw new NotFoundError('Purchase order not found');
    return this.purchaseOrderRepository.itemsByOrder(orderId, context.clinicId).map((item) => ({ ...item }));
  }
}

const PROCESSING_TRANSITIONS: Record<string, readonly string[]> = {
  DRAFT: ['SENT', 'CANCELLED'],
  SENT: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: ['RECEIVED'],
  RECEIVED: [],
  CANCELLED: [],
};

export class ProcessingOrderService {
  private readonly db: Database.Database;
  private readonly processingOrderRepository: ProcessingOrderRepository;

  constructor(db: Database.Database, processingOrderRepository?: ProcessingOrderRepository) {
    this.db = db;
    this.processingOrderRepository = processingOrderRepository ?? new SqliteProcessingOrderRepository(db);
  }

  transition(id: string, status: string, context: AppContext): Record<string, unknown> {
    const row = this.processingOrderRepository.findById(id, context.clinicId);
    if (!row) throw new NotFoundError('Processing order not found');
    if (!PROCESSING_TRANSITIONS[row.status]?.includes(status)) {
      throw new ConflictError(`Cannot transition processing order from ${row.status} to ${status}`);
    }
    this.processingOrderRepository.updateStatus(id, status, context.now().toISOString(), context.clinicId);
    return { id, status };
  }
}

export class DebtService {
  private readonly db: Database.Database;
  private readonly debtRepository: DebtRepository;

  constructor(db: Database.Database, debtRepository?: DebtRepository) {
    this.db = db;
    this.debtRepository = debtRepository ?? new SqliteDebtRepository(db);
  }

  async pay(debtId: string, amount: number, context: AppContext, requestId?: string): Promise<Record<string, unknown>> {
    return await withIdempotency(this.db, {
      operation: 'debt.pay',
      userId: context.userId,
      clinicId: context.clinicId,
      requestId: requestId ?? '',
    }, () => {
      const debt = this.debtRepository.findById(debtId, context.clinicId);
      if (!debt) throw new NotFoundError('Debt record not found');
      const remaining = Number(debt.totalAmount) - Number(debt.paidAmount);
      if (!Number.isSafeInteger(amount) || amount <= 0 || amount > remaining) throw new ValidationError('Invalid debt payment amount');
      const paid = Number(debt.paidAmount) + amount;
      const status = paid >= Number(debt.totalAmount) ? 'PAID' : 'PARTIAL';
      this.debtRepository.updatePaid(debtId, paid, status, context.now().toISOString(), context.clinicId);
      return { id: debtId, paidAmount: paid, status };
    });
  }
}
