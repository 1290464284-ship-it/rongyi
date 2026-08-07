import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { ConflictError, NotFoundError, ValidationError } from '../../infrastructure/errors';
import { touchSearchIndex } from '../../infrastructure/search-index';
import { tenantAnd, tenantParams } from '../../infrastructure/tenant';
import { generateDocumentNumber } from './common';
import type { AppContext } from '../../../domain/contracts';

export interface ChargeTreeNode {
  id: string;
  code: string;
  name: string;
  category: string;
  price: number;
  costType: 'SERVICE' | 'MATERIAL' | null;
  anesthesia: boolean;
  businessCategory: 'SERVICE' | 'DRUG' | 'MATERIAL' | 'OTHER' | null;
  parentId: string | null;
  children: ChargeTreeNode[];
}

/**
 * 收费标准二级分类树 + 快捷划价。
 *
 * 收费标准词典的增删改走既有资源 CRUD（/resources/treatmentCatalogs），
 * 本服务提供「二级分类树」查询与「按收费标准一键划价」（quickCharge）。
 */
export class ChargeTreeService {
  constructor(private readonly db: Database.Database) {}

  tree(context: AppContext): { items: ChargeTreeNode[] } {
    const rows = this.db.prepare(
      `SELECT id, code, name, category, price, costType, anesthesia, businessCategory, parentId
       FROM TreatmentCatalog
       WHERE deletedAt IS NULL${tenantAnd(context.clinicId)}
       ORDER BY code`,
    ).all(...tenantParams(context.clinicId)) as Array<Record<string, unknown>>;

    const nodes = new Map<string, ChargeTreeNode>();
    for (const row of rows) {
      const parentId = row.parentId == null || row.parentId === '' ? null : String(row.parentId);
      nodes.set(String(row.id), {
        id: String(row.id),
        code: String(row.code),
        name: String(row.name),
        category: String(row.category),
        price: Number(row.price),
        costType: (row.costType as 'SERVICE' | 'MATERIAL' | null) ?? null,
        anesthesia: Boolean(row.anesthesia),
        businessCategory: (row.businessCategory as 'SERVICE' | 'DRUG' | 'MATERIAL' | 'OTHER' | null) ?? null,
        parentId,
        children: [],
      });
    }

    const items: ChargeTreeNode[] = [];
    for (const node of nodes.values()) {
      if (node.parentId && nodes.has(node.parentId)) {
        nodes.get(node.parentId)!.children.push(node);
      } else {
        items.push(node);
      }
    }
    for (const node of nodes.values()) {
      node.children.sort((a, b) => a.code.localeCompare(b.code));
    }
    return { items };
  }

  /**
   * 按收费标准快捷划价：校验收费标准、患者（、可选库存物料），
   * 事务内落 Charge + ChargeItem 各一条，返回新建收费单摘要。
   *
   * 高值耗材（isHighValue=1）必须关联本收费标准才能使用，否则拒绝，
   * 体现「高值耗材需匹配收费标准才能用到患者名下」。
   */
  quickCharge(
    catalogId: string,
    input: {
      patientId: string;
      visitId?: string;
      doctorId?: string;
      quantity?: number;
      itemId?: string;
      remark?: string;
    },
    context: AppContext,
  ): { chargeId: string; number: string; totalAmount: number; catalogId: string; itemId: string | null } {
    const now = context.now().toISOString();

    const catalog = this.db.prepare(
      `SELECT id, name, category, price, costType
       FROM TreatmentCatalog
       WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).get(catalogId, ...tenantParams(context.clinicId)) as
      | { id: string; name: string; category: string; price: number; costType: string | null }
      | undefined;
    if (!catalog) throw new NotFoundError('Treatment catalog not found');

    const quantity = input.quantity ?? 1;
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      throw new ValidationError('Quantity must be a positive integer');
    }

    const patient = this.db.prepare(
      `SELECT id FROM Patient WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).get(input.patientId, ...tenantParams(context.clinicId));
    if (!patient) throw new NotFoundError('Patient not found');

    let itemId: string | null = null;
    if (input.itemId) {
      const item = this.db.prepare(
        `SELECT id, isHighValue, catalogId FROM InventoryItem
         WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
      ).get(input.itemId, ...tenantParams(context.clinicId)) as
        | { id: string; isHighValue: number | null; catalogId: string | null }
        | undefined;
      if (!item) throw new NotFoundError('Inventory item not found');
      if (Number(item.isHighValue) === 1 && String(item.catalogId ?? '') !== catalogId) {
        throw new ConflictError('高值耗材必须使用其关联的收费标准');
      }
      itemId = input.itemId;
    }

    const totalAmount = Number(catalog.price) * quantity;
    const chargeId = randomUUID();
    const number = generateDocumentNumber('CHG');
    const remark = input.remark ?? `快捷划价：${catalog.name}`;

    const chargeRun = this.db.transaction(() => {
      this.db.prepare(
        `INSERT INTO Charge (
           id, clinicId, createdAt, updatedAt, deletedAt,
           patientId, visitId, doctorId, number, totalAmount,
           paidAmount, refundedAmount, discount, status, remark
         ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 0, 0, 0, 'UNPAID', ?)`,
      ).run(
        chargeId,
        context.clinicId ?? null,
        now,
        now,
        input.patientId,
        input.visitId ?? null,
        input.doctorId ?? null,
        number,
        totalAmount,
        remark,
      );
      this.db.prepare(
        `INSERT INTO ChargeItem (
           id, chargeId, name, category, price, quantity, teethNumbers, subtotal,
           costType, treatmentId, clinicId, createdAt, updatedAt, deletedAt
         ) VALUES (?, ?, ?, ?, ?, ?, '[]', ?, ?, NULL, ?, ?, ?, NULL)`,
      ).run(
        randomUUID(),
        chargeId,
        catalog.name,
        catalog.category,
        Number(catalog.price),
        quantity,
        totalAmount,
        catalog.costType ?? 'SERVICE',
        context.clinicId ?? null,
        now,
        now,
      );
      // 直写搜索索引：Charge 行创建后同步其可检索内容（含患者姓名）。
      touchSearchIndex(this.db, 'Charge', chargeId, 'INSERT');
    });
    chargeRun();

    return { chargeId, number, totalAmount, catalogId, itemId };
  }
}
