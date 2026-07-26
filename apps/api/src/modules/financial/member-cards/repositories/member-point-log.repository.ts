import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';

import { SqlExecutor } from '../../../../common/repositories/base.repository';
import { PointLogType } from '../../../../common/constants';

export interface MemberPointLog {
  id: string;
  cardId: string;
  type: PointLogType;
  points: number;
  balanceAfter: number;
  chargeId?: string | null;
  remark?: string | null;
  clinicId?: string | null;
  createdAt: string;
}

interface CreatePointLogDto {
  cardId: string;
  type: PointLogType;
  points: number;
  balanceAfter: number;
  chargeId?: string | null;
  remark?: string | null;
  clinicId?: string | null;
}

@Injectable()
export class MemberPointLogRepository {
  private readonly tableName = 'MemberPointLog';

  create(
    db: SqlExecutor,
    dto: CreatePointLogDto,
    now?: string,
  ): string {
    const id = crypto.randomUUID();
    const createdAt = now || new Date().toISOString();

    const data: Record<string, unknown> = {
      id,
      cardId: dto.cardId,
      type: dto.type,
      points: dto.points,
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
  ): MemberPointLog[] {
    const { page = 1, pageSize = 100, clinicClause = '', clinicParams = [] } = options;
    const offset = (page - 1) * pageSize;

    return db.prepare(
      `SELECT id, cardId, type, points, balanceAfter, chargeId, remark, clinicId, createdAt 
       FROM ${this.tableName} 
       WHERE cardId = ?${clinicClause} 
       ORDER BY createdAt DESC 
       LIMIT ? OFFSET ?`,
    ).all(cardId, ...clinicParams, pageSize, offset) as MemberPointLog[];
  }
}
