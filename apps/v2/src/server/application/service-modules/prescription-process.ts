/**
 * 处方处理：一张处方同时生成「划价单 + 领药单」。
 *
 * - 划价单：Charge（UNPAID）+ ChargeItem（DRUG/MATERIAL），金额取处方明细 price * quantity；
 * - 领药单：Dispense（PENDING）+ DispenseItem，按库存档案（先 drugId、再 name）匹配；
 * - 本服务只建单，不做库存扣减（扣减由既有发药流程 DispenseService.dispense 完成，避免双重扣减）；
 * - 已处理的处方（status='PROCESSED'）不可重复处理。
 */
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { ConflictError, NotFoundError, ValidationError } from '../../infrastructure/errors';
import { touchSearchIndex } from '../../infrastructure/search-index';
import { tenantAnd, tenantParams } from '../../infrastructure/tenant';
import { generateDocumentNumber } from './common';
import type { AppContext } from '../../../domain/contracts';

export interface PrescriptionProcessInput {
  itemIds?: string[];
}

interface PrescriptionRow {
  id: string;
  patientId: string;
  visitId: string | null;
  doctorId: string | null;
  remark: string | null;
  status: string | null;
  processedAt: string | null;
  chargeId: string | null;
  dispenseId: string | null;
}

interface PrescriptionItemRow {
  id: string;
  prescriptionId: string;
  drugId: string | null;
  name: string;
  specification: string | null;
  quantity: number;
  price: number;
}

interface InventoryItemRow {
  id: string;
  name: string;
  spec: string | null;
}

export class PrescriptionProcessService {
  constructor(private readonly db: Database.Database) {}

  /**
   * 处方处理：生成一张 UNPAID 划价单 + 一张 PENDING 领药单，并标记处方 PROCESSED。
   * itemIds 缺省 = 全部未删明细；选中明细必须都属于该处方。
   */
  process(prescriptionId: string, input: PrescriptionProcessInput, context: AppContext): Record<string, unknown> {
    const clinicId = context.clinicId;
    const prescription = this.db.prepare(
      `SELECT id, patientId, visitId, doctorId, remark, status, processedAt, chargeId, dispenseId
       FROM Prescription WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`,
    ).get(prescriptionId, ...tenantParams(clinicId)) as PrescriptionRow | undefined;
    if (!prescription) throw new NotFoundError('处方不存在');
    if (prescription.status === 'PROCESSED') throw new ConflictError('处方已处理');

    const allItems = this.db.prepare(
      `SELECT id, prescriptionId, drugId, name, specification, quantity, price
       FROM PrescriptionItem
       WHERE prescriptionId = ? AND deletedAt IS NULL${tenantAnd(clinicId)}
       ORDER BY createdAt ASC`,
    ).all(prescriptionId, ...tenantParams(clinicId)) as PrescriptionItemRow[];

    let items: PrescriptionItemRow[];
    if (input.itemIds === undefined) {
      items = allItems;
    } else {
      if (!Array.isArray(input.itemIds)) throw new ValidationError('itemIds 格式无效');
      const selected = new Set(input.itemIds.map(String).filter((id) => id !== ''));
      for (const selectedId of selected) {
        if (!allItems.some((item) => item.id === selectedId)) {
          throw new NotFoundError('Prescription item not found');
        }
      }
      items = allItems.filter((item) => selected.has(item.id));
    }
    if (items.length === 0) throw new ValidationError('处方没有可处理的药品明细');

    // 明细 -> 领药库存档案：先按 drugId 匹配，再按 name 精确匹配
    const dispensePlans = items.map((item) => {
      const inventory = this.resolveInventoryItem(item, clinicId);
      return {
        itemId: inventory.id,
        name: inventory.name,
        spec: inventory.spec !== null && inventory.spec !== '' ? inventory.spec : item.specification,
        quantity: item.quantity,
        subtotal: Math.round(item.price * item.quantity),
      };
    });

    const now = context.now().toISOString();
    const chargeId = randomUUID();
    const dispenseId = randomUUID();
    const chargeNumber = generateDocumentNumber('CHG');
    const dispenseNumber = generateDocumentNumber('DSP');
    const chargeTotalAmount = dispensePlans.reduce((sum, plan) => sum + plan.subtotal, 0);

    const run = this.db.transaction(() => {
      this.db.prepare(
        `INSERT INTO Charge (
           id, clinicId, createdAt, updatedAt, deletedAt,
           patientId, visitId, doctorId, number, totalAmount,
           paidAmount, refundedAmount, discount, status, payMethod,
           payMethodName, paidAt, memberCardId, remark, discountPlanSnapshotJson
         ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 0, 0, 0, 'UNPAID', NULL, NULL, NULL, NULL, '处方划价', '{}')`,
      ).run(
        chargeId,
        clinicId ?? null,
        now,
        now,
        prescription.patientId,
        prescription.visitId ?? null,
        prescription.doctorId ?? null,
        chargeNumber,
        chargeTotalAmount,
      );
      // 直写搜索索引：Charge 行创建后同步其可检索内容（含患者姓名）。
      touchSearchIndex(this.db, 'Charge', chargeId, 'INSERT');

      const insertChargeItem = this.db.prepare(
        `INSERT INTO ChargeItem (
           id, chargeId, treatmentId, name, category, price, quantity, teethNumbers, subtotal, costType,
           clinicId, createdAt, updatedAt, deletedAt
         ) VALUES (?, ?, NULL, ?, 'DRUG', ?, ?, '[]', ?, 'MATERIAL', ?, ?, ?, NULL)`,
      );
      for (const item of items) {
        insertChargeItem.run(
          randomUUID(),
          chargeId,
          item.name,
          item.price,
          item.quantity,
          Math.round(item.price * item.quantity),
          clinicId ?? null,
          now,
          now,
        );
      }

      this.db.prepare(
        `INSERT INTO Dispense (
           id, number, chargeId, prescriptionId, patientId, doctorId, pharmacistId,
           status, dispensedAt, returnedAt, note, clinicId, createdAt, updatedAt, deletedAt
         ) VALUES (?, ?, ?, ?, ?, ?, NULL, 'PENDING', NULL, NULL, ?, ?, ?, ?, NULL)`,
      ).run(
        dispenseId,
        dispenseNumber,
        chargeId,
        prescriptionId,
        prescription.patientId,
        prescription.doctorId ?? null,
        prescription.remark ?? null,
        clinicId ?? null,
        now,
        now,
      );

      const insertDispenseItem = this.db.prepare(
        `INSERT INTO DispenseItem (
           id, dispenseId, itemId, batchId, name, spec, quantity, returnedQuantity,
           clinicId, createdAt, updatedAt, deletedAt
         ) VALUES (?, ?, ?, NULL, ?, ?, ?, 0, ?, ?, ?, NULL)`,
      );
      for (const plan of dispensePlans) {
        insertDispenseItem.run(
          randomUUID(),
          dispenseId,
          plan.itemId,
          plan.name,
          plan.spec ?? null,
          plan.quantity,
          clinicId ?? null,
          now,
          now,
        );
      }

      const updated = this.db.prepare(
        `UPDATE Prescription
         SET status = 'PROCESSED', processedAt = ?, chargeId = ?, dispenseId = ?, updatedAt = ?
         WHERE id = ? AND deletedAt IS NULL AND (status IS NULL OR status != 'PROCESSED')${tenantAnd(clinicId)}`,
      ).run(now, chargeId, dispenseId, now, prescriptionId, ...tenantParams(clinicId));
      if (updated.changes === 0) throw new ConflictError('处方已处理');
    });
    run();

    return {
      prescriptionId,
      status: 'PROCESSED',
      chargeId,
      chargeNumber,
      chargeTotalAmount,
      dispenseId,
      dispenseNumber,
      itemCount: items.length,
    };
  }

