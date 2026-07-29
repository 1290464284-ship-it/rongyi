import { AppointmentStatsService } from './appointment-stats.service';
import { ChargeStatsService } from './charge-stats.service';
import { DoctorStatsService } from './doctor-stats.service';
import { InventoryStatsService } from './inventory-stats.service';
import { MemberStatsService } from './member-stats.service';
import { PatientStatsService } from './patient-stats.service';
import { RevenueStatsService } from './revenue-stats.service';
import { DashboardStatsService } from './dashboard-stats.service';
import { DbService } from '../../../db/db.service';
import { CacheService } from '../../../common/services/cache.service';
import { ClinicContextService } from '../../../common/services/clinic-context.service';

/**
 * 创建 mock 依赖：CacheService.getOrSet 直接执行 factory（跳过缓存）
 */
function createMocks() {
  const db = {
    prepare: jest.fn(),
  } as unknown as DbService;

  const cache = {
    getOrSet: jest.fn((_key: string, factory: () => unknown) => factory()),
  } as unknown as CacheService;

  const clinicContext = {
    getClinicId: jest.fn().mockReturnValue('clinic-1'),
    getUserId: jest.fn().mockReturnValue(null),
    getRole: jest.fn().mockReturnValue(null),
    getSource: jest.fn().mockReturnValue(null),
  } as unknown as ClinicContextService;

  return { db, cache, clinicContext };
}

// ─── AppointmentStatsService ──────────────────────────────────────

describe('AppointmentStatsService', () => {
  it('getAppointmentStats 应返回 status/daily/monthly 结构', async () => {
    const { db, cache, clinicContext } = createMocks();
    const service = new AppointmentStatsService(db, cache, clinicContext);

    (db.prepare as jest.Mock).mockReturnValue({ all: jest.fn().mockReturnValue([]) });

    const result = await service.getAppointmentStats({});
    expect(result).toHaveProperty('status');
    expect(result).toHaveProperty('daily');
    expect(result).toHaveProperty('monthly');
    expect(Array.isArray(result.status)).toBe(true);
    expect(Array.isArray(result.daily)).toBe(true);
    expect(cache.getOrSet).toHaveBeenCalled();
  });

  it('带日期参数时应正常执行', async () => {
    const { db, cache, clinicContext } = createMocks();
    (db.prepare as jest.Mock).mockReturnValue({ all: jest.fn().mockReturnValue([]) });
    const service = new AppointmentStatsService(db, cache, clinicContext);
    const result = await service.getAppointmentStats({ startDate: '2026-01-01', endDate: '2026-12-31' });
    expect(result).toHaveProperty('status');
  });
});

// ─── ChargeStatsService ───────────────────────────────────────────

describe('ChargeStatsService', () => {
  it('getChargeStats 应返回 daily/monthly 结构，金额转为元', async () => {
    const { db, cache, clinicContext } = createMocks();
    (db.prepare as jest.Mock).mockReturnValue({ all: jest.fn().mockReturnValue([]) });
    const service = new ChargeStatsService(db, cache, clinicContext);

    const result = await service.getChargeStats({});
    expect(result).toHaveProperty('daily');
    expect(result).toHaveProperty('monthly');
    expect(cache.getOrSet).toHaveBeenCalled();
  });
});

// ─── DoctorStatsService ───────────────────────────────────────────

describe('DoctorStatsService', () => {
  it('doctorWorkload 应返回数组', async () => {
    const { db, cache, clinicContext } = createMocks();
    (db.prepare as jest.Mock).mockReturnValue({ all: jest.fn().mockReturnValue([]) });
    const service = new DoctorStatsService(db, cache, clinicContext);

    const result = await service.doctorWorkload({});
    expect(Array.isArray(result)).toBe(true);
    expect(cache.getOrSet).toHaveBeenCalled();
  });
});

// ─── InventoryStatsService ────────────────────────────────────────

describe('InventoryStatsService', () => {
  it('getInventoryStatus 应返回数组', async () => {
    const { db, cache, clinicContext } = createMocks();
    (db.prepare as jest.Mock).mockReturnValue({ all: jest.fn().mockReturnValue([]) });
    const service = new InventoryStatsService(db, cache, clinicContext);

    const result = await service.getInventoryStatus();
    expect(Array.isArray(result)).toBe(true);
    expect(cache.getOrSet).toHaveBeenCalled();
  });
});

// ─── MemberStatsService ───────────────────────────────────────────

