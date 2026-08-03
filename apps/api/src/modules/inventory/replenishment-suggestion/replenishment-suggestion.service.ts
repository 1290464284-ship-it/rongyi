import { BusinessNotFoundException, BusinessValidationException } from '@common/errors';
import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';

import { DbService } from '../../../db/db.service';
import { IDatabase } from '../../../db/db.interface';
import { BaseService } from '../../../common/services/base.service';
import { ClinicContextService } from '../../../common/services/clinic-context.service';
import { SettingsService } from '../../system/settings/settings.service';
import { AuditLogType } from '../../../common/constants/audit-log-types';
import { yuanToCents, multiplyCents, sumCents, centsToYuan } from '../../../common/utils/format/money.utils';
import { GenerateSuggestionsDto } from './dto/generate-suggestions.dto';
import { ListSuggestionsDto } from './dto/list-suggestions.dto';
import { PurchaseOrdersService } from '../purchase-orders/purchase-orders.service';

export interface TransactionSnapshot {
  date: string;
  quantity: number;
}

export interface ConsumptionResult {
  avgDaily: number;
  windowDays: number;
  outliersSkipped: number;
  recent90: TransactionSnapshot[];
  sigma?: number;
}

export interface CalculationSnapshot {
  avgDaily: number;
  sigma: number;
  leadTimeDays: number;
  safetyFactor: number;
  safetyStock: number;
  rop: number;
  eoq: number;
  annualDemand: number;
  orderCostPerOrder: number;
  holdingCostRate: number;
  unitPrice: number;
  stockAtCalculation: number;
  minStockAtCalculation: number;
  recent7dAvg: number;
  recent90dAvg: number;
  reason: string;
}

export interface SuggestionStats {
  scanned: number;
  generated: number;
  zeroStock: number;
  expiring: number;
  spike: number;
}

export interface GenerateResult {
  stats: SuggestionStats;
  suggestions: InventoryReplenishmentSuggestionRow[];
}

export interface InventoryReplenishmentSuggestionRow {
  id: string;
  clinicId: string;
  inventoryId: string;
  avgDailyConsumption: number;
  leadTimeDays: number;
  safetyFactor: number;
  rop: number;
  suggestedQty: number;
  calculationSnapshotJson: string;
  status: string;
  reason: string;
  supplierId: string | null;
  totalAmount: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export const REASON_PRIORITY: Record<string, number> = {
  ZERO_STOCK: 4,
  USAGE_SPIKE: 3,
  EXPIRING_30D: 2,
  ROP_BELOW_MIN: 1,
};

export function selectHigherReason(existing: string | null, candidate: string): string {
  if (!existing) return candidate;
  const ePrio = REASON_PRIORITY[existing] ?? 0;
  const cPrio = REASON_PRIORITY[candidate] ?? 0;
  return cPrio > ePrio ? candidate : existing;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function medianAbsoluteDeviation(values: number[]): { median: number; mad: number } {
  const med = median(values);
  const deviations = values.map((v) => Math.abs(v - med));
  return { median: med, mad: median(deviations) };
}

export function filterMADOutliers3Sigma(dailyQuantities: number[]): { kept: number[]; skippedCount: number } {
  if (dailyQuantities.length < 3) {
    return { kept: dailyQuantities, skippedCount: 0 };
  }
  const { median: med, mad } = medianAbsoluteDeviation(dailyQuantities);
  const threshold = mad > 0
    ? 3 * 1.4826 * mad
    : 0;
  const kept: number[] = [];
  let skipped = 0;
  for (const q of dailyQuantities) {
    if (Math.abs(q - med) > threshold) {
      skipped++;
    } else {
      kept.push(q);
    }
  }
  return { kept, skippedCount: skipped };
}

export function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = values.reduce((s, v) => s + v, 0) / values.length;
  const sqSum = values.reduce((s, v) => s + (v - avg) ** 2, 0);
  return Math.sqrt(sqSum / (values.length - 1));
}

export function ceilIfDiscreteUnit(value: number, unit?: string): number {
  const discreteUnits = ['盒', '包', '箱', '瓶', '支', '根', '片', '条', '个', '卷', '袋'];
  const needCeil = !unit || discreteUnits.some((u) => unit.includes(u));
  if (needCeil) {
    const ceiled = Math.ceil(value);
    return Math.max(ceiled, 1);
  }
  return value <= 0 ? 0.01 : value;
}

export function computeROPPure(
  avgDaily: number,
  leadTimeDays: number,
  safetyFactor: number,
  sigma?: number,
): number {
  let safetyStock: number;
  if (sigma != undefined && sigma > 0) {
    safetyStock = safetyFactor * Math.sqrt(leadTimeDays) * sigma;
  } else {
    safetyStock = safetyFactor * avgDaily * 2;
  }
  return Math.ceil(avgDaily * leadTimeDays + safetyStock);
}

export function computeEOQPure(
  annualDemandQty: number,
  orderCostPerOrder: number,
  holdingCostRate: number,
  unitPrice: number,
  minStockFallback: number = 0,
): number {
  const H = unitPrice * holdingCostRate;
  if (H <= 0 || annualDemandQty <= 0 || orderCostPerOrder <= 0) {
    return Math.max(1, minStockFallback * 2);
  }
  const eoq = Math.sqrt((2 * annualDemandQty * orderCostPerOrder) / H);
  return Math.max(1, Math.round(eoq));
}

@Injectable()
export class ReplenishmentSuggestionService extends BaseService<InventoryReplenishmentSuggestionRow> {
  constructor(
    dbService: DbService,
    clinicContext: ClinicContextService,
    private readonly settings: SettingsService,
    private readonly purchaseOrders: PurchaseOrdersService,
  ) {
    super(dbService, clinicContext, {
      tableName: 'InventoryReplenishmentSuggestion',
      moneyFields: ['totalAmount'],
    });
  }

