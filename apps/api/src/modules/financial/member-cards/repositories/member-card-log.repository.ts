import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';

import { SqlExecutor } from '../../../../common/repositories/base.repository';
import { MemberCardLogType } from '../../../../common/constants';

export interface MemberCardLog {
  id: string;
  cardId: string;
  type: MemberCardLogType;
  amount: number;
  balanceAfter: number;
  chargeId?: string | null;
  remark?: string | null;
  clinicId?: string | null;
  createdAt: string;
}

interface CreateLogDto {
  cardId: string;
  type: MemberCardLogType;
  amount: number;
  balanceAfter: number;
  chargeId?: string | null;
  remark?: string | null;
  clinicId?: string | null;
}

@Injectable()
export class MemberCardLogRepository {
  private readonly tableName = 'MemberCardLog';

  create(
    db: SqlExecutor,
    dto: CreateLogDto,
    now?: string,
  ): string {
    const id = crypto.randomUUID();
    const createdAt = now || new Date().toISOString();

    const data: Record<string, unknown> = {
      id,
      cardId: dto.cardId,
      type: dto.type,
      amount: dto.amount,
      balanceAfter: dto.balanceAfter,
      chargeId: dto.chargeId ?? null,
      remark: dto.remark ?? null,
      clinicId: dto.clinicId ?? null,
      createdAt,
    };

    const keys = Object.keys(data);
    const placeholders = keys.map(() => '?').join(', ');
    const values = keys.map((k) => data[k]);

    db.prepare(
      `INSERT INTO ${this.tableName} (${keys.join(', ')}) VALUES (${placeholders})`,
    ).run(...values);

    return id;
  }

  findByCardId(
    db: SqlExecutor,
    cardId: string,
    options: {
      page?: number;
      pageSize?: number;
      clinicClause?: string;
      clinicParams?: unknown[];
    } = {},
  ): MemberCardLog[] {
    const { page = 1, pageSize = 100, clinicClause = '', clinicParams = [] } = options;
    const offset = (page - 1) * pageSize;

    return db.prepare(
      `SELECT id, cardId, type, amount, balanceAfter, chargeId, remark, clinicId, createdAt 
       FROM ${this.tableName} 
       WHERE cardId = ?${clinicClause} 
       ORDER BY createdAt DESC 
       LIMIT ? OFFSET ?`,
    ).all(cardId, ...clinicParams, pageSize, offset) as MemberCardLog[];
  }
}
