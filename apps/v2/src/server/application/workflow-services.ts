import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { ConflictError, NotFoundError, ValidationError } from '../infrastructure/errors';
import type { AppContext } from '../../domain/contracts';
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
    const row = this.getRow('Registration', id);
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
      this.clinicalRepository.updateStatus('Registration', id, row.status as string, now, { visitId });
    }
    this.clinicalRepository.updateStatus('Registration', id, status, now);
    return { id, status, visitId };
  }

  visitStatus(id: string, status: string, context: AppContext): Record<string, unknown> {
    const row = this.getRow('Visit', id);
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
    );
    return { id, status };
  }

  firstExamStatus(id: string, status: string, context: AppContext): Record<string, unknown> {
    const row = this.getRow('FirstExam', id);
    const allowed: Record<string, readonly string[]> = {
      DRAFT: ['SUBMITTED', 'CANCELLED'],
      SUBMITTED: ['APPROVED', 'CANCELLED'],
      APPROVED: [],
      CANCELLED: [],
    };
    this.assertTransition(row, allowed, status);
    this.clinicalRepository.updateStatus('FirstExam', id, status, context.now().toISOString());
    return { id, status };
  }

  treatmentStatus(id: string, status: string, context: AppContext): Record<string, unknown> {
    const row = this.getRow('Treatment', id);
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
    );
    return { id, status };
  }

  lockMedicalRecord(id: string, locked: boolean, context: AppContext): Record<string, unknown> {
    const row = this.getRow('MedicalRecord', id);
    const now = context.now().toISOString();
    this.clinicalRepository.lockMedicalRecord(id, locked, context.userId, now);
    return { id, isLocked: locked };
  }

  private getRow(table: string, id: string): Record<string, unknown> {
    const row = this.clinicalRepository.getRow(table, id);
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
    const items = this.db.prepare(
      'SELECT * FROM InventoryItem WHERE deletedAt IS NULL',
    ).all() as Array<Record<string, unknown>>;
    const nowDate = context.now();
    const now = nowDate.toISOString();
    const since = new Date(nowDate.getTime() - 90 * 86_400_000).toISOString();
    const leadTimeDays = 7;
    const safetyFactor = 1.5;
    const orderCost = 50;
    const holdingCostRate = 0.1;
    let generated = 0;
    for (const item of items) {
      const stock = Number(item.stock ?? 0);
      const minStock = Number(item.minStock ?? 0);
      const consumed = this.consumption(String(item.id), since);
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

  private consumption(itemId: string, since: string): number {
    const row = this.db.prepare(
      `SELECT COALESCE(SUM(
         CASE
           WHEN type = 'OUT' THEN quantity
           WHEN type = 'ADJUST' AND quantity < 0 THEN ABS(quantity)
           ELSE 0
         END
       ), 0) AS consumed
       FROM InventoryTransaction
       WHERE itemId = ? AND createdAt >= ? AND deletedAt IS NULL`,
    ).get(itemId, since) as { consumed: number };
    /* v8 ignore start -- the SQL aggregate always returns a numeric value. */
    return Number(row.consumed ?? 0);
    /* v8 ignore stop */
  }

  applyToPurchaseOrder(ids: string[], context: AppContext): Record<string, unknown> {
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 500) {
      throw new ValidationError('At least one suggestion is required and at most 500 can be applied');
    }
    const placeholders = ids.map(() => '?').join(',');
    const suggestions = this.db.prepare(
      `SELECT * FROM InventoryReplenishmentSuggestion
       WHERE id IN (${placeholders}) AND deletedAt IS NULL AND status IS NULL`,
    ).all(...ids) as Array<Record<string, unknown>>;
    if (!suggestions.length) throw new NotFoundError('No applicable suggestions found');
    const now = context.now().toISOString();
    const orderId = randomUUID();
    const orderNumber = `PO-${Date.now()}`;
    /* v8 ignore start -- suggestedQty is NOT NULL in the schema. */
    const totalAmount = suggestions.reduce((sum, suggestion) => sum + Math.max(0, Number(suggestion.suggestedQty ?? 0)), 0);
    /* v8 ignore stop */
    this.db.prepare(
      `INSERT INTO PurchaseOrder (
         id, clinicId, createdAt, updatedAt, deletedAt,
         number, supplierId, totalAmount, status
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 'PENDING')`,
    ).run(orderId, context.clinicId ?? null, now, now, orderNumber, suggestions[0].supplierId ?? null, totalAmount);
    for (const suggestion of suggestions) {
      this.db.prepare(
        `INSERT INTO PurchaseOrderItem (
           id, clinicId, createdAt, updatedAt, deletedAt,
           orderId, itemId, name, quantity, unitPrice, subtotal
         ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, 0, 0)`,
      ).run(randomUUID(), context.clinicId ?? null, now, now, orderId, suggestion.inventoryId, String(suggestion.inventoryId), Number(suggestion.suggestedQty));
      this.db.prepare(
        'UPDATE InventoryReplenishmentSuggestion SET status = ?, updatedAt = ? WHERE id = ?',
      ).run('APPLIED', now, suggestion.id);
    }
    return { orderId, orderNumber, items: suggestions.length };
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
    const now = context.now().toISOString();
    this.wechatRepository.markSent(messageId, now, now);
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
    return this.analyticsRepository.rfm();
  }

  churn(context: AppContext): Array<Record<string, unknown>> {
    return this.analyticsRepository.churn();
  }

  doctorAnomalies(context: AppContext): Array<Record<string, unknown>> {
    return this.analyticsRepository.doctorAnomalies();
  }
}

export class ChargeAssistantService {
  constructor(private readonly db: Database.Database) {}

  frequentItems(): Array<Record<string, unknown>> {
    return this.db.prepare(
      `SELECT category, name, COUNT(*) AS count
       FROM ChargeItem
       WHERE deletedAt IS NULL
       GROUP BY category, name
       ORDER BY count DESC
       LIMIT 50`,
    ).all() as Array<Record<string, unknown>>;
  }
}

export class PrintTemplateService {
  constructor(private readonly db: Database.Database) {}

  list(): Array<Record<string, unknown>> {
    return this.db.prepare(
      'SELECT * FROM PrintTemplate WHERE deletedAt IS NULL ORDER BY category, name',
    ).all() as Array<Record<string, unknown>>;
  }

  render(code: string, variables: Record<string, unknown>): string {
    const row = this.db.prepare('SELECT * FROM PrintTemplate WHERE code = ? AND deletedAt IS NULL').get(code) as
      | Record<string, unknown>
      | undefined;
    if (!row) throw new NotFoundError('Print template not found');
    return Object.entries(variables).reduce(
      (html, [key, value]) => html.replaceAll(`{{${key}}}`, escapeHtml(String(value ?? ''))),
      escapeHtml(String(row.content)),
    );
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
