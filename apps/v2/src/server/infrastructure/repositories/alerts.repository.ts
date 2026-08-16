// 业务告警仓储（M-04：由 core.repositories.ts 拆分）
import type Database from 'better-sqlite3';
import { tenantAnd } from '../tenant';
import { keysetCondition, keysetOrder, nextCursorFrom } from '../keyset';
import type { AlertRepository } from '../../application/ports';

export class SqliteAlertRepository implements AlertRepository {
  constructor(private readonly db: Database.Database) {}

  open(
    clinicId?: string | null,
    options?: { page?: number; pageSize?: number; cursor?: string | null },
  ): { items: Array<Record<string, unknown>>; total: number; page: number; pageSize: number; truncated?: boolean; nextCursor?: string | null } {
    const rawPage = Number(options?.page);
    const rawPageSize = Number(options?.pageSize);
    const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
    const pageSize = Number.isFinite(rawPageSize) && rawPageSize >= 1 ? Math.min(100, Math.floor(rawPageSize)) : 100;
    const offset = (page - 1) * pageSize;
    const params: Array<string | number> = clinicId ? [clinicId] : [];
    const where = `WHERE status = 'OPEN' AND deletedAt IS NULL${tenantAnd(clinicId)}`;
    const total = Number((this.db.prepare(
      `SELECT COUNT(*) AS total FROM BusinessAlert ${where}`,
    ).get(...params) as { total: number }).total);
    // S-2 keyset：两模式统一按 (createdAt DESC, id DESC) 排序，恒取 pageSize+1 行并回传 nextCursor。
    const keyset = { columns: [{ column: 'createdAt', key: 'createdAt' }], idColumn: 'id', direction: 'DESC' as const };
    const cursorCondition = keysetCondition(options?.cursor, keyset);
    const hasCursor = cursorCondition.where !== '';
    const items = this.db.prepare(
      `SELECT * FROM BusinessAlert ${where}${cursorCondition.where}
       ${keysetOrder(keyset)}
       LIMIT ${pageSize + 1} OFFSET ${hasCursor ? 0 : offset}`,
    ).all(...params, ...cursorCondition.params) as Array<Record<string, unknown>>;
    return {
      items: items.slice(0, pageSize),
      total,
      page,
      pageSize,
      truncated: total > offset + items.slice(0, pageSize).length,
      nextCursor: nextCursorFrom(items, pageSize, keyset),
    };
  }

  setStatus(id: string, status: string, userId: string | null, now: string, clinicId?: string | null): number {
    const params = clinicId ? [status, userId, now, now, id, clinicId] : [status, userId, now, now, id];
    return this.db.prepare(
      `UPDATE BusinessAlert SET status = ?, acknowledgedBy = ?, acknowledgedAt = ?, updatedAt = ?
       WHERE id = ? AND deletedAt IS NULL AND status IN ('OPEN', 'ACKNOWLEDGED')${tenantAnd(clinicId)}`,
    ).run(...params).changes;
  }
}
