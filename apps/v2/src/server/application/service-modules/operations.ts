import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { ConflictError, NotFoundError, ValidationError } from '../../infrastructure/errors';
import { SqliteUnitOfWork } from '../../infrastructure/unit-of-work';
import {
  SqliteFollowUpRepository,
  SqliteInventoryRepository,
} from '../../infrastructure/repositories/core.repositories';
import { withIdempotency } from '../../infrastructure/idempotency';
import { SystemClock } from '../../infrastructure/clock';
import { tenantAnd, tenantParams } from '../../infrastructure/tenant';
import type { AppContext, IUnitOfWork } from '../../../domain/contracts';
import type {
  FollowUpRepository,
  InventoryRepository,
} from '../ports';

export class InventoryService {
  private readonly db: Database.Database;
  private readonly inventoryRepository: InventoryRepository;
  private readonly unitOfWork: IUnitOfWork;

  constructor(db: Database.Database, inventoryRepository?: InventoryRepository, unitOfWork?: IUnitOfWork) {
    this.db = db;
    this.inventoryRepository = inventoryRepository ?? new SqliteInventoryRepository(db);
    this.unitOfWork = unitOfWork ?? new SqliteUnitOfWork(db);
  }

  async createTransaction(
    input: { itemId: string; type: 'IN' | 'OUT' | 'ADJUST'; quantity: number; remark?: string },
    context: AppContext,
    requestId?: string,
  ): Promise<Record<string, unknown>> {
    return withIdempotency(this.db, {
      operation: 'inventory.transaction',
      userId: context.userId,
      clinicId: context.clinicId,
      requestId: requestId ?? '',
    }, () => {
      if (!['IN', 'OUT', 'ADJUST'].includes(input.type)) {
        throw new ValidationError('Inventory transaction type must be IN, OUT, or ADJUST');
      }
      if (!Number.isFinite(input.quantity) || input.quantity === 0) {
        throw new ValidationError('Inventory transaction quantity must be a non-zero number');
      }
      if (input.type !== 'ADJUST' && input.quantity < 0) {
        throw new ValidationError('Inventory transaction quantity must be positive');
      }
      const item = this.inventoryRepository.findItem(input.itemId, context.clinicId);
      if (!item) throw new NotFoundError('Inventory item not found');
      const before = Number(item.stock);
      const delta = input.type === 'IN' ? input.quantity : input.type === 'OUT' ? -input.quantity : input.quantity;
      const after = before + delta;
      if (after < 0) throw new ConflictError('Insufficient stock');
      const now = context.now().toISOString();
      const id = randomUUID();
      this.unitOfWork.run(() => {
        this.inventoryRepository.updateStock(input.itemId, after, now, context.clinicId);
        this.inventoryRepository.createTransaction({
          id,
          clinicId: context.clinicId ?? null,
          itemId: input.itemId,
          type: input.type,
          quantity: input.quantity,
          beforeStock: before,
          afterStock: after,
          operatorId: context.userId,
          remark: input.remark ?? null,
          createdAt: now,
          updatedAt: now,
        });
      });
      return { id, beforeStock: before, afterStock: after };
    });
  }

  lowStock(context: AppContext): Array<Record<string, unknown>> {
    return this.inventoryRepository.lowStock(context.clinicId).map((row) => ({ ...row }));
  }

  expiringSoon(days = 30, context: AppContext): Array<Record<string, unknown>> {
    const clock = new SystemClock();
    const today = clock.clinicDate();
    const cutoff = clock.clinicDate(Date.now() + Math.max(1, days) * 86_400_000);
    const params = context.clinicId ? [today, cutoff, context.clinicId] : [today, cutoff];
    return this.db.prepare(
      `SELECT * FROM InventoryItem
       WHERE deletedAt IS NULL
         AND expireDate IS NOT NULL
         AND expireDate >= ?
         AND expireDate <= ?
         ${tenantAnd(context.clinicId)}
       ORDER BY expireDate ASC
       LIMIT 100`,
    ).all(...params) as Array<Record<string, unknown>>;
  }
}

export class FollowUpService {
  private readonly db: Database.Database;
  private readonly followUpRepository: FollowUpRepository;

  constructor(db: Database.Database, followUpRepository?: FollowUpRepository) {
    this.db = db;
    this.followUpRepository = followUpRepository ?? new SqliteFollowUpRepository(db);
  }

  reminders(context: AppContext): Array<Record<string, unknown>> {
    return this.followUpRepository.reminders(context.clinicId);
  }

