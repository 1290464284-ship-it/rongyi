import { Injectable } from "@nestjs/common";
import { CacheService } from "../../../common/services/cache.service";
import { CACHE_PREFIXES } from "../../../common/constants/cache-keys";
import { DashboardStatsService } from "./dashboard-stats.service";
import { RevenueStatsService } from "./revenue-stats.service";
import { PatientStatsService } from "./patient-stats.service";
import { AppointmentStatsService } from "./appointment-stats.service";
import { ChargeStatsService } from "./charge-stats.service";
import { InventoryStatsService } from "./inventory-stats.service";
import { MemberStatsService } from "./member-stats.service";
import { DoctorStatsService } from "./doctor-stats.service";
import { StatsCacheCategory } from "./stats.interfaces";

export * from "./stats.interfaces";

@Injectable()
export class StatsService {
  constructor(
    private cache: CacheService,
    private dashboardStats: DashboardStatsService,
    private revenueStats: RevenueStatsService,
    private patientStats: PatientStatsService,
    private appointmentStats: AppointmentStatsService,
    private chargeStats: ChargeStatsService,
    private inventoryStats: InventoryStatsService,
    private memberStats: MemberStatsService,
    private doctorStats: DoctorStatsService,
  ) {}

  async dashboard() {
    return this.dashboardStats.dashboard();
  }

  async revenue(params: { startDate?: string; endDate?: string; groupBy?: string }) {
    return this.revenueStats.revenue(params);
  }

  async doctorWorkload(params: { startDate?: string; endDate?: string }) {
    return this.doctorStats.doctorWorkload(params);
  }

  async getPatientGrowth(params: { startDate?: string; endDate?: string }) {
    return this.patientStats.getPatientGrowth(params);
  }

  async getRevenueByCategory(params: { startDate?: string; endDate?: string }) {
    return this.revenueStats.getRevenueByCategory(params);
  }

  async getRevenueByDoctor(params: { startDate?: string; endDate?: string }) {
    return this.revenueStats.getRevenueByDoctor(params);
  }

  async getInventoryStatus() {
    return this.inventoryStats.getInventoryStatus();
  }

  async getAppointmentStats(params: { startDate?: string; endDate?: string }) {
    return this.appointmentStats.getAppointmentStats(params);
  }

  async getChargeStats(params: { startDate?: string; endDate?: string }) {
    return this.chargeStats.getChargeStats(params);
  }

  async getPatientStats(params: { startDate?: string; endDate?: string }) {
    return this.patientStats.getPatientStats(params);
  }

  async getMemberStats() {
    return this.memberStats.getMemberStats();
  }

  invalidateStatsCache(category?: StatsCacheCategory): void {
    if (category) {
      this.cache.delPattern(`${CACHE_PREFIXES.STATS}${category}:`);
    } else {
      this.cache.delPattern(CACHE_PREFIXES.STATS);
    }
  }
}
