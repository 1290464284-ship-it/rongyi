import type Database from 'better-sqlite3';
import type {
  ChargeItemRecord,
  ChargeRecord,
  ChargeRepository,
  CreateChargeInput,
} from '../../application/ports';
import { tenantAnd } from '../tenant';
import { recordSyncChange } from '../sync-change';
import { touchSearchIndex } from '../search-index';

export class SqliteChargeRepository implements ChargeRepository {
  constructor(private readonly db: Database.Database) {}

  findById(id: string, clinicId?: string | null): ChargeRecord | null {
    const params = clinicId ? [id, clinicId] : [id];
    const row = this.db.prepare(`SELECT * FROM Charge WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`).get(...params) as
      | ChargeRecord
      | undefined;
    return row ?? null;
  }

  create(input: CreateChargeInput): void {
    this.db.prepare(
      `INSERT INTO Charge (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, visitId, doctorId, number, totalAmount,
         paidAmount, refundedAmount, discount, status, remark
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)`,
    ).run(
      input.id,
      input.clinicId ?? null,
      input.createdAt,
      input.updatedAt,
      input.patientId,
      input.visitId ?? null,
      input.doctorId ?? null,
      input.number,
      input.totalAmount,
      input.discount,
      input.status,
      input.remark ?? null,
    );
    if (input.clinicId) {
      recordSyncChange(this.db, { tableName: 'Charge', recordId: input.id, operation: 'INSERT', clinicId: input.clinicId });
    }
    touchSearchIndex(this.db, 'Charge', input.id, 'INSERT');
  }

  createItem(item: ChargeItemRecord): void {
    this.db.prepare(
      `INSERT INTO ChargeItem (
         id, chargeId, treatmentId, name, category, price, quantity,
         teethNumbers, subtotal, clinicId, createdAt, updatedAt, deletedAt
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    ).run(
      item.id,
      item.chargeId,
      item.treatmentId ?? null,
      item.name,
      item.category,
      item.price,
      item.quantity,
      JSON.stringify(item.teethNumbers),
      item.subtotal,
      item.clinicId ?? null,
      item.createdAt,
      item.updatedAt,
    );
  }

  updatePayment(
    id: string,
    paidAmount: number,
    status: string,
    paidAt: string,
    payMethod?: string,
    memberCardId?: string | null,
    clinicId?: string | null,
  ): void {
    const params = clinicId
      ? [paidAmount, status, paidAt, payMethod ?? null, memberCardId ?? null, paidAt, id, clinicId]
      : [paidAmount, status, paidAt, payMethod ?? null, memberCardId ?? null, paidAt, id];
    this.db.prepare(
      `UPDATE Charge SET paidAmount = ?, status = ?, paidAt = ?, payMethod = COALESCE(?, payMethod),
       memberCardId = COALESCE(?, memberCardId), updatedAt = ? WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`,
    ).run(...params);
    if (clinicId) {
      recordSyncChange(this.db, { tableName: 'Charge', recordId: id, operation: 'UPDATE', clinicId });
    }
    touchSearchIndex(this.db, 'Charge', id, 'UPDATE');
  }

  updateRefund(id: string, refundedAmount: number, status: string, updatedAt: string, clinicId?: string | null): void {
    const params = clinicId ? [refundedAmount, status, updatedAt, id, clinicId] : [refundedAmount, status, updatedAt, id];
    this.db.prepare(
      `UPDATE Charge SET refundedAmount = ?, status = ?, updatedAt = ? WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`,
    ).run(...params);
    if (clinicId) {
      recordSyncChange(this.db, { tableName: 'Charge', recordId: id, operation: 'UPDATE', clinicId });
    }
    touchSearchIndex(this.db, 'Charge', id, 'UPDATE');
  }
}
