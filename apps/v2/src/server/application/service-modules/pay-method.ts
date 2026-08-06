import type Database from 'better-sqlite3';
import { tenantAnd, tenantParams } from '../../infrastructure/tenant';
import type { AppContext } from '../../../domain/contracts';

export interface PayMethodNode {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  active: boolean;
  remark: string | null;
  children: PayMethodNode[];
}

/**
 * 自定义缴费方式（二级支付方式树）。
 *
 * 词典的增删改走既有资源 CRUD（/resources/payMethods），本服务只提供
 * 「二级树」查询：按 parentId 分层，根 = parentId 为 NULL 或空串。
 */
export class PayMethodService {
  constructor(private readonly db: Database.Database) {}

  tree(context: AppContext): { items: PayMethodNode[] } {
    const rows = this.db.prepare(
      `SELECT id, name, parentId, sortOrder, active, remark
       FROM PayMethod
       WHERE deletedAt IS NULL${tenantAnd(context.clinicId)}
       ORDER BY sortOrder, createdAt`,
    ).all(...tenantParams(context.clinicId)) as Array<Record<string, unknown>>;

    const nodes = new Map<string, PayMethodNode>();
    for (const row of rows) {
      const parentId = row.parentId == null || row.parentId === '' ? null : String(row.parentId);
      nodes.set(String(row.id), {
        id: String(row.id),
        name: String(row.name),
        parentId,
        sortOrder: Number(row.sortOrder ?? 0),
        active: Boolean(row.active),
        remark: row.remark == null ? null : String(row.remark),
        children: [],
      });
    }

    const items: PayMethodNode[] = [];
    for (const node of nodes.values()) {
      if (node.parentId && nodes.has(node.parentId)) {
        nodes.get(node.parentId)!.children.push(node);
      } else {
        items.push(node);
      }
    }
    for (const node of nodes.values()) {
      node.children.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    }
    return { items };
  }
}
