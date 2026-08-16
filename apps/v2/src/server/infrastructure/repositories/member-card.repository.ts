// 会员卡仓储（M-04：由 core.repositories.ts 拆分）
import type Database from 'better-sqlite3';
import { ConflictError } from '../errors';
import { tenantAnd } from '../tenant';
import type { MemberCardRecord, MemberCardRepository } from '../../application/ports';

export class SqliteMemberCardRepository implements MemberCardRepository {
  constructor(private readonly db: Database.Database) {}

  create(input: MemberCardRecord): void {
    this.db.prepare(
      `INSERT INTO MemberCard (
         id, clinicId, patientId, cardNo, balance, totalRecharge, totalConsume,
         status, points, totalPoints, level, createdAt, updatedAt, deletedAt
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    ).run(
      input.id,
      input.clinicId ?? null,
      input.patientId,
      input.cardNo,
      input.balance,
      input.totalRecharge,
      input.totalConsume,
      input.status,
      input.points,
      input.totalPoints,
      input.level,
      input.createdAt,
      input.updatedAt,
    );
  }

  findById(id: string, clinicId?: string | null): MemberCardRecord | null {
    const params = clinicId ? [id, clinicId] : [id];
    return (this.db.prepare(`SELECT * FROM MemberCard WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`).get(...params) as MemberCardRecord | undefined) ?? null;
  }

  findByPatient(patientId: string, clinicId?: string | null): MemberCardRecord | null {
    const params = clinicId ? [patientId, 'ACTIVE', clinicId] : [patientId, 'ACTIVE'];
    // 多卡时按建档顺序取最早一张（同时间戳按 rowid 即插入顺序兜底），避免依赖无 ORDER BY 的隐式选择。
    return (this.db.prepare(`SELECT * FROM MemberCard WHERE patientId = ? AND status = ? AND deletedAt IS NULL${tenantAnd(clinicId)} ORDER BY createdAt ASC, rowid ASC LIMIT 1`).get(...params) as MemberCardRecord | undefined) ?? null;
  }

  findByPatientForRefund(patientId: string, clinicId?: string | null): MemberCardRecord | null {
    const params = clinicId ? [patientId, clinicId] : [patientId];
    return (this.db.prepare(`SELECT * FROM MemberCard WHERE patientId = ? AND deletedAt IS NULL${tenantAnd(clinicId)} ORDER BY createdAt ASC, rowid ASC LIMIT 1`).get(...params) as MemberCardRecord | undefined) ?? null;
  }

  updateBalanceRefund(id: string, amount: number, updatedAt: string, clinicId?: string | null): void {
    const params = clinicId ? [amount, updatedAt, id, clinicId] : [amount, updatedAt, id];
    this.db.prepare(`UPDATE MemberCard SET balance = balance + ?, updatedAt = ? WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`).run(...params);
  }

  updateRecharge(id: string, amount: number, updatedAt: string, clinicId?: string | null): void {
    const params = clinicId ? [amount, amount, updatedAt, id, clinicId] : [amount, amount, updatedAt, id];
    this.db.prepare(`UPDATE MemberCard SET balance = balance + ?, totalRecharge = totalRecharge + ?, updatedAt = ? WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`)
      .run(...params);
  }

  updateConsume(id: string, amount: number, updatedAt: string, clinicId?: string | null): void {
    const params = clinicId ? [amount, amount, updatedAt, id, amount, clinicId] : [amount, amount, updatedAt, id, amount];
    const result = this.db.prepare(
      `UPDATE MemberCard SET balance = balance - ?, totalConsume = totalConsume + ?, updatedAt = ?
       WHERE id = ? AND deletedAt IS NULL AND balance >= ?${tenantAnd(clinicId)}`,
    ).run(...params);
    if (result.changes === 0) {
      throw new ConflictError('Insufficient member card balance');
    }
  }

  updatePoints(id: string, pointsDelta: number, totalPointsDelta: number, updatedAt: string, clinicId?: string | null): void {
    const params = clinicId
      ? [pointsDelta, totalPointsDelta, updatedAt, id, pointsDelta, clinicId]
      : [pointsDelta, totalPointsDelta, updatedAt, id, pointsDelta];
    const result = this.db.prepare(
      `UPDATE MemberCard
       SET points = points + ?, totalPoints = totalPoints + ?, updatedAt = ?
       WHERE id = ? AND deletedAt IS NULL AND points + ? >= 0${tenantAnd(clinicId)}`,
    ).run(...params);
    if (result.changes === 0) {
      throw new ConflictError('Insufficient points');
    }
  }

  insertLog(input: Record<string, unknown>): void {
    this.db.prepare(
      `INSERT INTO MemberCardLog (
         id, clinicId, createdAt, updatedAt, deletedAt,
         cardId, type, amount, balanceAfter, remark
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
    ).run(
      input.id,
      input.clinicId ?? null,
      input.createdAt,
      input.updatedAt,
      input.cardId,
      input.type,
      input.amount,
      input.balanceAfter,
      input.remark ?? null,
    );
  }

  insertPointLog(input: Record<string, unknown>): void {
    this.db.prepare(
      `INSERT INTO MemberPointLog (
         id, clinicId, createdAt, updatedAt, deletedAt,
         cardId, type, points, pointsAfter, remark
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, NULL)`,
    ).run(
      input.id,
      input.clinicId ?? null,
      input.createdAt,
      input.updatedAt,
      input.cardId,
      input.type,
      input.points,
      input.pointsAfter,
    );
  }
}
