import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { ConflictError, NotFoundError, ValidationError } from '../../../infrastructure/errors';
import { withIdempotency } from '../../../infrastructure/idempotency';
import { tenantAnd, tenantParams } from '../../../infrastructure/tenant';
import { SqliteProcessingOrderRepository } from '../../../infrastructure/repositories/core.repositories';
import type { AppContext } from '../../../../domain/contracts';
import type { ProcessingOrderRepository } from '../../ports';
import { assertDoctorExists, assertPatientExists } from '../common';

const PROCESSING_TRANSITIONS: Record<string, readonly string[]> = {
  DRAFT: ['SENT', 'CANCELLED'],
  SENT: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: ['RECEIVED'],
  RECEIVED: [],
  CANCELLED: [],
};

export class ProcessingOrderService {
  private readonly db: Database.Database;
  private readonly processingOrderRepository: ProcessingOrderRepository;

  constructor(db: Database.Database, processingOrderRepository?: ProcessingOrderRepository) {
    this.db = db;
    this.processingOrderRepository = processingOrderRepository ?? new SqliteProcessingOrderRepository(db);
  }

  async create(
    input: {
      patientId: string;
      doctorId?: string;
      factoryId?: string;
      number: string;
      shade?: string;
      teethNumbers?: string[];
      totalFee: number;
      expectedAt?: string;
      remark?: string;
      items: Array<{ name: string; spec?: string; quantity: number; unitPrice: number }>;
    },
    context: AppContext,
    requestId?: string,
  ): Promise<Record<string, unknown>> {
    return withIdempotency(this.db, {
      operation: 'processing-order.create',
      userId: context.userId,
      clinicId: context.clinicId,
      requestId: requestId ?? '',
    }, () => {
      assertPatientExists(this.db, input.patientId, context.clinicId);
      if (input.doctorId) assertDoctorExists(this.db, input.doctorId, context.clinicId);
      if (input.factoryId) {
        const factory = this.db.prepare(
          `SELECT id FROM ProcessingFactory WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
        ).get(input.factoryId, ...tenantParams(context.clinicId));
        if (!factory) throw new NotFoundError('Processing factory not found');
      }
      if (!input.number?.trim()) throw new ValidationError('Processing order number is required');
      if (!Number.isSafeInteger(Number(input.totalFee)) || Number(input.totalFee) < 0) {
        throw new ValidationError('Processing order total fee must be non-negative');
      }
      if (!Array.isArray(input.items) || input.items.length === 0 || input.items.length > 500) {
        throw new ValidationError('Processing order items must contain 1 to 500 entries');
      }
      const now = context.now().toISOString();
      const id = randomUUID();
      const items = input.items.map((item) => {
        const name = String(item.name ?? '').trim();
        const quantity = Number(item.quantity);
        const unitPrice = Number(item.unitPrice);
        if (!name || !Number.isSafeInteger(quantity) || quantity <= 0 || !Number.isSafeInteger(unitPrice) || unitPrice < 0) {
          throw new ValidationError('Each processing item requires a name, positive quantity, and non-negative unit price');
        }
        const rawSubtotal = unitPrice * quantity;
        if (!Number.isSafeInteger(rawSubtotal) || rawSubtotal > 1_000_000_000_000) {
          throw new ValidationError('Processing item subtotal exceeds the allowed amount');
        }
        const subtotal = Math.round(rawSubtotal);
        return {
          id: randomUUID(),
          clinicId: context.clinicId ?? null,
          orderId: id,
          name,
          spec: item.spec ?? null,
          quantity,
          unitPrice: Math.round(unitPrice),
          subtotal,
          status: 'DRAFT',
          createdAt: now,
          updatedAt: now,
        };
      });
      const totalFee = Math.round(Number(input.totalFee));
      if (totalFee > 1_000_000_000_000) throw new ValidationError('Processing order total fee exceeds the allowed amount');
      const itemTotal = items.reduce((sum, item) => sum + item.subtotal, 0);
      if (itemTotal !== totalFee) throw new ValidationError('Processing order total fee must equal the sum of item subtotals');
      this.db.transaction(() => {
        this.processingOrderRepository.createOrder({
          id,
          clinicId: context.clinicId ?? null,
          patientId: input.patientId,
          doctorId: input.doctorId ?? null,
          factoryId: input.factoryId ?? null,
          number: input.number.trim(),
          shade: input.shade ?? null,
          teethNumbers: Array.isArray(input.teethNumbers) ? input.teethNumbers : [],
          totalFee,
          status: 'DRAFT',
          settleStatus: 'UNSETTLED',
          expectedAt: input.expectedAt ?? null,
          remark: input.remark ?? null,
          createdAt: now,
          updatedAt: now,
        });
        for (const item of items) this.processingOrderRepository.createItem(item);
      })();
      return { id, number: input.number.trim(), status: 'DRAFT' };
    });
  }

  transition(id: string, status: string, context: AppContext): Record<string, unknown> {
    const row = this.processingOrderRepository.findById(id, context.clinicId);
    if (!row) throw new NotFoundError('Processing order not found');
    if (!PROCESSING_TRANSITIONS[row.status]?.includes(status)) {
      throw new ConflictError(`Cannot transition processing order from ${row.status} to ${status}`);
    }
    const changes = this.processingOrderRepository.updateStatus(
      id,
      status,
      context.now().toISOString(),
      context.clinicId,
      row.status,
    );
    if (changes === 0) {
      throw new ConflictError(`Cannot transition processing order from ${row.status} to ${status}`);
    }
    return { id, status };
  }
}
