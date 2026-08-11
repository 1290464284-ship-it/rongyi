import type Database from 'better-sqlite3';
import { NotFoundError, ValidationError } from '../../infrastructure/errors';
import { tenantAnd, tenantParams } from '../../infrastructure/tenant';
import { trackResourceWrite } from '../../infrastructure/write-tracking';
import type { AppContext } from '../../../domain/contracts';

/**
 * 高值耗材标记：库存物料可标记为「高值耗材」并强制关联一个收费标准，
 * 之后该物料只能通过其关联的收费标准划价使用（见 ChargeTreeService.quickCharge）。
 */
export class HighValueService {
  constructor(private readonly db: Database.Database) {}

  mark(
    itemId: string,
    input: { isHighValue: boolean; catalogId?: string },
    context: AppContext,
  ): { itemId: string; isHighValue: boolean; catalogId: string | null } {
    const now = context.now().toISOString();

    const item = this.db.prepare(
      `SELECT id FROM InventoryItem WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).get(itemId, ...tenantParams(context.clinicId));
    if (!item) throw new NotFoundError('Inventory item not found');

    const isHighValue = Boolean(input.isHighValue);
    let catalogId: string | null = null;
    if (isHighValue) {
      if (!input.catalogId) throw new ValidationError('高值耗材必须关联收费标准');
      const catalog = this.db.prepare(
        `SELECT id FROM TreatmentCatalog WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
      ).get(input.catalogId, ...tenantParams(context.clinicId));
      if (!catalog) throw new ValidationError('关联的收费标准不存在');
      catalogId = input.catalogId;
    } else if (input.catalogId != null && input.catalogId !== '') {
      catalogId = input.catalogId;
    }

    this.db.prepare(
      `UPDATE InventoryItem SET isHighValue = ?, catalogId = ?, updatedAt = ? WHERE id = ?`,
    ).run(isHighValue ? 1 : 0, catalogId, now, itemId);
    trackResourceWrite(this.db, { tableName: 'InventoryItem', recordId: itemId, operation: 'UPDATE', clinicId: context.clinicId, searchResource: null });

    return { itemId, isHighValue, catalogId };
  }
}
