// 加工单仓储（M-04：由 core.repositories.ts 拆分）
import type Database from 'better-sqlite3';
import { tenantAnd } from '../tenant';
import type {
  ProcessingOrderItemRecord,
  ProcessingOrderRecord,
  ProcessingOrderRepository,
} from '../../application/ports';

export class SqliteProcessingOrderRepository implements ProcessingOrderRepository {
  constructor(private readonly db: Database.Database) {}

  findById(id: string, clinicId?: string | null): { id: string; status: string; deletedAt?: string | null } | null {
    const params = clinicId ? [id, clinicId] : [id];
    return (this.db.prepare(`SELECT id, status, deletedAt FROM ProcessingOrder WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`).get(...params) as
      | { id: string; status: string; deletedAt?: string | null }
      | undefined) ?? null;
  }

  updateStatus(id: string, status: string, updatedAt: string, clinicId?: string | null, fromStatus?: string): number {
    // 条件更新：只有当前状态仍为 fromStatus 时才推进，防止并发请求互相覆盖状态。
    const params = clinicId
      ? [status, updatedAt, id, fromStatus ?? '', clinicId]
      : [status, updatedAt, id, fromStatus ?? ''];
    const result = this.db.prepare(
      `UPDATE ProcessingOrder SET status = ?, updatedAt = ?
       WHERE id = ? AND status = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`,
    ).run(...params);
    return Number(result.changes);
  }

  createOrder(input: ProcessingOrderRecord): void {
    this.db.prepare(
      `INSERT INTO ProcessingOrder (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, visitId, factoryId, doctorId, number, shade,
         teethNumbers, totalFee, status, settleStatus, expectedAt, remark
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.id,
      input.clinicId ?? null,
      input.createdAt,
      input.updatedAt,
      input.patientId,
      input.visitId ?? null,
      input.factoryId ?? null,
      input.doctorId ?? null,
      input.number,
      input.shade ?? null,
      JSON.stringify(input.teethNumbers),
      input.totalFee,
      input.status,
      input.settleStatus ?? 'UNSETTLED',
      input.expectedAt ?? null,
      input.remark ?? null,
    );
  }

  createItem(input: ProcessingOrderItemRecord): void {
    this.db.prepare(
      `INSERT INTO ProcessingOrderItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         orderId, name, spec, quantity, unitPrice, subtotal, status
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.id,
      input.clinicId ?? null,
      input.createdAt,
      input.updatedAt,
      input.orderId,
      input.name,
      input.spec ?? null,
      input.quantity,
      input.unitPrice,
      input.subtotal,
      input.status,
    );
  }
}
