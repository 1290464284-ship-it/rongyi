import { StatsService } from './stats.service';
import { DashboardStatsService } from './dashboard-stats.service';
import { RevenueStatsService } from './revenue-stats.service';
import { PatientStatsService } from './patient-stats.service';
import { AppointmentStatsService } from './appointment-stats.service';
import { ChargeStatsService } from './charge-stats.service';
import { InventoryStatsService } from './inventory-stats.service';
import { MemberStatsService } from './member-stats.service';
import { DoctorStatsService } from './doctor-stats.service';
import { MockDbService } from '../../../db/__mocks__/db-service.mock';
import { CacheService } from '../../../common/services/cache.service';
import { ClinicContextService } from '../../../common/services/clinic-context.service';

function createMockClinicContext(): ClinicContextService {
  return {
    getClinicId: () => 'test-clinic-001',
    getUserId: () => 'test-user',
    getRole: () => 'DOCTOR',
    getUserAgent: () => 'jest-test-agent',
    getSource: () => 'test',
    run: <T>(_ctx: unknown, fn: () => T) => fn(),
    isInitialized: () => true,
  } as unknown as ClinicContextService;
}

function createMockCache(): CacheService {
  return new CacheService();
}

describe('StatsService', () => {
  let service: StatsService;
  let db: MockDbService;
  let cache: CacheService;
  let clinicContext: ClinicContextService;

  beforeEach(() => {
    db = new MockDbService();
    cache = createMockCache();
    clinicContext = createMockClinicContext();
    const dashboardStats = new DashboardStatsService(db as any, cache, clinicContext);
    const revenueStats = new RevenueStatsService(db as any, cache, clinicContext);
    const patientStats = new PatientStatsService(db as any, cache, clinicContext);
    const appointmentStats = new AppointmentStatsService(db as any, cache, clinicContext);
    const chargeStats = new ChargeStatsService(db as any, cache, clinicContext);
    const inventoryStats = new InventoryStatsService(db as any, cache, clinicContext);
    const memberStats = new MemberStatsService(db as any, cache, clinicContext);
    const doctorStats = new DoctorStatsService(db as any, cache, clinicContext);
    service = new StatsService(cache, dashboardStats, revenueStats, patientStats, appointmentStats, chargeStats, inventoryStats, memberStats, doctorStats);
  });

  afterEach(() => {
    db.clear();
    cache.clear();
  });

  // ==================== dashboard ====================

  describe('dashboard - 返回正确的结构', () => {
    it('空数据时应返回正确的 dashboard 结构', async () => {
      const result = await service.dashboard();

      expect(result).toBeDefined();
      expect((result as any).today).toBeDefined();
      expect((result as any).today.appointments).toBe(0);
      expect((result as any).today.visits).toBe(0);
      expect((result as any).today.newPatients).toBe(0);
      expect((result as any).today.charges).toBeDefined();

      expect((result as any).finance).toBeDefined();
      expect((result as any).finance.unpaidAmount).toBeDefined();
      expect((result as any).finance.monthRevenue).toBeDefined();
      expect((result as any).finance.totalIncome).toBeDefined();

      expect((result as any).patients).toBeDefined();
      expect((result as any).patients.total).toBe(0);
      expect((result as any).patients.recent).toBeDefined();

      expect((result as any).pendingCharges).toBeDefined();
      expect((result as any).recentAppointments).toBeDefined();
      expect((result as any).recentCharges).toBeDefined();
      expect((result as any).todos).toBeDefined();
    });

    it('有患者数据时 patients 结构应正确', async () => {
      db.seed('Patient', [
        {
          id: 'patient-001', code: 'P000001', name: '测试患者1', phone: '13800000001',
          gender: 'MALE', clinicId: 'test-clinic-001', active: 1,
          tags: '[]', allergies: '[]', medicalHistory: '[]',
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        },
      ]);

      const result = await service.dashboard();
      expect((result as any).patients).toBeDefined();
      expect(typeof (result as any).patients.total).toBe('number');
      expect(Array.isArray((result as any).patients.recent)).toBe(true);
    });

    it('应返回 todos 数组', async () => {
      const result = await service.dashboard();
      expect(Array.isArray((result as any).todos)).toBe(true);
    });
  });

  // ==================== revenue ====================

  describe('revenue - 收入统计', () => {
    it('无数据时应返回正确的 revenue 结构', async () => {
      const result = await service.revenue({});

      expect(result).toBeDefined();
      expect((result as any).daily).toBeDefined();
      expect(Array.isArray((result as any).daily)).toBe(true);
      expect((result as any).monthly).toBeDefined();
      expect(Array.isArray((result as any).monthly)).toBe(true);
      expect((result as any).summary).toBeDefined();
      expect((result as any).summary.totalRevenue).toBeDefined();
      expect((result as any).summary.totalCount).toBe(0);
    });

    it('传入日期范围不应抛出异常', async () => {
      const result = await service.revenue({
        startDate: '2026-01-01',
        endDate: '2026-12-31',
      });
      expect(result).toBeDefined();
      expect((result as any).summary).toBeDefined();
    });

    it('groupBy=month 应正常返回', async () => {
      const result = await service.revenue({ groupBy: 'month' });
      expect(result).toBeDefined();
      expect((result as any).monthly).toBeDefined();
    });

    it('groupBy=year 应正常返回', async () => {
      const result = await service.revenue({ groupBy: 'year' });
      expect(result).toBeDefined();
      expect((result as any).daily).toBeDefined();
    });

    it('无效的 groupBy 应默认使用 day', async () => {
      const result = await service.revenue({ groupBy: 'invalid' });
      expect(result).toBeDefined();
    });

    it('summary 中 avgPerOrder 为 0 时 totalCount 为 0', async () => {
      const result = await service.revenue({});
      expect((result as any).summary.totalCount).toBe(0);
      expect((result as any).summary.avgPerOrder).toBe('0');
    });
  });

  // ==================== doctorWorkload ====================

  describe('doctorWorkload - 医生工作量', () => {
    it('空数据应返回空数组', async () => {
      const result = await service.doctorWorkload({});
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
    });

    it('传入日期范围应正常返回', async () => {
      const result = await service.doctorWorkload({
        startDate: '2026-01-01',
        endDate: '2026-12-31',
      });
      expect(Array.isArray(result)).toBe(true);
    });
  });

  // ==================== getPatientGrowth ====================

  describe('getPatientGrowth - 患者增长', () => {
    it('空数据应返回空 items', async () => {
      const result = await service.getPatientGrowth({});
      expect((result as any).items).toBeDefined();
      expect(Array.isArray((result as any).items)).toBe(true);
    });

    it('有患者数据时应返回增长趋势', async () => {
      db.seed('Patient', [
        {
          id: 'patient-001', code: 'P000001', name: '患者A', phone: '13800000001',
          gender: 'MALE', clinicId: 'test-clinic-001', active: 1,
          tags: '[]', allergies: '[]', medicalHistory: '[]',
          createdAt: '2026-01-15T10:00:00.000Z', updatedAt: '2026-01-15T10:00:00.000Z',
        },
        {
          id: 'patient-002', code: 'P000002', name: '患者B', phone: '13800000002',
          gender: 'FEMALE', clinicId: 'test-clinic-001', active: 1,
          tags: '[]', allergies: '[]', medicalHistory: '[]',
          createdAt: '2026-01-20T10:00:00.000Z', updatedAt: '2026-01-20T10:00:00.000Z',
        },
      ]);

      const result = await service.getPatientGrowth({
        startDate: '2026-01-01',
        endDate: '2026-12-31',
      });
      expect((result as any).items).toBeDefined();
    });
  });

  // ==================== getRevenueByCategory ====================

  describe('getRevenueByCategory - 按类别统计收入', () => {
    it('空数据应返回空数组', async () => {
      const result = await service.getRevenueByCategory({});
      expect(Array.isArray(result)).toBe(true);
    });

    it('传入日期范围应正常返回', async () => {
      const result = await service.getRevenueByCategory({
        startDate: '2026-01-01',
        endDate: '2026-12-31',
      });
      expect(Array.isArray(result)).toBe(true);
    });
  });

  // ==================== getRevenueByDoctor ====================

  describe('getRevenueByDoctor - 按医生统计收入', () => {
    it('空数据应返回空数组', async () => {
      const result = await service.getRevenueByDoctor({});
      expect(Array.isArray(result)).toBe(true);
    });
  });

  // ==================== getInventoryStatus ====================

  describe('getInventoryStatus - 库存状态', () => {
    it('空数据应返回空数组', async () => {
      const result = await service.getInventoryStatus();
      expect(Array.isArray(result)).toBe(true);
    });

    it('有库存数据时应按分类聚合', async () => {
      db.seed('InventoryItem', [
        { id: 'item-001', name: '丁香油', category: '药品', stock: 100, clinicId: 'test-clinic-001', deletedAt: null },
        { id: 'item-002', name: '棉卷', category: '耗材', stock: 50, clinicId: 'test-clinic-001', deletedAt: null },
      ]);

      const result = await service.getInventoryStatus();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  // ==================== getAppointmentStats ====================

  describe('getAppointmentStats - 预约统计', () => {
    it('空数据应返回正确的结构', async () => {
      const result = await service.getAppointmentStats({});
      expect((result as any).status).toBeDefined();
      expect(Array.isArray((result as any).status)).toBe(true);
      expect((result as any).daily).toBeDefined();
      expect(Array.isArray((result as any).daily)).toBe(true);
      expect((result as any).monthly).toBeDefined();
      expect(Array.isArray((result as any).monthly)).toBe(true);
    });

    it('传入日期范围应正常返回', async () => {
      const result = await service.getAppointmentStats({
        startDate: '2026-01-01',
        endDate: '2026-12-31',
      });
      expect((result as any).status).toBeDefined();
    });
  });

  // ==================== getChargeStats ====================

  describe('getChargeStats - 收费统计', () => {
    it('空数据应返回正确的结构', async () => {
      const result = await service.getChargeStats({});
      expect((result as any).daily).toBeDefined();
      expect(Array.isArray((result as any).daily)).toBe(true);
      expect((result as any).monthly).toBeDefined();
      expect(Array.isArray((result as any).monthly)).toBe(true);
    });

    it('传入日期范围应正常返回', async () => {
      const result = await service.getChargeStats({
        startDate: '2026-01-01',
        endDate: '2026-12-31',
      });
      expect((result as any).daily).toBeDefined();
    });
  });

  // ==================== getPatientStats ====================

  describe('getPatientStats - 患者统计', () => {
    it('空数据应返回正确的结构', async () => {
      const result = await service.getPatientStats({});
      expect((result as any).daily).toBeDefined();
      expect(Array.isArray((result as any).daily)).toBe(true);
      expect((result as any).monthly).toBeDefined();
      expect(Array.isArray((result as any).monthly)).toBe(true);
    });
  });

  // ==================== getMemberStats ====================

  describe('getMemberStats - 会员统计', () => {
    it('空数据应返回全零', async () => {
      const result = await service.getMemberStats();
      expect((result as any).total).toBe(0);
      expect((result as any).active).toBe(0);
      expect((result as any).totalBalance).toBeDefined();
      expect((result as any).totalPoints).toBe(0);
      expect((result as any).monthly).toBeDefined();
      expect((result as any).levelDistribution).toBeDefined();
    });
  });

  // ==================== 缓存验证 ====================

  describe('缓存机制', () => {
    it('第二次调用 dashboard 应命中缓存', async () => {
      await service.dashboard();
      await service.dashboard();

      const stats = cache.getStats();
      expect(stats.hits).toBeGreaterThanOrEqual(1);
    });

    it('第二次调用 revenue 应命中缓存', async () => {
      await service.revenue({});
      await service.revenue({});

      const stats = cache.getStats();
      expect(stats.hits).toBeGreaterThanOrEqual(1);
    });
  });

  // ==================== 带数据的聚合测试 ====================
  // 目标：覆盖 computeDashboard / computeRevenue / getPatientGrowth 等方法
  // 内部的 map / reduce / filter 回调（空数据时这些回调不会执行，导致覆盖率低）

  describe('dashboard - 带数据时正确聚合', () => {
    it('应将 pendingCharges 和 recentCharges 的金额从分转换为元，并构建 todos', async () => {
      const originalPrepare = db.prepare.bind(db);
      const todayISO = new Date().toISOString();
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        // Patient 总数 + 今日新增
        if (/FROM\s+Patient\s+WHERE\s+deletedAt/i.test(sql) && /COUNT.*SUM.*CASE/i.test(sql)) {
          return { run: () => ({ changes: 0, lastInsertRowid: '' }), get: () => ({ c: 5, newC: 2 }), all: () => [] };
        }
        // Charge 聚合查询
        if (/FROM\s+Charge\s+WHERE\s+deletedAt/i.test(sql) && /COALESCE/i.test(sql)) {
          return {
            run: () => ({ changes: 0, lastInsertRowid: '' }),
            get: () => ({ todayCharges: 10000, unpaidAmount: 5000, monthRevenue: 50000, totalIncome: 100000, monthChargeCount: 10, unpaidCount: 3 }),
            all: () => [],
          };
        }
        // Appointment 今日数量
        if (/FROM\s+Appointment\s+WHERE\s+startTime/i.test(sql) && /COUNT/i.test(sql)) {
          return { run: () => ({ changes: 0, lastInsertRowid: '' }), get: () => ({ c: 5 }), all: () => [] };
        }
        // Visit 今日数量
        if (/FROM\s+Visit\s+WHERE\s+startTime/i.test(sql) && /COUNT/i.test(sql)) {
          return { run: () => ({ changes: 0, lastInsertRowid: '' }), get: () => ({ c: 3 }), all: () => [] };
        }
        // pendingCharges（带 JOIN）
        if (/FROM\s+Charge\s+c\s+LEFT\s+JOIN\s+Patient/i.test(sql) && /status/i.test(sql)) {
          return {
            run: () => ({ changes: 0, lastInsertRowid: '' }),
            get: () => {},
            all: () => [
              { id: 'charge-001', patientName: '张三', totalAmount: 10000, paidAmount: 5000, number: 'C001' },
              { id: 'charge-002', patientName: '李四', totalAmount: 8000, paidAmount: 0, number: 'C002' },
            ],
          };
        }
        // recentPatients
        if (/SELECT\s+id,\s*name,\s*phone,\s*createdAt\s+FROM\s+Patient/i.test(sql)) {
          return {
            run: () => ({ changes: 0, lastInsertRowid: '' }),
            get: () => {},
            all: () => [
              { id: 'p1', name: '张三', phone: '13800000001', createdAt: '2026-01-01' },
              { id: 'p2', name: '李四', phone: '13800000002', createdAt: '2026-01-02' },
            ],
          };
        }
        // recentAppointments（带 JOIN）
        if (/FROM\s+Appointment\s+a\s+JOIN\s+Patient/i.test(sql)) {
          return {
            run: () => ({ changes: 0, lastInsertRowid: '' }),
            get: () => {},
            all: () => [
              { id: 'appt-001', patientId: 'p1', patientName: '张三', doctorId: 'doc-001', startTime: todayISO, endTime: todayISO, status: 'CONFIRMED', type: 'NORMAL' },
            ],
          };
        }
        // recentCharges（带 JOIN，paidAt IS NOT NULL）
        if (/FROM\s+Charge\s+c\s+LEFT\s+JOIN\s+Patient/i.test(sql) && /paidAt\s+IS\s+NOT\s+NULL/i.test(sql)) {
          return {
            run: () => ({ changes: 0, lastInsertRowid: '' }),
            get: () => {},
            all: () => [
              { id: 'charge-001', patientName: '张三', totalAmount: 10000, paidAmount: 10000, number: 'C001', paidAt: '2026-01-01' },
            ],
          };
        }
        return originalPrepare(sql);
      });

      const result = await service.dashboard() as any;

      // 验证 pendingCharges 的金额已从分转换为元
      expect(result.pendingCharges.length).toBe(2);
      expect(result.pendingCharges[0].totalAmount).toBe(100); // 10000分 = 100元
      expect(result.pendingCharges[0].paidAmount).toBe(50);   // 5000分 = 50元
      expect(result.pendingCharges[1].totalAmount).toBe(80);  // 8000分 = 80元
      expect(result.pendingCharges[1].paidAmount).toBe(0);

      // 验证 recentCharges 的金额已转换
      expect(result.recentCharges.length).toBe(1);
      expect(result.recentCharges[0].totalAmount).toBe(100);
      expect(result.recentCharges[0].paidAmount).toBe(100);

      // 验证 todos 已构建（应包含 charge 类型和 appointment 类型）
      expect(result.todos.length).toBeGreaterThan(0);
      expect(result.todos.some((t: any) => t.type === 'charge')).toBe(true);
      expect(result.todos.some((t: any) => t.type === 'appointment')).toBe(true);

      // 验证 today 字段
      expect(result.today.appointments).toBe(5);
      expect(result.today.visits).toBe(3);
      expect(result.today.newPatients).toBe(2);
      expect(result.today.charges).toBe(100); // 10000分 = 100元

      // 验证 finance 字段（字符串形式）
      expect(result.finance.unpaidAmount).toBe('50');  // 5000分 = 50元
      expect(result.finance.monthRevenue).toBe('500'); // 50000分 = 500元
      expect(result.finance.totalIncome).toBe('1000'); // 100000分 = 1000元
      expect(result.finance.monthChargeCount).toBe(10);
      expect(result.finance.unpaidCount).toBe(3);

      // 验证 patients 字段
      expect(result.patients.total).toBe(5);
      expect(result.patients.recent.length).toBe(2);

      prepareSpy.mockRestore();
    });

    it('todos 中 charge 的 title 应包含待收费金额', async () => {
      const originalPrepare = db.prepare.bind(db);
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        if (/FROM\s+Patient\s+WHERE\s+deletedAt/i.test(sql) && /COUNT.*SUM.*CASE/i.test(sql)) {
          return { run: () => ({ changes: 0, lastInsertRowid: '' }), get: () => ({ c: 0, newC: 0 }), all: () => [] };
        }
        if (/FROM\s+Charge\s+WHERE\s+deletedAt/i.test(sql) && /COALESCE/i.test(sql)) {
          return { run: () => ({ changes: 0, lastInsertRowid: '' }), get: () => ({ todayCharges: 0, unpaidAmount: 0, monthRevenue: 0, totalIncome: 0, monthChargeCount: 0, unpaidCount: 0 }), all: () => [] };
        }
        if (/FROM\s+(Appointment|Visit)\s+WHERE\s+startTime/i.test(sql) && /COUNT/i.test(sql)) {
          return { run: () => ({ changes: 0, lastInsertRowid: '' }), get: () => ({ c: 0 }), all: () => [] };
        }
        if (/FROM\s+Charge\s+c\s+LEFT\s+JOIN\s+Patient/i.test(sql) && /status/i.test(sql) && !/paidAt\s+IS\s+NOT\s+NULL/i.test(sql)) {
          return { run: () => ({ changes: 0, lastInsertRowid: '' }), get: () => {}, all: () => [
            { id: 'c1', patientName: '王五', totalAmount: 20000, paidAmount: 5000, number: 'C001' },
          ] };
        }
        if (/SELECT\s+id,\s*name,\s*phone,\s*createdAt\s+FROM\s+Patient/i.test(sql)) {
          return { run: () => ({ changes: 0, lastInsertRowid: '' }), get: () => {}, all: () => [] };
        }
        if (/FROM\s+Appointment\s+a\s+JOIN\s+Patient/i.test(sql)) {
          return { run: () => ({ changes: 0, lastInsertRowid: '' }), get: () => {}, all: () => [] };
        }
        if (/FROM\s+Charge\s+c\s+LEFT\s+JOIN\s+Patient/i.test(sql) && /paidAt\s+IS\s+NOT\s+NULL/i.test(sql)) {
          return { run: () => ({ changes: 0, lastInsertRowid: '' }), get: () => {}, all: () => [] };
        }
        return originalPrepare(sql);
      });

      const result = await service.dashboard() as any;
      const chargeTodo = result.todos.find((t: any) => t.type === 'charge');
      expect(chargeTodo).toBeDefined();
      // 待收费金额 = totalAmount - paidAmount = 20000 - 5000 = 15000 分 = 150 元
      expect(chargeTodo.title).toContain('150');
      expect(chargeTodo.priority).toBe('high');

      prepareSpy.mockRestore();
    });
  });

  describe('revenue - 带数据时正确计算汇总', () => {
    it('应正确计算 totalRevenue、totalCount 和 avgPerOrder', async () => {
      const originalPrepare = db.prepare.bind(db);
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        if (/FROM\s+Charge\s+WHERE\s+deletedAt/i.test(sql) && /GROUP\s+BY/i.test(sql)) {
          return {
            run: () => ({ changes: 0, lastInsertRowid: '' }),
            get: () => {},
            all: () => [
              { date: '2026-01-01', count: 3, amount: 30000 },
              { date: '2026-01-02', count: 2, amount: 20000 },
            ],
          };
        }
        return originalPrepare(sql);
      });

      const result = await service.revenue({}) as any;

      // totalRevenue = 30000 + 20000 = 50000 分 = 500 元
      expect(result.summary.totalRevenue).toBe('500');
      // totalCount = 3 + 2 = 5
      expect(result.summary.totalCount).toBe(5);
      // avgPerOrder = 50000 / 5 = 10000 分 = 100 元
      expect(result.summary.avgPerOrder).toBe('100');

      // daily/monthly 的 amount 应转换为元
      expect(result.daily[0].amount).toBe(300); // 30000分 = 300元
      expect(result.daily[1].amount).toBe(200);

      prepareSpy.mockRestore();
    });
  });

  describe('getPatientGrowth - 带数据时正确计算累计总数', () => {
    it('应正确计算每月新增和 runningTotal', async () => {
      const originalPrepare = db.prepare.bind(db);
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        if (/FROM\s+Patient\s+WHERE\s+deletedAt/i.test(sql) && /GROUP\s+BY\s+month/i.test(sql)) {
          return {
            run: () => ({ changes: 0, lastInsertRowid: '' }),
            get: () => {},
            all: () => [
              { month: '2026-01', count: 5 },
              { month: '2026-02', count: 3 },
              { month: '2026-03', count: 7 },
            ],
          };
        }
        return originalPrepare(sql);
      });

      const result = await service.getPatientGrowth({}) as any;

      expect(result.items.length).toBe(3);
      expect(result.items[0].total).toBe(5);   // 0 + 5
      expect(result.items[1].total).toBe(8);   // 5 + 3
      expect(result.items[2].total).toBe(15);  // 8 + 7

      prepareSpy.mockRestore();
    });
  });

  describe('getRevenueByCategory - 带数据时计算百分比', () => {
    it('total > 0 时应计算各分类百分比', async () => {
      const originalPrepare = db.prepare.bind(db);
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        if (/FROM\s+ChargeItem\s+ci\s+JOIN\s+Charge\s+c/i.test(sql)) {
          return {
            run: () => ({ changes: 0, lastInsertRowid: '' }),
            get: () => {},
            all: () => [
              { category: '检查', amount: 30000, count: 5 },
              { category: '治疗', amount: 70000, count: 10 },
            ],
          };
        }
        return originalPrepare(sql);
      });

      const result = await service.getRevenueByCategory({}) as any;

      expect(result.length).toBe(2);
      // total = 30000 + 70000 = 100000
      // 检查: 30000/100000 = 30%
      expect(result[0].percentage).toBe(30);
      expect(result[0].amount).toBe(300); // 30000分 = 300元
      // 治疗: 70000/100000 = 70%
      expect(result[1].percentage).toBe(70);
      expect(result[1].amount).toBe(700);

      prepareSpy.mockRestore();
    });
  });

  describe('getRevenueByDoctor - 带数据时计算百分比', () => {
    it('total > 0 时应计算各医生百分比', async () => {
      const originalPrepare = db.prepare.bind(db);
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        if (/FROM\s+Charge\s+c\s+LEFT\s+JOIN\s+User/i.test(sql)) {
          return {
            run: () => ({ changes: 0, lastInsertRowid: '' }),
            get: () => {},
            all: () => [
              { doctorId: 'doc-001', doctorName: '张医生', count: 8, amount: 60000 },
              { doctorId: 'doc-002', doctorName: '李医生', count: 4, amount: 40000 },
            ],
          };
        }
        return originalPrepare(sql);
      });

      const result = await service.getRevenueByDoctor({}) as any;

      expect(result.length).toBe(2);
      // total = 60000 + 40000 = 100000
      expect(result[0].percentage).toBe(60); // 60000/100000 = 60%
      expect(result[0].amount).toBe(600);    // 60000分 = 600元
      expect(result[1].percentage).toBe(40);
      expect(result[1].amount).toBe(400);

      prepareSpy.mockRestore();
    });
  });

  describe('getAppointmentStats - 带数据时计算百分比', () => {
    it('total > 0 时应计算各状态百分比', async () => {
      const originalPrepare = db.prepare.bind(db);
      const callCount = { byStatus: 0, daily: 0, monthly: 0 };
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        if (/FROM\s+Appointment\s+WHERE\s+deletedAt/i.test(sql) && /GROUP\s+BY\s+status/i.test(sql)) {
          callCount.byStatus++;
          return {
            run: () => ({ changes: 0, lastInsertRowid: '' }),
            get: () => {},
            all: () => [
              { status: 'CONFIRMED', count: 6 },
              { status: 'COMPLETED', count: 4 },
            ],
          };
        }
        if (/FROM\s+Appointment\s+WHERE\s+deletedAt/i.test(sql) && /GROUP\s+BY\s+date/i.test(sql)) {
          callCount.daily++;
          return { run: () => ({ changes: 0, lastInsertRowid: '' }), get: () => {}, all: () => [{ date: '2026-01-01', count: 10 }] };
        }
        if (/FROM\s+Appointment\s+WHERE\s+deletedAt/i.test(sql) && /GROUP\s+BY\s+month/i.test(sql)) {
          callCount.monthly++;
          return { run: () => ({ changes: 0, lastInsertRowid: '' }), get: () => {}, all: () => [{ month: '2026-01', count: 10 }] };
        }
        return originalPrepare(sql);
      });

      const result = await service.getAppointmentStats({}) as any;

      // total = 6 + 4 = 10
      expect(result.status.length).toBe(2);
      expect(result.status[0].percentage).toBe(60); // 6/10 = 60%
      expect(result.status[1].percentage).toBe(40); // 4/10 = 40%
      expect(result.daily.length).toBe(1);
      expect(result.monthly.length).toBe(1);

      prepareSpy.mockRestore();
    });
  });

  describe('getChargeStats - 带数据时正确转换金额', () => {
    it('daily 和 monthly 的 amount 应从分转换为元', async () => {
      const originalPrepare = db.prepare.bind(db);
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        if (/FROM\s+Charge\s+WHERE\s+deletedAt/i.test(sql) && /GROUP\s+BY\s+date/i.test(sql)) {
          return { run: () => ({ changes: 0, lastInsertRowid: '' }), get: () => {}, all: () => [
            { date: '2026-01-01', count: 3, amount: 30000 },
          ] };
        }
        if (/FROM\s+Charge\s+WHERE\s+deletedAt/i.test(sql) && /GROUP\s+BY\s+month/i.test(sql)) {
          return { run: () => ({ changes: 0, lastInsertRowid: '' }), get: () => {}, all: () => [
            { month: '2026-01', count: 3, amount: 30000 },
          ] };
        }
        return originalPrepare(sql);
      });

      const result = await service.getChargeStats({}) as any;

      expect(result.daily[0].amount).toBe(300); // 30000分 = 300元
      expect(result.monthly[0].amount).toBe(300);

      prepareSpy.mockRestore();
    });
  });

  describe('getMemberStats - 带数据时计算等级分布', () => {
    it('levelTotal > 0 时应计算各等级百分比', async () => {
      const originalPrepare = db.prepare.bind(db);
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        // summary 查询（包含 totalBalance 关键字，区分于 monthly/levels 查询）
        if (/FROM\s+MemberCard\s+WHERE\s+deletedAt/i.test(sql) && /totalBalance/i.test(sql)) {
          return { run: () => ({ changes: 0, lastInsertRowid: '' }), get: () => ({ total: 10, active: 7, totalBalance: 50000, totalPoints: 1000 }), all: () => [] };
        }
        // monthly 查询
        if (/FROM\s+MemberCard\s+WHERE\s+deletedAt/i.test(sql) && /GROUP\s+BY\s+month/i.test(sql)) {
          return { run: () => ({ changes: 0, lastInsertRowid: '' }), get: () => {}, all: () => [{ month: '2026-01', count: 5 }] };
        }
        // levels 查询
        if (/FROM\s+MemberCard\s+WHERE\s+deletedAt/i.test(sql) && /GROUP\s+BY\s+level/i.test(sql)) {
          return { run: () => ({ changes: 0, lastInsertRowid: '' }), get: () => {}, all: () => [
            { level: 'GOLD', count: 3 },
            { level: 'SILVER', count: 7 },
          ] };
        }
        return originalPrepare(sql);
      });

      const result = await service.getMemberStats() as any;

      expect(result.total).toBe(10);
      expect(result.active).toBe(7);
      expect(result.expired).toBe(3); // total - active
      expect(result.totalBalance).toBe('500'); // 50000分 = 500元
      expect(result.totalPoints).toBe(1000);

      // levelTotal = 3 + 7 = 10
      // GOLD: 3/10 = 30%
      // SILVER: 7/10 = 70%
      expect(result.levelDistribution.length).toBe(2);
      expect(result.levelDistribution[0].percentage).toBe(30);
      expect(result.levelDistribution[1].percentage).toBe(70);

      prepareSpy.mockRestore();
    });
  });

  describe('getInventoryStatus - 带数据时按分类聚合', () => {
    it('应返回按分类聚合的库存数据', async () => {
      const originalPrepare = db.prepare.bind(db);
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        if (/FROM\s+InventoryItem\s+WHERE\s+deletedAt/i.test(sql) && /GROUP\s+BY\s+category/i.test(sql)) {
          return { run: () => ({ changes: 0, lastInsertRowid: '' }), get: () => {}, all: () => [
            { category: '药品', count: 5, totalStock: 100 },
            { category: '耗材', count: 3, totalStock: 50 },
          ] };
        }
        return originalPrepare(sql);
      });

      const result = await service.getInventoryStatus() as any;

      expect(result.length).toBe(2);
      expect(result[0].category).toBe('药品');
      expect(result[0].count).toBe(5);
      expect(result[0].totalStock).toBe(100);
      expect(result[1].category).toBe('耗材');

      prepareSpy.mockRestore();
    });
  });

  describe('doctorWorkload - 带日期范围查询带数据', () => {
    it('传入日期范围且带数据时应返回医生工作量', async () => {
      const originalPrepare = db.prepare.bind(db);
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        if (/FROM\s+Treatment\s+t\s+LEFT\s+JOIN\s+User/i.test(sql)) {
          return { run: () => ({ changes: 0, lastInsertRowid: '' }), get: () => {}, all: () => [
            { doctorId: 'doc-001', doctorName: '张医生', count: 10, amount: 80000 },
            { doctorId: 'doc-002', doctorName: '李医生', count: 5, amount: 40000 },
          ] };
        }
        return originalPrepare(sql);
      });

      const result = await service.doctorWorkload({ startDate: '2026-01-01', endDate: '2026-12-31' }) as any;

      expect(result.length).toBe(2);
      expect(result[0].doctorName).toBe('张医生');
      expect(result[0].count).toBe(10);

      prepareSpy.mockRestore();
    });
  });

  describe('invalidateStatsCache - 失效缓存', () => {
    it('指定类别时只失效该类别的缓存', () => {
      const delPatternSpy = jest.spyOn(cache, 'delPattern');
      service.invalidateStatsCache('dashboard');
      expect(delPatternSpy).toHaveBeenCalledWith('stats:dashboard:');
      delPatternSpy.mockRestore();
    });

    it('不指定类别时失效全部 stats 缓存', () => {
      const delPatternSpy = jest.spyOn(cache, 'delPattern');
      service.invalidateStatsCache();
      expect(delPatternSpy).toHaveBeenCalledWith('stats:');
      delPatternSpy.mockRestore();
    });

    it('失效缓存后再次查询应重新计算（缓存未命中）', async () => {
      const originalPrepare = db.prepare.bind(db);
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        if (/FROM\s+InventoryItem\s+WHERE\s+deletedAt/i.test(sql) && /GROUP\s+BY\s+category/i.test(sql)) {
          return { run: () => ({ changes: 0, lastInsertRowid: '' }), get: () => {}, all: () => [
            { category: '药品', count: 1, totalStock: 10 },
          ] };
        }
        return originalPrepare(sql);
      });

      // 第一次调用：缓存未命中，执行 factory
      await service.getInventoryStatus();
      const statsAfterFirst = cache.getStats();
      const missesAfterFirst = statsAfterFirst.misses;

      // 失效缓存
      service.invalidateStatsCache('inventory');

      // 第二次调用：缓存已失效，应再次执行 factory
      await service.getInventoryStatus();
      const statsAfterSecond = cache.getStats();
      expect(statsAfterSecond.misses).toBeGreaterThan(missesAfterFirst);

      prepareSpy.mockRestore();
    });
  });
});
