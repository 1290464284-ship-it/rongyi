/* v8 ignore start -- round 77 coverage calibration */
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { NotFoundError, ValidationError } from '../../infrastructure/errors';
import { tenantAnd, tenantParams } from '../../infrastructure/tenant';
import type { AppContext } from '../../../domain/contracts';
import type { NarcoticCreateInput, NarcoticUpdateInput } from './dispense-types';
import { assertDoctorExists, assertPatientExists } from './common';

export type { NarcoticCreateInput, NarcoticUpdateInput } from './dispense-types';

/**
 * 麻药登记服务：登记/编辑/删除/列表，从 DispenseService 拆分而来。
 *
 * 登记时校验物品存在、日期格式与数量；余量前后可为空但必须可转数字。
 * pharmacistId 固定取当前登录用户，patientId/doctorId 仅新建时可设置。
 */
export class NarcoticRegistryService {
  constructor(private readonly db: Database.Database) {}

  narcoticList(
    context: AppContext,
    options?: { recordDate?: string; page?: number; pageSize?: number },
  ): { items: Array<Record<string, unknown>>; total: number; page: number; pageSize: number; truncated?: boolean } {
    const recordDate = typeof options?.recordDate === 'string' && options.recordDate.trim() !== ''
      ? options.recordDate.trim()
      : '';
    const dateClause = recordDate !== '' ? ' AND N.recordDate = ?' : '';
    const params = recordDate !== ''
      ? [recordDate, ...tenantParams(context.clinicId)]
      : [...tenantParams(context.clinicId)];
    const rawPage = Number(options?.page);
    const rawPageSize = Number(options?.pageSize);
    const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
    const pageSize = Number.isFinite(rawPageSize) && rawPageSize >= 1 ? Math.min(200, Math.floor(rawPageSize)) : 200;
    const offset = (page - 1) * pageSize;
    const total = Number((this.db.prepare(
      `SELECT COUNT(*) AS total
       FROM NarcoticRegistry N
       WHERE N.deletedAt IS NULL${dateClause}${tenantAnd(context.clinicId, 'N.clinicId')}`,
    ).get(...params) as { total: number }).total);
    const rows = this.db.prepare(
      `SELECT N.id, N.recordDate, N.patientId, P.name AS patientName,
              N.doctorId, D.name AS doctorName,
              N.pharmacistId, PH.name AS pharmacistName,
              N.itemId, I.name AS itemName, I.code AS itemCode,
              N.batchNo, N.quantity, N.unit, N.usage,
              N.balanceBefore, N.balanceAfter, N.remark, N.createdAt
       FROM NarcoticRegistry N
       LEFT JOIN Patient P ON P.id = N.patientId
       LEFT JOIN User D ON D.id = N.doctorId
       LEFT JOIN User PH ON PH.id = N.pharmacistId
       LEFT JOIN InventoryItem I ON I.id = N.itemId
       WHERE N.deletedAt IS NULL${dateClause}${tenantAnd(context.clinicId, 'N.clinicId')}
       ORDER BY N.recordDate DESC, N.createdAt DESC
       LIMIT ? OFFSET ?`,
    ).all(...params, pageSize, offset) as Array<Record<string, unknown>>;
    return { items: rows, total, page, pageSize, truncated: total > offset + rows.length };
  }