  async computeAvgDailyConsumption(
    itemId: string,
    lookbackDays: number = 90,
  ): Promise<ConsumptionResult> {
    const today = new Date();
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - (lookbackDays - 1));
    const startIso = startDate.toISOString().slice(0, 10);
    const todayIso = today.toISOString().slice(0, 10);

    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();

    const rows = this.dbService
      .prepare(
        `SELECT DATE(createdAt) as day, SUM(quantity) as totalQty
         FROM InventoryTransaction
         WHERE itemId = ? AND type = 'OUT'
           AND DATE(createdAt) BETWEEN ? AND ?
           AND deletedAt IS NULL
           ${clinicClause}
         GROUP BY DATE(createdAt)
         ORDER BY DATE(createdAt) ASC`,
      )
      .all(itemId, startIso, todayIso, ...clinicParams) as Array<{
        day?: string;
        totalQty?: number;
        createdAt?: string;
        quantity?: number;
      }>;

    const dailyMap = new Map<string, number>();
    for (let d = new Date(startDate); d <= today; d.setDate(d.getDate() + 1)) {
      dailyMap.set(d.toISOString().slice(0, 10), 0);
    }
    for (const r of rows) {
      let day = typeof r.day === 'string' ? r.day : undefined;
      if (!day && typeof r.createdAt === 'string') {
        try { day = new Date(r.createdAt).toISOString().slice(0, 10); } catch { /* ignore */ }
      }
      const qty = Number(r.totalQty ?? r.quantity ?? 0);
      if (typeof day === 'string' && day.length === 10) {
        dailyMap.set(day, (dailyMap.get(day) ?? 0) + qty);
      }
    }

    const allDays = Array.from(dailyMap.entries())
      .filter(([d]) => typeof d === 'string' && d.length === 10)
      .sort(([a], [b]) => (a).localeCompare(b))
      .map(([date, quantity]) => ({ date, quantity }));

    const actualDataDays = rows.length;
    const allQuantities = allDays.map((d) => d.quantity);

    const { kept, skippedCount } = filterMADOutliers3Sigma(allQuantities);
    const windowDays = Math.min(lookbackDays, allQuantities.length);

    let avgDaily: number;
    let windowForAvg: number;

