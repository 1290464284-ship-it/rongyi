import { Injectable } from "@nestjs/common";
import { DbService } from "../../../db/db.service";
import { CacheService } from "../../../common/services/cache.service";
import { getLocalDateStr, startOfDay, startOfMonth } from "../../../common/utils/format/date";
import { ClinicContextService } from "../../../common/services/clinic-context.service";
import { centsToYuan } from "../../../common/utils/format/money.utils";
import { buildClinicFilter } from "../../../common/utils/db/clinic-filter";
import {
  STATS_DASHBOARD_CACHE_TTL_MS,
  STATS_DEFAULT_LIMIT,
} from "../../../config/constants";
import { STATS_CACHE_KEYS, buildStatsCacheKey } from "../../../common/constants/cache-keys";
import {
  CountRow,
  PendingChargeRow,
  RecentPatientRow,
  RecentAppointmentRow,
  RecentChargeRow,
  TodoItemRow,
} from "./stats.interfaces";

@Injectable()
export class DashboardStatsService {
  constructor(
    private dbService: DbService,
    private cache: CacheService,
    private clinicContext: ClinicContextService,
  ) {}

  async dashboard() {
    const today = getLocalDateStr();
    const clinicId = this.clinicContext.getClinicId();
    return this.cache.getOrSet(
      buildStatsCacheKey(STATS_CACHE_KEYS.DASHBOARD, clinicId, today),
      () => this.computeDashboard(),
      STATS_DASHBOARD_CACHE_TTL_MS,
    );
  }

  private computeDashboard() {
    const clinicFilter = buildClinicFilter(this.clinicContext.getClinicId());
    const clinicClause = clinicFilter.clause;
    const clinicParams = clinicFilter.params;
    const apptClinicClause = clinicFilter.clause.replace('clinicId', 'a.clinicId');
    const chargeClinicClause = clinicFilter.clause.replace('clinicId', 'c.clinicId');
    const todayStart = startOfDay(getLocalDateStr());
    const tomorrowStart = startOfDay(getLocalDateStr(new Date(Date.now() + 86400000)));
    const monthStartISO = startOfMonth();
    const nextMonthStartISO = startOfMonth(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1));

    const patientRow = this.dbService.prepare(
      `SELECT COUNT(*) as c, SUM(CASE WHEN createdAt >= ? AND createdAt < ? THEN 1 ELSE 0 END) as newC FROM Patient WHERE deletedAt IS NULL${clinicClause}`
    ).get(todayStart, tomorrowStart, ...clinicParams) as { c: number; newC: number };
    const patientCount = patientRow?.c || 0;
    const newPatients = patientRow?.newC || 0;

    const chargeRow = this.dbService.prepare(
      `SELECT
        COALESCE(SUM(CASE WHEN paidAt >= ? AND paidAt < ? THEN paidAmount END), 0) AS todayCharges,
        COALESCE(SUM(CASE WHEN status != 'PAID' THEN totalAmount - paidAmount END), 0) AS unpaidAmount,
        COALESCE(SUM(CASE WHEN paidAt >= ? AND paidAt < ? THEN paidAmount END), 0) AS monthRevenue,
        COALESCE(SUM(paidAmount), 0) AS totalIncome,
        SUM(CASE WHEN paidAt >= ? AND paidAt < ? THEN 1 ELSE 0 END) AS monthChargeCount,
        SUM(CASE WHEN status != 'PAID' THEN 1 ELSE 0 END) AS unpaidCount
      FROM Charge WHERE deletedAt IS NULL${clinicClause}`
    ).get(todayStart, tomorrowStart, monthStartISO, nextMonthStartISO, monthStartISO, nextMonthStartISO, ...clinicParams) as {
      todayCharges: number; unpaidAmount: number; monthRevenue: number; totalIncome: number; monthChargeCount: number; unpaidCount: number;
    };

