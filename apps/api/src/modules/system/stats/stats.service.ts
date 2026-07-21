import { Injectable, BadRequestException } from "@nestjs/common";
import { DbService } from "../../../db/db.service";
import { CacheService } from "../../../common/services/cache.service";
import { validateDates, getLocalDateStr, getLocalMonthStr, endOfDay, startOfDay, startOfMonth } from "../../../common/utils/date";

export interface CountRow { c: number; }
export interface SumRow { t: number; }
export interface DateCountRow { date: string; count: number; }
export interface DateAmountRow { date: string; count: number; amount: number; }
export interface MonthCountRow { month: string; count: number; }
export interface DoctorWorkloadRow { doctorId: string; doctorName: string; count: number; amount: number; }
export interface CategoryAmountRow { category: string; amount: number; count: number; percentage?: number; }
export interface DoctorRevenueRow { doctorId: string; doctorName: string; count: number; amount: number; percentage?: number; }
export interface StatusCountRow { status: string; count: number; percentage?: number; }
export interface PendingChargeRow { id: string; patientName: string; totalAmount: number; paidAmount: number; number: string; }
export interface RecentPatientRow { id: string; name: string; phone: string; createdAt: string; }
export interface InventoryStatusRow { category: string; count: number; totalStock: number; }
export interface MemberLevelRow { level: string; count: number; percentage?: number; }

@Injectable()
export class StatsService {
  constructor(
    private dbService: DbService,
    private cache: CacheService,
  ) {}

  async dashboard() {
    const today = getLocalDateStr();
    return this.cache.getOrSet(
      `stats:dashboard:${today}`,
      () => this.computeDashboard(),
      60 * 1000,
    );
  }