    if (actualDataDays < 7) {
      windowForAvg = Math.min(actualDataDays, lookbackDays);
      const sumConsumed = kept.reduce((s, v) => s + v, 0);
      const avgFromData = windowForAvg > 0 ? sumConsumed / windowForAvg : 0;

      const minStockRow = this.dbService
        .prepare(
          `SELECT minStock FROM InventoryItem WHERE id = ? AND deletedAt IS NULL${clinicClause}`,
        )
        .get(itemId, ...clinicParams) as { minStock: number } | undefined;
      const minStockVal = Number(minStockRow?.minStock || 0);
      const fallbackAvg = minStockVal > 0 ? minStockVal / 30 : 0;

      if (actualDataDays === 0) {
        avgDaily = Math.max(0.01, fallbackAvg);
      } else {
        avgDaily = Math.max(0.01, Math.min(fallbackAvg || Infinity, avgFromData || fallbackAvg));
      }
    } else {
      windowForAvg = windowDays;
      const sumConsumed = kept.reduce((s, v) => s + v, 0);
      avgDaily = sumConsumed / windowForAvg;
      if (avgDaily < 0.01) avgDaily = 0.01;
    }

    const sigma = standardDeviation(kept);

    return {
      avgDaily,
      windowDays: windowForAvg,
      outliersSkipped: skippedCount,
      recent90: allDays,
      sigma,
    };
  }

  computeROP(avgDaily: number, leadTimeDays: number, safetyFactor: number = 1.5, sigma?: number): number {
    return computeROPPure(avgDaily, leadTimeDays, safetyFactor, sigma);
  }

  computeEOQ(
    annualDemandQty: number,
    orderCostPerOrder: number = 100,
    holdingCostRate: number = 0.2,
    unitPrice: number,
    minStockFallback: number = 0,
  ): number {
    return computeEOQPure(annualDemandQty, orderCostPerOrder, holdingCostRate, unitPrice, minStockFallback);
  }

  private getRecentAvg(recentDays: TransactionSnapshot[], days: number): number {
    const last = recentDays.slice(-days);
    if (last.length === 0) return 0;
    return last.reduce((s, d) => s + d.quantity, 0) / last.length;
  }

