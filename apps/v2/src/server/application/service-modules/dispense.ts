import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { ConflictError, NotFoundError, ValidationError } from '../../infrastructure/errors';
import { isUniqueConstraintError } from '../../infrastructure/repository';
import { tenantAnd, tenantParams } from '../../infrastructure/tenant';
import type { AppContext } from '../../../domain/contracts';

const DISPENSE_STATUSES = ['PENDING', 'PARTIAL', 'DISPENSED', 'RETURNED'] as const;

interface DispenseCreateItemInput {
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

interface DispenseUpdateItemInput extends DispenseCreateItemInput {
  /** 已存在的明细行 id（编辑时回填）；无 id 视为新增行。 */
  id?: string;
}

export interface DispenseUpdateInput {
  number: string;
  patientId: string;
  note?: string;
  items: DispenseUpdateItemInput[];
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

/** 麻药登记可编辑字段（patientId/doctorId/pharmacistId/unit 编辑时保持不变）。 */
export interface NarcoticUpdateInput {
  recordDate: string;
  itemId: string;
  batchNo?: string;
  quantity: number;
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
 * 发药/退药的库存增减、批次余量、明细与状态更新在同一事务内原子完成
 * （避免并发校验后扣成负数、以及批次守卫失败时库存已扣不可回滚的幽灵库存），
 * InventoryTransaction 流水直接落 referenceType（DISPENSE / DISPENSE_RETURN）
 * 供库存明细报表分类。所有写操作保持"先全量校验、后执行扣减"，避免中途失败留下半成品。
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

