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
      REGISTERED: ['TRIAGED', 'STARTED', 'CANCELLED'],
      TRIAGED: ['STARTED', 'CANCELLED'],
      STARTED: ['COMPLETED', 'CANCELLED'],
      COMPLETED: [],
      CANCELLED: [],
    };
    this.assertTransition(row, allowed, status);
    const now = context.now().toISOString();
    let visitId = row.visitId ? String(row.visitId) : null;
    if ((status === 'STARTED' || status === 'COMPLETED') && !visitId) {
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
      REGISTERED: ['IN_PROGRESS', 'CANCELLED'],
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
      PLANNED: ['APPROVED', 'IN_PROGRESS', 'CANCELLED'],
      APPROVED: ['IN_PROGRESS', 'CANCELLED'],
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
    const now = context.now().toISOString();
    let generated = 0;
    for (const item of items) {
      const stock = Number(item.stock ?? 0);
      const minStock = Number(item.minStock ?? 0);
      const avgDaily = Math.max(0.01, minStock / 30);
      const rop = Math.ceil(avgDaily * 7 + avgDaily * 2);
      if (stock <= rop) {
        const suggestedQty = Math.max(1, Math.ceil(rop - stock + 1));
        const snapshot = {
          avgDaily,
          leadTimeDays: 7,
          safetyFactor: 1.5,
          safetyStock: avgDaily * 2,
          rop,
          stockAtCalculation: stock,
          minStockAtCalculation: minStock,
          reason: 'ROP_BELOW_MIN',
        };
        this.db.prepare(
          `INSERT INTO InventoryReplenishmentSuggestion (
             id, clinicId, inventoryId, avgDailyConsumption, leadTimeDays,
             safetyFactor, rop, suggestedQty, calculationSnapshotJson,
             createdAt, updatedAt, deletedAt
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        ).run(
          randomUUID(), context.clinicId ?? null, item.id, avgDaily, 7, 1.5, rop, suggestedQty,
          JSON.stringify(snapshot), now, now,
        );
        generated += 1;
      }
    }
    return { generated };
  }

  applyToPurchaseOrder(ids: string[], context: AppContext): Record<string, unknown> {
    if (!ids.length) throw new ValidationError('At least one suggestion is required');
    const placeholders = ids.map(() => '?').join(',');
    const suggestions = this.db.prepare(
      `SELECT * FROM InventoryReplenishmentSuggestion
       WHERE id IN (${placeholders}) AND deletedAt IS NULL AND status IS NULL`,
    ).all(...ids) as Array<Record<string, unknown>>;
    if (!suggestions.length) throw new NotFoundError('No applicable suggestions found');
    const now = context.now().toISOString();
    const orderId = randomUUID();
    const orderNumber = `PO-${Date.now()}`;
    const totalAmount = suggestions.reduce((sum, suggestion) => sum + Math.max(0, Number(suggestion.suggestedQty ?? 0)), 0);
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
      (html, [key, value]) => html.replaceAll(`{{${key}}}`, String(value ?? '')),
      String(row.content),
    );
  }
}
