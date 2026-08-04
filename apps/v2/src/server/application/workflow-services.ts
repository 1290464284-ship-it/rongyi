import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { ConflictError, NotFoundError, ValidationError } from '../infrastructure/errors';
import type { AppContext } from '../../domain/contracts';
import { tenantAnd, tenantParams } from '../infrastructure/tenant';
import { escapeHtml } from '../shared/html';
import {
  SqliteAnalyticsRepository,
  SqliteClinicalWorkflowRepository,
  SqliteWechatMessageRepository,
} from '../infrastructure/repositories/core.repositories';
import type { AnalyticsRepository, ClinicalWorkflowRepository, WechatMessageRepository } from './ports';

export class ClinicalWorkflowService {
  private readonly db: Database.Database;
  private readonly clinicalRepository: ClinicalWorkflowRepository;

  constructor(db: Database.Database, clinicalRepository?: ClinicalWorkflowRepository) {
    this.db = db;
    this.clinicalRepository = clinicalRepository ?? new SqliteClinicalWorkflowRepository(db);
  }

  registrationStatus(id: string, status: string, context: AppContext): Record<string, unknown> {
    const row = this.getRow('Registration', id, context.clinicId);
    const allowed: Record<string, readonly string[]> = {
      REGISTERED: ['TRIAGED', 'IN_PROGRESS', 'CANCELLED'],
      TRIAGED: ['IN_PROGRESS', 'CANCELLED'],
      IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
      COMPLETED: [],
      CANCELLED: [],
    };
    this.assertTransition(row, allowed, status);
    const now = context.now().toISOString();
    let visitId = row.visitId ? String(row.visitId) : null;
    if ((status === 'IN_PROGRESS' || status === 'COMPLETED') && !visitId) {
      visitId = randomUUID();
      this.clinicalRepository.createVisit({
        id: visitId,
        clinicId: context.clinicId ?? null,
        createdAt: now,
        updatedAt: now,
        patientId: row.patientId,
        doctorId: row.doctorId ?? context.userId,
        userId: context.userId,
      });
      this.clinicalRepository.updateStatus('Registration', id, row.status as string, now, { visitId }, context.clinicId);
    }
    this.clinicalRepository.updateStatus('Registration', id, status, now, {}, context.clinicId);
    return { id, status, visitId };
  }

  visitStatus(id: string, status: string, context: AppContext): Record<string, unknown> {
    const row = this.getRow('Visit', id, context.clinicId);
    const allowed: Record<string, readonly string[]> = {
      IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
      COMPLETED: [],
      CANCELLED: [],
    };
    this.assertTransition(row, allowed, status);
    const now = context.now().toISOString();
    this.clinicalRepository.updateStatus(
      'Visit',
      id,
      status,
      now,
      status === 'COMPLETED' ? { endTime: now } : {},
      context.clinicId,
    );
    return { id, status };
  }

  firstExamStatus(id: string, status: string, context: AppContext): Record<string, unknown> {
    const row = this.getRow('FirstExam', id, context.clinicId);
    const allowed: Record<string, readonly string[]> = {
      DRAFT: ['SUBMITTED', 'CANCELLED'],
      SUBMITTED: ['APPROVED', 'CANCELLED'],
      APPROVED: [],
      CANCELLED: [],
    };
    this.assertTransition(row, allowed, status);
    this.clinicalRepository.updateStatus('FirstExam', id, status, context.now().toISOString(), {}, context.clinicId);
    return { id, status };
  }

  treatmentStatus(id: string, status: string, context: AppContext): Record<string, unknown> {
    const row = this.getRow('Treatment', id, context.clinicId);
    const allowed: Record<string, readonly string[]> = {
      PLANNED: ['IN_PROGRESS', 'CANCELLED'],
      IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
      COMPLETED: [],
      CANCELLED: [],
    };
    this.assertTransition(row, allowed, status);
    const now = context.now().toISOString();
    const completedDate = status === 'COMPLETED' ? now.slice(0, 10) : null;
    this.clinicalRepository.updateStatus(
      'Treatment',
      id,
      status,
      now,
      completedDate ? { completedDate } : {},
      context.clinicId,
    );
    return { id, status };
  }

  lockMedicalRecord(id: string, locked: boolean, context: AppContext): Record<string, unknown> {
    this.getRow('MedicalRecord', id, context.clinicId);
    const now = context.now().toISOString();
    this.clinicalRepository.lockMedicalRecord(id, locked, context.userId, now, context.clinicId);
    return { id, isLocked: locked };
  }