  /**
   * 发药：仅 PENDING/PARTIAL 可发。先全量校验（状态、明细、库存、批次归属与
   * 批次余量），再在单事务内原子完成库存扣减（after >= 0 守卫）、批次余量扣减
   * （remainingQuantity >= ? 守卫，防止并发下扣成负数）、明细批次落库与状态更新；
   * 任一守卫失败整体回滚，不再出现"库存已扣、批次失败"的幽灵库存。
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

    // 单事务内完成：扣库存（原子守卫，after >= 0）+ 批次余量守卫扣减 + 明细批次落库 + 状态更新。
    // 此前"扣库存"与"批次守卫/状态"分属多个独立事务，批次守卫失败时库存已扣不可回滚（幽灵库存），
    // 并发扣减亦可能出现校验后扣成负数；合并后要么全部成功要么整体回滚。
    const now = context.now().toISOString();
    const run = this.db.transaction(() => {
      for (const plan of plans) {
        this.lockGuard?.(plan.itemId, context.clinicId);
        const item = this.db.prepare(
          `SELECT id, stock FROM InventoryItem
           WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
        ).get(plan.itemId, ...tenantParams(context.clinicId)) as { id: string; stock: number } | undefined;
        if (!item) throw new NotFoundError('Inventory item not found');
        const before = Number(item.stock);
        const after = before - plan.quantity;
        if (after < 0) throw new ConflictError('Insufficient stock');
        this.db.prepare(
          `UPDATE InventoryItem SET stock = ?, updatedAt = ?
           WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
        ).run(after, now, plan.itemId, ...tenantParams(context.clinicId));
        this.db.prepare(
          `INSERT INTO InventoryTransaction (
             id, clinicId, createdAt, updatedAt, deletedAt,
             itemId, type, quantity, beforeStock, afterStock, operatorId, remark,
             referenceType, referenceId, batchId
           ) VALUES (?, ?, ?, ?, NULL, ?, 'OUT', ?, ?, ?, ?, ?, 'DISPENSE', ?, ?)`,
        ).run(
          randomUUID(),
          context.clinicId ?? null,
          now,
          now,
          plan.itemId,
          plan.quantity,
          before,
          after,
          context.userId,
          '药房发药',
          id,
          plan.batchId,
        );
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

    // 按明细行聚合去重：同一 dispenseItemId 出现多次时合并数量，
    // 避免旧实现逐条校验"各自 ≤ 未退数量"而累计超额回补。
    const merged = new Map<string, number>();
    for (const entry of input.items) {
      if (!entry || typeof entry.dispenseItemId !== 'string' || !entry.dispenseItemId) {
        throw new ValidationError('退药明细格式无效');
      }
      const quantity = Number(entry.quantity);
      if (!Number.isSafeInteger(quantity) || quantity <= 0) {
        throw new ValidationError('退回数量必须为正整数');
      }
      const key = entry.dispenseItemId;
      merged.set(key, (merged.get(key) ?? 0) + quantity);
    }

    interface ReturnPlan {
      dispenseItemId: string;
      itemId: string;
      batchId: string | null;
      quantity: number;
    }
    const plans: ReturnPlan[] = [];
    for (const [dispenseItemId, quantity] of merged) {
      const row = this.db.prepare(
        `SELECT id, itemId, batchId, quantity, returnedQuantity
         FROM DispenseItem WHERE id = ? AND dispenseId = ? AND deletedAt IS NULL`,
      ).get(dispenseItemId, id) as
        | { id: string; itemId: string; batchId: string | null; quantity: number; returnedQuantity: number }
        | undefined;
      if (!row) throw new NotFoundError('发药明细不存在');
      const remaining = Number(row.quantity) - Number(row.returnedQuantity ?? 0);
      if (quantity > remaining) throw new ValidationError('退回数量不能超过未退数量');
      plans.push({ dispenseItemId: row.id, itemId: row.itemId, batchId: row.batchId, quantity });
    }

    // 单事务内完成：回补库存（IN 流水直接带 DISPENSE_RETURN 标记）+ 批次余量回补 +
    // returnedQuantity 累加 + 状态更新，全部原子，失败整体回滚。
    const now = context.now().toISOString();
    let finalStatus = 'PARTIAL';
    let allReturned = false;
    const run = this.db.transaction(() => {
      for (const plan of plans) {
        this.lockGuard?.(plan.itemId, context.clinicId);
        const item = this.db.prepare(
          `SELECT id, stock FROM InventoryItem
           WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
        ).get(plan.itemId, ...tenantParams(context.clinicId)) as { id: string; stock: number } | undefined;
        if (!item) throw new NotFoundError('Inventory item not found');
        const before = Number(item.stock);
        const after = before + plan.quantity;
        this.db.prepare(
          `UPDATE InventoryItem SET stock = ?, updatedAt = ?
           WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
        ).run(after, now, plan.itemId, ...tenantParams(context.clinicId));
        this.db.prepare(
          `INSERT INTO InventoryTransaction (
             id, clinicId, createdAt, updatedAt, deletedAt,
             itemId, type, quantity, beforeStock, afterStock, operatorId, remark,
             referenceType, referenceId, batchId
           ) VALUES (?, ?, ?, ?, NULL, ?, 'IN', ?, ?, ?, ?, ?, 'DISPENSE_RETURN', ?, ?)`,
        ).run(
          randomUUID(),
          context.clinicId ?? null,
          now,
          now,
          plan.itemId,
          plan.quantity,
          before,
          after,
          context.userId,
          '药房退药',
          id,
          plan.batchId,
        );
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

  /**
   * 编辑发药单：仅 PENDING 可编辑（未扣库存，直接改明细安全）。明细按
   * (itemId, batchId) 合并（规则同 create）：带 id 的行更新对应 DispenseItem，
   * 无 id 的行新增，服务端有而表单没有的行软删。全程在一个事务内完成。
   */
  updateDispense(id: string, input: DispenseUpdateInput, context: AppContext): Record<string, unknown> {
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
      this.db.prepare(
        `UPDATE Dispense SET number = ?, patientId = ?, note = ?, updatedAt = ?
         WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
      ).run(
        number,
        input.patientId,
        input.note === undefined || input.note === null ? null : String(input.note),
        now,
        id,
        ...tenantParams(context.clinicId),
      );
    });
    run();
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
      this.db.prepare(
        `UPDATE Dispense SET deletedAt = ?, updatedAt = ?
         WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
      ).run(now, now, id, ...tenantParams(context.clinicId));
      this.db.prepare(
        `UPDATE DispenseItem SET deletedAt = ?, updatedAt = ?
         WHERE dispenseId = ? AND deletedAt IS NULL`,
      ).run(now, now, id);
    });
    run();
    return { id, deleted: true };
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

  /** 编辑麻药登记：可编辑登记日期/物品/批号/数量/用途/余量前/余量后/备注，patientId/doctorId 保持不变。 */
  updateNarcotic(id: string, input: NarcoticUpdateInput, context: AppContext): Record<string, unknown> {
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
    this.db.prepare(
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
    return { id };
  }

  /** 删除麻药登记：软删。 */
  deleteNarcotic(id: string, context: AppContext): Record<string, unknown> {
    const record = this.db.prepare(
      `SELECT id FROM NarcoticRegistry WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).get(id, ...tenantParams(context.clinicId));
    if (!record) throw new NotFoundError('麻药登记不存在');
    const now = context.now().toISOString();
    this.db.prepare(
      `UPDATE NarcoticRegistry SET deletedAt = ?, updatedAt = ?
       WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).run(now, now, id, ...tenantParams(context.clinicId));
    return { id, deleted: true };
  }
}
