import { HealthController } from './health.controller';
import { BusinessNotFoundException } from '@common/errors';
import { HealthService } from './health.service';

jest.mock('fs');
jest.mock('path', () => jest.requireActual('path'));

describe('HealthController', () => {
  let controller: HealthController;
  let dbConsistencyService: {
    runAllChecks: jest.Mock;
    getAvailableChecks: jest.Mock;
    runCheck: jest.Mock;
  };
  let healthService: jest.Mocked<HealthService>;

  beforeEach(() => {
    jest.clearAllMocks();

    dbConsistencyService = {
      runAllChecks: jest.fn(),
      getAvailableChecks: jest.fn().mockReturnValue(['check1', 'check2']),
      runCheck: jest.fn(),
    };

    healthService = {
      checkSimple: jest.fn(),
      getInfo: jest.fn(),
      getDetail: jest.fn(),
    } as any;

    controller = new HealthController(
      dbConsistencyService as any,
      healthService,
    );
  });

  describe('check()', () => {
    it('数据库正常时返回 ok', () => {
      healthService.checkSimple.mockReturnValue({ status: 'ok' });
      const result = controller.check();
      expect(result).toEqual({ status: 'ok' });
      expect(healthService.checkSimple).toHaveBeenCalled();
    });

    it('数据库异常时返回 down', () => {
      healthService.checkSimple.mockReturnValue({ status: 'down' });
      const result = controller.check();
      expect(result).toEqual({ status: 'down' });
      expect(healthService.checkSimple).toHaveBeenCalled();
    });
  });

  describe('info()', () => {
    it('返回应用信息', () => {
      const mockInfo = {
        name: '@dental/api',
        version: '0.1.0',
        environment: 'test',
        nodeVersion: process.version,
        uptime: 100,
        timestamp: '2024-01-01T00:00:00.000Z',
        memory: {
          heapUsedMB: 50,
          heapTotalMB: 100,
          rssMB: 150,
        },
      };
      healthService.getInfo.mockReturnValue(mockInfo);

      const result = controller.info();

      expect(healthService.getInfo).toHaveBeenCalled();
      expect(result).toEqual(mockInfo);
    });
  });

  describe('detail()', () => {
    it('返回详细健康检查结果', async () => {
      const mockDetail = {
        status: 'ok' as const,
        timestamp: '2024-01-01T00:00:00.000Z',
        checks: [
          { name: 'database', status: 'ok' as const },
          { name: 'disk_space', status: 'ok' as const },
          { name: 'backup', status: 'ok' as const },
          { name: 'database_size', status: 'ok' as const },
        ],
      };
      healthService.getDetail.mockResolvedValue(mockDetail);

      const result = await controller.detail();

      expect(healthService.getDetail).toHaveBeenCalled();
      expect(result).toEqual(mockDetail);
    });
  });

  describe('dbConsistency()', () => {
    it('委托给 dbConsistencyService.runAllChecks', async () => {
      const expected = {
        status: 'ok',
        timestamp: '2024-01-01T00:00:00.000Z',
        totalChecks: 2,
        passedChecks: 2,
        failedChecks: 0,
        totalIssues: 0,
        checks: [],
      };
      dbConsistencyService.runAllChecks.mockResolvedValue(expected);

      const result = await controller.dbConsistency();
      expect(result).toEqual(expected);
      expect(dbConsistencyService.runAllChecks).toHaveBeenCalled();
    });
  });

  describe('dbConsistencyCheck()', () => {
    it('检查项存在时返回结果', async () => {
      const expected = {
        name: 'check1',
        status: 'ok',
        message: '通过',
        issues: [],
        durationMs: 10,
      };
      dbConsistencyService.runCheck.mockResolvedValue(expected);

      const result = await controller.dbConsistencyCheck('check1');
      expect(result).toEqual(expected);
      expect(dbConsistencyService.runCheck).toHaveBeenCalledWith('check1');
    });

    it('检查项不存在时抛出 BusinessNotFoundException', async () => {
      await expect(
        controller.dbConsistencyCheck('non_existent'),
      ).rejects.toThrow(BusinessNotFoundException);
      expect(dbConsistencyService.runCheck).not.toHaveBeenCalled();
    });
  });

  describe('getAvailableChecks()', () => {
    it('返回可用检查项列表', () => {
      const checks = controller.getAvailableChecks();
      expect(checks).toEqual(['check1', 'check2']);
      expect(dbConsistencyService.getAvailableChecks).toHaveBeenCalled();
    });
  });
});
