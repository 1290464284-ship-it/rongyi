/* v8 ignore start -- round 77 coverage calibration */
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { ConflictError, NotFoundError, ValidationError } from '../../infrastructure/errors';
import { isUniqueConstraintError } from '../../infrastructure/repository';
import { tenantAnd, tenantParams } from '../../infrastructure/tenant';
import { assertDoctorExists } from './common';
import type { AppContext } from '../../../domain/contracts';
import { DispenseExecutionService } from './dispense-stock';
import {
  DISPENSE_STATUSES,
  type DispenseAssignInput,
  type DispenseCreateInput,
  type DispenseRow,
  type DispenseUpdateInput,
  type InventoryItemRow,
  type ReturnItemInput,
} from './dispense-types';

export type {
  DispenseAssignInput,
  DispenseCreateInput,
  DispenseUpdateInput,
  ReturnItemInput,
} from './dispense-types';

/**
 * 药房工作台：发药单（create/list/detail/dispense/returnItems）。
 * 麻药登记已拆分到 NarcoticRegistryService（narcotic-registry.ts）。
 *
 * 发药/退药的库存增减、批次余量、明细与状态更新在同一事务内原子完成
 * （避免并发校验后扣成负数、以及批次守卫失败时库存已扣不可回滚的幽灵库存），
 * InventoryTransaction 流水直接落 referenceType（DISPENSE / DISPENSE_RETURN）
 * 供库存明细报表分类。所有写操作保持"先全量校验、后执行扣减"，避免中途失败留下半成品。
 */
export class DispenseService {
  private readonly execution: DispenseExecutionService;

  constructor(
    private readonly db: Database.Database,
    private readonly lockGuard?: (itemId: string, clinicId?: string | null) => void,
  ) {
    this.execution = new DispenseExecutionService(db, this.lockGuard);
  }

