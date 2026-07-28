import { Injectable } from '@nestjs/common';
import { DbService } from "../../../db/db.service";
import { CacheService } from "../../../common/services/cache.service";
import { validateDates, endOfDay } from "../../../common/utils/format/date";
import { ClinicContextService } from "../../../common/services/clinic-context.service";
import { centsToYuan } from "../../../common/utils/format/money.utils";
import { buildClinicFilter } from "../../../common/utils/db/clinic-filter";
import {
  STATS_REVENUE_CACHE_TTL_MS,
  STATS_REVENUE_BY_CATEGORY_CACHE_TTL_MS,
  STATS_REVENUE_BY_DOCTOR_CACHE_TTL_MS,
} from "../../../config/constants";
import { STATS_CACHE_KEYS, buildStatsCacheKey } from "../../../common/constants/cache-keys";
import { DateAmountRow, CategoryAmountRow, DoctorRevenueRow } from "./stats.interfaces";

@Injectable()
export class RevenueStatsService {
  constructor(
    private dbService: DbService,
    private cache: CacheService,
    private clinicContext: ClinicContextService,
  ) {}

  async revenue(params: { startDate?: string; endDate?: string; groupBy?: string }) {
    const clinicId = this.clinicContext.getClinicId();
    const key = buildStatsCacheKey(
      STATS_CACHE_KEYS.REVENUE,
      clinicId,
      params.startDate || '',
      params.endDate || '',
      params.groupBy || 'day',
    );
    return this.cache.getOrSet(key, () => this.computeRevenue(params), STATS_REVENUE_CACHE_TTL_MS);
  }

  private computeRevenue(params: { startDate?: string; endDate?: string; groupBy?: string }) {
    const { startDate, endDate, groupBy: rawGroupBy = 'day' } = params;
    const groupBy = ['day', 'month', 'year'].includes(rawGroupBy) ? rawGroupBy : 'day';
    validateDates(startDate, endDate);
    const { clause: clinicClause, params: clinicParams } = buildClinicFilter(this.clinicContext.getClinicId());
    const dateFilter = startDate && endDate ? "AND paidAt >= ? AND paidAt <= ?" : "";
    const groupExpr = groupBy === 'month' ? "substr(paidAt,1,7)" : groupBy === 'year' ? "substr(paidAt,1,4)" : "date(paidAt)";
    const qp: unknown[] = [];
    if (startDate && endDate) { qp.push(startDate, endOfDay(endDate)); }
    const rows = this.dbService.prepare(
      `SELECT ${groupExpr} as date, COUNT(*) as count, COALESCE(SUM(paidAmount),0) as amount FROM Charge WHERE deletedAt IS NULL AND paidAt IS NOT NULL ${dateFilter}${clinicClause} GROUP BY date ORDER BY date`
    ).all(...qp, ...clinicParams) as DateAmountRow[];
    const totalRevenue = rows.reduce((s: number, r) => s + r.amount, 0);
    const totalCount = rows.reduce((s: number, r) => s + r.count, 0);
    const yuanRows = rows.map(r => ({ ...r, amount: centsToYuan(r.amount) }));
    return { daily: yuanRows, monthly: yuanRows, summary: { totalRevenue: String(centsToYuan(totalRevenue)), totalCount, totalDiscount: '0', avgPerOrder: totalCount > 0 ? String(centsToYuan(Math.round(totalRevenue / totalCount))) : '0' } };
  }

  async getRevenueByCategory(params: { startDate?: string; endDate?: string }) {
    const { startDate, endDate } = params;
    const clinicId = this.clinicContext.getClinicId();
    const key = buildStatsCacheKey(
      STATS_CACHE_KEYS.REVENUE_BY_CATEGORY,
      clinicId,
      startDate || '',
      endDate || '',
    );
    return this.cache.getOrSet(key, () => {
      const clinicFilter = buildClinicFilter(clinicId);
      const clinicClause = clinicFilter.clause.replace('clinicId', 'c.clinicId');
      const clinicParams = clinicFilter.params;
      const dateFilter = startDate && endDate ? "AND c.paidAt >= ? AND c.paidAt <= ?" : "";
      const qp: unknown[] = [];
      if (startDate && endDate) { qp.push(startDate, endOfDay(endDate)); }
      const rows = this.dbService.prepare(
        `SELECT ci.category, SUM(ci.subtotal) as amount, COUNT(ci.id) as count FROM ChargeItem ci JOIN Charge c ON ci.chargeId = c.id WHERE c.deletedAt IS NULL ${dateFilter}${clinicClause} GROUP BY ci.category ORDER BY amount DESC`
      ).all(...qp, ...clinicParams) as CategoryAmountRow[];
      const total = rows.reduce((s: number, r) => s + r.amount, 0);
      if (total === 0) return rows.map(r => ({ ...r, amount: centsToYuan(r.amount), percentage: 0 }));
      return rows.map(r => ({ ...r, amount: centsToYuan(r.amount), percentage: Math.round((r.amount / total) * 100) }));
    }, STATS_REVENUE_BY_CATEGORY_CACHE_TTL_MS);
  }

  async getRevenueByDoctor(params: { startDate?: string; endDate?: string }) {
    const { startDate, endDate } = params;
    const clinicId = this.clinicContext.getClinicId();
    const key = buildStatsCacheKey(
      STATS_CACHE_KEYS.REVENUE_BY_DOCTOR,
      clinicId,
      startDate || '',
      endDate || '',
    );
    return this.cache.getOrSet(key, () => {
      const clinicFilter = buildClinicFilter(clinicId);
      const clinicClause = clinicFilter.clause.replace('clinicId', 'c.clinicId');
      const clinicParams = clinicFilter.params;
      const dateFilter = startDate && endDate ? "AND c.paidAt >= ? AND c.paidAt <= ?" : "";
      const qp: unknown[] = [];
      if (startDate && endDate) { qp.push(startDate, endOfDay(endDate)); }
      const rows = this.dbService.prepare(
        `SELECT c.doctorId, u.name as doctorName, COUNT(c.id) as count, COALESCE(SUM(c.paidAmount),0) as amount FROM Charge c LEFT JOIN User u ON c.doctorId = u.id WHERE c.deletedAt IS NULL ${dateFilter}${clinicClause} GROUP BY c.doctorId ORDER BY amount DESC`
      ).all(...qp, ...clinicParams) as DoctorRevenueRow[];
      const total = rows.reduce((s: number, r) => s + r.amount, 0);
      if (total === 0) return rows.map(r => ({ ...r, amount: centsToYuan(r.amount), percentage: 0 }));
      return rows.map(r => ({ ...r, amount: centsToYuan(r.amount), percentage: Math.round((r.amount / total) * 100) }));
    }, STATS_REVENUE_BY_DOCTOR_CACHE_TTL_MS);
  }
}