    const todayAppts = (this.dbService.prepare(`SELECT COUNT(*) as c FROM Appointment WHERE startTime >= ? AND startTime < ? AND deletedAt IS NULL${clinicClause}`).get(todayStart, tomorrowStart, ...clinicParams) as CountRow)?.c || 0;
    const todayVisits = (this.dbService.prepare(`SELECT COUNT(*) as c FROM Visit WHERE startTime >= ? AND startTime < ? AND deletedAt IS NULL${clinicClause}`).get(todayStart, tomorrowStart, ...clinicParams) as CountRow)?.c || 0;
    const pendingCharges = this.dbService.prepare(
      `SELECT c.id, p.name as patientName, c.totalAmount, c.paidAmount, c.number FROM Charge c LEFT JOIN Patient p ON c.patientId = p.id WHERE c.status != 'PAID' AND c.deletedAt IS NULL${chargeClinicClause} ORDER BY c.createdAt DESC LIMIT ${STATS_DEFAULT_LIMIT}`
    ).all(...clinicParams) as PendingChargeRow[];
    const recentPatients = this.dbService.prepare(
      `SELECT id, name, phone, createdAt FROM Patient WHERE deletedAt IS NULL${clinicClause} ORDER BY createdAt DESC LIMIT 10`
    ).all(...clinicParams) as RecentPatientRow[];
    const recentAppointments = this.dbService.prepare(
      `SELECT a.id, a.patientId, p.name as patientName, a.doctorId, a.startTime, a.endTime, a.status, a.type FROM Appointment a JOIN Patient p ON a.patientId = p.id WHERE a.deletedAt IS NULL${apptClinicClause} ORDER BY a.startTime DESC LIMIT 10`
    ).all(...clinicParams) as RecentAppointmentRow[];
    const recentCharges = this.dbService.prepare(
      `SELECT c.id, p.name as patientName, c.totalAmount, c.paidAmount, c.number, c.paidAt FROM Charge c LEFT JOIN Patient p ON c.patientId = p.id WHERE c.paidAt IS NOT NULL AND c.deletedAt IS NULL${chargeClinicClause} ORDER BY c.paidAt DESC LIMIT 10`
    ).all(...clinicParams) as RecentChargeRow[];
    const pendingChargesYuan = pendingCharges.map(c => ({ ...c, totalAmount: centsToYuan(c.totalAmount), paidAmount: centsToYuan(c.paidAmount) }));
    const todos = this.buildTodos(pendingChargesYuan, recentAppointments, todayStart);
    return {
      today: { appointments: todayAppts, visits: todayVisits, newPatients, charges: centsToYuan(chargeRow?.todayCharges || 0) },
      finance: { unpaidAmount: String(centsToYuan(chargeRow?.unpaidAmount || 0)), monthRevenue: String(centsToYuan(chargeRow?.monthRevenue || 0)), totalIncome: String(centsToYuan(chargeRow?.totalIncome || 0)), monthChargeCount: chargeRow?.monthChargeCount || 0, unpaidCount: chargeRow?.unpaidCount || 0 },
      pendingCharges: pendingChargesYuan,
      patients: { total: patientCount, recent: recentPatients },
      recentAppointments,
      recentCharges: recentCharges.map(c => ({ ...c, totalAmount: centsToYuan(c.totalAmount), paidAmount: centsToYuan(c.paidAmount) })),
      todos,
    };
  }

  private buildTodos(pendingCharges: PendingChargeRow[], recentAppointments: RecentAppointmentRow[], todayStart: string): TodoItemRow[] {
    const todos: TodoItemRow[] = [];
    for (const charge of pendingCharges.slice(0, 5)) {
      todos.push({
        id: `charge-${charge.id}`,
        type: 'charge',
        title: `${charge.patientName} 待收费 ¥${charge.totalAmount - charge.paidAmount}`,
        status: 'pending',
        priority: 'high',
        dueDate: '',
      });
    }
    const todayAppts = recentAppointments.filter(a => a.startTime >= todayStart);
    for (const appt of todayAppts.slice(0, 5)) {
      todos.push({
        id: `appt-${appt.id}`,
        type: 'appointment',
        title: `${appt.patientName} 预约`,
        status: appt.status,
        priority: 'medium',
        dueDate: appt.startTime,
      });
    }
    return todos;
  }
}