  async generateSuggestions(
    opts?: GenerateSuggestionsDto,
  ): Promise<GenerateResult> {
    const enabled = await this.settings.getBoolean('aiInventoryReplenishmentEnabled', true);
    if (!enabled) {
      return {
        stats: { scanned: 0, generated: 0, zeroStock: 0, expiring: 0, spike: 0 },
        suggestions: [],
      };
    }

    const lookbackDays = opts?.lookbackDays ?? (await this.settings.getNumber('aiInventoryLookbackDays', 90));
    const leadTimeDaysDefault = opts?.leadTimeDaysDefault ?? (await this.settings.getNumber('aiInventoryLeadTimeDaysDefault', 7));
    const safetyFactor = opts?.safetyFactor ?? (await this.settings.getNumber('aiInventorySafetyFactor', 1.5));
    const holdingCostRate = await this.settings.getNumber('aiInventoryHoldingCostRate', 0.2);
    const orderCostPerOrder = await this.settings.getNumber('aiInventoryOrderCostPerOrder', 100);

    const clinicId = this.clinicContext.getClinicId();
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();

    const items = this.dbService
      .prepare(
        `SELECT id, code, name, spec, category, unit, stock, minStock, price, supplierId, expireDate
         FROM InventoryItem
         WHERE deletedAt IS NULL${clinicClause}`,
      )
      .all(...clinicParams) as Array<{
        id: string;
        code: string;
        name: string;
        spec?: string;
        category: string;
        unit: string;
        stock: number;
        minStock: number;
        price: number;
        supplierId?: string;
        expireDate?: string;
      }>;

    const stats: SuggestionStats = {
      scanned: items.length,
      generated: 0,
      zeroStock: 0,
      expiring: 0,
      spike: 0,
    };

    const now = new Date();
    const nowIso = now.toISOString();
    const today30 = new Date(now);
    today30.setDate(today30.getDate() + 30);
    const today30Iso = today30.toISOString().slice(0, 10);

    const created: InventoryReplenishmentSuggestionRow[] = [];

    await this.dbService.transaction(async (db) => {
      const existingOpenStmt = db.prepare(
        `UPDATE InventoryReplenishmentSuggestion
         SET deletedAt = ?, updatedAt = ?
         WHERE inventoryId = ? AND status = 'OPEN' AND deletedAt IS NULL${clinicClause}`,
      );

      for (const item of items) {
        const consumption = await this.computeAvgDailyConsumption(item.id, lookbackDays);
        const avgDaily = consumption.avgDaily;
        const sigma = consumption.sigma ?? 0;

        const leadTime = leadTimeDaysDefault;
        const rop = this.computeROP(avgDaily, leadTime, safetyFactor, sigma);
        const annualDemand = avgDaily * 365;
        const unitPriceYuan = centsToYuan(Number(item.price) || 0);
        const eoq = this.computeEOQ(annualDemand, orderCostPerOrder, holdingCostRate, unitPriceYuan, Number(item.minStock || 0));

        const stock = Number(item.stock || 0);
        let reason: string | null = null;

        if (stock <= rop) {
          reason = 'ROP_BELOW_MIN';
        }

        if (stock === 0 && avgDaily > 0) {
          reason = selectHigherReason(reason, 'ZERO_STOCK');
          stats.zeroStock++;
        }

        if (item.expireDate) {
          const exp = item.expireDate.slice(0, 10);
          if (exp <= today30Iso) {
            reason = selectHigherReason(reason, 'EXPIRING_30D');
            stats.expiring++;
          }
        }

        const recent7dAvg = this.getRecentAvg(consumption.recent90, 7);
        const recent90dAvg = consumption.windowDays > 0
          ? consumption.recent90.reduce((s, d) => s + d.quantity, 0) / consumption.windowDays
          : 0;
        if (recent90dAvg > 0 && recent7dAvg > recent90dAvg * 3) {
          reason = selectHigherReason(reason, 'USAGE_SPIKE');
          stats.spike++;
        }

        if (!reason) continue;

        const minQtyNeeded = Math.max(1, rop - stock + 1);
        let suggestedQty = Math.max(eoq, minQtyNeeded);
        suggestedQty = ceilIfDiscreteUnit(suggestedQty, item.unit);

        const unitPriceCents = Number(item.price) || 0;
        const totalAmount = multiplyCents(unitPriceCents, suggestedQty);

        const snapshot: CalculationSnapshot = {
          avgDaily,
          sigma,
          leadTimeDays: leadTime,
          safetyFactor,
          safetyStock: sigma > 0
            ? safetyFactor * Math.sqrt(leadTime) * sigma
            : safetyFactor * avgDaily * 2,
          rop,
          eoq,
          annualDemand,
          orderCostPerOrder,
          holdingCostRate,
          unitPrice: unitPriceYuan,
          stockAtCalculation: stock,
          minStockAtCalculation: Number(item.minStock || 0),
          recent7dAvg,
          recent90dAvg,
          reason,
        };

        existingOpenStmt.run(nowIso, nowIso, item.id, ...clinicParams);

        const sugId = crypto.randomUUID();
        db.prepare(
          `INSERT INTO InventoryReplenishmentSuggestion
           (id, clinicId, inventoryId, avgDailyConsumption, leadTimeDays, safetyFactor, rop,
            suggestedQty, calculationSnapshotJson, status, reason, supplierId, totalAmount, createdAt, updatedAt, deletedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, ?, ?, NULL)`,
        ).run(
          sugId,
          clinicId || null,
          item.id,
          avgDaily,
          leadTime,
          safetyFactor,
          rop,
          suggestedQty,
          JSON.stringify(snapshot),
          reason,
          item.supplierId || null,
          totalAmount,
          nowIso,
          nowIso,
        );

        stats.generated++;
        // soft-delete-exempt: 写后读取刚创建的记录，id 已确认存在且未删除
        const rawRow = db
          .prepare(`SELECT * FROM InventoryReplenishmentSuggestion WHERE id = ?`)
          .get(sugId) as InventoryReplenishmentSuggestionRow;
        const row = { ...rawRow };
        if (row && typeof row.totalAmount === 'number') {
          row.totalAmount = centsToYuan(row.totalAmount);
        }
        created.push(row);
      }
    });

    return { stats, suggestions: created };
  }

