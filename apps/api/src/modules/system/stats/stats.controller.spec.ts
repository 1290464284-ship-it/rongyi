import { Test, TestingModule } from '@nestjs/testing';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';

describe('StatsController', () => {
  let controller: StatsController;
  let service: { [key: string]: jest.Mock };

  beforeEach(async () => {
    service = {
      dashboard: jest.fn(),
      revenue: jest.fn(),
      doctorWorkload: jest.fn(),
      getPatientGrowth: jest.fn(),
      getRevenueByCategory: jest.fn(),
      getRevenueByDoctor: jest.fn(),
      getInventoryStatus: jest.fn(),
      getAppointmentStats: jest.fn(),
      getMemberStats: jest.fn(),
      getChargeStats: jest.fn(),
      getPatientStats: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StatsController],
      providers: [{ provide: StatsService, useValue: service }],
    }).compile();

    controller = module.get(StatsController);
  });

  describe('dashboard', () => {
    it('调用 service.dashboard 获取仪表盘数据', async () => {
      const expected = { totalPatients: 100, todayRevenue: 5000 };
      service.dashboard.mockResolvedValue(expected);

      const result = await controller.dashboard();
      expect(result).toEqual(expected);
      expect(service.dashboard).toHaveBeenCalled();
    });
  });

  describe('revenue', () => {
    it('调用 service.revenue 不传参数', async () => {
      const expected = [];
      service.revenue.mockResolvedValue(expected);

      const result = await controller.revenue();
      expect(result).toEqual(expected);
      expect(service.revenue).toHaveBeenCalledWith({ startDate: undefined, endDate: undefined, groupBy: undefined });
    });

    it('调用 service.revenue 传入所有参数', async () => {
      const expected = [{ date: '2024-01-01', amount: 1000 }];
      service.revenue.mockResolvedValue(expected);

      const result = await controller.revenue('2024-01-01', '2024-01-31', 'day');
      expect(result).toEqual(expected);
      expect(service.revenue).toHaveBeenCalledWith({ startDate: '2024-01-01', endDate: '2024-01-31', groupBy: 'day' });
    });
  });

  describe('doctorWorkload', () => {
    it('调用 service.doctorWorkload 不传参数', async () => {
      const expected = [];
      service.doctorWorkload.mockResolvedValue(expected);

      const result = await controller.doctorWorkload();
      expect(result).toEqual(expected);
      expect(service.doctorWorkload).toHaveBeenCalledWith({ startDate: undefined, endDate: undefined });
    });

    it('调用 service.doctorWorkload 传入日期参数', async () => {
      const expected = [{ doctorId: 'd-1', doctorName: '医生A', count: 10 }];
      service.doctorWorkload.mockResolvedValue(expected);

      const result = await controller.doctorWorkload('2024-01-01', '2024-01-31');
      expect(result).toEqual(expected);
      expect(service.doctorWorkload).toHaveBeenCalledWith({ startDate: '2024-01-01', endDate: '2024-01-31' });
    });
  });

  describe('patientGrowth', () => {
    it('调用 service.getPatientGrowth 不传参数', async () => {
      const expected = [];
      service.getPatientGrowth.mockResolvedValue(expected);

      const result = await controller.patientGrowth();
      expect(result).toEqual(expected);
      expect(service.getPatientGrowth).toHaveBeenCalledWith({ startDate: undefined, endDate: undefined });
    });

    it('调用 service.getPatientGrowth 传入日期参数', async () => {
      const expected = [{ date: '2024-01-01', count: 5 }];
      service.getPatientGrowth.mockResolvedValue(expected);

      const result = await controller.patientGrowth('2024-01-01', '2024-01-31');
      expect(result).toEqual(expected);
      expect(service.getPatientGrowth).toHaveBeenCalledWith({ startDate: '2024-01-01', endDate: '2024-01-31' });
    });
  });

  describe('revenueByCategory', () => {
    it('调用 service.getRevenueByCategory 不传参数', async () => {
      const expected = [];
      service.getRevenueByCategory.mockResolvedValue(expected);

      const result = await controller.revenueByCategory();
      expect(result).toEqual(expected);
      expect(service.getRevenueByCategory).toHaveBeenCalledWith({ startDate: undefined, endDate: undefined });
    });

    it('调用 service.getRevenueByCategory 传入日期参数', async () => {
      const expected = [{ category: '检查费', amount: 5000 }];
      service.getRevenueByCategory.mockResolvedValue(expected);

      const result = await controller.revenueByCategory('2024-01-01', '2024-01-31');
      expect(result).toEqual(expected);
      expect(service.getRevenueByCategory).toHaveBeenCalledWith({ startDate: '2024-01-01', endDate: '2024-01-31' });
    });
  });

  describe('revenueByDoctor', () => {
    it('调用 service.getRevenueByDoctor 不传参数', async () => {
      const expected = [];
      service.getRevenueByDoctor.mockResolvedValue(expected);

      const result = await controller.revenueByDoctor();
      expect(result).toEqual(expected);
      expect(service.getRevenueByDoctor).toHaveBeenCalledWith({ startDate: undefined, endDate: undefined });
    });

    it('调用 service.getRevenueByDoctor 传入日期参数', async () => {
      const expected = [{ doctorId: 'd-1', doctorName: '医生A', amount: 10000 }];
      service.getRevenueByDoctor.mockResolvedValue(expected);

      const result = await controller.revenueByDoctor('2024-01-01', '2024-01-31');
      expect(result).toEqual(expected);
      expect(service.getRevenueByDoctor).toHaveBeenCalledWith({ startDate: '2024-01-01', endDate: '2024-01-31' });
    });
  });

  describe('inventoryStatus', () => {
    it('调用 service.getInventoryStatus 获取库存统计', async () => {
      const expected = [{ category: '耗材', count: 50, totalStock: 1000 }];
      service.getInventoryStatus.mockResolvedValue(expected);

      const result = await controller.inventoryStatus();
      expect(result).toEqual(expected);
      expect(service.getInventoryStatus).toHaveBeenCalled();
    });
  });

  describe('appointmentStats', () => {
    it('调用 service.getAppointmentStats 不传参数', async () => {
      const expected = [];
      service.getAppointmentStats.mockResolvedValue(expected);

      const result = await controller.appointmentStats();
      expect(result).toEqual(expected);
      expect(service.getAppointmentStats).toHaveBeenCalledWith({ startDate: undefined, endDate: undefined });
    });

    it('调用 service.getAppointmentStats 传入日期参数', async () => {
      const expected = [{ date: '2024-01-01', count: 10 }];
      service.getAppointmentStats.mockResolvedValue(expected);

      const result = await controller.appointmentStats('2024-01-01', '2024-01-31');
      expect(result).toEqual(expected);
      expect(service.getAppointmentStats).toHaveBeenCalledWith({ startDate: '2024-01-01', endDate: '2024-01-31' });
    });
  });

  describe('appointmentStatusStats', () => {
    it('调用 service.getAppointmentStats 不传参数', async () => {
      const expected = [];
      service.getAppointmentStats.mockResolvedValue(expected);

      const result = await controller.appointmentStatusStats();
      expect(result).toEqual(expected);
      expect(service.getAppointmentStats).toHaveBeenCalledWith({ startDate: undefined, endDate: undefined });
    });

    it('调用 service.getAppointmentStats 传入日期参数', async () => {
      const expected = [{ status: 'confirmed', count: 8 }];
      service.getAppointmentStats.mockResolvedValue(expected);

      const result = await controller.appointmentStatusStats('2024-01-01', '2024-01-31');
      expect(result).toEqual(expected);
      expect(service.getAppointmentStats).toHaveBeenCalledWith({ startDate: '2024-01-01', endDate: '2024-01-31' });
    });
  });

  describe('memberStats', () => {
    it('调用 service.getMemberStats 获取会员统计', async () => {
      const expected = { total: 100, active: 80, totalBalance: 50000 };
      service.getMemberStats.mockResolvedValue(expected);

      const result = await controller.memberStats();
      expect(result).toEqual(expected);
      expect(service.getMemberStats).toHaveBeenCalled();
    });
  });

  describe('chargeStats', () => {
    it('调用 service.getChargeStats 不传参数', async () => {
      const expected = [];
      service.getChargeStats.mockResolvedValue(expected);

      const result = await controller.chargeStats();
      expect(result).toEqual(expected);
      expect(service.getChargeStats).toHaveBeenCalledWith({ startDate: undefined, endDate: undefined });
    });

    it('调用 service.getChargeStats 传入日期参数', async () => {
      const expected = [{ date: '2024-01-01', count: 5, amount: 2000 }];
      service.getChargeStats.mockResolvedValue(expected);

      const result = await controller.chargeStats('2024-01-01', '2024-01-31');
      expect(result).toEqual(expected);
      expect(service.getChargeStats).toHaveBeenCalledWith({ startDate: '2024-01-01', endDate: '2024-01-31' });
    });
  });

  describe('patientStats', () => {
    it('调用 service.getPatientStats 不传参数', async () => {
      const expected = [];
      service.getPatientStats.mockResolvedValue(expected);

      const result = await controller.patientStats();
      expect(result).toEqual(expected);
      expect(service.getPatientStats).toHaveBeenCalledWith({ startDate: undefined, endDate: undefined });
    });

    it('调用 service.getPatientStats 传入日期参数', async () => {
      const expected = [{ date: '2024-01-01', newCount: 3, total: 100 }];
      service.getPatientStats.mockResolvedValue(expected);

      const result = await controller.patientStats('2024-01-01', '2024-01-31');
      expect(result).toEqual(expected);
      expect(service.getPatientStats).toHaveBeenCalledWith({ startDate: '2024-01-01', endDate: '2024-01-31' });
    });
  });
});
