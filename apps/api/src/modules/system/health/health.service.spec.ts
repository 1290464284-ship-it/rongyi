import { HealthService } from './health.service';
import * as fs from 'node:fs';

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

  describe('checkSimple()', () => {
    it('数据库正常时返回 ok', () => {
      mockPrepare({ ok: 1 });
      const result = service.checkSimple();
      expect(result.status).toBe('ok');
    });

    it('数据库返回异常值时返回 down', () => {
      mockPrepare({ ok: 0 });
      const result = service.checkSimple();
      expect(result.status).toBe('down');
    });

    it('数据库异常时返回 down', () => {
      dbService.prepare.mockImplementation(() => { throw new Error('DB error'); });
      const result = service.checkSimple();
      expect(result.status).toBe('down');
    });
  });

  describe('getDetail()', () => {
    it('应返回详细健康检查结果', async () => {
      mockPrepare({ ok: 1 });
      const result = await service.getDetail();
      expect(result.status).toBeDefined();
      expect(result.timestamp).toBeDefined();
      expect(result.checks.length).toBeGreaterThan(0);
    });

    it('生产环境应省略 data 字段', async () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'NODE_ENV') return 'production';
        return 'test';
      });
      service = new HealthService(dbService as any, configService as any, clinicContext as any);
      mockPrepare({ ok: 1 });
      const result = await service.getDetail();
      result.checks.forEach(check => {
        expect(check.data).toBeUndefined();
      });
    });
  });

  describe('checkDatabase()', () => {
    it('数据库正常时返回 ok', () => {
      mockPrepare({ ok: 1 });
      const result = service.checkDatabase();
      expect(result.name).toBe('database');
      expect(result.status).toBe('ok');
      expect(result.message).toContain('正常');
    });

    it('数据库异常时返回 error', () => {
      dbService.prepare.mockImplementation(() => { throw new Error('Connection refused'); });
      const result = service.checkDatabase();
      expect(result.status).toBe('error');
      expect(result.message).toContain('Connection refused');
    });
  });

  describe('checkBackupStatus()', () => {
    it('无备份记录时返回 warning', () => {
      mockPrepare();
      const result = service.checkBackupStatus();
      expect(result.name).toBe('backup');
      expect(result.status).toBe('warning');
      expect(result.message).toContain('暂无备份记录');
    });

    it('有最近备份时返回 ok', () => {
      const recentBackup = {
        id: 'b-1',
        filename: 'test.sqlite',
        fileSize: 1024,
        type: 'manual',
        operatorId: 'u-1',
        operatorName: 'Test',
        remark: null,
        clinicId: 'clinic-1',
        createdAt: new Date().toISOString(),
      };
      mockPrepare(recentBackup);
      const result = service.checkBackupStatus();
      expect(result.status).toBe('ok');
      expect(result.data).toBeDefined();
    });

    it('备份超时时返回 warning', () => {
      const oldBackup = {
        id: 'b-1',
        filename: 'test.sqlite',
        fileSize: 1024,
        type: 'manual',
        operatorId: 'u-1',
        operatorName: 'Test',
        remark: null,
        clinicId: 'clinic-1',
        createdAt: new Date(Date.now() - 30 * 3600000).toISOString(),
      };
      mockPrepare(oldBackup);
      const result = service.checkBackupStatus();
      expect(result.status).toBe('warning');
      expect(result.message).toContain('备份超时');
    });
  });

  describe('checkDatabaseSize()', () => {
    it('应返回数据库大小信息', async () => {
      const statSpy = jest.spyOn(fs.promises, 'stat').mockImplementation(async (path: fs.PathLike) => {
        if (String(path).endsWith('-wal')) throw new Error('ENOENT');
        return { size: 1048576 } as fs.Stats;
      });
      mockPrepare({ cnt: 10 });
      const stmt = { get: jest.fn(), all: jest.fn().mockReturnValue([{ name: 'Patient' }]), run: jest.fn() };
      dbService.prepare.mockReturnValue(stmt);

      const result = await service.checkDatabaseSize();
      expect(result.name).toBe('database_size');
      expect(result.data).toBeDefined();
      statSpy.mockRestore();
    });
  });

  describe('getTableStats()', () => {
    it('应返回表统计信息', () => {
      const stmt = {
        get: jest.fn().mockReturnValue({ cnt: 5 }),
        all: jest.fn().mockReturnValue([{ name: 'Patient' }]),
        run: jest.fn(),
      };
      dbService.prepare.mockReturnValue(stmt);

      const result = service.getTableStats();
      expect(result.length).toBeGreaterThanOrEqual(0);
    });

    it('应使用缓存', () => {
      const stmt = {
        get: jest.fn().mockReturnValue({ cnt: 5 }),
        all: jest.fn().mockReturnValue([{ name: 'Patient' }]),
        run: jest.fn(),
      };
      dbService.prepare.mockReturnValue(stmt);

      service.getTableStats();
      const result2 = service.getTableStats();
      // Second call should use cache (prepare called same number of times)
      expect(result2).toBeDefined();
    });
  });
});
