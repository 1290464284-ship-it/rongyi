import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { ConflictError, NotFoundError, ValidationError } from '../../infrastructure/errors';
import { tenantAnd, tenantParams } from '../../infrastructure/tenant';
import type { AppContext } from '../../../domain/contracts';
import { addInventoryStock, deductInventoryStock, inventoryStockAfter, recordInventoryTransaction } from './inventory-ledger';
import type { DispenseAssignInput, DispenseItemRow, DispenseRow, InventoryItemRow, ReturnItemInput } from './dispense-types';

type StockLockGuard = (itemId: string, clinicId?: string | null) => void;

/**
 * 发药/退药的规划与原子执行：库存扣减、批次余量、流水与状态更新都在各自
 * 单一事务内完成；校验失败或任一原子守卫失败时整体回滚。
 */
export class DispenseExecutionService {
  constructor(
    private readonly db: Database.Database,
    private readonly lockGuard?: StockLockGuard,
  ) {}

  /**
   * 发药：仅 PENDING/PARTIAL 可发。先全量校验（状态、明细、库存、批次归属与
   * 批次余量），再在单事务内原子完成库存扣减（after >= 0 守卫）、批次余量扣减
   * （remainingQuantity >= ? 守卫，防止并发下扣成负数）、明细批次落库与状态更新；
   * 任一守卫失败整体回滚，不再出现“库存已扣、批次失败”的幽灵库存。
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
    if (plans.length === 0) throw new ValidationError('发药单没有可发药项目');

    // 单事务内完成：扣库存（原子守卫，after >= 0）、批次余量守卫扣减 + 明细批次落库 + 状态更新。
    // 此前“扣库存 + 批次守卫/状态”分属多个独立事务，批次守卫失败时库存已扣不可回滚（幽灵库存）；
    // 并发扣减亦可能出现校验后扣成负数；合并后要么全部成功要么整体回滚。
    const now = context.now().toISOString();
    const run = this.db.transaction(() => {
      for (const plan of plans) {
        this.lockGuard?.(plan.itemId, context.clinicId);
        deductInventoryStock(this.db, plan.itemId, plan.quantity, now, context.clinicId, 'Insufficient stock');
        const after = inventoryStockAfter(this.db, plan.itemId, context.clinicId);
        const before = after + plan.quantity;
        recordInventoryTransaction(this.db, {
          id: randomUUID(),
          clinicId: context.clinicId ?? null,
          itemId: plan.itemId,
          type: 'OUT',
          quantity: plan.quantity,
          beforeStock: before,
          afterStock: after,
          operatorId: context.userId,
          remark: '药房发药',
          createdAt: now,
          updatedAt: now,
          referenceType: 'DISPENSE',
          referenceId: id,
          batchId: plan.batchId,
        });
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
      const statusResult = this.db.prepare(
        `UPDATE Dispense
         SET status = 'DISPENSED', pharmacistId = ?, dispensedAt = ?, updatedAt = ?
         WHERE id = ? AND status IN ('PENDING', 'PARTIAL') AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
      ).run(context.userId, now, now, id, ...tenantParams(context.clinicId));
      if (statusResult.changes === 0) throw new ConflictError('仅待发药或部分发药的发药单可发药');
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
   * 库存（IN 流水），最后在同一个事务内回补批次余量、累加 returnedQuantity 并
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
    // 避免旧实现逐条校验“各自 ≤ 未退数量”而累计超额回补。
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

    // 单事务内完成：回补库存（IN 流水直接带 DISPENSE_RETURN 标记）、批次余量回补 +
    // returnedQuantity 累加 + 状态更新，全部原子，失败整体回滚。
    const now = context.now().toISOString();
    let finalStatus = 'PARTIAL';
    let allReturned = false;
    const run = this.db.transaction(() => {
      for (const plan of plans) {
        this.lockGuard?.(plan.itemId, context.clinicId);
        addInventoryStock(this.db, plan.itemId, plan.quantity, now, context.clinicId);
        const after = inventoryStockAfter(this.db, plan.itemId, context.clinicId);
        const before = after - plan.quantity;
        recordInventoryTransaction(this.db, {
          id: randomUUID(),
          clinicId: context.clinicId ?? null,
          itemId: plan.itemId,
          type: 'IN',
          quantity: plan.quantity,
          beforeStock: before,
          afterStock: after,
          operatorId: context.userId,
          remark: '药房退药',
          createdAt: now,
          updatedAt: now,
          referenceType: 'DISPENSE_RETURN',
          referenceId: id,
          batchId: plan.batchId,
        });
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
        const returnedResult = this.db.prepare(
          `UPDATE Dispense SET status = 'RETURNED', returnedAt = ?, updatedAt = ?
           WHERE id = ? AND status IN ('DISPENSED', 'PARTIAL') AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
        ).run(now, now, id, ...tenantParams(context.clinicId));
        if (returnedResult.changes === 0) throw new ConflictError('仅已发药或部分发药的发药单可退药');
      } else {
        const partialResult = this.db.prepare(
          `UPDATE Dispense SET status = 'PARTIAL', updatedAt = ?
           WHERE id = ? AND status IN ('DISPENSED', 'PARTIAL') AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
        ).run(now, id, ...tenantParams(context.clinicId));
        if (partialResult.changes === 0) throw new ConflictError('仅已发药或部分发药的发药单可退药');
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
}
