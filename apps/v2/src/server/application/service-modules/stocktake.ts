import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { ConflictError, NotFoundError, ValidationError } from '../../infrastructure/errors';
import { tenantAnd, tenantParams } from '../../infrastructure/tenant';
import type { AppContext } from '../../../domain/contracts';

/**
 * 库存盘点（Stocktake）服务。
 *
 * 状态机：IN_PROGRESS → LOCKED → COMPLETED；IN_PROGRESS/LOCKED → CANCELLED。
 * 开始盘点时按系统库存快照生成 StocktakeItem；锁定后禁止该批物品出入库
 * （assertNotLocked 作为出入库守卫被调用方注入）；完成时将差异写回库存，
 * 并为每条差异插入 ADJUST 库存流水。
 */
interface StocktakeRow {
  id: string;
  number: string;
  status: string;
  startedAt: string | null;
}

export class StocktakeService {
  constructor(private readonly db: Database.Database) {}

  /**
   * 开始盘点：校验单号与并发，生成盘点单并为该租户全部在库物品生成明细快照。
   */
  start(input: { number: string; note?: string }, context: AppContext): Record<string, unknown> {
    const number = typeof input?.number === 'string' ? input.number.trim() : '';
    if (!number) throw new ValidationError('盘点单号不能为空');
    const note = typeof input?.note === 'string' && input.note.trim() ? input.note.trim() : null;
    const now = context.now().toISOString();

    const run = this.db.transaction((): { id: string; itemCount: number } => {
      const active = this.db.prepare(
        `SELECT id FROM Stocktake
         WHERE deletedAt IS NULL AND status IN ('IN_PROGRESS', 'LOCKED')${tenantAnd(context.clinicId)}
         LIMIT 1`,
      ).get(...tenantParams(context.clinicId)) as { id: string } | undefined;
      if (active) throw new ConflictError('已有进行中的盘点单');

      // UNIQUE(clinicId, number) 对软删行同样生效，因此冲突检查必须含软删行，
      // 否则插入会撞 SQLite 约束错误（500）而非返回 ConflictError。
      const numberConflict = this.db.prepare(
        `SELECT id FROM Stocktake
         WHERE number = ?${tenantAnd(context.clinicId)}
         LIMIT 1`,
      ).get(number, ...tenantParams(context.clinicId)) as { id: string } | undefined;
      if (numberConflict) throw new ConflictError('盘点单号已存在');

      const id = randomUUID();
      this.db.prepare(
        `INSERT INTO Stocktake (
           id, number, status, startedById, startedAt, note, clinicId, createdAt, updatedAt, deletedAt
         ) VALUES (?, ?, 'IN_PROGRESS', ?, ?, ?, ?, ?, ?, NULL)`,
      ).run(id, number, context.userId, now, note, context.clinicId ?? null, now, now);

      const items = this.db.prepare(
        `SELECT id, stock FROM InventoryItem WHERE deletedAt IS NULL${tenantAnd(context.clinicId)}`,
      ).all(...tenantParams(context.clinicId)) as Array<{ id: string; stock: number }>;
      const insertItem = this.db.prepare(
        `INSERT INTO StocktakeItem (
           id, stocktakeId, itemId, systemStock, countedStock, difference, note, clinicId, createdAt, updatedAt, deletedAt
         ) VALUES (?, ?, ?, ?, NULL, 0, NULL, ?, ?, ?, NULL)`,
      );
      for (const item of items) {
        insertItem.run(randomUUID(), id, item.id, Number(item.stock), context.clinicId ?? null, now, now);
      }
      return { id, itemCount: items.length };
    });

    const result = run();
    return { id: result.id, number, status: 'IN_PROGRESS', itemCount: result.itemCount };
  }