  private computeDashboard() {
    // P1 修复（时区错配）：原代码用本地日期字符串 "2026-07-22" 直接与 UTC ISO 比较，
    // 凌晨 0-8 点数据会少算。改用 startOfDay/startOfMonth 获取本地边界的 UTC ISO 表示。
    const todayStart = startOfDay(getLocalDateStr());
    const tomorrowStart = startOfDay(getLocalDateStr(new Date(Date.now() + 86400000)));
    const monthStartISO = startOfMonth();
    const nextMonthStartISO = startOfMonth(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1));
    const patientCount = (this.dbService.prepare("SELECT COUNT(*) as c FROM Patient WHERE deletedAt IS NULL").get() as CountRow)?.c || 0;
    const todayAppts = (this.dbService.prepare("SELECT COUNT(*) as c FROM Appointment WHERE startTime >= ? AND startTime < ? AND deletedAt IS NULL").get(todayStart, tomorrowStart) as CountRow)?.c || 0;
    const todayVisits = (this.dbService.prepare("SELECT COUNT(*) as c FROM Visit WHERE startTime >= ? AND startTime < ? AND deletedAt IS NULL").get(todayStart, tomorrowStart) as CountRow)?.c || 0;
    const newPatients = (this.dbService.prepare("SELECT COUNT(*) as c FROM Patient WHERE createdAt >= ? AND createdAt < ? AND deletedAt IS NULL").get(todayStart, tomorrowStart) as CountRow)?.c || 0;
    const todayCharges = (this.dbService.prepare("SELECT COALESCE(SUM(paidAmount),0) as t FROM Charge WHERE paidAt >= ? AND paidAt < ? AND deletedAt IS NULL").get(todayStart, tomorrowStart) as SumRow)?.t || 0;
    const unpaidAmount = (this.dbService.prepare("SELECT COALESCE(SUM(totalAmount - paidAmount),0) as t FROM Charge WHERE status != 'PAID' AND deletedAt IS NULL").get() as SumRow)?.t || 0;
    const monthRevenue = (this.dbService.prepare("SELECT COALESCE(SUM(paidAmount),0) as t FROM Charge WHERE paidAt >= ? AND paidAt < ? AND deletedAt IS NULL").get(monthStartISO, nextMonthStartISO) as SumRow)?.t || 0;
    const totalIncome = (this.dbService.prepare("SELECT COALESCE(SUM(paidAmount),0) as t FROM Charge WHERE deletedAt IS NULL").get() as SumRow)?.t || 0;
    const monthChargeCount = (this.dbService.prepare("SELECT COUNT(*) as c FROM Charge WHERE paidAt >= ? AND paidAt < ? AND deletedAt IS NULL").get(monthStartISO, nextMonthStartISO) as CountRow)?.c || 0;
    const unpaidCount = (this.dbService.prepare("SELECT COUNT(*) as c FROM Charge WHERE status != 'PAID' AND deletedAt IS NULL").get() as CountRow)?.c || 0;
    const pendingCharges = this.dbService.prepare(
      "SELECT c.id, p.name as patientName, c.totalAmount, c.paidAmount, c.number FROM Charge c LEFT JOIN Patient p ON c.patientId = p.id WHERE c.status != 'PAID' AND c.deletedAt IS NULL ORDER BY c.createdAt DESC LIMIT 20"
    ).all() as PendingChargeRow[];
    const recentPatients = this.dbService.prepare(
      "SELECT id, name, phone, createdAt FROM Patient WHERE deletedAt IS NULL ORDER BY createdAt DESC LIMIT 10"
    ).all() as RecentPatientRow[];
    return {
      today: { appointments: todayAppts, visits: todayVisits, newPatients, charges: todayCharges },
      finance: { unpaidAmount: String(unpaidAmount), monthRevenue: String(monthRevenue), totalIncome: String(totalIncome), monthChargeCount, unpaidCount },
      pendingCharges,
      patients: { total: patientCount, recent: recentPatients },
    };
  }

  async revenue(params: { startDate?: string; endDate?: string; groupBy?: string }) {
    const key = `stats:revenue:${params.startDate || ''}:${params.endDate || ''}:${params.groupBy || 'day'}`;
    return this.cache.getOrSet(key, () => this.computeRevenue(params), 60 * 1000);
  }

  private computeRevenue(params: { startDate?: string; endDate?: string; groupBy?: string }) {
    const { startDate, endDate, groupBy = 'day' } = params;
    validateDates(startDate, endDate);
    const dateFilter = startDate && endDate ? "AND paidAt >= ? AND paidAt <= ?" : "";
    const groupExpr = groupBy === 'month' ? "substr(paidAt,1,7)" : groupBy === 'year' ? "substr(paidAt,1,4)" : "date(paidAt)";
    const qp: unknown[] = [];
    if (startDate && endDate) { qp.push(startDate, endOfDay(endDate)); }
    const rows = this.dbService.prepare(
      `SELECT ${groupExpr} as date, COUNT(*) as count, COALESCE(SUM(paidAmount),0) as amount FROM Charge WHERE deletedAt IS NULL AND paidAt IS NOT NULL ${dateFilter} GROUP BY date ORDER BY date`
    ).all(...qp) as DateAmountRow[];
    const totalRevenue = rows.reduce((s: number, r) => s + r.amount, 0);
    const totalCount = rows.reduce((s: number, r) => s + r.count, 0);
    return { daily: rows, monthly: rows, summary: { totalRevenue: String(totalRevenue), totalCount, totalDiscount: '0', avgPerOrder: totalCount > 0 ? String(Math.round(totalRevenue / totalCount)) : '0' } };
  }

  async doctorWorkload(params: { startDate?: string; endDate?: string }) {
    const { startDate, endDate } = params;
    const dateFilter = startDate && endDate ? "AND t.completedDate >= ? AND t.completedDate <= ?" : "";
    const qp: unknown[] = [];
    if (startDate && endDate) { qp.push(startDate, endOfDay(endDate)); }
    return this.dbService.prepare(
      `SELECT t.doctorId, u.name as doctorName, COUNT(t.id) as count, COALESCE(SUM(t.price * t.quantity),0) as amount FROM Treatment t LEFT JOIN User u ON t.doctorId = u.id WHERE t.deletedAt IS NULL ${dateFilter} GROUP BY t.doctorId ORDER BY amount DESC`
    ).all(...qp) as DoctorWorkloadRow[];
  }

  async getPatientGrowth(params: { startDate?: string; endDate?: string }) {
    const { startDate, endDate } = params;
    const dateFilter = startDate && endDate ? "WHERE createdAt >= ? AND createdAt <= ? AND deletedAt IS NULL" : "WHERE deletedAt IS NULL";
    const qp: unknown[] = [];
    if (startDate && endDate) { qp.push(startDate, endOfDay(endDate)); }
    const rows = this.dbService.prepare(
      `SELECT substr(createdAt,1,7) as month, COUNT(*) as count FROM Patient ${dateFilter} GROUP BY month ORDER BY month`
    ).all(...qp) as MonthCountRow[];
    let runningTotal = 0;
    return { items: rows.map(r => { runningTotal += r.count; return { date: r.month, count: r.count, total: runningTotal }; }) };
  }

  async getRevenueByCategory(params: { startDate?: string; endDate?: string }) {
    const { startDate, endDate } = params;
    const dateFilter = startDate && endDate ? "AND c.paidAt >= ? AND c.paidAt <= ?" : "";
    const qp: unknown[] = [];
    if (startDate && endDate) { qp.push(startDate, endOfDay(endDate)); }
    const rows = this.dbService.prepare(
      `SELECT ci.category, SUM(ci.subtotal) as amount, COUNT(ci.id) as count FROM ChargeItem ci JOIN Charge c ON ci.chargeId = c.id WHERE c.deletedAt IS NULL ${dateFilter} GROUP BY ci.category ORDER BY amount DESC`
    ).all(...qp) as CategoryAmountRow[];
    const total = rows.reduce((s: number, r) => s + r.amount, 0);
    if (total === 0) return rows.map(r => ({ ...r, percentage: 0 }));
    return rows.map(r => ({ ...r, percentage: Math.round((r.amount / total) * 100) }));
  }

  async getRevenueByDoctor(params: { startDate?: string; endDate?: string }) {
    const { startDate, endDate } = params;
    const dateFilter = startDate && endDate ? "AND c.paidAt >= ? AND c.paidAt <= ?" : "";
    const qp: unknown[] = [];
    if (startDate && endDate) { qp.push(startDate, endOfDay(endDate)); }
    const rows = this.dbService.prepare(
      `SELECT c.doctorId, u.name as doctorName, COUNT(c.id) as count, COALESCE(SUM(c.paidAmount),0) as amount FROM Charge c LEFT JOIN User u ON c.doctorId = u.id WHERE c.deletedAt IS NULL ${dateFilter} GROUP BY c.doctorId ORDER BY amount DESC`
    ).all(...qp) as DoctorRevenueRow[];
    const total = rows.reduce((s: number, r) => s + r.amount, 0);
    if (total === 0) return rows.map(r => ({ ...r, percentage: 0 }));
    return rows.map(r => ({ ...r, percentage: Math.round((r.amount / total) * 100) }));
  }

  async getInventoryStatus() {
    return this.dbService.prepare("SELECT category, COUNT(*) as count, SUM(stock) as totalStock FROM InventoryItem WHERE deletedAt IS NULL GROUP BY category").all() as InventoryStatusRow[];
  }

  async getAppointmentStats(params: { startDate?: string; endDate?: string }) {
    const { startDate, endDate } = params;
    const dateFilter = startDate && endDate ? "AND startTime >= ? AND startTime <= ?" : "";
    const qp: unknown[] = [];
    if (startDate && endDate) { qp.push(startDate, endOfDay(endDate)); }
    const byStatus = this.dbService.prepare(
      `SELECT status, COUNT(*) as count FROM Appointment WHERE deletedAt IS NULL ${dateFilter} GROUP BY status`
    ).all(...qp) as StatusCountRow[];
    const total = byStatus.reduce((s: number, r) => s + r.count, 0);
    const statusItems = total === 0
      ? byStatus.map(r => ({ status: r.status, count: r.count, percentage: 0 }))
      : byStatus.map(r => ({ status: r.status, count: r.count, percentage: Math.round((r.count / total) * 100) }));
    const daily = this.dbService.prepare(
      `SELECT date(startTime) as date, COUNT(*) as count FROM Appointment WHERE deletedAt IS NULL ${dateFilter} GROUP BY date ORDER BY date`
    ).all(...qp) as DateCountRow[];
    const monthly = this.dbService.prepare(
      `SELECT substr(startTime,1,7) as month, COUNT(*) as count FROM Appointment WHERE deletedAt IS NULL ${dateFilter} GROUP BY month ORDER BY month`
    ).all(...qp) as MonthCountRow[];
    return { status: statusItems, daily, monthly };
  }

  async getChargeStats(params: { startDate?: string; endDate?: string }) {
    const { startDate, endDate } = params;
    const dateFilter = startDate && endDate ? "AND paidAt >= ? AND paidAt <= ?" : "";
    const qp: unknown[] = [];
    if (startDate && endDate) { qp.push(startDate, endOfDay(endDate)); }
    const daily = this.dbService.prepare(
      `SELECT date(paidAt) as date, COUNT(*) as count, COALESCE(SUM(paidAmount),0) as amount FROM Charge WHERE deletedAt IS NULL AND paidAt IS NOT NULL ${dateFilter} GROUP BY date ORDER BY date`
    ).all(...qp) as DateAmountRow[];
    const monthly = this.dbService.prepare(
      `SELECT substr(paidAt,1,7) as month, COUNT(*) as count, COALESCE(SUM(paidAmount),0) as amount FROM Charge WHERE deletedAt IS NULL AND paidAt IS NOT NULL ${dateFilter} GROUP BY month ORDER BY month`
    ).all(...qp) as DateAmountRow[];
    return { daily, monthly };
  }

  async getPatientStats(params: { startDate?: string; endDate?: string }) {
    const { startDate, endDate } = params;
    const dateFilter = startDate && endDate ? "WHERE createdAt >= ? AND createdAt <= ? AND deletedAt IS NULL" : "WHERE deletedAt IS NULL";
    const qp: unknown[] = [];
    if (startDate && endDate) { qp.push(startDate, endOfDay(endDate)); }
    const daily = this.dbService.prepare(
      `SELECT date(createdAt) as date, COUNT(*) as count FROM Patient ${dateFilter} GROUP BY date ORDER BY date`
    ).all(...qp) as DateCountRow[];
    const monthly = this.dbService.prepare(
      `SELECT substr(createdAt,1,7) as month, COUNT(*) as count FROM Patient ${dateFilter} GROUP BY month ORDER BY month`
    ).all(...qp) as MonthCountRow[];
    return { daily, monthly };
  }

  async getMemberStats() {
    const total = (this.dbService.prepare("SELECT COUNT(*) as c FROM MemberCard WHERE deletedAt IS NULL").get() as CountRow)?.c || 0;
    const active = (this.dbService.prepare("SELECT COUNT(*) as c FROM MemberCard WHERE status = 'ACTIVE' AND deletedAt IS NULL").get() as CountRow)?.c || 0;
    const totalBalance = (this.dbService.prepare("SELECT COALESCE(SUM(balance),0) as t FROM MemberCard WHERE deletedAt IS NULL").get() as SumRow)?.t || 0;
    const totalPoints = (this.dbService.prepare("SELECT COALESCE(SUM(points),0) as t FROM MemberCard WHERE deletedAt IS NULL").get() as SumRow)?.t || 0;
    const monthly = this.dbService.prepare(
      "SELECT substr(createdAt,1,7) as month, COUNT(*) as count FROM MemberCard WHERE deletedAt IS NULL GROUP BY month ORDER BY month"
    ).all() as MonthCountRow[];
    const levels = this.dbService.prepare(
      "SELECT level, COUNT(*) as count FROM MemberCard WHERE deletedAt IS NULL GROUP BY level"
    ).all() as MemberLevelRow[];
    const levelTotal = levels.reduce((s: number, l) => s + l.count, 0);
    const levelDistribution = levelTotal === 0
      ? levels.map(l => ({ level: l.level, count: l.count, percentage: 0 }))
      : levels.map(l => ({ level: l.level, count: l.count, percentage: Math.round((l.count / levelTotal) * 100) }));
    return { total, active, expired: total - active, totalMembers: total, totalBalance: String(totalBalance), totalPoints, monthly, levelDistribution };
  }
}
