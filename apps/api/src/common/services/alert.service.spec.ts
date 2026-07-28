import { AlertService, AlertLevel, AlertCategory } from './alert.service';
import { AppLogger } from './logger.service';

describe('AlertService', () => {
  let service: AlertService;
  let mockPrepare: jest.Mock;
  let mockRun: jest.Mock;
  let mockGet: jest.Mock;
  let mockAll: jest.Mock;
  let loggerErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockRun = jest.fn();
    mockGet = jest.fn();
    mockAll = jest.fn();
    mockPrepare = jest.fn().mockReturnValue({
      run: mockRun,
      get: mockGet,
      all: mockAll,
    });

    const mockDbService = {
      prepare: mockPrepare,
    };

    service = new AlertService(mockDbService as any);

    loggerErrorSpy = jest.spyOn(AppLogger.prototype, 'error').mockImplementation(() => {});
    jest.spyOn(AppLogger.prototype, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('recordAlert', () => {
    it('应正常记录告警并返回 SystemAlert 对象', () => {
      mockRun.mockReturnValue({ changes: 1 });

      const result = service.recordAlert(
        AlertLevel.WARNING,
        AlertCategory.SYSTEM,
        '测试标题',
        '测试消息',
      );

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.level).toBe(AlertLevel.WARNING);
      expect(result.category).toBe(AlertCategory.SYSTEM);
      expect(result.title).toBe('测试标题');
      expect(result.message).toBe('测试消息');
      expect(result.resolved).toBe(false);
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
    });

    it('应写入内存缓存（recentAlerts）', () => {
      service.recordAlert(AlertLevel.INFO, AlertCategory.SYSTEM, '标题1', '消息1');
      service.recordAlert(AlertLevel.WARNING, AlertCategory.SYSTEM, '标题2', '消息2');

      const alerts = service.getAlerts();
      expect(alerts.length).toBe(2);
      expect(alerts[0].title).toBe('标题2');
      expect(alerts[1].title).toBe('标题1');
    });

    it('应写入数据库', () => {
      mockRun.mockReturnValue({ changes: 1 });

      service.recordAlert(
        AlertLevel.ERROR,
        AlertCategory.DATABASE,
        'DB错误',
        '连接失败',
      );

      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO SystemAlert'));
      expect(mockRun).toHaveBeenCalled();
    });

    it('应正确序列化 metadata 为 JSON', () => {
      const metadata = { userId: '123', action: 'login' };
      mockRun.mockReturnValue({ changes: 1 });

      service.recordAlert(
        AlertLevel.INFO,
        AlertCategory.SYSTEM,
        '标题',
        '消息',
        metadata,
      );

      expect(mockRun).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        JSON.stringify(metadata),
        null,
        expect.any(String),
        expect.any(String),
      );
    });

    it('metadata 为 undefined 时 data 应为 null', () => {
      mockRun.mockReturnValue({ changes: 1 });

      service.recordAlert(
        AlertLevel.INFO,
        AlertCategory.SYSTEM,
        '标题',
        '消息',
      );

      expect(mockRun).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        null,
        null,
        expect.any(String),
        expect.any(String),
      );
    });

    it('应正确传递 clinicId', () => {
      mockRun.mockReturnValue({ changes: 1 });

      const result = service.recordAlert(
        AlertLevel.WARNING,
        AlertCategory.BUSINESS,
        '标题',
        '消息',
        undefined,
        'clinic-001',
      );

      expect(result.clinicId).toBe('clinic-001');
      expect(mockRun).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        null,
        'clinic-001',
        expect.any(String),
        expect.any(String),
      );
    });

    it('clinicId 为 undefined 时应传入 null', () => {
      mockRun.mockReturnValue({ changes: 1 });

      service.recordAlert(
        AlertLevel.INFO,
        AlertCategory.SYSTEM,
        '标题',
        '消息',
      );

      expect(mockRun).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        null,
        null,
        expect.any(String),
        expect.any(String),
      );
    });

    it('缓存超过 MAX_CACHE_ALERTS (100) 时应截断', () => {
      for (let i = 0; i < 150; i++) {
        service.recordAlert(AlertLevel.INFO, AlertCategory.SYSTEM, `标题${i}`, `消息${i}`);
      }

      const alerts = service.getAlerts();
      expect(alerts.length).toBe(100);
      expect(alerts[0].title).toBe('标题149');
      expect(alerts[99].title).toBe('标题50');
    });

    it('数据库写入失败时应记录错误日志但不抛出异常', () => {
      mockRun.mockImplementation(() => {
        throw new Error('DB error');
      });

      expect(() => {
        service.recordAlert(AlertLevel.ERROR, AlertCategory.SYSTEM, '标题', '消息');
      }).not.toThrow();

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        '写入告警到数据库失败',
        'DB error',
      );
    });
  });

  describe('recordFailure', () => {
    it('首次失败时级别应为 ERROR', () => {
      const result = service.recordFailure(
        AlertCategory.BACKUP,
        'backup-daily',
        '备份失败',
        '磁盘空间不足',
      );

      expect(result.level).toBe(AlertLevel.ERROR);
      expect(result.consecutiveFailures).toBe(1);
    });

    it('连续失败第2次级别仍为 ERROR', () => {
      service.recordFailure(AlertCategory.BACKUP, 'key1', '标题', '消息');
      const result = service.recordFailure(AlertCategory.BACKUP, 'key1', '标题', '消息');

      expect(result.level).toBe(AlertLevel.ERROR);
      expect(result.consecutiveFailures).toBe(2);
    });

    it('连续失败第3次应升级为 CRITICAL', () => {
      service.recordFailure(AlertCategory.BACKUP, 'key1', '标题', '消息');
      service.recordFailure(AlertCategory.BACKUP, 'key1', '标题', '消息');
      const result = service.recordFailure(AlertCategory.BACKUP, 'key1', '标题', '消息');

      expect(result.level).toBe(AlertLevel.CRITICAL);
      expect(result.consecutiveFailures).toBe(3);
    });

    it('连续失败超过3次保持 CRITICAL', () => {
      for (let i = 0; i < 5; i++) {
        service.recordFailure(AlertCategory.BACKUP, 'key1', '标题', '消息');
      }

      const result = service.recordFailure(AlertCategory.BACKUP, 'key1', '标题', '消息');
      expect(result.level).toBe(AlertLevel.CRITICAL);
      expect(result.consecutiveFailures).toBe(6);
    });

    it('不同 key 的失败计数应独立', () => {
      service.recordFailure(AlertCategory.BACKUP, 'key1', '标题', '消息');
      service.recordFailure(AlertCategory.BACKUP, 'key1', '标题', '消息');

      const result = service.recordFailure(AlertCategory.BACKUP, 'key2', '标题', '消息');
      expect(result.consecutiveFailures).toBe(1);
      expect(result.level).toBe(AlertLevel.ERROR);
    });

    it('应写入数据库并包含 consecutiveFailures', () => {
      mockRun.mockReturnValue({ changes: 1 });

      service.recordFailure(
        AlertCategory.DATABASE,
        'db-conn',
        '连接失败',
        '超时',
      );

      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO SystemAlert'));
      expect(mockRun).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        null,
        1,
        null,
        expect.any(String),
        expect.any(String),
      );
    });

    it('应写入内存缓存', () => {
      service.recordFailure(AlertCategory.SYSTEM, 'key1', '标题', '消息');

      const alerts = service.getAlerts();
      expect(alerts.length).toBe(1);
      expect(alerts[0].consecutiveFailures).toBe(1);
    });
  });

  describe('recordSuccess', () => {
    it('应清除指定 key 的失败计数', () => {
      service.recordFailure(AlertCategory.BACKUP, 'key1', '标题', '消息');
      service.recordFailure(AlertCategory.BACKUP, 'key1', '标题', '消息');

      service.recordSuccess(AlertCategory.BACKUP, 'key1');

      const result = service.recordFailure(AlertCategory.BACKUP, 'key1', '标题', '消息');
      expect(result.consecutiveFailures).toBe(1);
      expect(result.level).toBe(AlertLevel.ERROR);
    });

    it('清除不存在的 key 时不应报错', () => {
      expect(() => {
        service.recordSuccess(AlertCategory.BACKUP, 'nonexistent-key');
      }).not.toThrow();
    });

    it('只清除指定 key，不影响其他 key', () => {
      service.recordFailure(AlertCategory.BACKUP, 'key1', '标题', '消息');
      service.recordFailure(AlertCategory.BACKUP, 'key1', '标题', '消息');
      service.recordFailure(AlertCategory.BACKUP, 'key2', '标题', '消息');
      service.recordFailure(AlertCategory.BACKUP, 'key2', '标题', '消息');

      service.recordSuccess(AlertCategory.BACKUP, 'key1');

      const result1 = service.recordFailure(AlertCategory.BACKUP, 'key1', '标题', '消息');
      const result2 = service.recordFailure(AlertCategory.BACKUP, 'key2', '标题', '消息');

      expect(result1.consecutiveFailures).toBe(1);
      expect(result2.consecutiveFailures).toBe(3);
    });
  });

  describe('getAlerts', () => {
    beforeEach(() => {
      service.recordAlert(AlertLevel.INFO, AlertCategory.SYSTEM, 'Info告警', '消息', undefined, 'clinic-a');
      service.recordAlert(AlertLevel.WARNING, AlertCategory.DATABASE, 'Warning告警', '消息', undefined, 'clinic-b');
      service.recordAlert(AlertLevel.ERROR, AlertCategory.BACKUP, 'Error告警', '消息', undefined, 'clinic-a');
    });

    it('无 options 时返回全部缓存告警', () => {
      const alerts = service.getAlerts();
      expect(alerts.length).toBe(3);
    });

    it('按 level 过滤', () => {
      const alerts = service.getAlerts({ level: AlertLevel.ERROR });
      expect(alerts.length).toBe(1);
      expect(alerts[0].level).toBe(AlertLevel.ERROR);
    });

    it('按 category 过滤', () => {
      const alerts = service.getAlerts({ category: AlertCategory.DATABASE });
      expect(alerts.length).toBe(1);
      expect(alerts[0].category).toBe(AlertCategory.DATABASE);
    });

    it('按 resolved 过滤（未解决）', () => {
      const alerts = service.getAlerts({ resolved: false });
      expect(alerts.length).toBe(3);
    });

    it('按 resolved 过滤（已解决）', () => {
      const alerts = service.getAlerts({ resolved: true });
      expect(alerts.length).toBe(0);
    });

    it('按 clinicId 过滤', () => {
      const alerts = service.getAlerts({ clinicId: 'clinic-a' });
      expect(alerts.length).toBe(2);
      alerts.forEach((a) => expect(a.clinicId).toBe('clinic-a'));
    });

    it('按 limit 限制返回数量', () => {
      const alerts = service.getAlerts({ limit: 2 });
      expect(alerts.length).toBe(2);
    });

    it('简单查询应走缓存（不调用 DB）', () => {
      mockAll.mockClear();
      mockPrepare.mockClear();

      service.getAlerts({ level: AlertLevel.INFO });

      expect(mockPrepare).not.toHaveBeenCalled();
      expect(mockAll).not.toHaveBeenCalled();
    });

    it('有 offset 时应走 DB 查询', () => {
      mockAll.mockReturnValue([]);
      mockGet.mockReturnValue({ count: 0 });

      service.getAlerts({ offset: 10 });

      expect(mockPrepare).toHaveBeenCalled();
      expect(mockAll).toHaveBeenCalled();
    });

    it('limit 超过 MAX_CACHE_ALERTS 时应走 DB 查询', () => {
      mockAll.mockReturnValue([]);
      mockGet.mockReturnValue({ count: 0 });

      service.getAlerts({ limit: 200 });

      expect(mockPrepare).toHaveBeenCalled();
      expect(mockAll).toHaveBeenCalled();
    });

    it('DB 查询失败时应抛出异常', () => {
      mockAll.mockImplementation(() => {
        throw new Error('DB error');
      });

      expect(() => service.getAlerts({ offset: 0 })).toThrow('查询告警失败');
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        '从数据库查询告警失败',
        'DB error',
      );
    });
  });

  describe('getAlertsPaginated', () => {
    it('应返回分页结果', () => {
      const mockRows = [
        {
          id: '1',
          level: AlertLevel.ERROR,
          category: AlertCategory.SYSTEM,
          title: '标题1',
          message: '消息1',
          data: null,
          resolved: 0,
          resolvedAt: null,
          consecutiveFailures: null,
          clinicId: null,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
        {
          id: '2',
          level: AlertLevel.WARNING,
          category: AlertCategory.DATABASE,
          title: '标题2',
          message: '消息2',
          data: null,
          resolved: 0,
          resolvedAt: null,
          consecutiveFailures: null,
          clinicId: null,
          createdAt: '2024-01-02T00:00:00.000Z',
          updatedAt: '2024-01-02T00:00:00.000Z',
        },
      ];

      mockGet.mockReturnValue({ count: 25 });
      mockAll.mockReturnValue(mockRows);

      const result = service.getAlertsPaginated(2, 10);

      expect(result.items.length).toBe(2);
      expect(result.total).toBe(25);
      expect(result.page).toBe(2);
      expect(result.pageSize).toBe(10);
    });

    it('应正确构建 WHERE 条件（level）', () => {
      mockGet.mockReturnValue({ count: 0 });
      mockAll.mockReturnValue([]);

      service.getAlertsPaginated(1, 20, { level: AlertLevel.ERROR });

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('WHERE level = ?'),
      );
    });

    it('应正确构建 WHERE 条件（category）', () => {
      mockGet.mockReturnValue({ count: 0 });
      mockAll.mockReturnValue([]);

      service.getAlertsPaginated(1, 20, { category: AlertCategory.BACKUP });

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('WHERE category = ?'),
      );
    });

    it('应正确构建 WHERE 条件（resolved）', () => {
      mockGet.mockReturnValue({ count: 0 });
      mockAll.mockReturnValue([]);

      service.getAlertsPaginated(1, 20, { resolved: true });

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('WHERE resolved = ?'),
      );
    });

    it('应正确构建 WHERE 条件（clinicId）', () => {
      mockGet.mockReturnValue({ count: 0 });
      mockAll.mockReturnValue([]);

      service.getAlertsPaginated(1, 20, { clinicId: 'clinic-1' });

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('WHERE clinicId = ?'),
      );
    });

    it('应正确构建多个 WHERE 条件（AND 连接）', () => {
      mockGet.mockReturnValue({ count: 0 });
      mockAll.mockReturnValue([]);

      service.getAlertsPaginated(1, 20, {
        level: AlertLevel.ERROR,
        category: AlertCategory.DATABASE,
        resolved: false,
      });

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('WHERE level = ? AND category = ? AND resolved = ?'),
      );
    });

    it('无过滤条件时不应有 WHERE 子句', () => {
      mockGet.mockReturnValue({ count: 0 });
      mockAll.mockReturnValue([]);

      service.getAlertsPaginated(1, 20);

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.not.stringContaining('WHERE'),
      );
    });

    it('应计算正确的总条数', () => {
      mockGet.mockReturnValue({ count: 100 });
      mockAll.mockReturnValue([]);

      const result = service.getAlertsPaginated(3, 20);
      expect(result.total).toBe(100);
    });

    it('第1页的 offset 应为 0', () => {
      mockGet.mockReturnValue({ count: 0 });
      mockAll.mockReturnValue([]);

      service.getAlertsPaginated(1, 20);

      expect(mockAll).toHaveBeenCalledWith(20, 0);
    });

    it('第3页 pageSize=10 的 offset 应为 20', () => {
      mockGet.mockReturnValue({ count: 0 });
      mockAll.mockReturnValue([]);

      service.getAlertsPaginated(3, 10);

      expect(mockAll).toHaveBeenCalledWith(10, 20);
    });
  });

  describe('resolveAlert', () => {
    it('成功更新时应返回 true', () => {
      mockRun.mockReturnValue({ changes: 1 });

      const alert = service.recordAlert(AlertLevel.ERROR, AlertCategory.SYSTEM, '标题', '消息');
      const result = service.resolveAlert(alert.id);

      expect(result).toBe(true);
    });

    it('成功更新时应同步缓存', () => {
      mockRun.mockReturnValue({ changes: 1 });

      const alert = service.recordAlert(AlertLevel.ERROR, AlertCategory.SYSTEM, '标题', '消息');
      service.resolveAlert(alert.id);

      const cached = service.getAlerts().find((a) => a.id === alert.id);
      expect(cached?.resolved).toBe(true);
      expect(cached?.resolvedAt).toBeDefined();
      expect(cached?.updatedAt).toBeDefined();
    });

    it('告警不存在时应返回 false', () => {
      mockRun.mockReturnValue({ changes: 0 });

      const result = service.resolveAlert('nonexistent-id');
      expect(result).toBe(false);
    });

    it('DB 错误时应返回 false', () => {
      mockRun.mockImplementation(() => {
        throw new Error('DB error');
      });

      const alert = service.recordAlert(AlertLevel.ERROR, AlertCategory.SYSTEM, '标题', '消息');
      const result = service.resolveAlert(alert.id);

      expect(result).toBe(false);
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        '标记告警已解决失败',
        'DB error',
      );
    });
  });

  describe('markAsResolved', () => {
    it('应委托给 resolveAlert', () => {
      const resolveSpy = jest.spyOn(service, 'resolveAlert').mockReturnValue(true);

      const result = service.markAsResolved('test-id');

      expect(resolveSpy).toHaveBeenCalledWith('test-id');
      expect(result).toBe(true);
    });
  });

  describe('clearResolved', () => {
    it('无 clinicId 时应清除所有已解决告警', () => {
      mockRun.mockReturnValue({ changes: 5 });

      const result = service.clearResolved();

      expect(result).toBe(5);
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM SystemAlert WHERE resolved = 1'),
      );
      expect(mockRun).toHaveBeenCalledWith();
    });

    it('有 clinicId 时应清除特定诊所的已解决告警', () => {
      mockRun.mockReturnValue({ changes: 3 });

      const result = service.clearResolved('clinic-123');

      expect(result).toBe(3);
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('WHERE resolved = 1 AND clinicId = ?'),
      );
      expect(mockRun).toHaveBeenCalledWith('clinic-123');
    });

    it('应同步清除缓存中的已解决告警', () => {
      mockRun.mockReturnValue({ changes: 1 });

      const alert1 = service.recordAlert(AlertLevel.ERROR, AlertCategory.SYSTEM, '告警1', '消息');
      const alert2 = service.recordAlert(AlertLevel.WARNING, AlertCategory.SYSTEM, '告警2', '消息');

      mockRun.mockReturnValue({ changes: 1 });
      service.resolveAlert(alert1.id);

      mockRun.mockReturnValue({ changes: 1 });
      service.clearResolved();

      const alerts = service.getAlerts();
      expect(alerts.length).toBe(1);
      expect(alerts[0].id).toBe(alert2.id);
    });

    it('DB 错误时应返回 0', () => {
      mockRun.mockImplementation(() => {
        throw new Error('DB error');
      });

      const result = service.clearResolved();

      expect(result).toBe(0);
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        '清除已解决告警失败',
        'DB error',
      );
    });
  });

  describe('mapRowToAlert（通过 getAlertsPaginated 间接测试）', () => {
    it('应正确解析 data JSON 字段为 metadata', () => {
      const metadata = { key: 'value', num: 123 };
      const mockRow = {
        id: '1',
        level: AlertLevel.ERROR,
        category: AlertCategory.SYSTEM,
        title: '标题',
        message: '消息',
        data: JSON.stringify(metadata),
        resolved: 0,
        resolvedAt: null,
        consecutiveFailures: null,
        clinicId: null,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };

      mockGet.mockReturnValue({ count: 1 });
      mockAll.mockReturnValue([mockRow]);

      const result = service.getAlertsPaginated(1, 10);
      expect(result.items[0].metadata).toEqual(metadata);
    });

    it('data 解析失败时应保留 raw', () => {
      const mockRow = {
        id: '1',
        level: AlertLevel.ERROR,
        category: AlertCategory.SYSTEM,
        title: '标题',
        message: '消息',
        data: 'invalid-json-{',
        resolved: 0,
        resolvedAt: null,
        consecutiveFailures: null,
        clinicId: null,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };

      mockGet.mockReturnValue({ count: 1 });
      mockAll.mockReturnValue([mockRow]);

      const result = service.getAlertsPaginated(1, 10);
      expect(result.items[0].metadata).toEqual({ raw: 'invalid-json-{' });
    });

    it('resolved 为数字 1 时应转为 true', () => {
      const mockRow = {
        id: '1',
        level: AlertLevel.INFO,
        category: AlertCategory.SYSTEM,
        title: '标题',
        message: '消息',
        data: null,
        resolved: 1,
        resolvedAt: '2024-01-02T00:00:00.000Z',
        consecutiveFailures: null,
        clinicId: null,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
      };

      mockGet.mockReturnValue({ count: 1 });
      mockAll.mockReturnValue([mockRow]);

      const result = service.getAlertsPaginated(1, 10);
      expect(result.items[0].resolved).toBe(true);
    });

    it('resolved 为数字 0 时应转为 false', () => {
      const mockRow = {
        id: '1',
        level: AlertLevel.INFO,
        category: AlertCategory.SYSTEM,
        title: '标题',
        message: '消息',
        data: null,
        resolved: 0,
        resolvedAt: null,
        consecutiveFailures: null,
        clinicId: null,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };

      mockGet.mockReturnValue({ count: 1 });
      mockAll.mockReturnValue([mockRow]);

      const result = service.getAlertsPaginated(1, 10);
      expect(result.items[0].resolved).toBe(false);
    });

    it('可选字段缺失时不应出现在结果中', () => {
      const mockRow = {
        id: '1',
        level: AlertLevel.INFO,
        category: AlertCategory.SYSTEM,
        title: '标题',
        message: '消息',
        data: null,
        resolved: 0,
        resolvedAt: null,
        consecutiveFailures: null,
        clinicId: null,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };

      mockGet.mockReturnValue({ count: 1 });
      mockAll.mockReturnValue([mockRow]);

      const result = service.getAlertsPaginated(1, 10);
      expect(result.items[0].resolvedAt).toBeUndefined();
      expect(result.items[0].consecutiveFailures).toBeUndefined();
      expect(result.items[0].metadata).toBeUndefined();
      expect(result.items[0].clinicId).toBeUndefined();
    });

    it('可选字段存在时应正确映射', () => {
      const mockRow = {
        id: '1',
        level: AlertLevel.CRITICAL,
        category: AlertCategory.BACKUP,
        title: '标题',
        message: '消息',
        data: JSON.stringify({ reason: 'timeout' }),
        resolved: 1,
        resolvedAt: '2024-01-03T00:00:00.000Z',
        consecutiveFailures: 5,
        clinicId: 'clinic-001',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-03T00:00:00.000Z',
      };

      mockGet.mockReturnValue({ count: 1 });
      mockAll.mockReturnValue([mockRow]);

      const result = service.getAlertsPaginated(1, 10);
      const item = result.items[0];

      expect(item.resolved).toBe(true);
      expect(item.resolvedAt).toBe('2024-01-03T00:00:00.000Z');
      expect(item.consecutiveFailures).toBe(5);
      expect(item.clinicId).toBe('clinic-001');
      expect(item.metadata).toEqual({ reason: 'timeout' });
    });
  });
});
