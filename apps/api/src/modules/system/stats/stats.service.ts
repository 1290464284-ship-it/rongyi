import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { Subscription } from 'rxjs';
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
import { EventBusService } from "../../../common/events/event-bus.service";
import {
  ChargeCreatedEvent,
  ChargePaidEvent,
  ChargeCancelledEvent,
  RefundCreatedEvent,
  MemberCardRechargedEvent,
  MemberCardConsumedEvent,
  InventoryStockChangedEvent,
  PatientRegisteredEvent,
  AppointmentCreatedEvent,
  AppointmentUpdatedEvent,
  AppointmentDeletedEvent,
} from "../../../common/events/domain-events";

export * from "./stats.interfaces";

@Injectable()
export class StatsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StatsService.name);
  private subscriptions: Subscription[] = [];

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
    private eventBus: EventBusService,
  ) {}

  onModuleInit() {
    // P1 修复：保存订阅引用，onModuleDestroy 时取消订阅，防止内存泄漏
    this.subscriptions.push(
      this.eventBus.on<ChargeCreatedEvent>('charge.created').subscribe(() => {
        this.invalidateStatsCache('dashboard');
        this.invalidateStatsCache('charge');
        this.invalidateStatsCache('revenue');
        this.invalidateStatsCache('doctorWorkload');
        this.invalidateStatsCache('revenueByDoctor');
        this.invalidateStatsCache('revenueByCategory');
      }),

      this.eventBus.on<ChargePaidEvent>('charge.paid').subscribe(() => {
        this.invalidateStatsCache('dashboard');
        this.invalidateStatsCache('revenue');
        this.invalidateStatsCache('charge');
        this.invalidateStatsCache('doctorWorkload');
        this.invalidateStatsCache('revenueByDoctor');
        this.invalidateStatsCache('revenueByCategory');
        this.invalidateStatsCache('member');
      }),

      this.eventBus.on<ChargeCancelledEvent>('charge.cancelled').subscribe(() => {
        this.invalidateStatsCache('dashboard');
        this.invalidateStatsCache('charge');
        this.invalidateStatsCache('revenue');
        this.invalidateStatsCache('doctorWorkload');
        this.invalidateStatsCache('revenueByDoctor');
        this.invalidateStatsCache('revenueByCategory');
      }),

      this.eventBus.on<RefundCreatedEvent>('refund.created').subscribe(() => {
        this.invalidateStatsCache('dashboard');
        this.invalidateStatsCache('revenue');
        this.invalidateStatsCache('charge');
        this.invalidateStatsCache('doctorWorkload');
        this.invalidateStatsCache('revenueByDoctor');
        this.invalidateStatsCache('revenueByCategory');
        this.invalidateStatsCache('member');
      }),

      this.eventBus.on<MemberCardRechargedEvent>('member-card.recharged').subscribe(() => {
        this.invalidateStatsCache('dashboard');
        this.invalidateStatsCache('member');
        this.invalidateStatsCache('revenue');
      }),

      this.eventBus.on<MemberCardConsumedEvent>('member-card.consumed').subscribe(() => {
        this.invalidateStatsCache('dashboard');
        this.invalidateStatsCache('member');
        this.invalidateStatsCache('revenue');
      }),

      this.eventBus.on<InventoryStockChangedEvent>('inventory.stock-changed').subscribe(() => {
        this.invalidateStatsCache('dashboard');
        this.invalidateStatsCache('inventory');
      }),

      this.eventBus.on<PatientRegisteredEvent>('patient.registered').subscribe(() => {
        this.invalidateStatsCache('dashboard');
        this.invalidateStatsCache('patient');
        this.invalidateStatsCache('patientGrowth');
      }),

      this.eventBus.on<AppointmentCreatedEvent>('appointment.created').subscribe(() => {
        this.invalidateStatsCache('dashboard');
        this.invalidateStatsCache('appointment');
        this.invalidateStatsCache('doctorWorkload');
      }),

      this.eventBus.on<AppointmentUpdatedEvent>('appointment.updated').subscribe(() => {
        this.invalidateStatsCache('dashboard');
        this.invalidateStatsCache('appointment');
        this.invalidateStatsCache('doctorWorkload');
      }),

      this.eventBus.on<AppointmentDeletedEvent>('appointment.deleted').subscribe(() => {
        this.invalidateStatsCache('dashboard');
        this.invalidateStatsCache('appointment');
        this.invalidateStatsCache('doctorWorkload');
      }),
    );

    this.logger.log('StatsService 已订阅领域事件');
  }

  onModuleDestroy() {
    // P1 修复：取消所有事件订阅，防止模块销毁后内存泄漏
    for (const sub of this.subscriptions) {
      sub.unsubscribe();
    }
    this.subscriptions = [];
    this.logger.log('StatsService 已取消订阅领域事件');
  }

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
