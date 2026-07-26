import { HealthService } from './health.service';

describe('HealthService', () => {
  let service: HealthService;
  let dbService: { prepare: jest.Mock; db: { name: string } };
  let configService: { get: jest.Mock };
  let clinicContext: { getClinicId: jest.Mock; getRole: jest.Mock };

  const mockPrepare = (getResult?: unknown, allResult?: unknown) => {
    const stmt = {
      get: jest.fn().mockReturnValue(getResult),
      all: jest.fn().mockReturnValue(allResult),
      run: jest.fn(),
    };
    dbService.prepare.mockReturnValue(stmt);
    return stmt;
  };

  beforeEach(() => {
    jest.clearAllMocks();

    dbService = {
      prepare: jest.fn(),
      db: { name: 'C:\\data\\test.db' },
    };

    configService = {
      get: jest.fn().mockImplementation((key: string) => {
        const config: Record<string, string> = {
          NODE_ENV: 'test',
          npm_package_name: '@dental/api',
          npm_package_version: '0.1.0',
        };
        return config[key];
      }),
    };

    clinicContext = {
      getClinicId: jest.fn().mockReturnValue('clinic-1'),
      getRole: jest.fn().mockReturnValue('BOSS'),
    };

    service = new HealthService(
      dbService as any,
      configService as any,
      clinicContext as any,
    );
  });

  describe('check()', () => {
    it('数据库正常时返回 ok 状态', () => {
      mockPrepare({ ok: 1 });

      const result = service.check();

      expect(result.status).toBe('ok');
      expect(result.timestamp).toBeDefined();
      expect(result.uptime).toBeGreaterThanOrEqual(0);
      expect(result.version).toBe('0.1.0');
      expect(result.environment).toBe('test');
      expect(result.checks.database.status).toBe('ok');
      expect(result.checks.database.responseTimeMs).toBeGreaterThanOrEqual(0);
      expect(result.checks.memory.status).toBe('ok');
      expect(result.checks.memory.heapUsedMB).toBeGreaterThan(0);
      expect(result.checks.memory.heapTotalMB).toBeGreaterThan(0);
      expect(result.checks.memory.rssMB).toBeGreaterThan(0);
    });

    it('数据库返回非 1 时返回 degraded 状态', () => {
      mockPrepare({ ok: 0 });

      const result = service.check();

      expect(result.status).toBe('degraded');
      expect(result.checks.database.status).toBe('error');
      expect(result.checks.database.message).toBeDefined();
    });

    it('数据库返回 undefined 时返回 degraded 状态', () => {
      mockPrepare();

      const result = service.check();

      expect(result.status).toBe('degraded');
      expect(result.checks.database.status).toBe('error');
    });

    it('数据库异常时返回 degraded 状态', () => {
      dbService.prepare.mockImplementation(() => {
        throw new Error('DB connection failed');
      });

      const result = service.check();

      expect(result.status).toBe('degraded');
      expect(result.checks.database.status).toBe('error');
      expect(result.checks.database.message).toContain('DB connection failed');
    });
  });

  describe('getInfo()', () => {
    it('返回应用信息', () => {
      const result = service.getInfo();

      expect(result.name).toBe('@dental/api');
      expect(result.version).toBe('0.1.0');
      expect(result.environment).toBe('test');
      expect(result.nodeVersion).toBe(process.version);
      expect(result.uptime).toBeGreaterThanOrEqual(0);
      expect(result.timestamp).toBeDefined();
      expect(result.memory.heapUsedMB).toBeGreaterThan(0);
      expect(result.memory.heapTotalMB).toBeGreaterThan(0);
      expect(result.memory.rssMB).toBeGreaterThan(0);
    });

    it('当 npm_package_name 未配置时使用默认值', () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'npm_package_name') return;
        if (key === 'npm_package_version') return;
        if (key === 'NODE_ENV') return 'test';
        return;
      });

      service = new HealthService(
        dbService as any,
        configService as any,
        clinicContext as any,
      );

      const result = service.getInfo();

      expect(result.name).toBe('@dental/api');
      expect(result.version).toBe('0.1.0');
    });

    it('当 NODE_ENV 未配置时使用 development', () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'NODE_ENV') return;
        if (key === 'npm_package_name') return '@dental/api';
        if (key === 'npm_package_version') return '0.1.0';
        return;
      });

      service = new HealthService(
        dbService as any,
        configService as any,
        clinicContext as any,
      );

      const result = service.getInfo();

      expect(result.environment).toBe('development');
    });
  });
});
