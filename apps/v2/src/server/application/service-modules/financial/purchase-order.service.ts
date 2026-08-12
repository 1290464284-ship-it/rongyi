import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { ConflictError, NotFoundError, ValidationError } from '../../../infrastructure/errors';
import { withIdempotency } from '../../../infrastructure/idempotency';
import { tenantAnd, tenantParams } from '../../../infrastructure/tenant';
import {
  SqliteInventoryRepository,
  SqlitePurchaseOrderRepository,
} from '../../../infrastructure/repositories/core.repositories';
import type { AppContext } from '../../../../domain/contracts';
import type { InventoryRepository, PurchaseOrderRepository } from '../../ports';
import { MAX_MONEY_CENTS } from '../common';

export class PurchaseOrderService {
  private readonly db: Database.Database;
  private readonly purchaseOrderRepository: PurchaseOrderRepository;
  private readonly inventoryRepository: InventoryRepository;
  private readonly lockGuard?: (itemId: string, clinicId?: string | null) => void;

  constructor(
    db: Database.Database,
    purchaseOrderRepository?: PurchaseOrderRepository,
    inventoryRepository?: InventoryRepository,
    lockGuard?: (itemId: string, clinicId?: string | null) => void,
  ) {
    this.db = db;
    this.purchaseOrderRepository = purchaseOrderRepository ?? new SqlitePurchaseOrderRepository(db);
    this.inventoryRepository = inventoryRepository ?? new SqliteInventoryRepository(db);
    this.lockGuard = lockGuard;
  }

  async create(
    input: {
      number: string;
      supplierId?: string;
      items: Array<{ itemId?: string; name: string; quantity: number; unitPrice: number }>;
    },
    context: AppContext,
    requestId?: string,
  ): Promise<Record<string, unknown>> {
    return withIdempotency(this.db, {
      operation: 'purchase-order.create',
      userId: context.userId,
      clinicId: context.clinicId,
      requestId: requestId ?? '',
    }, () => {
      if (!input.number?.trim()) throw new ValidationError('Purchase order number is required');
      if (!Array.isArray(input.items) || input.items.length === 0 || input.items.length > 500) {
        throw new ValidationError('Purchase order items must contain 1 to 500 entries');
      }
      if (input.supplierId) {
        const supplier = this.db.prepare(
          `SELECT id FROM Supplier WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
        ).get(input.supplierId, ...tenantParams(context.clinicId));
        if (!supplier) throw new NotFoundError('Supplier not found');
      }
      const now = context.now().toISOString();
      const id = randomUUID();
      let totalAmount = 0;
      const items = input.items.map((item) => {
        const name = String(item.name ?? '').trim();
        const quantity = Number(item.quantity);
        const unitPrice = Number(item.unitPrice);
        if (!name || !Number.isSafeInteger(quantity) || quantity <= 0 || !Number.isSafeInteger(unitPrice) || unitPrice < 0) {
          throw new ValidationError('Each purchase item requires a name, positive quantity, and non-negative unit price');
        }
        if (item.itemId && !this.inventoryRepository.findItem(item.itemId, context.clinicId)) {
          throw new NotFoundError(`Inventory item not found: ${item.itemId}`);
        }
        const rawSubtotal = unitPrice * quantity;
        if (!Number.isSafeInteger(rawSubtotal) || rawSubtotal > MAX_MONEY_CENTS) {
          throw new ValidationError('Purchase item subtotal exceeds the allowed amount');
        }
        const subtotal = Math.round(rawSubtotal);
        totalAmount += subtotal;
        if (totalAmount > MAX_MONEY_CENTS) {
          throw new ValidationError('Purchase order total exceeds the allowed amount');
        }
        return {
          id: randomUUID(),
          clinicId: context.clinicId ?? null,
          orderId: id,
          itemId: item.itemId ?? null,
          name,
          quantity,
          unitPrice: Math.round(unitPrice),
          subtotal,
          createdAt: now,
          updatedAt: now,
        };
      });
      this.db.transaction(() => {
        this.purchaseOrderRepository.createOrder({
          id,
          clinicId: context.clinicId ?? null,
          number: input.number.trim(),
          supplierId: input.supplierId ?? null,
          totalAmount,
          status: 'PENDING',
          reviewStatus: 'PENDING',
          createdAt: now,
          updatedAt: now,
        });
        for (const item of items) this.purchaseOrderRepository.createItem(item);
      })();
      return { id, number: input.number.trim(), status: 'PENDING', totalAmount };
    });
  }

  async receive(orderId: string, context: AppContext): Promise<Record<string, unknown>> {
    const order = this.purchaseOrderRepository.findById(orderId, context.clinicId);
    if (!order) throw new NotFoundError('Purchase order not found');
    if (order.status !== 'PENDING') throw new ConflictError('Purchase order is not pending');
    if (order.reviewStatus && order.reviewStatus !== 'APPROVED') {
      throw new ConflictError('Purchase order must be approved before receiving');
    }
    const now = context.now().toISOString();
    const items = this.purchaseOrderRepository.itemsByOrder(orderId, context.clinicId);
    const receivedItems: Array<Record<string, unknown>> = [];
    const run = this.db.transaction(() => {
      this.purchaseOrderRepository.markReceived(orderId, now, now, context.clinicId);
      const missing: string[] = [];
      for (const item of items) {
        if (!item.itemId) {
          receivedItems.push({
            itemId: null,
            name: item.name,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            subtotal: item.subtotal,
            beforeStock: null,
            afterStock: null,
          });
          continue;
        }
        const current = this.inventoryRepository.findItem(item.itemId, context.clinicId);
        if (!current) {
          missing.push(item.name);
          continue;
        }
        this.lockGuard?.(item.itemId, context.clinicId);
        this.inventoryRepository.adjustStock(item.itemId, Number(item.quantity), now, context.clinicId);
        const afterRow = this.inventoryRepository.findItem(item.itemId, context.clinicId);
        const after = Number(afterRow?.stock ?? Number(current.stock) + Number(item.quantity));
        const before = after - Number(item.quantity);
        receivedItems.push({
          itemId: item.itemId,
          name: item.name,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          subtotal: item.subtotal,
          beforeStock: before,
          afterStock: after,
        });
        this.inventoryRepository.createTransaction({
          id: randomUUID(),
          clinicId: context.clinicId ?? null,
          itemId: item.itemId,
          type: 'IN',
          quantity: Number(item.quantity),
          beforeStock: before,
          afterStock: after,
          operatorId: context.userId,
          createdAt: now,
          updatedAt: now,
        });
      }
      if (missing.length > 0) {
        throw new ConflictError(`Purchase order contains missing inventory items: ${missing.join(', ')}`);
      }
    });
    run();
    return { id: orderId, number: order.number, status: 'RECEIVED', receivedAt: now, items: receivedItems };
  }

  items(orderId: string, context: AppContext): Array<Record<string, unknown>> {
    const order = this.purchaseOrderRepository.findById(orderId, context.clinicId);
    if (!order) throw new NotFoundError('Purchase order not found');
    return this.purchaseOrderRepository.itemsByOrder(orderId, context.clinicId).map((item) => ({ ...item }));
  }
}