describe('MemberStatsService', () => {
  it('getMemberStats 应返回完整统计结构', async () => {
    const { db, cache, clinicContext } = createMocks();
    let callIdx = 0;
    (db.prepare as jest.Mock).mockImplementation(() => {
      callIdx++;
      if (callIdx === 1) {
        // summary query
        return { get: jest.fn().mockReturnValue({ total: 10, active: 8, totalBalance: 50000, totalPoints: 2000 }) };
      }
      return { all: jest.fn().mockReturnValue([]) };
    });
    const service = new MemberStatsService(db, cache, clinicContext);

    const result = await service.getMemberStats();
    expect(result.total).toBe(10);
    expect(result.active).toBe(8);
    expect(result.expired).toBe(2);
    expect(result.totalMembers).toBe(10);
    expect(result.totalBalance).toBe('500'); // 50000 cents → 500 yuan
    expect(result.totalPoints).toBe(2000);
    expect(result).toHaveProperty('monthly');
    expect(result).toHaveProperty('levelDistribution');
  });

  it('无会员时 total/active 应为 0', async () => {
    const { db, cache, clinicContext } = createMocks();
    (db.prepare as jest.Mock).mockImplementation(() => ({
      get: jest.fn().mockReturnValue(undefined),
      all: jest.fn().mockReturnValue([]),
    }));
    const service = new MemberStatsService(db, cache, clinicContext);
    const result = await service.getMemberStats();
    expect(result.total).toBe(0);
    expect(result.active).toBe(0);
  });
});

// ─── PatientStatsService ──────────────────────────────────────────

describe('PatientStatsService', () => {
  it('getPatientGrowth 应返回累计增长数据', async () => {
    const { db, cache, clinicContext } = createMocks();
    (db.prepare as jest.Mock).mockReturnValue({
      all: jest.fn().mockReturnValue([
        { month: '2026-01', count: 5 },
        { month: '2026-02', count: 3 },
      ]),
    });
    const service = new PatientStatsService(db, cache, clinicContext);

    const result = await service.getPatientGrowth({});
    expect(result.items).toHaveLength(2);
    expect(result.items[0].total).toBe(5);
    expect(result.items[1].total).toBe(8); // 5 + 3
  });

  it('getPatientStats 应返回 daily/monthly', async () => {
    const { db, cache, clinicContext } = createMocks();
    (db.prepare as jest.Mock).mockReturnValue({ all: jest.fn().mockReturnValue([]) });
    const service = new PatientStatsService(db, cache, clinicContext);

    const result = await service.getPatientStats({});
    expect(result).toHaveProperty('daily');
    expect(result).toHaveProperty('monthly');
  });
});

// ─── RevenueStatsService ──────────────────────────────────────────

describe('RevenueStatsService', () => {
  it('revenue 应返回 daily/monthly/summary，金额转为元', async () => {
    const { db, cache, clinicContext } = createMocks();
    (db.prepare as jest.Mock).mockReturnValue({
      all: jest.fn().mockReturnValue([
        { date: '2026-01-01', count: 2, amount: 10000 },
      ]),
    });
    const service = new RevenueStatsService(db, cache, clinicContext);

    const result = await service.revenue({});
    expect(result).toHaveProperty('daily');
    expect(result).toHaveProperty('monthly');
    expect(result).toHaveProperty('summary');
    expect(result.summary.totalRevenue).toBe('100'); // 10000 cents → 100 yuan
    expect(result.summary.totalCount).toBe(2);
  });

  it('getRevenueByCategory 应计算百分比', async () => {
    const { db, cache, clinicContext } = createMocks();
    (db.prepare as jest.Mock).mockReturnValue({
      all: jest.fn().mockReturnValue([
        { category: '治疗', amount: 6000, count: 3 },
        { category: '药品', amount: 4000, count: 2 },
      ]),
    });
    const service = new RevenueStatsService(db, cache, clinicContext);

    const result = await service.getRevenueByCategory({});
    expect(result).toHaveLength(2);
    expect(result[0].percentage).toBe(60); // 6000/10000
    expect(result[1].percentage).toBe(40);
    expect(result[0].amount).toBe(60); // centsToYuan
  });

  it('getRevenueByDoctor 应返回数组', async () => {
    const { db, cache, clinicContext } = createMocks();
    (db.prepare as jest.Mock).mockReturnValue({ all: jest.fn().mockReturnValue([]) });
    const service = new RevenueStatsService(db, cache, clinicContext);

    const result = await service.getRevenueByDoctor({});
    expect(Array.isArray(result)).toBe(true);
  });
});

// ─── DashboardStatsService ────────────────────────────────────────

describe('DashboardStatsService', () => {
  it('dashboard 应返回完整仪表盘结构', async () => {
    const { db, cache, clinicContext } = createMocks();
    (db.prepare as jest.Mock).mockImplementation(() => ({
      get: jest.fn().mockReturnValue({ c: 0, newC: 0, todayCharges: 0, unpaidAmount: 0, monthRevenue: 0, totalIncome: 0, monthChargeCount: 0, unpaidCount: 0 }),
      all: jest.fn().mockReturnValue([]),
    }));
    const service = new DashboardStatsService(db, cache, clinicContext);

    const result = await service.dashboard();
    expect(result).toHaveProperty('today');
    expect(result).toHaveProperty('finance');
    expect(result).toHaveProperty('pendingCharges');
    expect(result).toHaveProperty('patients');
    expect(result).toHaveProperty('recentAppointments');
    expect(result).toHaveProperty('recentCharges');
    expect(result).toHaveProperty('todos');
    expect(cache.getOrSet).toHaveBeenCalled();
  });
});
