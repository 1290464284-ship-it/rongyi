// 统计服务（M-04：由 read-services.ts 拆分）
import type Database from 'better-sqlite3';
import type { AppContext } from '../../domain/contracts';
import { tenantWhere } from '../infrastructure/tenant';
import { clinicDayEndUtc, clinicDayStartUtc } from '../infrastructure/clock';
import { TtlCache } from './ttl-cache';

export class StatsService {
  constructor(private readonly db: Database.Database) {}

  private readonly cache = new TtlCache(30_000);

  dashboard(context: AppContext): Record<string, unknown> {
    // 缓存键含 role：DOCTOR 与 BOSS 返回结构不同（金额字段裁剪），不可混用缓存。
    const role = context.role;
    const isDoctor = role === 'DOCTOR';
    return this.cache.get(`dashboard:${context.clinicId ?? 'none'}:${role}`, () => {
      const tenant = tenantWhere(context.clinicId);
      const where = tenant.sql ? `WHERE ${tenant.sql} AND deletedAt IS NULL` : 'WHERE deletedAt IS NULL';
      const wherePending = tenant.sql
        ? `WHERE ${tenant.sql} AND deletedAt IS NULL AND status = 'PENDING'`
        : "WHERE deletedAt IS NULL AND status = 'PENDING'";
      const whereCharge = tenant.sql ? `WHERE ${tenant.sql} AND deletedAt IS NULL` : 'WHERE deletedAt IS NULL';
      const row = this.db.prepare(
        `SELECT (SELECT COUNT(*) FROM Patient ${where}) AS p,
                (SELECT COUNT(*) FROM Appointment ${where}) AS a,
                (SELECT COALESCE(SUM(CASE WHEN status <> 'CANCELLED' THEN paidAmount - refundedAmount ELSE 0 END), 0) FROM Charge ${whereCharge}) AS paid,
                (SELECT COALESCE(SUM(CASE WHEN status IN ('UNPAID', 'PARTIAL') THEN totalAmount - paidAmount ELSE 0 END), 0) FROM Charge ${whereCharge}) AS unpaid,
                (SELECT COUNT(*) FROM InventoryItem ${where}) AS i,
                (SELECT COUNT(*) FROM FollowUp ${wherePending}) AS f`,
      ).get(...tenant.params, ...tenant.params, ...tenant.params, ...tenant.params, ...tenant.params, ...tenant.params) as
        { p: number; a: number; paid: number; unpaid: number; i: number; f: number };
      const result: Record<string, unknown> = {
        patients: row.p,
        appointments: row.a,
        paidAmount: row.paid,
        unpaidAmount: row.unpaid,
        inventoryItems: row.i,
        pendingFollowUps: row.f,
      };
      if (isDoctor) {
        // DOCTOR 角色裁剪营收/待收金额，避免营业数据越权可见。
        delete result.paidAmount;
        delete result.unpaidAmount;
      }
      return result;
    });
  }

  revenue(
    startDate?: string,
    endDate?: string,
    groupBy: 'day' | 'month' = 'day',
    context?: AppContext,
  ): Array<Record<string, unknown>> {
    return this.cache.get(
      `revenue:${context?.clinicId ?? 'none'}:${startDate ?? ''}:${endDate ?? ''}:${groupBy}`,
      () => {
        const groupExpr = groupBy === 'month'
          ? "strftime('%Y-%m', paidAt, '+8 hours')"
          : "strftime('%Y-%m-%d', paidAt, '+8 hours')";
        const where: string[] = ['deletedAt IS NULL', 'paidAt IS NOT NULL'];
        const params: unknown[] = [];
        const startBoundary = startDate ? clinicDayStartUtc(startDate) ?? startDate : undefined;
        const endBoundary = endDate ? clinicDayEndUtc(endDate) ?? endDate : undefined;
        if (startBoundary) {
          where.push('paidAt >= ?');
          params.push(startBoundary);
        }
        if (endBoundary) {
          where.push('paidAt <= ?');
          params.push(endBoundary);
        }
        const tenant = tenantWhere(context?.clinicId);
        if (tenant.sql) {
          where.push(tenant.sql);
          params.push(...tenant.params);
        }
        return this.db.prepare(
          `SELECT ${groupExpr} AS period, SUM(CASE WHEN status <> 'CANCELLED' THEN paidAmount - refundedAmount ELSE 0 END) AS amount, COUNT(*) AS count
           FROM Charge
           WHERE ${where.join(' AND ')}
           GROUP BY ${groupExpr}
           ORDER BY period ASC`,
        ).all(...params) as Array<Record<string, unknown>>;
      },
    );
  }

  patientGrowth(startDate?: string, endDate?: string, context?: AppContext): Array<Record<string, unknown>> {
    return this.cache.get(
      `patientGrowth:${context?.clinicId ?? 'none'}:${startDate ?? ''}:${endDate ?? ''}`,
      () => {
        const where: string[] = ['deletedAt IS NULL'];
        const params: unknown[] = [];
        const startBoundary = startDate ? clinicDayStartUtc(startDate) ?? startDate : undefined;
        const endBoundary = endDate ? clinicDayEndUtc(endDate) ?? endDate : undefined;
        if (startBoundary) {
          where.push('createdAt >= ?');
          params.push(startBoundary);
        }
        if (endBoundary) {
          where.push('createdAt <= ?');
          params.push(endBoundary);
        }
        const tenant = tenantWhere(context?.clinicId);
        if (tenant.sql) {
          where.push(tenant.sql);
          params.push(...tenant.params);
        }
        return this.db.prepare(
          `SELECT strftime('%Y-%m-%d', createdAt, '+8 hours') AS day, COUNT(*) AS count
           FROM Patient
           WHERE ${where.join(' AND ')}
           GROUP BY strftime('%Y-%m-%d', createdAt, '+8 hours')
           ORDER BY day ASC`,
        ).all(...params) as Array<Record<string, unknown>>;
      },
    );
  }

  inventoryStats(context: AppContext): Array<Record<string, unknown>> {
    return this.cache.get(`inventoryStats:${context.clinicId ?? 'none'}`, () => {
      const tenant = tenantWhere(context.clinicId);
      const params: unknown[] = tenant.params;
      return this.db.prepare(
        `SELECT category, COUNT(*) AS count, SUM(stock) AS totalStock, SUM(minStock) AS minStock
         FROM InventoryItem
         WHERE deletedAt IS NULL ${tenant.sql ? `AND ${tenant.sql}` : ''}
         GROUP BY category
         ORDER BY category`,
      ).all(...params) as Array<Record<string, unknown>>;
    });
  }

  memberStats(context: AppContext): Record<string, unknown> {
    return this.cache.get(`memberStats:${context.clinicId ?? 'none'}`, () => {
      const tenant = tenantWhere(context.clinicId);
      const clinicClause = tenant.sql ? `WHERE ${tenant.sql} AND deletedAt IS NULL` : 'WHERE deletedAt IS NULL';
      const params: unknown[] = tenant.params;
      const row = this.db.prepare(
        `SELECT COUNT(*) AS total,
                COALESCE(SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END), 0) AS active,
                COALESCE(SUM(balance), 0) AS totalBalance,
                COALESCE(SUM(points), 0) AS totalPoints
         FROM MemberCard ${clinicClause}`,
      ).get(...params) as Record<string, unknown>;
      return row;
    });
  }
}
