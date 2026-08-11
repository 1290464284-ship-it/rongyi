import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { ConflictError, NotFoundError, ValidationError } from '../../infrastructure/errors';
import { tenantAnd, tenantParams } from '../../infrastructure/tenant';
import { trackResourceWrite } from '../../infrastructure/write-tracking';
import { generateDocumentNumber } from './common';
import type { AppContext } from '../../../domain/contracts';

export class ReplenishmentService {
  constructor(private readonly db: Database.Database) {}

  generate(context: AppContext): { generated: number } {
    const clinicId = context.clinicId;
    const clinicParams = tenantParams(clinicId);
    this.db.prepare(
      `UPDATE InventoryReplenishmentSuggestion
       SET status = 'IGNORED', updatedAt = ?
       WHERE deletedAt IS NULL AND (status IS NULL OR status = 'OPEN')${tenantAnd(clinicId)}`,
    ).run(context.now().toISOString(), ...clinicParams);
    const items = this.db.prepare(
      `SELECT * FROM InventoryItem WHERE deletedAt IS NULL${tenantAnd(clinicId)}`,
    ).all(...clinicParams) as Array<Record<string, unknown>>;
    const nowDate = context.now();
    const now = nowDate.toISOString();
    const since = new Date(nowDate.getTime() - 90 * 86_400_000).toISOString();
    const consumptionParams = clinicId ? [since, clinicId] : [since];
    const consumptionRows = this.db.prepare(
      `SELECT itemId,
              COALESCE(SUM(
                CASE
                  WHEN type = 'OUT' THEN quantity
                  WHEN type = 'ADJUST' AND quantity < 0 THEN ABS(quantity)
                  ELSE 0
                END
              ), 0) AS consumed
       FROM InventoryTransaction
       WHERE createdAt >= ? AND deletedAt IS NULL${tenantAnd(clinicId)}
       GROUP BY itemId`,
    ).all(...consumptionParams) as Array<{ itemId: string; consumed: number }>;
    /* v8 ignore start -- the aggregate query always returns a numeric consumed value. */
    const consumptionByItem = new Map(consumptionRows.map((row) => [row.itemId, Number(row.consumed ?? 0)]));
    /* v8 ignore stop */
    const leadTimeDays = 7;
    const safetyFactor = 1.5;
    const orderCost = 50;
    const holdingCostRate = 0.1;
    let generated = 0;
    for (const item of items) {
      const stock = Number(item.stock ?? 0);
      const minStock = Number(item.minStock ?? 0);
      const consumed = consumptionByItem.get(String(item.id)) ?? 0;
      const avgDaily = Math.max(0.01, consumed / 90);
      const safetyStock = Math.ceil(avgDaily * safetyFactor * 2);
      const rop = Math.ceil(avgDaily * leadTimeDays + safetyStock);
      const annualDemand = Math.max(1, avgDaily * 365);
      const eoq = Math.ceil(Math.sqrt((2 * annualDemand * orderCost) / holdingCostRate));
      if (stock <= rop) {
        const suggestedQty = Math.max(1, Math.ceil(rop - stock + 1), eoq);
        const snapshot = {
          avgDaily,
          leadTimeDays,
          safetyFactor,
          safetyStock,
          rop,
          eoq,
          consumedLast90Days: consumed,
          consumptionWindowDays: 90,
          stockAtCalculation: stock,
          minStockAtCalculation: minStock,
          reason: consumed > 0 ? 'DEMAND_BASED_ROP' : 'MIN_STOCK_BASELINE',
        };
        this.db.prepare(
          `INSERT INTO InventoryReplenishmentSuggestion (
             id, clinicId, inventoryId, avgDailyConsumption, leadTimeDays,
             safetyFactor, rop, suggestedQty, calculationSnapshotJson,
             createdAt, updatedAt, deletedAt
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        ).run(
          randomUUID(), context.clinicId ?? null, item.id, avgDaily, leadTimeDays, safetyFactor, rop, suggestedQty,
          JSON.stringify(snapshot), now, now,
        );
        generated += 1;
      }
    }
    return { generated };
  }

  applyToPurchaseOrder(ids: string[], context: AppContext): Record<string, unknown> {
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 500) {
      throw new ValidationError('At least one suggestion is required and at most 500 can be applied');
    }
    const requestedIds = [...new Set(ids)];
    const placeholders = requestedIds.map(() => '?').join(',');
    const clinicId = context.clinicId;
    const suggestionParams = clinicId ? [...requestedIds, clinicId] : [...requestedIds];
    const suggestions = this.db.prepare(
      `SELECT * FROM InventoryReplenishmentSuggestion
       WHERE id IN (${placeholders}) AND deletedAt IS NULL AND (status IS NULL OR status = 'OPEN')${tenantAnd(clinicId)}`,
    ).all(...suggestionParams) as Array<Record<string, unknown>>;
    if (suggestions.length !== requestedIds.length) throw new NotFoundError('No applicable suggestions found');
    const inventoryIds = [...new Set(suggestions.map((suggestion) => String(suggestion.inventoryId)))];
    const inventoryPlaceholders = inventoryIds.map(() => '?').join(',');
    const inventoryParams = clinicId ? [...inventoryIds, clinicId] : [...inventoryIds];
    const inventoryRows = this.db.prepare(
      `SELECT id, name, price, supplierId, clinicId FROM InventoryItem
       WHERE id IN (${inventoryPlaceholders}) AND deletedAt IS NULL${tenantAnd(clinicId)}`,
    ).all(...inventoryParams) as Array<{ id: string; name: string; price: number; supplierId?: string | null; clinicId?: string | null }>;
    const inventory = new Map(inventoryRows.map((row) => [row.id, row]));
    if (inventoryRows.length !== inventoryIds.length) {
      throw new NotFoundError('One or more inventory items are not available');
    }
    const now = context.now().toISOString();
    const groups = new Map<string | null, Array<Record<string, unknown>>>();
    for (const suggestion of suggestions) {
      const item = inventory.get(String(suggestion.inventoryId));
      const supplierId = item?.supplierId ?? null;
      const existing = groups.get(supplierId) ?? [];
      existing.push(suggestion);
      groups.set(supplierId, existing);
    }
    const orders: Array<Record<string, unknown>> = [];
    let index = 0;
    const run = this.db.transaction(() => {
      for (const [supplierId, group] of groups) {
        index += 1;
        const orderId = randomUUID();
        const orderNumber = `${generateDocumentNumber('PO')}-${index}`;
        /* v8 ignore start -- inventory rows and suggestedQty are schema-required; fallbacks are defensive. */
        const totalAmount = group.reduce((sum, suggestion) => {
          const item = inventory.get(String(suggestion.inventoryId));
          return sum + Number(item?.price ?? 0) * Number(suggestion.suggestedQty ?? 0);
        }, 0);
        /* v8 ignore stop */
        this.db.prepare(
          `INSERT INTO PurchaseOrder (
             id, clinicId, createdAt, updatedAt, deletedAt,
             number, supplierId, totalAmount, status
           ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 'PENDING')`,
        ).run(orderId, clinicId ?? null, now, now, orderNumber, supplierId, totalAmount);
        trackResourceWrite(this.db, { tableName: 'PurchaseOrder', recordId: orderId, operation: 'INSERT', clinicId: clinicId ?? null });
        for (const suggestion of group) {
          const item = inventory.get(String(suggestion.inventoryId));
          /* v8 ignore start -- inventory rows and suggestedQty are schema-required; fallbacks are defensive. */
          const quantity = Number(suggestion.suggestedQty ?? 0);
          const unitPrice = Number(item?.price ?? 0);
          /* v8 ignore stop */
          this.db.prepare(
            `INSERT INTO PurchaseOrderItem (
               id, clinicId, createdAt, updatedAt, deletedAt,
               orderId, itemId, name, quantity, unitPrice, subtotal
             ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
          ).run(
            randomUUID(),
            clinicId ?? null,
            now,
            now,
            orderId,
            suggestion.inventoryId,
            /* v8 ignore next -- inventory name is schema-required; fallback is defensive. */
            item?.name ?? String(suggestion.inventoryId),
            quantity,
            unitPrice,
            quantity * unitPrice,
          );
          const claimed = this.db.prepare(
            `UPDATE InventoryReplenishmentSuggestion
             SET status = ?, updatedAt = ?
             WHERE id = ? AND deletedAt IS NULL AND (status IS NULL OR status = 'OPEN')${tenantAnd(clinicId)}`,
          ).run('APPLIED', now, suggestion.id, ...(clinicId ? [clinicId] : []));
          if (claimed.changes === 0) {
            throw new ConflictError('补货建议已被处理，请刷新后重试');
          }
        }
        orders.push({ id: orderId, number: orderNumber, supplierId, totalAmount, items: group.length });
      }
    });
    run();
    return {
      orderId: orders[0]?.id,
      orderNumber: orders[0]?.number,
      items: suggestions.length,
      orders,
      orderCount: orders.length,
    };
  }
}