  /** 盘点单列表（含明细数与差异项数），按创建时间倒序。 */
  list(context: AppContext): Array<Record<string, unknown>> {
    const rows = this.db.prepare(
      `SELECT s.id, s.number, s.status, s.startedById, s.startedAt,
              s.completedById, s.completedAt, s.note,
              (SELECT COUNT(*) FROM StocktakeItem si
                WHERE si.stocktakeId = s.id AND si.deletedAt IS NULL) AS itemCount,
              (SELECT COUNT(*) FROM StocktakeItem si
                WHERE si.stocktakeId = s.id AND si.deletedAt IS NULL AND si.difference != 0) AS differenceCount
       FROM Stocktake s
       WHERE s.deletedAt IS NULL${tenantAnd(context.clinicId, 's.clinicId')}
       ORDER BY s.createdAt DESC, s.id
       LIMIT 200`,
    ).all(...tenantParams(context.clinicId)) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      ...row,
      itemCount: Number(row.itemCount ?? 0),
      differenceCount: Number(row.differenceCount ?? 0),
    }));
  }

  /** 盘点单明细（关联物品名称/编码/规格/单位）。 */
  items(stocktakeId: string, context: AppContext): Array<Record<string, unknown>> {
    this.findStocktake(stocktakeId, context);
    return this.db.prepare(
      `SELECT si.id, si.stocktakeId, si.itemId, si.systemStock, si.countedStock, si.difference, si.note,
              i.name, i.code, i.spec, i.unit
       FROM StocktakeItem si
       LEFT JOIN InventoryItem i ON i.id = si.itemId
       WHERE si.stocktakeId = ? AND si.deletedAt IS NULL${tenantAnd(context.clinicId, 'si.clinicId')}
       ORDER BY i.name, i.code`,
    ).all(stocktakeId, ...tenantParams(context.clinicId)) as Array<Record<string, unknown>>;
  }

  /** 录入盘点数量：仅 IN_PROGRESS 可录入，差异 = 实盘 - 系统库存。 */
  recordCount(stocktakeId: string, itemId: string, countedStock: unknown, context: AppContext): Record<string, unknown> {
    if (typeof countedStock !== 'number' || !Number.isInteger(countedStock) || countedStock < 0) {
      throw new ValidationError('录入数量必须是非负整数');
    }
    const stocktake = this.findStocktake(stocktakeId, context);
    if (stocktake.status !== 'IN_PROGRESS') throw new ConflictError('仅进行中的盘点单可录入数量');

    const row = this.db.prepare(
      `SELECT id, systemStock FROM StocktakeItem
       WHERE stocktakeId = ? AND itemId = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}
       LIMIT 1`,
    ).get(stocktakeId, itemId, ...tenantParams(context.clinicId)) as { id: string; systemStock: number } | undefined;
    if (!row) throw new NotFoundError('Stocktake item not found');

    const value = Number(countedStock);
    const systemStock = Number(row.systemStock);
    const difference = value - systemStock;
    const now = context.now().toISOString();
    this.db.prepare(
      `UPDATE StocktakeItem SET countedStock = ?, difference = ?, updatedAt = ? WHERE id = ?`,
    ).run(value, difference, now, row.id);
    return { id: row.id, systemStock, countedStock: value, difference };
  }

  /** 锁定盘点单：冻结被盘物品的出入库。 */
  lock(stocktakeId: string, context: AppContext): Record<string, unknown> {
    const row = this.findStocktake(stocktakeId, context);
    if (row.status !== 'IN_PROGRESS') throw new ConflictError('仅进行中的盘点单可锁定');
    if (!row.startedAt) throw new ConflictError('盘点单缺少开始时间');
    const now = context.now().toISOString();
    this.db.prepare(
      `UPDATE Stocktake SET status = 'LOCKED', updatedAt = ? WHERE id = ? AND deletedAt IS NULL`,
    ).run(now, stocktakeId);
    return { id: stocktakeId, status: 'LOCKED' };
  }

  /**
   * 完成盘点：仅 LOCKED 可完成。事务内将差异写回 InventoryItem.stock，
   * 并为每条差异插入 ADJUST 库存流水（直接 SQL，避免与盘点锁定守卫互锁）。
   */
  complete(stocktakeId: string, context: AppContext): Record<string, unknown> {
    const row = this.findStocktake(stocktakeId, context);
    if (row.status !== 'LOCKED') throw new ConflictError('仅已锁定的盘点单可完成');
    const now = context.now().toISOString();

    const run = this.db.transaction((): { adjustedCount: number; items: Array<Record<string, unknown>> } => {
      this.db.prepare(
        `UPDATE Stocktake SET status = 'COMPLETED', completedById = ?, completedAt = ?, updatedAt = ?
         WHERE id = ? AND deletedAt IS NULL`,
      ).run(context.userId, now, now, stocktakeId);

      const diffs = this.db.prepare(
        `SELECT si.itemId, si.systemStock, si.countedStock, si.difference, i.name
         FROM StocktakeItem si
         LEFT JOIN InventoryItem i ON i.id = si.itemId
         WHERE si.stocktakeId = ? AND si.deletedAt IS NULL AND si.difference != 0
           ${tenantAnd(context.clinicId, 'si.clinicId')}`,
      ).all(stocktakeId, ...tenantParams(context.clinicId)) as Array<{
        itemId: string;
        systemStock: number;
        countedStock: number | null;
        difference: number;
        name: string | null;
      }>;

      const updateItem = this.db.prepare(
        `UPDATE InventoryItem SET stock = ?, updatedAt = ? WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
      );
      const insertTx = this.db.prepare(
        `INSERT INTO InventoryTransaction (
           id, clinicId, createdAt, updatedAt, deletedAt,
           itemId, type, quantity, beforeStock, afterStock, operatorId, remark
         ) VALUES (?, ?, ?, ?, NULL, ?, 'ADJUST', ?, ?, ?, ?, ?)`,
      );
      const items: Array<Record<string, unknown>> = [];
      for (const diff of diffs) {
        const systemStock = Number(diff.systemStock);
        const countedStock = Number(diff.countedStock ?? systemStock);
        updateItem.run(countedStock, now, diff.itemId, ...tenantParams(context.clinicId));
        insertTx.run(
          randomUUID(),
          context.clinicId ?? null,
          now,
          now,
          diff.itemId,
          Number(diff.difference),
          systemStock,
          countedStock,
          context.userId,
          '盘点差异调整',
        );
        items.push({
          itemId: diff.itemId,
          name: diff.name ?? null,
          systemStock,
          countedStock,
          difference: Number(diff.difference),
        });
      }
      return { adjustedCount: items.length, items };
    });

    const result = run();
    return { id: stocktakeId, status: 'COMPLETED', adjustedCount: result.adjustedCount, items: result.items };
  }

  /** 取消盘点单：IN_PROGRESS 或 LOCKED 可取消。 */
  cancel(stocktakeId: string, context: AppContext): Record<string, unknown> {
    const row = this.findStocktake(stocktakeId, context);
    if (row.status !== 'IN_PROGRESS' && row.status !== 'LOCKED') {
      throw new ConflictError('仅进行中或已锁定的盘点单可取消');
    }
    const now = context.now().toISOString();
    this.db.prepare(
      `UPDATE Stocktake SET status = 'CANCELLED', updatedAt = ? WHERE id = ? AND deletedAt IS NULL`,
    ).run(now, stocktakeId);
    return { id: stocktakeId, status: 'CANCELLED' };
  }

  /**
   * 出入库锁定守卫：若物品属于任一 LOCKED 盘点单则拒绝出入库。
   * 由调用方注入到库存出入库流程中。
   */
  assertNotLocked(itemId: string, clinicId?: string | null): void {
    const row = this.db.prepare(
      `SELECT si.id
       FROM StocktakeItem si
       JOIN Stocktake s ON s.id = si.stocktakeId
       WHERE si.itemId = ? AND si.deletedAt IS NULL
         AND s.status = 'LOCKED' AND s.deletedAt IS NULL${tenantAnd(clinicId ?? null, 'si.clinicId')}
       LIMIT 1`,
    ).get(itemId, ...tenantParams(clinicId ?? null)) as { id: string } | undefined;
    if (row) throw new ConflictError('库存盘点锁定中，该物品暂不能出入库');
  }

  /** 返回被 LOCKED 盘点单覆盖的物品 id 列表。 */
  lockedItemIds(clinicId?: string | null): string[] {
    const rows = this.db.prepare(
      `SELECT DISTINCT si.itemId
       FROM StocktakeItem si
       JOIN Stocktake s ON s.id = si.stocktakeId
       WHERE si.deletedAt IS NULL AND s.deletedAt IS NULL AND s.status = 'LOCKED'
         ${tenantAnd(clinicId ?? null, 'si.clinicId')}`,
    ).all(...tenantParams(clinicId ?? null)) as Array<{ itemId: string }>;
    return rows.map((row) => row.itemId);
  }

  private findStocktake(id: string, context: AppContext): StocktakeRow {
    const row = this.db.prepare(
      `SELECT id, number, status, startedAt FROM Stocktake
       WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).get(id, ...tenantParams(context.clinicId)) as StocktakeRow | undefined;
    if (!row) throw new NotFoundError('Stocktake not found');
    return row;
  }
}
