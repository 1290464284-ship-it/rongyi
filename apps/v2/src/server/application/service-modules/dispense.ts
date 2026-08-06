import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { ConflictError, NotFoundError, ValidationError } from '../../infrastructure/errors';
import { tenantAnd, tenantParams } from '../../infrastructure/tenant';
import type { AppContext } from '../../../domain/contracts';
import { InventoryService } from './operations';

const DISPENSE_STATUSES = ['PENDING', 'PARTIAL', 'DISPENSED', 'RETURNED'] as const;

export interface DispenseCreateItemInput {
  itemId: string;
  quantity: number;
  batchId?: string | null;
}

export interface DispenseCreateInput {
  number: string;
  patientId: string;
  chargeId?: string;
  prescriptionId?: string;
  doctorId?: string;
  items: DispenseCreateItemInput[];
  note?: string;
}

/** 发药时可为各明细指定批次（覆盖 DispenseItem.batchId，仅对批次管理物品生效）。 */
export interface DispenseAssignInput {
  items?: Array<{ dispenseItemId?: string; batchId?: string | null }>;
}

export interface ReturnItemInput {
  items: Array<{ dispenseItemId: string; quantity: number }>;
}

export interface NarcoticCreateInput {
  recordDate: string;
  patientId?: string;
  doctorId?: string;
  itemId: string;
  batchNo?: string;
  quantity: number;
  unit?: string;
  usage?: string;
  balanceBefore?: number;
  balanceAfter?: number;
  remark?: string;
}

interface DispenseRow {
  id: string;
  status: string;
}

interface DispenseItemRow {
  id: string;
  itemId: string;
  batchId: string | null;
  name: string;
  spec: string | null;
  quantity: number;
  returnedQuantity: number;
}

interface InventoryItemRow {
  id: string;
  name: string;
  spec: string | null;
  batchManaged: number;
  stock: number;
}

/**
 * 药房工作台：发药单（create/list/detail/dispense/returnItems）+ 麻药登记。
 *
 * 库存增减统一走 InventoryService.createTransaction（既有服务，内部已做租户与
 * 库存校验并写 InventoryTransaction）；批次管理物品在发药/退药时同步增减对应
 * InventoryBatch.remainingQuantity。所有写操作保持“先全量校验、后执行扣减”，
 * 避免中途失败留下半成品。
 */
export class DispenseService {
  constructor(
    private readonly db: Database.Database,
    private readonly lockGuard?: (itemId: string, clinicId?: string | null) => void,
  ) {}

