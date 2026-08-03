import type Database from 'better-sqlite3';
import type {
  ChargeItemRecord,
  ChargeRecord,
  ChargeRepository,
  CreateChargeInput,
} from '../../application/ports';

export class SqliteChargeRepository implements ChargeRepository {
  constructor(private readonly db: Database.Database) {}

  findById(id: string): ChargeRecord | null {
    const row = this.db.prepare('SELECT * FROM Charge WHERE id = ? AND deletedAt IS NULL').get(id) as
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

  updatePayment(id: string, paidAmount: number, status: string, paidAt: string, payMethod?: string): void {
    this.db.prepare('UPDATE Charge SET paidAmount = ?, status = ?, paidAt = ?, payMethod = COALESCE(?, payMethod), updatedAt = ? WHERE id = ?')
      .run(paidAmount, status, paidAt, payMethod ?? null, paidAt, id);
  }

  updateRefund(id: string, refundedAmount: number, status: string, updatedAt: string): void {
    this.db.prepare('UPDATE Charge SET refundedAmount = ?, status = ?, updatedAt = ? WHERE id = ?')
      .run(refundedAmount, status, updatedAt, id);
  }
}
