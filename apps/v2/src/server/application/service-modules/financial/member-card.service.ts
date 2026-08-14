import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { ConflictError, NotFoundError, ValidationError } from '../../../infrastructure/errors';
import { stableRequestBodyHash, withIdempotency } from '../../../infrastructure/idempotency';
import { tenantAnd, tenantParams } from '../../../infrastructure/tenant';
import { SqliteMemberCardRepository } from '../../../infrastructure/repositories/core.repositories';
import type { AppContext } from '../../../../domain/contracts';
import type { MemberCardRecord, MemberCardRepository } from '../../ports';
import { MAX_MONEY_CENTS, assertPatientExists } from '../common';

const MAX_POINTS = 1_000_000_000_000;

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
      `SELECT id FROM MemberCard WHERE cardNo = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).get(cardNo, ...tenantParams(context.clinicId)) as { id: string } | undefined;
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
      resourceId: cardId,
      userId: context.userId,
      clinicId: context.clinicId,
      requestId: requestId ?? '',
      requestBodyHash: stableRequestBodyHash({ amount }),
    }, () => {
      const card = this.card(cardId, context);
      this.assertActive(card);
      if (!Number.isSafeInteger(amount) || amount <= 0) throw new ValidationError('Recharge amount must be a positive integer in cents');
      if (amount > MAX_MONEY_CENTS || Number(card.balance) + amount > MAX_MONEY_CENTS) {
        throw new ValidationError('Recharge amount exceeds the member card balance limit');
      }
      const now = context.now().toISOString();
      this.memberCardRepository.updateRecharge(cardId, amount, now, context.clinicId);
      const balance = Number(this.card(cardId, context).balance);
      this.log(cardId, 'RECHARGE', amount, balance, now, context.clinicId, null);
      return { cardId, balance, amount };
    });
  }

  async consume(cardId: string, amount: number, context: AppContext, requestId?: string): Promise<Record<string, unknown>> {
    return withIdempotency(this.db, {
      operation: 'member-card.consume',
      resourceId: cardId,
      userId: context.userId,
      clinicId: context.clinicId,
      requestId: requestId ?? '',
      requestBodyHash: stableRequestBodyHash({ amount }),
    }, () => {
      const card = this.card(cardId, context);
      this.assertActive(card);
      if (!Number.isSafeInteger(amount) || amount <= 0) throw new ValidationError('Consume amount must be a positive integer in cents');
      if (amount > MAX_MONEY_CENTS) throw new ValidationError('Consume amount exceeds the member card limit');
      const now = context.now().toISOString();
      this.memberCardRepository.updateConsume(cardId, amount, now, context.clinicId);
      const balance = Number(this.card(cardId, context).balance);
      this.log(cardId, 'CONSUME', -amount, balance, now, context.clinicId, null);
      return { cardId, balance, amount };
    });
  }

  async addPoints(cardId: string, points: number, context: AppContext, requestId?: string): Promise<Record<string, unknown>> {
    return withIdempotency(this.db, {
      operation: 'member-card.points',
      resourceId: cardId,
      userId: context.userId,
      clinicId: context.clinicId,
      requestId: requestId ?? '',
      requestBodyHash: stableRequestBodyHash({ points }),
    }, () => {
      const card = this.card(cardId, context);
      this.assertActive(card);
      if (!Number.isSafeInteger(points) || points === 0) {
        throw new ValidationError('Points must be a non-zero integer');
      }
      if (Math.abs(points) > MAX_POINTS) throw new ValidationError('Points adjustment exceeds the member card points limit');
      if (Number(card.points) + points > MAX_POINTS || Number(card.totalPoints) + Math.max(0, points) > MAX_POINTS) {
        throw new ValidationError('Points adjustment exceeds the member card points limit');
      }
      if (Number(card.points) + points < 0) throw new ConflictError('Insufficient points');
      const now = context.now().toISOString();
      this.memberCardRepository.updatePoints(cardId, points, Math.max(0, points), now, context.clinicId);
      const after = Number(this.card(cardId, context).points);
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