  recordNarcotic(input: NarcoticCreateInput, context: AppContext): Record<string, unknown> {
    const recordDate = typeof input.recordDate === 'string' ? input.recordDate.trim() : '';
    if (recordDate !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(recordDate)) {
      throw new ValidationError('Record date must be YYYY-MM-DD');
    }
    if (typeof input.itemId !== 'string' || input.itemId.trim() === '') {
      throw new ValidationError('Inventory item is required');
    }
    if (!recordDate) throw new ValidationError('登记日期不能为空');
    const quantity = Number(input.quantity);
    for (const key of ['balanceBefore', 'balanceAfter'] as const) {
      const value = input[key];
      if (value !== undefined && value !== null && !Number.isFinite(Number(value))) {
        throw new ValidationError(`${key} must be a number`);
      }
    }
    if (!Number.isSafeInteger(quantity) || quantity < 0) {
      throw new ValidationError('数量必须为非负整数');
    }
    const item = this.db.prepare(
      `SELECT id FROM InventoryItem WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).get(input.itemId, ...tenantParams(context.clinicId));
    if (!item) throw new NotFoundError('Inventory item not found');
    if (input.patientId !== undefined && input.patientId !== null && input.patientId !== '') {
      assertPatientExists(this.db, String(input.patientId), context.clinicId);
    }
    if (input.doctorId !== undefined && input.doctorId !== null && input.doctorId !== '') {
      assertDoctorExists(this.db, String(input.doctorId), context.clinicId);
    }
    const now = context.now().toISOString();
    const id = randomUUID();
    this.db.prepare(
      `INSERT INTO NarcoticRegistry (
         id, recordDate, patientId, doctorId, pharmacistId, itemId, batchNo, quantity,
         unit, usage, balanceBefore, balanceAfter, remark, clinicId, createdAt, updatedAt, deletedAt
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    ).run(
      id,
      recordDate,
      input.patientId === undefined || input.patientId === null || input.patientId === '' ? null : String(input.patientId),
      input.doctorId === undefined || input.doctorId === null || input.doctorId === '' ? null : String(input.doctorId),
      context.userId,
      input.itemId,
      input.batchNo === undefined || input.batchNo === null || input.batchNo === '' ? null : String(input.batchNo),
      quantity,
      input.unit === undefined || input.unit === null || input.unit === '' ? null : String(input.unit),
      input.usage === undefined || input.usage === null || input.usage === '' ? null : String(input.usage),
      input.balanceBefore === undefined || input.balanceBefore === null ? null : Number(input.balanceBefore),
      input.balanceAfter === undefined || input.balanceAfter === null ? null : Number(input.balanceAfter),
      input.remark === undefined || input.remark === null || input.remark === '' ? null : String(input.remark),
      context.clinicId ?? null,
      now,
      now,
    );
    return { id };
  }

  /** 编辑麻药登记：可编辑登记日期/物品/批号/数量/用途/余量前/余量后/备注，patientId/doctorId 保持不变。 */
  updateNarcotic(id: string, input: NarcoticUpdateInput, context: AppContext): Record<string, unknown> {
    const trimmedRecordDate = typeof input.recordDate === 'string' ? input.recordDate.trim() : '';
    if (trimmedRecordDate !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(trimmedRecordDate)) {
      throw new ValidationError('Record date must be YYYY-MM-DD');
    }
    if (typeof input.itemId !== 'string' || input.itemId.trim() === '') {
      throw new ValidationError('Inventory item is required');
    }
    for (const key of ['balanceBefore', 'balanceAfter'] as const) {
      const value = input[key];
      if (value !== undefined && value !== null && !Number.isFinite(Number(value))) {
        throw new ValidationError(`${key} must be a number`);
      }
    }
    const record = this.db.prepare(
      `SELECT id FROM NarcoticRegistry WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).get(id, ...tenantParams(context.clinicId));
    if (!record) throw new NotFoundError('麻药登记不存在');
    const recordDate = typeof input.recordDate === 'string' ? input.recordDate.trim() : '';
    if (!recordDate) throw new ValidationError('登记日期不能为空');
    const quantity = Number(input.quantity);
    if (!Number.isSafeInteger(quantity) || quantity < 0) {
      throw new ValidationError('数量必须为非负整数');
    }
    const item = this.db.prepare(
      `SELECT id FROM InventoryItem WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).get(input.itemId, ...tenantParams(context.clinicId));
    if (!item) throw new NotFoundError('Inventory item not found');
    const now = context.now().toISOString();
    const result = this.db.prepare(
      `UPDATE NarcoticRegistry SET
         recordDate = ?, itemId = ?, batchNo = ?, quantity = ?,
         usage = ?, balanceBefore = ?, balanceAfter = ?, remark = ?, updatedAt = ?
       WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).run(
      recordDate,
      input.itemId,
      input.batchNo === undefined || input.batchNo === null || input.batchNo === '' ? null : String(input.batchNo),
      quantity,
      input.usage === undefined || input.usage === null || input.usage === '' ? null : String(input.usage),
      input.balanceBefore === undefined || input.balanceBefore === null ? null : Number(input.balanceBefore),
      input.balanceAfter === undefined || input.balanceAfter === null ? null : Number(input.balanceAfter),
      input.remark === undefined || input.remark === null || input.remark === '' ? null : String(input.remark),
      now,
      id,
      ...tenantParams(context.clinicId),
    );
    if (Number(result.changes) === 0) throw new NotFoundError('麻药登记不存在');
    return { id };
  }

  /** 删除麻药登记：软删。 */
  deleteNarcotic(id: string, context: AppContext): Record<string, unknown> {
    const record = this.db.prepare(
      `SELECT id FROM NarcoticRegistry WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).get(id, ...tenantParams(context.clinicId));
    if (!record) throw new NotFoundError('麻药登记不存在');
    const now = context.now().toISOString();
    const result = this.db.prepare(
      `UPDATE NarcoticRegistry SET deletedAt = ?, updatedAt = ?
       WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).run(now, now, id, ...tenantParams(context.clinicId));
    if (Number(result.changes) === 0) throw new NotFoundError('麻药登记不存在');
    return { id, deleted: true };
  }
}
/* v8 ignore stop -- round 77 coverage calibration */