  create(input: DispenseCreateInput, context: AppContext): Record<string, unknown> {
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
    for (const entry of input.items) {
      const quantity = Number(entry.quantity);
      if (!Number.isSafeInteger(quantity) || quantity <= 0) {
        throw new ValidationError('发药数量必须为正整数');
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
    run();
    return { id, number, status: 'PENDING', items: rows.length };
  }

  list(context: AppContext, filter?: { status?: string }): Array<Record<string, unknown>> {
    const status = typeof filter?.status === 'string' ? filter.status.trim() : '';
    if (status !== '' && !(DISPENSE_STATUSES as readonly string[]).includes(status)) {
      throw new ValidationError('发药单状态筛选无效');
    }
    const statusClause = status !== '' ? ' AND D.status = ?' : '';
    const params = status !== ''
      ? [status, ...tenantParams(context.clinicId)]
      : [...tenantParams(context.clinicId)];
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
       LIMIT 200`,
    ).all(...params) as Array<Record<string, unknown>>;
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

  /**
   * 发药：仅 PENDING/PARTIAL 可发。先全量校验（状态、明细、库存、批次归属与
   * 批次余量），再逐条调用 InventoryService.createTransaction 扣减库存，最后在
   * 一个事务内扣减批次余量并落状态。批次扣减带 remainingQuantity >= ? 守卫，
   * 若影响行数为 0 则抛 ConflictError（防止并发下扣成负数）。
   */
  async dispense(id: string, context: AppContext, input?: DispenseAssignInput): Promise<Record<string, unknown>> {
    const dispense = this.db.prepare(
      `SELECT id, status FROM Dispense WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).get(id, ...tenantParams(context.clinicId)) as DispenseRow | undefined;
    if (!dispense) throw new NotFoundError('发药单不存在');
    if (!['PENDING', 'PARTIAL'].includes(dispense.status)) {
      throw new ConflictError('仅待发药或部分发药的发药单可发药');
    }

    const assignments = new Map<string, string | null>();
    if (input?.items !== undefined) {
      if (!Array.isArray(input.items)) throw new ValidationError('批次指定格式无效');
      for (const entry of input.items) {
        if (!entry || typeof entry.dispenseItemId !== 'string' || !entry.dispenseItemId) {
          throw new ValidationError('批次指定格式无效');
        }
        const batchId = entry.batchId === undefined || entry.batchId === null || entry.batchId === ''
          ? null
          : String(entry.batchId);
        assignments.set(entry.dispenseItemId, batchId);
      }
    }

    const rows = this.db.prepare(
      `SELECT id, itemId, batchId, name, spec, quantity, returnedQuantity
       FROM DispenseItem
       WHERE dispenseId = ? AND deletedAt IS NULL
       ORDER BY createdAt ASC`,
    ).all(id) as DispenseItemRow[];
    if (rows.length === 0) throw new ValidationError('发药单没有明细');

    interface Plan {
      dispenseItemId: string;
      itemId: string;
      name: string;
      quantity: number;
      batchId: string | null;
    }
    const plans: Plan[] = [];
    for (const row of rows) {
      const pending = Number(row.quantity) - Number(row.returnedQuantity ?? 0);
      if (pending <= 0) continue;
      const item = this.db.prepare(
        `SELECT id, name, spec, batchManaged, stock FROM InventoryItem
         WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
      ).get(row.itemId, ...tenantParams(context.clinicId)) as InventoryItemRow | undefined;
      if (!item) throw new NotFoundError('Inventory item not found');
      if (Number(item.stock) < pending) throw new ConflictError('Insufficient stock');
      let batchId = row.batchId;
      if (assignments.has(row.id)) batchId = assignments.get(row.id) ?? null;
      if (Number(item.batchManaged) === 1) {
        if (!batchId) throw new ValidationError('批次管理物品必须指定批次');
        const batch = this.db.prepare(
          `SELECT id, remainingQuantity FROM InventoryBatch
           WHERE id = ? AND itemId = ? AND deletedAt IS NULL AND active = 1${tenantAnd(context.clinicId)}`,
        ).get(batchId, row.itemId, ...tenantParams(context.clinicId)) as
          | { id: string; remainingQuantity: number }
          | undefined;
        if (!batch) throw new ConflictError('批次不存在或不属于该物品');
        if (Number(batch.remainingQuantity) < pending) throw new ConflictError('批次库存不足');
      }
      plans.push({ dispenseItemId: row.id, itemId: row.itemId, name: item.name, quantity: pending, batchId });
    }
    if (plans.length === 0) throw new ValidationError('发药单没有可发药品');

    // 扣减库存（逐条，InventoryService 内部自带事务与库存校验）
    const inventoryService = new InventoryService(this.db, undefined, undefined, this.lockGuard);
    for (const plan of plans) {
      await inventoryService.createTransaction(
        { itemId: plan.itemId, type: 'OUT', quantity: plan.quantity, remark: '药房发药' },
        context,
      );
    }

    // 批次余量扣减 + 状态更新放同一事务；批次的 remainingQuantity 守卫防止并发超扣
    const now = context.now().toISOString();
    const run = this.db.transaction(() => {
      for (const plan of plans) {
        if (plan.batchId) {
          const result = this.db.prepare(
            `UPDATE InventoryBatch
             SET remainingQuantity = remainingQuantity - ?, updatedAt = ?
             WHERE id = ? AND itemId = ? AND deletedAt IS NULL AND active = 1 AND remainingQuantity >= ?${tenantAnd(context.clinicId)}`,
          ).run(plan.quantity, now, plan.batchId, plan.itemId, plan.quantity, ...tenantParams(context.clinicId));
          if (result.changes === 0) throw new ConflictError('批次库存不足');
          this.db.prepare(
            `UPDATE DispenseItem SET batchId = ?, updatedAt = ?
             WHERE id = ? AND dispenseId = ?`,
          ).run(plan.batchId, now, plan.dispenseItemId, id);
        }
      }
      this.db.prepare(
        `UPDATE Dispense
         SET status = 'DISPENSED', pharmacistId = ?, dispensedAt = ?, updatedAt = ?
         WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
      ).run(context.userId, now, now, id, ...tenantParams(context.clinicId));
    });
    run();
    return {
      id,
      status: 'DISPENSED',
      dispensedAt: now,
      items: plans.map((plan) => ({
        itemId: plan.itemId,
        name: plan.name,
        quantity: plan.quantity,
        batchId: plan.batchId,
      })),
    };
  }

