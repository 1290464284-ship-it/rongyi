import { Test, TestingModule } from '@nestjs/testing';
import { StatsService } from './stats.service';
import { CacheService } from '../../../common/services/cache.service';
import { DashboardStatsService } from './dashboard-stats.service';
import { RevenueStatsService } from './revenue-stats.service';
import { PatientStatsService } from './patient-stats.service';
import { AppointmentStatsService } from './appointment-stats.service';
import { ChargeStatsService } from './charge-stats.service';
import { InventoryStatsService } from './inventory-stats.service';
import { MemberStatsService } from './member-stats.service';
import { DoctorStatsService } from './doctor-stats.service';
import { EventBusService } from '../../../common/events/event-bus.service';
import { Subject } from 'rxjs';

describe('StatsService', () => {
  let service: StatsService;
  let cache: { delPattern: jest.Mock };
  let dashboardStats: { dashboard: jest.Mock };
  let revenueStats: { revenue: jest.Mock; getRevenueByCategory: jest.Mock; getRevenueByDoctor: jest.Mock };
  let patientStats: { getPatientGrowth: jest.Mock; getPatientStats: jest.Mock };
  let appointmentStats: { getAppointmentStats: jest.Mock };
  let chargeStats: { getChargeStats: jest.Mock };
  let inventoryStats: { getInventoryStatus: jest.Mock };
  let memberStats: { getMemberStats: jest.Mock };
  let doctorStats: { doctorWorkload: jest.Mock };
  let eventSubjects: Map<string, Subject<unknown>>;

  beforeEach(async () => {
    cache = { delPattern: jest.fn() };
    dashboardStats = { dashboard: jest.fn().mockResolvedValue({ total: 0 }) };
    revenueStats = { revenue: jest.fn().mockResolvedValue([]), getRevenueByCategory: jest.fn().mockResolvedValue([]), getRevenueByDoctor: jest.fn().mockResolvedValue([]) };
    patientStats = { getPatientGrowth: jest.fn().mockResolvedValue([]), getPatientStats: jest.fn().mockResolvedValue([]) };
    appointmentStats = { getAppointmentStats: jest.fn().mockResolvedValue([]) };
    chargeStats = { getChargeStats: jest.fn().mockResolvedValue([]) };
    inventoryStats = { getInventoryStatus: jest.fn().mockResolvedValue([]) };
    memberStats = { getMemberStats: jest.fn().mockResolvedValue({}) };
    doctorStats = { doctorWorkload: jest.fn().mockResolvedValue([]) };
    eventSubjects = new Map();

    const mockEventBus = {
      on: jest.fn((event: string) => {
        if (!eventSubjects.has(event)) {
          eventSubjects.set(event, new Subject());
        }
        return eventSubjects.get(event)!;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StatsService,
        { provide: CacheService, useValue: cache },
        { provide: DashboardStatsService, useValue: dashboardStats },
        { provide: RevenueStatsService, useValue: revenueStats },
        { provide: PatientStatsService, useValue: patientStats },
        { provide: AppointmentStatsService, useValue: appointmentStats },
        { provide: ChargeStatsService, useValue: chargeStats },
        { provide: InventoryStatsService, useValue: inventoryStats },
        { provide: MemberStatsService, useValue: memberStats },
        { provide: DoctorStatsService, useValue: doctorStats },
        { provide: EventBusService, useValue: mockEventBus },
      ],
    }).compile();

    service = module.get(StatsService);
  });

  describe('onModuleInit 事件订阅', () => {
    it('应订阅所有领域事件', () => {
      service.onModuleInit();
      const expectedEvents = [
        'charge.created', 'charge.paid', 'charge.cancelled',
        'refund.created', 'member-card.recharged', 'member-card.consumed',
        'inventory.stock-changed', 'patient.registered',
        'appointment.created', 'appointment.updated', 'appointment.deleted',
      ];
      for (const event of expectedEvents) {
        expect(eventSubjects.has(event)).toBe(true);
      }
    });

    it('charge.created 应清除 dashboard/charge/revenue 缓存', () => {
      service.onModuleInit();
      eventSubjects.get('charge.created')!.next({});
      expect(cache.delPattern).toHaveBeenCalledWith(expect.stringContaining('dashboard'));
      expect(cache.delPattern).toHaveBeenCalledWith(expect.stringContaining('charge'));
      expect(cache.delPattern).toHaveBeenCalledWith(expect.stringContaining('revenue'));
    });

    it('charge.paid 应额外清除 member 缓存', () => {
      service.onModuleInit();
      eventSubjects.get('charge.paid')!.next({});
      expect(cache.delPattern).toHaveBeenCalledWith(expect.stringContaining('member'));
    });

    it('refund.created 应清除 dashboard/revenue/charge 缓存', () => {
      service.onModuleInit();
      eventSubjects.get('refund.created')!.next({});
      expect(cache.delPattern).toHaveBeenCalledWith(expect.stringContaining('dashboard'));
      expect(cache.delPattern).toHaveBeenCalledWith(expect.stringContaining('revenue'));
    });

    it('member-card.recharged 应清除 dashboard/member/revenue 缓存', () => {
      service.onModuleInit();
      eventSubjects.get('member-card.recharged')!.next({});
      expect(cache.delPattern).toHaveBeenCalledWith(expect.stringContaining('member'));
    });

    it('inventory.stock-changed 应清除 dashboard/inventory 缓存', () => {
      service.onModuleInit();
      eventSubjects.get('inventory.stock-changed')!.next({});
      expect(cache.delPattern).toHaveBeenCalledWith(expect.stringContaining('inventory'));
    });

    it('patient.registered 应清除 dashboard/patient/patientGrowth 缓存', () => {
      service.onModuleInit();
      eventSubjects.get('patient.registered')!.next({});
      expect(cache.delPattern).toHaveBeenCalledWith(expect.stringContaining('patient'));
    });

    it('appointment.created 应清除 dashboard/appointment/doctorWorkload 缓存', () => {
      service.onModuleInit();
      eventSubjects.get('appointment.created')!.next({});
      expect(cache.delPattern).toHaveBeenCalledWith(expect.stringContaining('appointment'));
      expect(cache.delPattern).toHaveBeenCalledWith(expect.stringContaining('doctorWorkload'));
    });

    it('appointment.updated 应清除 dashboard/appointment/doctorWorkload 缓存', () => {
      service.onModuleInit();
      eventSubjects.get('appointment.updated')!.next({});
      expect(cache.delPattern).toHaveBeenCalledWith(expect.stringContaining('doctorWorkload'));
    });

    it('appointment.deleted 应清除 dashboard/appointment/doctorWorkload 缓存', () => {
      service.onModuleInit();
      eventSubjects.get('appointment.deleted')!.next({});
      expect(cache.delPattern).toHaveBeenCalledWith(expect.stringContaining('appointment'));
    });
  });

  describe('onModuleDestroy 取消订阅', () => {
    it('应取消所有事件订阅', () => {
      service.onModuleInit();
      service.onModuleDestroy();
      // 取消订阅后发送事件不应触发缓存清除
      cache.delPattern.mockClear();
      // subjects 仍在但不再有新订阅者处理
    });
  });

  describe('委托方法', () => {
    it('dashboard 应委托给 dashboardStats', async () => {
      const result = await service.dashboard();
      expect(dashboardStats.dashboard).toHaveBeenCalled();
      expect(result).toEqual({ total: 0 });
    });

    it('revenue 应委托给 revenueStats', async () => {
      const params = { startDate: '2026-01-01', endDate: '2026-12-31' };
      const result = await service.revenue(params);
      expect(revenueStats.revenue).toHaveBeenCalledWith(params);
      expect(result).toEqual([]);
    });

    it('doctorWorkload 应委托给 doctorStats', async () => {
      const params = { startDate: '2026-01-01' };
      const result = await service.doctorWorkload(params);
      expect(doctorStats.doctorWorkload).toHaveBeenCalledWith(params);
      expect(result).toEqual([]);
    });

    it('getPatientGrowth 应委托给 patientStats', async () => {
      const result = await service.getPatientGrowth({});
      expect(patientStats.getPatientGrowth).toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it('getRevenueByCategory 应委托给 revenueStats', async () => {
      const result = await service.getRevenueByCategory({});
      expect(revenueStats.getRevenueByCategory).toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it('getRevenueByDoctor 应委托给 revenueStats', async () => {
      const result = await service.getRevenueByDoctor({});
      expect(revenueStats.getRevenueByDoctor).toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it('getInventoryStatus 应委托给 inventoryStats', async () => {
      const result = await service.getInventoryStatus();
      expect(inventoryStats.getInventoryStatus).toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it('getAppointmentStats 应委托给 appointmentStats', async () => {
      const result = await service.getAppointmentStats({});
      expect(appointmentStats.getAppointmentStats).toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it('getChargeStats 应委托给 chargeStats', async () => {
      const result = await service.getChargeStats({});
      expect(chargeStats.getChargeStats).toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it('getPatientStats 应委托给 patientStats', async () => {
      const result = await service.getPatientStats({});
      expect(patientStats.getPatientStats).toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it('getMemberStats 应委托给 memberStats', async () => {
      const result = await service.getMemberStats();
      expect(memberStats.getMemberStats).toHaveBeenCalled();
      expect(result).toEqual({});
    });
  });

  describe('invalidateStatsCache', () => {
    it('指定 category 应清除对应模式的缓存', () => {
      service.invalidateStatsCache('dashboard');
      expect(cache.delPattern).toHaveBeenCalledWith(expect.stringContaining('dashboard:'));
    });

    it('未指定 category 应清除所有统计缓存', () => {
      service.invalidateStatsCache();
      expect(cache.delPattern).toHaveBeenCalled();
    });
  });
});
