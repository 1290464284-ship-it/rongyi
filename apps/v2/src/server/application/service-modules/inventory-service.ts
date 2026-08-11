// 库存服务（M-04：由 operations.ts 拆分）
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { NotFoundError, ValidationError } from '../../infrastructure/errors';
import { SqliteUnitOfWork } from '../../infrastructure/unit-of-work';
import { SqliteInventoryRepository } from '../../infrastructure/repositories/core.repositories';
import { withIdempotency } from '../../infrastructure/idempotency';
import { SystemClock } from '../../infrastructure/clock';
import { tenantWhere } from '../../infrastructure/tenant';
import type { AppContext, IUnitOfWork } from '../../../domain/contracts';
import type { InventoryRepository } from '../ports';

export class InventoryService {
  private readonly db: Database.Database;
  private readonly inventoryRepository: InventoryRepository;
  private readonly unitOfWork: IUnitOfWork;
  private readonly lockGuard?: (itemId: string, clinicId?: string | null) => void;

  constructor(
    db: Database.Database,
    inventoryRepository?: InventoryRepository,
    unitOfWork?: IUnitOfWork,
    lockGuard?: (itemId: string, clinicId?: string | null) => void,
  ) {
    this.db = db;
    this.inventoryRepository = inventoryRepository ?? new SqliteInventoryRepository(db);
    this.unitOfWork = unitOfWork ?? new SqliteUnitOfWork(db);
    this.lockGuard = lockGuard;
  }

  async createTransaction(
    input: { itemId: string; type: 'IN' | 'OUT' | 'ADJUST'; quantity: number; remark?: string },
    context: AppContext,
    requestId?: string,
  ): Promise<Record<string, unknown>> {
    return withIdempotency(this.db, {
      operation: 'inventory.transaction',
      resourceId: input.itemId,
      userId: context.userId,
      clinicId: context.clinicId,
      requestId: requestId ?? '',
    }, () => {
      if (!['IN', 'OUT', 'ADJUST'].includes(input.type)) {
        throw new ValidationError('Inventory transaction type must be IN, OUT, or ADJUST');
      }
      if (!Number.isSafeInteger(input.quantity) || input.quantity === 0) {
        throw new ValidationError('Inventory transaction quantity must be a non-zero number');
      }
      if (Math.abs(input.quantity) > 1_000_000_000) {
        throw new ValidationError('Inventory transaction quantity exceeds the allowed upper bound');
      }
      if (input.type !== 'ADJUST' && input.quantity < 0) {
        throw new ValidationError('Inventory transaction quantity must be positive');
      }
      this.lockGuard?.(input.itemId, context.clinicId);
      const item = this.inventoryRepository.findItem(input.itemId, context.clinicId);
      if (!item) throw new NotFoundError('Inventory item not found');
      const delta = input.type === 'IN' ? input.quantity : input.type === 'OUT' ? -input.quantity : input.quantity;
      const now = context.now().toISOString();
      const id = randomUUID();
      let before = 0;
      let after = 0;
      this.unitOfWork.run(() => {
        this.inventoryRepository.adjustStock(input.itemId, delta, now, context.clinicId);
        const afterRow = this.inventoryRepository.findItem(input.itemId, context.clinicId);
        if (!afterRow) throw new NotFoundError('Inventory item not found');
        after = Number(afterRow.stock);
        before = after - delta;
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

  lowStock(context: AppContext): { items: Array<Record<string, unknown>>; truncated: boolean } {
    const tenant = tenantWhere(context.clinicId);
    const total = Number((this.db.prepare(
      `SELECT COUNT(*) AS total FROM InventoryItem
       WHERE deletedAt IS NULL AND stock <= minStock${tenant.sql ? ` AND ${tenant.sql}` : ''}`,
    ).get(...tenant.params) as { total: number }).total);
    const items = this.inventoryRepository.lowStock(context.clinicId).map((row) => ({ ...row }));
    return { items, truncated: total > items.length };
  }

  expiringSoon(days = 30, context: AppContext): { items: Array<Record<string, unknown>>; truncated: boolean } {
    const clock = new SystemClock();
    const today = clock.clinicDate();
    const cutoff = clock.clinicDate(Date.now() + Math.max(1, days) * 86_400_000);
    const tenant = tenantWhere(context.clinicId);
    const params = [today, cutoff, ...tenant.params];
    const total = Number((this.db.prepare(
      `SELECT COUNT(*) AS total FROM InventoryItem
       WHERE deletedAt IS NULL
         AND expireDate IS NOT NULL
         AND expireDate >= ?
         AND expireDate <= ?
         ${tenant.sql ? `AND ${tenant.sql}` : ''}`,
    ).get(...params) as { total: number }).total);
    const items = this.db.prepare(
      `SELECT * FROM InventoryItem
       WHERE deletedAt IS NULL
         AND expireDate IS NOT NULL
         AND expireDate >= ?
         AND expireDate <= ?
         ${tenant.sql ? `AND ${tenant.sql}` : ''}
       ORDER BY expireDate ASC
       LIMIT 100`,
    ).all(...params) as Array<Record<string, unknown>>;
    return { items, truncated: total > items.length };
  }
}
