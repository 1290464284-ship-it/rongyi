import type Database from 'better-sqlite3';
import { NotFoundError, ValidationError } from '../../infrastructure/errors';
import { tenantAnd, tenantParams } from '../../infrastructure/tenant';
import type { AppContext } from '../../../domain/contracts';
import { ChargeService } from './financial';

export interface ChargeComboItemRow {
  id: string;
  comboId: string;
  catalogId: string | null;
  name: string;
  category: string;
  price: number;
  quantity: number;
  costType: 'SERVICE' | 'MATERIAL' | null;
}

/**
 * 收费组合：查询 + 一键划价。
 *
 * 组合管理（增删改）走既有资源 CRUD（/resources/chargeCombos、/resources/chargeComboItems），
 * 本服务只负责「查询」与「一键调出划价」。私有组合仅对 ownerId 可见，避免泄露他人组合。
 */
export class ChargeComboService {
  constructor(private readonly db: Database.Database) {}

  /** 当前用户可见的启用组合（PUBLIC 全部可见 + 本人 PRIVATE），含明细。 */
  list(context: AppContext): Array<Record<string, unknown>> {
    const combos = this.db.prepare(
      `SELECT * FROM ChargeCombo
       WHERE deletedAt IS NULL AND active = 1 AND (type = 'PUBLIC' OR ownerId = ?)${tenantAnd(context.clinicId)}
       ORDER BY createdAt DESC`,
    ).all(context.userId, ...tenantParams(context.clinicId)) as Array<Record<string, unknown>>;
    const itemsByCombo = this.itemsByComboIds(combos.map((combo) => String(combo.id)));
    return combos.map((combo) => ({ ...combo, items: itemsByCombo.get(String(combo.id)) ?? [] }));
  }

  /** 单个组合及其明细；不存在或他人私有组合均按 NotFoundError 处理。 */
  comboWithItems(id: string, context: AppContext): Record<string, unknown> {
    const row = this.db.prepare(
      `SELECT * FROM ChargeCombo
       WHERE id = ? AND deletedAt IS NULL AND active = 1${tenantAnd(context.clinicId)}`,
    ).get(id, ...tenantParams(context.clinicId)) as Record<string, unknown> | undefined;
    if (!row) throw new NotFoundError('Charge combo not found');
    if (row.type === 'PRIVATE' && String(row.ownerId) !== context.userId) {
      throw new NotFoundError('Charge combo not found');
    }
    return { ...row, items: this.itemsOf(id) };
  }

  /** 将组合明细一键划入收费单（调用 ChargeService.create 落库）。 */
  async applyToCharge(comboId: string, patientId: string, context: AppContext): Promise<Record<string, unknown>> {
    const combo = this.comboWithItems(comboId, context);
    const items = combo.items as ChargeComboItemRow[];
    if (items.length === 0) throw new ValidationError('收费组合没有明细');
    // 引用了目录（catalogId 非空）的明细必须在划价时与 TreatmentCatalog 现行
    // 价目一致，防止组合价与目录价脱节造成错收费；目录缺失同样视为组合失效。
    const catalogStmt = this.db.prepare(
      `SELECT id, price FROM TreatmentCatalog WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    );
    for (const item of items) {
      if (item.catalogId) {
        const catalog = catalogStmt.get(item.catalogId, ...tenantParams(context.clinicId)) as
          | { id: string; price: number }
          | undefined;
        if (!catalog) throw new ValidationError(`收费组合明细引用的目录项不存在: ${item.name}`);
        if (Number(catalog.price) !== Number(item.price)) {
          throw new ValidationError(`收费组合明细价格与目录不一致: ${item.name}`);
        }
      }
    }
    const chargeService = new ChargeService(this.db);
    const created = await chargeService.create({
      patientId,
      items: items.map((item) => ({
        name: item.name,
        category: item.category,
        price: Number(item.price),
        quantity: Number(item.quantity),
        costType: item.costType ?? undefined,
      })),
      remark: `收费组合 ${String(combo.name)}`,
    }, context);
    return { ...created, comboId, comboName: combo.name };
  }

  private itemsOf(comboId: string): ChargeComboItemRow[] {
    return this.db.prepare(
      `SELECT id, comboId, catalogId, name, category, price, quantity, costType
       FROM ChargeComboItem
       WHERE comboId = ? AND deletedAt IS NULL
       ORDER BY createdAt`,
    ).all(comboId) as ChargeComboItemRow[];
  }

  private itemsByComboIds(comboIds: string[]): Map<string, ChargeComboItemRow[]> {
    const groups = new Map<string, ChargeComboItemRow[]>();
    if (comboIds.length === 0) return groups;
    const placeholders = comboIds.map(() => '?').join(',');
    const rows = this.db.prepare(
      `SELECT id, comboId, catalogId, name, category, price, quantity, costType
       FROM ChargeComboItem
       WHERE comboId IN (${placeholders}) AND deletedAt IS NULL
       ORDER BY createdAt`,
    ).all(...comboIds) as ChargeComboItemRow[];
    for (const row of rows) {
      const list = groups.get(row.comboId) ?? [];
      list.push(row);
      groups.set(row.comboId, list);
    }
    return groups;
  }
}