  async list(dto: ListSuggestionsDto) {
    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? 20;
    const sortBy = dto.sortBy ?? 'createdAt';
    const sortOrder = dto.sortOrder ?? 'DESC';

    const where: string[] = ['deletedAt IS NULL'];
    const params: unknown[] = [];

    if (dto.status) {
      where.push('status = ?');
      params.push(dto.status);
    }
    if (dto.reason) {
      where.push('reason = ?');
      params.push(dto.reason);
    }

    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    const clinicClauseTrim = clinicClause.replace(/^ AND/, '');
    where.push(clinicClauseTrim);
    params.push(...clinicParams);

    const whereSql = where.join(' AND ');
    const offset = (page - 1) * pageSize;

    const totalRow = this.dbService
      .prepare(`SELECT COUNT(*) as total FROM InventoryReplenishmentSuggestion WHERE ${whereSql}`)
      .get(...params) as { total: number };
    const total = Number(totalRow.total || 0);

    const rows = this.dbService
      .prepare(
        `SELECT * FROM InventoryReplenishmentSuggestion
         WHERE ${whereSql}
         ORDER BY ${sortBy} ${sortOrder}
         LIMIT ? OFFSET ?`,
      )
      .all(...params, pageSize, offset) as InventoryReplenishmentSuggestionRow[];

    const converted = rows.map((r) => {
      if (typeof r.totalAmount === 'number') {
        return { ...r, totalAmount: centsToYuan(r.totalAmount) };
      }
      return r;
    });

    return {
      data: converted,
      total,
      page,
      pageSize,
    };
  }