  complete(id: string, context: AppContext): Record<string, unknown> {
    const row = this.db.prepare(
      `SELECT id, status FROM FollowUp WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).get(id, ...tenantParams(context.clinicId)) as { id: string; status: string } | undefined;
    if (!row) throw new NotFoundError('Follow-up not found');
    if (!['PENDING', 'IN_PROGRESS'].includes(row.status)) {
      throw new ConflictError('Follow-up cannot be completed from current status');
    }
    const now = context.now().toISOString();
    const changes = this.followUpRepository.complete(id, now, now, context.clinicId);
    if (changes === 0) throw new ConflictError('Follow-up cannot be completed');
    return { id, status: 'COMPLETED', completedAt: now };
  }

  async batchGenerate(limit = 50, context: AppContext): Promise<{ processed: number; generated: number }> {
    const maxLimit = Math.min(200, Math.max(1, Math.floor(Number(limit) || 50)));
    const rowParams = context.clinicId ? [context.clinicId, maxLimit] : [maxLimit];
    const rows = this.db.prepare(
      `SELECT DISTINCT V.patientId,
              COALESCE(T.completedDate, V.createdAt) AS completedAt
       FROM Visit V
       INNER JOIN Treatment T ON T.visitId = V.id
       WHERE V.status = 'COMPLETED'
         AND T.status = 'COMPLETED'
         AND V.deletedAt IS NULL
         AND T.deletedAt IS NULL
         ${tenantAnd(context.clinicId, 'V.clinicId')}
       LIMIT ?`,
    ).all(...rowParams) as Array<{ patientId: string; completedAt: string }>;
    const templateParams = context.clinicId ? [context.clinicId] : [];
    const templates = this.db.prepare(
      `SELECT id, name, daysAfter, content, assigneeId
       FROM FollowUpTemplate
       WHERE isEnabled = 1 AND deletedAt IS NULL
         ${tenantAnd(context.clinicId)}
       ORDER BY daysAfter ASC
       LIMIT 20`,
    ).all(...templateParams) as Array<{ id: string; name: string; daysAfter: number; content: string | null; assigneeId: string | null }>;
    let generated = 0;
    const now = context.now().toISOString();
    const alreadyExists = (patientId: string, planDate: string, templateId: string | null): boolean => {
      const templateClause = templateId ? 'templateId = ?' : 'templateId IS NULL';
      const params = [patientId, planDate, ...(templateId ? [templateId] : []), ...tenantParams(context.clinicId)];
      return Boolean(this.db.prepare(
        `SELECT 1 FROM FollowUp
         WHERE patientId = ? AND planDate = ? AND ${templateClause}
           AND status IN ('PENDING', 'IN_PROGRESS')
           AND deletedAt IS NULL${tenantAnd(context.clinicId)}
         LIMIT 1`,
      ).get(...params));
    };
    const run = this.db.transaction(() => {
      for (const row of rows) {
        if (templates.length === 0) {
          const planDate = new SystemClock().clinicDate(Date.now() + 14 * 86_400_000);
          if (alreadyExists(row.patientId, planDate, null)) continue;
          this.followUpRepository.insert({
            id: randomUUID(),
            clinicId: context.clinicId ?? null,
            createdAt: now,
            updatedAt: now,
            patientId: row.patientId,
            planDate,
            content: 'Scheduled follow-up',
            status: 'PENDING',
          });
          generated += 1;
          continue;
        }
        /* v8 ignore start -- the query returns a non-null COALESCE value. */
        const completedAt = new Date(String(row.completedAt ?? Date.now())).getTime();
        /* v8 ignore stop */
        if (!Number.isFinite(completedAt)) throw new ValidationError('Completed date is invalid for follow-up generation');
        for (const template of templates) {
          const planDate = new SystemClock().clinicDate(completedAt + Number(template.daysAfter ?? 1) * 86_400_000);
          if (alreadyExists(row.patientId, planDate, template.id)) continue;
          this.followUpRepository.insert({
            id: randomUUID(),
            clinicId: context.clinicId ?? null,
            createdAt: now,
            updatedAt: now,
            patientId: row.patientId,
            planDate,
            content: template.content ?? template.name,
            status: 'PENDING',
            assigneeId: template.assigneeId ?? null,
            templateId: template.id,
          });
          generated += 1;
        }
      }
    });
    run();
    return { processed: rows.length, generated };
  }

  adherence(context: AppContext): { total: number; onTime: number; rate: number } {
    const params = tenantParams(context.clinicId);
    const row = this.db.prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN substr(completedAt, 1, 10) <= planDate THEN 1 ELSE 0 END), 0) AS onTime
       FROM FollowUp
       WHERE status = 'COMPLETED' AND planDate IS NOT NULL AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).get(...params) as { total: number; onTime: number };
    /* v8 ignore start -- the aggregate query always returns numeric columns. */
    const total = Number(row.total ?? 0);
    const onTime = Number(row.onTime ?? 0);
    /* v8 ignore stop */
    return { total, onTime, rate: total === 0 ? 0 : Math.round((onTime / total) * 100) };
  }
}