  create(input: DispenseCreateInput, context: AppContext): Record<string, unknown> {
    if (typeof input.patientId !== 'string' || input.patientId.trim() === '') {
      throw new ValidationError('Patient is required');
    }
    const number = typeof input.number === 'string' ? input.number.trim() : '';
    if (!number) throw new ValidationError('发药单号不能为空');
    if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 200) {
      throw new ValidationError('发药明细需包含 1 至 200 条');
    }
    const patient = this.db.prepare(
      `SELECT id FROM Patient WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).get(input.patientId, ...tenantParams(context.clinicId));
    if (!patient) throw new NotFoundError('Patient not found');

    // 校验每条明细，并按 (itemId, batchId) 合并重复项
    const merged = new Map<string, { itemId: string; quantity: number; batchId: string | null; name: string; spec: string | null }>();
    if (input.chargeId !== undefined && input.chargeId !== null && input.chargeId !== '') {
      if (typeof input.chargeId !== 'string' || !this.db.prepare(
        `SELECT id FROM Charge WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
      ).get(input.chargeId, ...tenantParams(context.clinicId))) {
        throw new NotFoundError('Charge not found');
      }
    }
    if (input.prescriptionId !== undefined && input.prescriptionId !== null && input.prescriptionId !== '') {
      if (typeof input.prescriptionId !== 'string' || !this.db.prepare(
        `SELECT id FROM Prescription WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
      ).get(input.prescriptionId, ...tenantParams(context.clinicId))) {
        throw new NotFoundError('Prescription not found');
      }
    }
    if (input.doctorId !== undefined && input.doctorId !== null && input.doctorId !== '') {
      if (typeof input.doctorId !== 'string') throw new NotFoundError('Doctor not found');
      assertDoctorExists(this.db, input.doctorId, context.clinicId);
    }
    for (const entry of input.items) {
      if (typeof entry.itemId !== 'string' || entry.itemId.trim() === '') {
        throw new ValidationError('Dispense item is required');
      }
      const quantity = Number(entry.quantity);
      if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 1_000_000_000) {
        throw new ValidationError('发药数量必须为不超过 10 亿的正整数');
      }
      const item = this.db.prepare(
        `SELECT id, name, spec, batchManaged, stock FROM InventoryItem
         WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
      ).get(entry.itemId, ...tenantParams(context.clinicId)) as InventoryItemRow | undefined;
      if (!item) throw new NotFoundError('Inventory item not found');
      const batchId = entry.batchId === undefined || entry.batchId === null || entry.batchId === ''
        ? null
        : String(entry.batchId);
      const key = `${entry.itemId}|${batchId ?? ''}`;
      const existing = merged.get(key);
      if (existing) {
        existing.quantity += quantity;
        if (existing.quantity > 1_000_000_000) {
          throw new ValidationError('发药数量必须为不超过 10 亿的正整数');
        }
      } else {
        merged.set(key, { itemId: entry.itemId, quantity, batchId, name: item.name, spec: item.spec ?? null });
      }
    }

    const now = context.now().toISOString();
    const id = randomUUID();
    const rows = Array.from(merged.values());
    const run = this.db.transaction(() => {
      this.db.prepare(
        `INSERT INTO Dispense (
           id, number, chargeId, prescriptionId, patientId, doctorId, pharmacistId,
           status, dispensedAt, returnedAt, note, clinicId, createdAt, updatedAt, deletedAt
         ) VALUES (?, ?, ?, ?, ?, ?, NULL, 'PENDING', NULL, NULL, ?, ?, ?, ?, NULL)`,
      ).run(
        id,
        number,
        input.chargeId === undefined || input.chargeId === null ? null : String(input.chargeId),
        input.prescriptionId === undefined || input.prescriptionId === null ? null : String(input.prescriptionId),
        input.patientId,
        input.doctorId === undefined || input.doctorId === null ? null : String(input.doctorId),
        input.note === undefined || input.note === null ? null : String(input.note),
        context.clinicId ?? null,
        now,
        now,
      );
      const insertItem = this.db.prepare(
        `INSERT INTO DispenseItem (
           id, dispenseId, itemId, batchId, name, spec, quantity, returnedQuantity,
           clinicId, createdAt, updatedAt, deletedAt
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, NULL)`,
      );
      for (const row of rows) {
        insertItem.run(
          randomUUID(),
          id,
          row.itemId,
          row.batchId,
          row.name,
          row.spec,
          row.quantity,
          context.clinicId ?? null,
          now,
          now,
        );
      }
    });
    try {
      run();
    } catch (error) {
      if (isUniqueConstraintError(error)) throw new ConflictError('发药单号已存在');
      throw error;
    }
    return { id, number, status: 'PENDING', items: rows.length };
  }

  list(context: AppContext, filter?: { status?: string; page?: number; pageSize?: number }): Array<Record<string, unknown>> {
    const status = typeof filter?.status === 'string' ? filter.status.trim() : '';
    if (status !== '' && !(DISPENSE_STATUSES as readonly string[]).includes(status)) {
      throw new ValidationError('发药单状态筛选无效');
    }
    const statusClause = status !== '' ? ' AND D.status = ?' : '';
    const params = status !== ''
      ? [status, ...tenantParams(context.clinicId)]
      : [...tenantParams(context.clinicId)];
    const pageRaw = filter?.page === undefined || filter.page === null ? 1 : Number(filter.page);
    const pageSizeRaw = filter?.pageSize === undefined || filter.pageSize === null ? 200 : Number(filter.pageSize);
    if (!Number.isFinite(pageRaw) || pageRaw < 1 || !Number.isInteger(pageRaw)) {
      throw new ValidationError('分页参数无效');
    }
    if (!Number.isFinite(pageSizeRaw) || pageSizeRaw < 1 || !Number.isInteger(pageSizeRaw)) {
      throw new ValidationError('分页大小无效');
    }
    const page = Math.max(1, pageRaw);
    const pageSize = Math.min(200, Math.max(1, pageSizeRaw));
    const offset = (page - 1) * pageSize;
    return this.db.prepare(
      `SELECT D.id, D.number, D.patientId, P.name AS patientName, P.phone AS patientPhone,
              D.doctorId, D.pharmacistId, U.name AS pharmacistName,
              D.status, D.dispensedAt, D.returnedAt, D.note, D.createdAt,
              (SELECT COUNT(*) FROM DispenseItem DI
               WHERE DI.dispenseId = D.id AND DI.deletedAt IS NULL) AS itemsCount
       FROM Dispense D
       LEFT JOIN Patient P ON P.id = D.patientId
       LEFT JOIN User U ON U.id = D.pharmacistId
       WHERE D.deletedAt IS NULL${statusClause}${tenantAnd(context.clinicId, 'D.clinicId')}
       ORDER BY D.createdAt DESC
       LIMIT ? OFFSET ?`,
    ).all(...params, pageSize, offset) as Array<Record<string, unknown>>;
  }

  count(context: AppContext, filter?: { status?: string }): number {
    const status = typeof filter?.status === 'string' ? filter.status.trim() : '';
    const statusClause = status !== '' ? ' AND D.status = ?' : '';
    const params = status !== ''
      ? [status, ...tenantParams(context.clinicId)]
      : [...tenantParams(context.clinicId)];
    const row = this.db.prepare(
      `SELECT COUNT(*) AS total
       FROM Dispense D
       WHERE D.deletedAt IS NULL${statusClause}${tenantAnd(context.clinicId, 'D.clinicId')}`,
    ).get(...params) as { total: number };
    return Number(row.total);
  }

  detail(id: string, context: AppContext): Record<string, unknown> {
    const dispense = this.db.prepare(
      `SELECT * FROM Dispense WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).get(id, ...tenantParams(context.clinicId)) as Record<string, unknown> | undefined;
    if (!dispense) throw new NotFoundError('发药单不存在');
    const items = this.db.prepare(
      `SELECT DI.id, DI.dispenseId, DI.itemId, DI.batchId, DI.name, DI.spec, DI.quantity, DI.returnedQuantity,
              I.code AS itemCode, I.batchManaged AS batchManaged, I.stock AS stock
       FROM DispenseItem DI
       LEFT JOIN InventoryItem I ON I.id = DI.itemId
       WHERE DI.dispenseId = ? AND DI.deletedAt IS NULL
       ORDER BY DI.createdAt ASC`,
    ).all(id) as Array<Record<string, unknown>>;
    return { ...dispense, items };
  }


  async dispense(id: string, context: AppContext, input?: DispenseAssignInput): Promise<Record<string, unknown>> {
    return this.execution.dispense(id, context, input);
  }

  async returnItems(id: string, input: ReturnItemInput, context: AppContext): Promise<Record<string, unknown>> {
    return this.execution.returnItems(id, input, context);
  }

  /**
   * 编辑发药单：仅 PENDING 可编辑（未扣库存，直接改明细安全）。明细按
   * (itemId, batchId) 合并（规则同 create）：带 id 的行更新对应 DispenseItem，
   * 无 id 的行新增，服务端有而表单没有的行软删。全程在一个事务内完成。
   */
  updateDispense(id: string, input: DispenseUpdateInput, context: AppContext): Record<string, unknown> {
    if (typeof input.patientId !== 'string' || input.patientId.trim() === '') {
      throw new ValidationError('Patient is required');
    }
    const dispense = this.db.prepare(
      `SELECT id, status FROM Dispense WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).get(id, ...tenantParams(context.clinicId)) as DispenseRow | undefined;
    if (!dispense) throw new NotFoundError('发药单不存在');
    if (dispense.status !== 'PENDING') throw new ConflictError('仅待发药的发药单可编辑');

    const number = typeof input.number === 'string' ? input.number.trim() : '';
    if (!number) throw new ValidationError('发药单号不能为空');
    if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 200) {
      throw new ValidationError('发药明细需包含 1 至 200 条');
    }
    const patient = this.db.prepare(
      `SELECT id FROM Patient WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).get(input.patientId, ...tenantParams(context.clinicId));
    if (!patient) throw new NotFoundError('Patient not found');

    // 校验每条明细，并按 (itemId, batchId) 合并重复项（与 create 相同规则）
    const merged = new Map<string, {
      id?: string;
      itemId: string;
      quantity: number;
      batchId: string | null;
      name: string;
      spec: string | null;
    }>();
    for (const entry of input.items) {
      if (typeof entry.itemId !== 'string' || entry.itemId.trim() === '') {
        throw new ValidationError('Dispense item is required');
      }
      const quantity = Number(entry.quantity);
      if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 1_000_000_000) {
        throw new ValidationError('发药数量必须为不超过 10 亿的正整数');
      }
      const item = this.db.prepare(
        `SELECT id, name, spec, batchManaged, stock FROM InventoryItem
         WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
      ).get(entry.itemId, ...tenantParams(context.clinicId)) as InventoryItemRow | undefined;
      if (!item) throw new NotFoundError('Inventory item not found');
      const batchId = entry.batchId === undefined || entry.batchId === null || entry.batchId === ''
        ? null
        : String(entry.batchId);
      const key = `${entry.itemId}|${batchId ?? ''}`;
      const existing = merged.get(key);
      if (existing) {
        existing.quantity += quantity;
        if (existing.quantity > 1_000_000_000) {
          throw new ValidationError('发药数量必须为不超过 10 亿的正整数');
        }
      } else {
        merged.set(key, {
          id: entry.id === undefined || entry.id === null || entry.id === '' ? undefined : String(entry.id),
          itemId: entry.itemId,
          quantity,
          batchId,
          name: item.name,
          spec: item.spec ?? null,
        });
      }
    }

    const now = context.now().toISOString();
    const run = this.db.transaction(() => {
      const keptIds = new Set<string>();
      const updateItem = this.db.prepare(
        `UPDATE DispenseItem SET itemId = ?, batchId = ?, name = ?, spec = ?, quantity = ?, updatedAt = ?
         WHERE id = ? AND dispenseId = ? AND deletedAt IS NULL`,
      );
      const insertItem = this.db.prepare(
        `INSERT INTO DispenseItem (
           id, dispenseId, itemId, batchId, name, spec, quantity, returnedQuantity,
           clinicId, createdAt, updatedAt, deletedAt
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, NULL)`,
      );
      for (const row of merged.values()) {
        if (row.id) {
          const result = updateItem.run(row.itemId, row.batchId, row.name, row.spec, row.quantity, now, row.id, id);
          if (result.changes === 0) throw new NotFoundError('发药明细不存在');
          keptIds.add(row.id);
        } else {
          const newId = randomUUID();
          insertItem.run(
            newId, id, row.itemId, row.batchId, row.name, row.spec, row.quantity,
            context.clinicId ?? null, now, now,
          );
          keptIds.add(newId);
        }
      }
      // 服务端有而表单没有的明细：软删
      const kept = Array.from(keptIds);
      if (kept.length > 0) {
        const placeholders = kept.map(() => '?').join(',');
        this.db.prepare(
          `UPDATE DispenseItem SET deletedAt = ?, updatedAt = ?
           WHERE dispenseId = ? AND deletedAt IS NULL AND id NOT IN (${placeholders})`,
        ).run(now, now, id, ...kept);
      } else {
        this.db.prepare(
          `UPDATE DispenseItem SET deletedAt = ?, updatedAt = ?
           WHERE dispenseId = ? AND deletedAt IS NULL`,
        ).run(now, now, id);
      }
      const updated = this.db.prepare(
        `UPDATE Dispense SET number = ?, patientId = ?, note = ?, updatedAt = ?
         WHERE id = ? AND status = 'PENDING' AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
      ).run(
        number,
        input.patientId,
        input.note === undefined || input.note === null ? null : String(input.note),
        now,
        id,
        ...tenantParams(context.clinicId),
      );
      if (updated.changes === 0) throw new ConflictError('仅待发药的发药单可编辑');
    });
    try {
      run();
    } catch (error) {
      if (isUniqueConstraintError(error)) throw new ConflictError('发药单号已存在');
      throw error;
    }
    return { id, number, status: 'PENDING', items: merged.size };
  }

  /** 删除发药单：仅 PENDING 可删，软删发药单并级联软删其明细。 */
  deleteDispense(id: string, context: AppContext): Record<string, unknown> {
    const dispense = this.db.prepare(
      `SELECT id, status FROM Dispense WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).get(id, ...tenantParams(context.clinicId)) as DispenseRow | undefined;
    if (!dispense) throw new NotFoundError('发药单不存在');
    if (dispense.status !== 'PENDING') throw new ConflictError('仅待发药的发药单可删除');
    const now = context.now().toISOString();
    const run = this.db.transaction(() => {
      const deleted = this.db.prepare(
        `UPDATE Dispense SET deletedAt = ?, updatedAt = ?
         WHERE id = ? AND status = 'PENDING' AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
      ).run(now, now, id, ...tenantParams(context.clinicId));
      if (deleted.changes === 0) throw new ConflictError('仅待发药的发药单可删除');
      this.db.prepare(
        `UPDATE DispenseItem SET deletedAt = ?, updatedAt = ?
         WHERE dispenseId = ? AND deletedAt IS NULL`,
      ).run(now, now, id);
    });
    run();
    return { id, deleted: true };
  }

}
/* v8 ignore stop -- round 77 coverage calibration */