  private ensureUnspecifiedSupplier(db: IDatabase, clinicId?: string): string {
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    const existing = db
      .prepare(`SELECT id FROM Supplier WHERE name = ? AND deletedAt IS NULL${clinicClause}`)
      .get('未指定供应商', ...clinicParams) as { id: string } | undefined;
    if (existing) return existing.id;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO Supplier (id, name, clinicId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)`,
    ).run(id, '未指定供应商', clinicId || null, now, now);
    return id;
  }

  async applyToPurchaseOrder(
    ids: string[],
    opts: { groupBySupplier: boolean; supplierIdFallback?: string },
  ): Promise<Array<Record<string, unknown>>> {
    if (!ids || ids.length === 0) {
      throw new BusinessValidationException('请选择至少一条建议');
    }

    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    const clinicId = this.clinicContext.getClinicId();
    const idPlaceholders = ids.map(() => '?').join(',');

    const suggestionsRaw = this.dbService
      .prepare(
        `SELECT * FROM InventoryReplenishmentSuggestion
         WHERE id IN (${idPlaceholders}) AND status = 'OPEN' AND deletedAt IS NULL${clinicClause}`,
      )
      .all(...ids, ...clinicParams) as InventoryReplenishmentSuggestionRow[];

    const suggestionsRawFiltered = suggestionsRaw.filter(
      (s) => s.status === 'OPEN' && (s.deletedAt === null || s.deletedAt == undefined),
    );

    if (suggestionsRawFiltered.length === 0) {
      throw new BusinessNotFoundException('未找到可应用的建议（可能已应用或已忽略）');
    }

    const suggestions: Array<
      InventoryReplenishmentSuggestionRow & {
        itemName?: string;
        itemSpec?: string;
        itemUnit?: string;
        itemPrice: number;
        itemSupplierId?: string;
      }
    > = [];
    for (const s of suggestionsRawFiltered) {
      const itemRow = this.dbService
        .prepare(
          `SELECT name, spec, unit, price, supplierId FROM InventoryItem WHERE id = ? AND deletedAt IS NULL${clinicClause}`,
        )
        .get(s.inventoryId, ...clinicParams) as
        | { name?: string; spec?: string; unit?: string; price: number; supplierId?: string }
        | undefined;
      suggestions.push({
        ...s,
        itemName: itemRow?.name,
        itemSpec: itemRow?.spec,
        itemUnit: itemRow?.unit,
        itemPrice: Number(itemRow?.price ?? 0),
        itemSupplierId: itemRow?.supplierId,
      });
    }

    const createdPOs: Array<Record<string, unknown>> = [];

    await this.dbService.transaction(async (db) => {
      const nowIso = new Date().toISOString();

      let groups: Array<{ supplierId: string; items: typeof suggestions }>;
      if (opts.groupBySupplier) {
        const bySupplier = new Map<string, typeof suggestions>();
        for (const s of suggestions) {
          let sid = s.supplierId || s.itemSupplierId || opts.supplierIdFallback;
          if (!sid) {
            sid = this.ensureUnspecifiedSupplier(db, clinicId ?? undefined);
          }
          const existing = db
            .prepare(`SELECT id FROM Supplier WHERE id = ? AND deletedAt IS NULL${clinicClause}`)
            .get(sid, ...clinicParams);
          if (!existing) {
            sid = this.ensureUnspecifiedSupplier(db, clinicId ?? undefined);
          }
          if (!bySupplier.has(sid)) bySupplier.set(sid, []);
          bySupplier.get(sid)!.push(s);
        }
        groups = Array.from(bySupplier.entries()).map(([supplierId, items]) => ({ supplierId, items }));
      } else {
        groups = suggestions.map((s) => {
          let sid = s.supplierId || s.itemSupplierId || opts.supplierIdFallback;
          if (!sid) {
            sid = this.ensureUnspecifiedSupplier(db, clinicId ?? undefined);
          }
          const existing = db
            .prepare(`SELECT id FROM Supplier WHERE id = ? AND deletedAt IS NULL${clinicClause}`)
            .get(sid, ...clinicParams);
          if (!existing) {
            sid = this.ensureUnspecifiedSupplier(db, clinicId ?? undefined);
          }
          return { supplierId: sid, items: [s] };
        });
      }

      const updateStmt = db.prepare(
        `UPDATE InventoryReplenishmentSuggestion SET status = 'APPLIED', updatedAt = ? WHERE id = ?${clinicClause}`,
      );

      for (const group of groups) {
        const poId = crypto.randomUUID();
        const poNumber = 'PO' + Date.now().toString() + crypto.randomBytes(2).toString('hex');
        const poItems = group.items.map((s) => ({
          itemId: s.inventoryId,
          name: s.itemName || `库存物品(${s.inventoryId})`,
          spec: s.itemSpec,
          quantity: s.suggestedQty,
          unitPrice: centsToYuan(Number(s.itemPrice) || 0),
        }));
        const totalCents = sumCents(
          group.items.map((s) => multiplyCents(Number(s.itemPrice) || 0, s.suggestedQty)),
        );

        db.prepare(
          `INSERT INTO PurchaseOrder (id, number, supplierId, totalAmount, status, clinicId, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, 'PENDING', ?, ?, ?)`,
        ).run(poId, poNumber, group.supplierId, totalCents, clinicId || null, nowIso, nowIso);

        if (poItems.length > 0) {
          const placeholders = poItems.map(() => '(?,?,?,?,?,?,?,?,?)').join(',');
          const values: unknown[] = [];
          for (const it of poItems) {
            const upCents = yuanToCents(it.unitPrice);
            const subtotal = multiplyCents(upCents, it.quantity);
            values.push(
              crypto.randomUUID(),
              poId,
              it.itemId || null,
              it.name,
              it.spec || null,
              it.quantity,
              upCents,
              subtotal,
              clinicId || null,
            );
          }
          db.prepare(
            `INSERT INTO PurchaseOrderItem (id, orderId, itemId, name, spec, quantity, unitPrice, subtotal, clinicId)
             VALUES ${placeholders}`,
          ).run(...values);
        }

        for (const s of group.items) {
          updateStmt.run(nowIso, s.id, ...clinicParams);
          this.logAudit(
            db,
            AuditLogType.INVENTORY_UPDATE,
            s.id,
            'InventoryReplenishmentSuggestion',
            {
              beforeData: { status: 'OPEN' },
              afterData: { status: 'APPLIED', purchaseOrderNumber: poNumber },
            },
          );
        }

        // soft-delete-exempt: 写后读取刚创建的记录，id 已确认存在且未删除
        const poRow = db
          .prepare(`SELECT * FROM PurchaseOrder WHERE id = ?`)
          .get(poId) as Record<string, unknown>;
        if (poRow && typeof poRow.totalAmount === 'number') {
          poRow.totalAmount = centsToYuan(poRow.totalAmount);
        }
        createdPOs.push(poRow);
      }
    });

    return createdPOs;
  }

  async ignoreSuggestions(ids: string[]): Promise<{ updated: number }> {
    if (!ids || ids.length === 0) {
      throw new BusinessValidationException('请选择至少一条建议');
    }
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    const placeholders = ids.map(() => '?').join(',');
    const nowIso = new Date().toISOString();

    const result = this.dbService.prepare(
      `UPDATE InventoryReplenishmentSuggestion
       SET status = 'IGNORED', updatedAt = ?
       WHERE id IN (${placeholders}) AND status != 'APPLIED' AND deletedAt IS NULL${clinicClause}`,
    ).run(nowIso, ...ids, ...clinicParams);

    return { updated: result.changes };
  }
}