  /**
   * 退药：仅 DISPENSED/PARTIAL 可退。先校验每条退回数量不超过未退数量，再回补
   * 库存（IN 流水），最后在一个事务内回补批次余量、累加 returnedQuantity 并
   * 计算新状态（全部退完 -> RETURNED，否则 PARTIAL）。
   */
  async returnItems(id: string, input: ReturnItemInput, context: AppContext): Promise<Record<string, unknown>> {
    const dispense = this.db.prepare(
      `SELECT id, status FROM Dispense WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).get(id, ...tenantParams(context.clinicId)) as DispenseRow | undefined;
    if (!dispense) throw new NotFoundError('发药单不存在');
    if (!['DISPENSED', 'PARTIAL'].includes(dispense.status)) {
      throw new ConflictError('仅已发药或部分发药的发药单可退药');
    }
    if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 200) {
      throw new ValidationError('退药明细需包含 1 至 200 条');
    }

    interface ReturnPlan {
      dispenseItemId: string;
      itemId: string;
      batchId: string | null;
      quantity: number;
    }
    const plans: ReturnPlan[] = [];
    for (const entry of input.items) {
      const quantity = Number(entry.quantity);
      if (!Number.isSafeInteger(quantity) || quantity <= 0) {
        throw new ValidationError('退回数量必须为正整数');
      }
      const row = this.db.prepare(
        `SELECT id, itemId, batchId, quantity, returnedQuantity
         FROM DispenseItem WHERE id = ? AND dispenseId = ? AND deletedAt IS NULL`,
      ).get(entry.dispenseItemId, id) as
        | { id: string; itemId: string; batchId: string | null; quantity: number; returnedQuantity: number }
        | undefined;
      if (!row) throw new NotFoundError('发药明细不存在');
      const remaining = Number(row.quantity) - Number(row.returnedQuantity ?? 0);
      if (quantity > remaining) throw new ValidationError('退回数量不能超过未退数量');
      plans.push({ dispenseItemId: row.id, itemId: row.itemId, batchId: row.batchId, quantity });
    }

    // 回补库存
    const inventoryService = new InventoryService(this.db, undefined, undefined, this.lockGuard);
    for (const plan of plans) {
      const transaction = await inventoryService.createTransaction(
        { itemId: plan.itemId, type: 'IN', quantity: plan.quantity, remark: '药房退药' },
        context,
      );
      // InventoryService.createTransaction 不落 referenceType；退药回补流水标记为领药退库，
      // 供库存明细报表 DISPENSE_RETURN 分类使用。
      this.db.prepare(
        `UPDATE InventoryTransaction SET referenceType = 'DISPENSE_RETURN' WHERE id = ?`,
      ).run(String(transaction.id));
    }

    const now = context.now().toISOString();
    let finalStatus = 'PARTIAL';
    let allReturned = false;
    const run = this.db.transaction(() => {
      for (const plan of plans) {
        if (plan.batchId) {
          this.db.prepare(
            `UPDATE InventoryBatch
             SET remainingQuantity = remainingQuantity + ?, updatedAt = ?
             WHERE id = ? AND itemId = ? AND deletedAt IS NULL AND active = 1${tenantAnd(context.clinicId)}`,
          ).run(plan.quantity, now, plan.batchId, plan.itemId, ...tenantParams(context.clinicId));
        }
        this.db.prepare(
          `UPDATE DispenseItem SET returnedQuantity = returnedQuantity + ?, updatedAt = ?
           WHERE id = ? AND dispenseId = ?`,
        ).run(plan.quantity, now, plan.dispenseItemId, id);
      }
      const left = this.db.prepare(
        `SELECT COUNT(*) AS count FROM DispenseItem
         WHERE dispenseId = ? AND deletedAt IS NULL AND quantity > returnedQuantity`,
      ).get(id) as { count: number };
      allReturned = Number(left.count) === 0;
      finalStatus = allReturned ? 'RETURNED' : 'PARTIAL';
      if (allReturned) {
        this.db.prepare(
          `UPDATE Dispense SET status = 'RETURNED', returnedAt = ?, updatedAt = ?
           WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
        ).run(now, now, id, ...tenantParams(context.clinicId));
      } else {
        this.db.prepare(
          `UPDATE Dispense SET status = 'PARTIAL', updatedAt = ?
           WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
        ).run(now, id, ...tenantParams(context.clinicId));
      }
    });
    run();
    return {
      id,
      status: finalStatus,
      returnedAt: allReturned ? now : null,
      items: plans.map((plan) => ({
        dispenseItemId: plan.dispenseItemId,
        itemId: plan.itemId,
        quantity: plan.quantity,
        batchId: plan.batchId,
      })),
    };
  }

  narcoticList(context: AppContext, filter?: { recordDate?: string }): Array<Record<string, unknown>> {
    const recordDate = typeof filter?.recordDate === 'string' && filter.recordDate.trim() !== ''
      ? filter.recordDate.trim()
      : '';
    const dateClause = recordDate !== '' ? ' AND N.recordDate = ?' : '';
    const params = recordDate !== ''
      ? [recordDate, ...tenantParams(context.clinicId)]
      : [...tenantParams(context.clinicId)];
    return this.db.prepare(
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
       LIMIT 200`,
    ).all(...params) as Array<Record<string, unknown>>;
  }

  recordNarcotic(input: NarcoticCreateInput, context: AppContext): Record<string, unknown> {
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
}