  /** 处方处理状态（供前端刷新用）；不存在抛 NotFound。 */
  status(prescriptionId: string, context: AppContext): Record<string, unknown> {
    const row = this.db.prepare(
      `SELECT id, status, processedAt, chargeId, dispenseId
       FROM Prescription WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).get(prescriptionId, ...tenantParams(context.clinicId)) as PrescriptionRow | undefined;
    if (!row) throw new NotFoundError('处方不存在');
    return {
      id: row.id,
      status: row.status ?? 'DRAFT',
      processedAt: row.processedAt,
      chargeId: row.chargeId,
      dispenseId: row.dispenseId,
    };
  }

  /** 先按 drugId 匹配库存档案，再按 name 精确匹配；均未命中抛 ValidationError。 */
  private resolveInventoryItem(item: PrescriptionItemRow, clinicId: string | null): InventoryItemRow {
    if (item.drugId !== null && item.drugId !== '') {
      const byId = this.db.prepare(
        `SELECT id, name, spec FROM InventoryItem
         WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`,
      ).get(item.drugId, ...tenantParams(clinicId)) as InventoryItemRow | undefined;
      if (byId) return byId;
    }
    const byName = this.db.prepare(
      `SELECT id, name, spec FROM InventoryItem
       WHERE name = ? AND deletedAt IS NULL${tenantAnd(clinicId)}
       ORDER BY createdAt ASC LIMIT 1`,
    ).get(item.name, ...tenantParams(clinicId)) as InventoryItemRow | undefined;
    if (byName) return byName;
    throw new ValidationError(`库存中未找到药品「${item.name}」，请先建立库存档案`);
  }
}