  private getRow(table: string, id: string, clinicId: string | null): Record<string, unknown> {
    const row = this.clinicalRepository.getRow(table, id, clinicId);
    if (!row) throw new NotFoundError(`${table} not found`);
    return row;
  }

  private assertTransition(
    row: Record<string, unknown>,
    allowed: Record<string, readonly string[]>,
    next: string,
  ): void {
    const current = String(row.status);
    if (!allowed[current]?.includes(next)) {
      throw new ConflictError(`Cannot transition from ${current} to ${next}`);
    }
  }
}

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
        const orderNumber = `PO-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 8).toUpperCase()}-${index}`;
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
          this.db.prepare(
            `UPDATE InventoryReplenishmentSuggestion SET status = ?, updatedAt = ? WHERE id = ?${tenantAnd(clinicId)}`,
          ).run('APPLIED', now, suggestion.id, ...(clinicId ? [clinicId] : []));
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

export class WechatService {
  private readonly db: Database.Database;
  private readonly wechatRepository: WechatMessageRepository;

  constructor(db: Database.Database, wechatRepository?: WechatMessageRepository) {
    this.db = db;
    this.wechatRepository = wechatRepository ?? new SqliteWechatMessageRepository(db);
  }

  send(messageId: string, context: AppContext): Record<string, unknown> {
    const row = this.wechatRepository.findById(messageId, context.clinicId);
    if (!row) throw new NotFoundError('Wechat message not found');
    if (row.status === 'SENT') return { id: messageId, status: 'SENT' };
    const now = context.now().toISOString();
    const changes = this.wechatRepository.markSent(messageId, now, now, context.clinicId);
    if (changes === 0) throw new NotFoundError('Wechat message not found');
    return { id: messageId, status: 'SENT' };
  }

  sendBatch(ids: string[], context: AppContext): { sent: number } {
    if (!Array.isArray(ids) || ids.length > 500) {
      throw new ValidationError('Send batch ids must be an array with at most 500 items');
    }
    for (const id of ids) this.send(id, context);
    return { sent: ids.length };
  }
}

export class AnalyticsService {
  private readonly db: Database.Database;
  private readonly analyticsRepository: AnalyticsRepository;

  constructor(db: Database.Database, analyticsRepository?: AnalyticsRepository) {
    this.db = db;
    this.analyticsRepository = analyticsRepository ?? new SqliteAnalyticsRepository(db);
  }

  rfm(context: AppContext): Array<Record<string, unknown>> {
    return this.analyticsRepository.rfm(context.clinicId);
  }

  churn(context: AppContext): Array<Record<string, unknown>> {
    return this.analyticsRepository.churn(context.clinicId);
  }

  doctorAnomalies(context: AppContext): Array<Record<string, unknown>> {
    return this.analyticsRepository.doctorAnomalies(context.clinicId);
  }
}

export class ChargeAssistantService {
  constructor(private readonly db: Database.Database) {}

  frequentItems(context: AppContext): Array<Record<string, unknown>> {
    const tenantClause = tenantAnd(context.clinicId);
    const params: unknown[] = tenantParams(context.clinicId);
    return this.db.prepare(
      `SELECT category, name, COUNT(*) AS count
       FROM ChargeItem
       WHERE deletedAt IS NULL${tenantClause}
       GROUP BY category, name
       ORDER BY count DESC
       LIMIT 50`,
    ).all(...params) as Array<Record<string, unknown>>;
  }
}

export class PrintTemplateService {
  constructor(private readonly db: Database.Database) {}

  list(context: AppContext): Array<Record<string, unknown>> {
    const tenantClause = tenantAnd(context.clinicId);
    const params: unknown[] = tenantParams(context.clinicId);
    return this.db.prepare(
      `SELECT * FROM PrintTemplate WHERE deletedAt IS NULL${tenantClause} ORDER BY category, name`,
    ).all(...params) as Array<Record<string, unknown>>;
  }

  render(code: string, variables: Record<string, unknown>, context: AppContext): string {
    const params: unknown[] = [code, ...tenantParams(context.clinicId)];
    const row = this.db.prepare(`SELECT * FROM PrintTemplate WHERE code = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`).get(...params) as
      | Record<string, unknown>
      | undefined;
    if (!row) throw new NotFoundError('Print template not found');
    return Object.entries(variables).reduce(
      (html, [key, value]) => html.replaceAll(`{{${key}}}`, escapeHtml(String(value ?? ''))),
      escapeHtml(String(row.content)),
    );
  }
}
