import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';

import { SqlExecutor } from '../../../../common/repositories/base.repository';
import { ChargeRecord, ChargeItemRecord } from '../entities/charge.entity';
import { maskPhone } from '../../../../common/utils/security/mask';

export interface CreateChargeData {
  id: string;
  patientId: string;
  visitId?: string;
  doctorId?: string;
  number: string;
  totalAmount: number;
  status: string;
  remark?: string;
  clinicId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateChargeItemData {
  id: string;
  chargeId: string;
  treatmentId?: string;
  inventoryItemId?: string;
  name: string;
  category: string;
  price: number;
  quantity: number;
  teethNumbers?: string;
  subtotal: number;
  clinicId?: string;
}

export interface ListChargesOptions {
  clinicClause: string;
  clinicParams: unknown[];
  patientId?: string;
  status?: string;
  page: number;
  pageSize: number;
}

@Injectable()
export class ChargeRepository {
  private readonly tableName = 'Charge';
  private readonly itemTableName = 'ChargeItem';

  create(db: SqlExecutor, data: CreateChargeData): void {
    db.prepare(
      `INSERT INTO ${this.tableName} (id, patientId, visitId, doctorId, number, totalAmount, paidAmount, refundedAmount, discount, status, remark, clinicId, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?, ?)`,
    ).run(
      data.id,
      data.patientId,
      data.visitId ?? null,
      data.doctorId ?? null,
      data.number,
      data.totalAmount,
      data.status,
      data.remark ?? null,
      data.clinicId ?? null,
      data.createdAt,
      data.updatedAt,
    );
  }

  update(
    db: SqlExecutor,
    id: string,
    updates: string[],
    params: unknown[],
    clinicClause: string,
    clinicParams: unknown[],
  ): void {
    if (updates.length === 0) return;
    db.prepare(
      `UPDATE ${this.tableName} SET ${updates.join(', ')} WHERE id = ? AND deletedAt IS NULL${clinicClause}`,
    ).run(...params, id, ...clinicParams);
  }

  findById(
    db: SqlExecutor,
    id: string,
    clinicClause: string,
    clinicParams: unknown[],
  ): ChargeRecord | undefined {
    return db.prepare(
      `SELECT id, patientId, visitId, doctorId, number, totalAmount, paidAmount, refundedAmount, discount, status, payMethod, paidAt, remark, clinicId, createdAt, updatedAt
       FROM ${this.tableName}
       WHERE id = ? AND deletedAt IS NULL${clinicClause}`,
    ).get(id, ...clinicParams) as ChargeRecord | undefined;
  }

  findMany(
    db: SqlExecutor,
    options: ListChargesOptions,
  ): { items: ChargeRecord[]; total: number } {
    const { clinicClause, clinicParams, patientId, status, page, pageSize } = options;

    const conditions: string[] = [`deletedAt IS NULL`];
    const params: unknown[] = [];

    if (clinicClause) {
      const cleanClause = clinicClause.replace(/^\s*AND\s+/i, '');
      conditions.push(cleanClause);
      params.push(...clinicParams);
    }

    if (patientId) {
      conditions.push('patientId = ?');
      params.push(patientId);
    }
    if (status) {
      conditions.push('status = ?');
      params.push(status);
    }

    const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
    const countSql = `SELECT COUNT(*) as total FROM ${this.tableName}${whereClause}`;
    const total = (db.prepare(countSql).get(...params) as { total: number } | undefined)?.total || 0;

    const dataSql = `SELECT id, patientId, visitId, doctorId, number, totalAmount, paidAmount, refundedAmount, discount, status, remark, createdAt, updatedAt
                     FROM ${this.tableName}${whereClause}
                     ORDER BY createdAt DESC LIMIT ? OFFSET ?`;
    const dataParams = [...params, pageSize, (page - 1) * pageSize];
    const items = db.prepare(dataSql).all(...dataParams) as ChargeRecord[];

    return { items, total };
  }

  delete(
    db: SqlExecutor,
    id: string,
    clinicClause: string,
    clinicParams: unknown[],
  ): void {
    db.prepare(
      `DELETE FROM ${this.tableName} WHERE id = ?${clinicClause}`,
    ).run(id, ...clinicParams);
  }

  findItemsByChargeId(
    db: SqlExecutor,
    chargeId: string,
    clinicClause: string,
    clinicParams: unknown[],
  ): ChargeItemRecord[] {
    return db.prepare(
      `SELECT id, chargeId, treatmentId, inventoryItemId, consumedQuantity, name, category, price, quantity, teethNumbers, subtotal, clinicId, createdAt
       FROM ${this.itemTableName}
       WHERE chargeId = ?${clinicClause}
       ORDER BY createdAt`,
    ).all(chargeId, ...clinicParams) as ChargeItemRecord[];
  }

  createItems(db: SqlExecutor, items: CreateChargeItemData[]): void {
    if (items.length === 0) return;
    const insertItem = db.prepare(
      `INSERT INTO ${this.itemTableName} (id, chargeId, treatmentId, inventoryItemId, name, category, price, quantity, teethNumbers, subtotal, clinicId)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const item of items) {
      insertItem.run(
        item.id || crypto.randomUUID(),
        item.chargeId,
        item.treatmentId ?? null,
        item.inventoryItemId ?? null,
        item.name,
        item.category,
        item.price,
        item.quantity,
        item.teethNumbers ?? null,
        item.subtotal,
        item.clinicId ?? null,
      );
    }
  }

  batchFindPatients(
    db: SqlExecutor,
    ids: string[],
    clinicClause: string,
    clinicParams: unknown[],
  ): Array<{ id: string; name: string; phone: string }> {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    const patients = db.prepare(
      `SELECT id, name, phone FROM Patient WHERE id IN (${placeholders}) AND deletedAt IS NULL${clinicClause}`,
    ).all(...ids, ...clinicParams) as Array<{ id: string; name: string; phone: string }>;
    patients.forEach(p => {
      const masked = maskPhone(p.phone);
      if (masked) p.phone = masked;
    });
    return patients;
  }

  batchFindDoctors(
    db: SqlExecutor,
    ids: string[],
    clinicClause: string,
    clinicParams: unknown[],
  ): Array<{ id: string; name: string; role: string }> {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    return db.prepare(
      `SELECT id, name, role FROM User WHERE id IN (${placeholders}) AND active = 1${clinicClause}`,
    ).all(...ids, ...clinicParams) as Array<{ id: string; name: string; role: string }>;
  }

  getLatestNumber(
    db: SqlExecutor,
    prefix: string,
    clinicId: string,
  ): { number: string } | undefined {
    return db.prepare(
      `SELECT number FROM ${this.tableName} WHERE number LIKE ? ESCAPE '\\' AND clinicId = ? ORDER BY number DESC LIMIT 1`,
    ).get(`${prefix}%`, clinicId) as { number: string } | undefined;
  }
}
