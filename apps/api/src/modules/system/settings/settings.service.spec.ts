import { SettingsService } from './settings.service';
import { asDbService, MockDbService } from '../../../db/__mocks__/db-service.mock';
import { CacheService } from '../../../common/services/cache.service';
import { ClinicContextService } from '../../../common/services/clinic-context.service';
import { AuditLogService } from '../../../common/services/audit-log.service';
import * as crypto from 'node:crypto';

function createMockClinicContext(clinicId: string | null = 'test-clinic-001'): ClinicContextService {
  return {
    getClinicId: () => clinicId,
    getUserId: () => 'test-user-001',
    getRole: () => 'BOSS',
    run: <T>(_ctx: unknown, fn: () => T) => fn(),
    isInitialized: () => true,
  } as unknown as ClinicContextService;
}

function createMockCacheService(): CacheService {
  return {
    get: jest.fn().mockResolvedValue(undefined),
    set: jest.fn().mockResolvedValue(undefined),
    del: jest.fn().mockResolvedValue(undefined),
    delPattern: jest.fn().mockResolvedValue(undefined),
    clear: jest.fn(),
    getStats: () => ({ hits: 0, misses: 0, hitRate: 0, size: 0, maxSize: 1000 }),
    has: () => false,
  } as unknown as CacheService;
}

function createMockAuditLogService(): AuditLogService {
  return {
    logAudit: jest.fn((db: { prepare: jest.Mock }, type: string, targetId: string, targetType: string, clinicId: string | null, options?: Record<string, unknown>) => {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const beforeData = options?.beforeData !== undefined ? JSON.stringify(options.beforeData) : null;
      const afterData = options?.afterData !== undefined ? JSON.stringify(options.afterData) : null;
      db.prepare(
        `INSERT INTO AuditLog (id, type, targetId, targetType, beforeData, afterData, remark, clinicId, createdAt, operatorId, operatorName, amount, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, type, targetId, targetType, beforeData, afterData, options?.remark || null, clinicId, now, options?.operatorId || null, options?.operatorName || null, options?.amount || null, options?.ip || null);
    }),
  } as unknown as AuditLogService;
}

describe('SettingsService', () => {
  let service: SettingsService;
  let db: MockDbService;
  let cache: CacheService;
  let context: ClinicContextService;
  let auditLog: AuditLogService;

  beforeEach(() => {
    db = new MockDbService();
    // Initialize ClinicInfo and AuditLog tables in the mock
    db.tables.set('ClinicInfo', new Map());
    db.tables.set('AuditLog', new Map());
    cache = createMockCacheService();
    context = createMockClinicContext();
    auditLog = createMockAuditLogService();
    service = new SettingsService(asDbService(db), cache, context, auditLog);
  });

  afterEach(() => {
    db.clear();
  });

  describe('onModuleInit / ensureDefaultConfigs', () => {
    it('初始化默认配置', () => {
      service.onModuleInit();
      const data = db.getTableData('ClinicInfo');
      expect(data.length).toBeGreaterThan(0);
      // 验证已写入默认配置
      const keys = data.map((r: any) => r.key);
      expect(keys).toContain('backupRetentionDays');
      expect(keys).toContain('defaultPageSize');
    });

    it('默认配置已存在时不重复插入', () => {
      // 预先 seed 一个默认 key
      db.seed('ClinicInfo', [
        { id: '1', key: 'backupRetentionDays', value: '30', clinicId: null, updatedAt: '2026-01-01' },
      ]);
      service.onModuleInit();
      const data = db.getTableData('ClinicInfo');
      const backup = data.filter((r: any) => r.key === 'backupRetentionDays');
      expect(backup.length).toBe(1);
    });

    it('数据库异常时记录 warn 不抛出', () => {
      const originalPrepare = db.prepare.bind(db);
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        if (/SELECT\s+id\s+FROM\s+ClinicInfo/i.test(sql)) {
          throw new Error('mock db error');
        }
        return originalPrepare(sql);
      });
      expect(() => service.onModuleInit()).not.toThrow();
      prepareSpy.mockRestore();
    });

    it('数据库异常且 err 非 Error 实例时也记录 warn（覆盖 String(err) 分支）', () => {
      const originalPrepare = db.prepare.bind(db);
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        if (/SELECT\s+id\s+FROM\s+ClinicInfo/i.test(sql)) {
          // 抛出一个非 Error 类型的值
          throw 'string error';
        }
        return originalPrepare(sql);
      });
      expect(() => service.onModuleInit()).not.toThrow();
      prepareSpy.mockRestore();
    });
  });

  describe('getClinicInfo / getAllWithCache', () => {
    beforeEach(() => {
      db.seed('ClinicInfo', [
        { id: '1', key: 'backupRetentionDays', value: '30', clinicId: null, updatedAt: '2026-01-01' },
        { id: '2', key: 'defaultPageSize', value: '20', clinicId: null, updatedAt: '2026-01-01' },
        { id: '3', key: 'clinicName', value: 'Test Clinic', clinicId: 'test-clinic-001', updatedAt: '2026-01-01' },
      ]);
    });

    it('从 DB 加载配置（缓存未命中）', async () => {
      (cache.get as jest.Mock).mockResolvedValue(undefined);
      const result = await service.getClinicInfo();
      expect(result['backupRetentionDays']).toBe('30');
      expect(result['defaultPageSize']).toBe('20');
      expect(result['clinicName']).toBe('Test Clinic');
    });

    it('从缓存加载配置（缓存命中）', async () => {
      (cache.get as jest.Mock).mockResolvedValue({ backupRetentionDays: '99' });
      const result = await service.getClinicInfo();
      expect(result['backupRetentionDays']).toBe('99');
    });

    it('findAll 等同于 getClinicInfo', async () => {
      (cache.get as jest.Mock).mockResolvedValue({ foo: 'bar' });
      const result = await service.findAll();
      expect(result['foo']).toBe('bar');
    });

    it('无 clinicId 时不应用 clinic 过滤', async () => {
      const noCtxService = new SettingsService(asDbService(db), cache, createMockClinicContext(null), auditLog);
      (cache.get as jest.Mock).mockResolvedValue(undefined);
      const result = await noCtxService.getClinicInfo();
      expect(Object.keys(result).length).toBeGreaterThan(0);
    });

    it('DB 行的 value 为空字符串时返回空字符串', async () => {
      db.clear();
      db.seed('ClinicInfo', [
        { id: '1', key: 'testKey', value: null, clinicId: null, updatedAt: '2026-01-01' },
      ]);
      (cache.get as jest.Mock).mockResolvedValue(undefined);
      const result = await service.getClinicInfo();
      expect(result['testKey']).toBe('');
    });
  });

  describe('get', () => {
    it('返回指定 key 的值', async () => {
      (cache.get as jest.Mock).mockResolvedValue({ myKey: 'myValue' });
      const result = await service.get('myKey');
      expect(result).toBe('myValue');
    });

    it('key 不存在时返回 undefined', async () => {
      (cache.get as jest.Mock).mockResolvedValue({ otherKey: 'value' });
      const result = await service.get('missingKey');
      expect(result).toBeUndefined();
    });
  });

  describe('getNumber', () => {
    it('返回数字值', async () => {
      (cache.get as jest.Mock).mockResolvedValue({ numKey: '42' });
      const result = await service.getNumber('numKey');
      expect(result).toBe(42);
    });

    it('值无效时返回默认值', async () => {
      (cache.get as jest.Mock).mockResolvedValue({ numKey: 'not-a-number' });
      const result = await service.getNumber('numKey', 10);
      expect(result).toBe(10);
    });

    it('key 不存在时返回默认值', async () => {
      (cache.get as jest.Mock).mockResolvedValue({});
      const result = await service.getNumber('missingKey', 5);
      expect(result).toBe(5);
    });
  });

  describe('getBoolean', () => {
    it('"true" 字符串返回 true', async () => {
      (cache.get as jest.Mock).mockResolvedValue({ bKey: 'true' });
      const result = await service.getBoolean('bKey');
      expect(result).toBe(true);
    });

    it('"1" 字符串返回 true', async () => {
      (cache.get as jest.Mock).mockResolvedValue({ bKey: '1' });
      const result = await service.getBoolean('bKey');
      expect(result).toBe(true);
    });

    it('"yes" 字符串返回 true', async () => {
      (cache.get as jest.Mock).mockResolvedValue({ bKey: 'yes' });
      const result = await service.getBoolean('bKey');
      expect(result).toBe(true);
    });

    it('其他字符串返回 false', async () => {
      (cache.get as jest.Mock).mockResolvedValue({ bKey: 'no' });
      const result = await service.getBoolean('bKey');
      expect(result).toBe(false);
    });

    it('key 不存在时返回默认 false', async () => {
      (cache.get as jest.Mock).mockResolvedValue({});
      const result = await service.getBoolean('missing');
      expect(result).toBe(false);
    });

    it('key 不存在且默认值为 true 时返回 true', async () => {
      (cache.get as jest.Mock).mockResolvedValue({});
      const result = await service.getBoolean('missing', true);
      expect(result).toBe(true);
    });

    it('val 为 null 时返回默认值', async () => {
      (cache.get as jest.Mock).mockResolvedValue({ bKey: null });
      const result = await service.getBoolean('bKey');
      expect(result).toBe(false);
    });
  });

  describe('updateClinicInfo', () => {
    it('存在时更新已存在的诊所专属配置', async () => {
      db.seed('ClinicInfo', [
        { id: '1', key: 'myKey', value: 'oldValue', clinicId: 'test-clinic-001', updatedAt: '2026-01-01' },
      ]);
      const result = await service.updateClinicInfo('myKey', 'newValue');
      expect(result).toEqual({ key: 'myKey', value: 'newValue' });
      const data = db.getTableData('ClinicInfo');
      const updated = data.find((r: any) => r.key === 'myKey');
      expect(updated!.value).toBe('newValue');
    });

    it('不存在时插入新配置', async () => {
      const result = await service.updateClinicInfo('newKey', 'newValue');
      expect(result).toEqual({ key: 'newKey', value: 'newValue' });
      const data = db.getTableData('ClinicInfo');
      expect(data.find((r: any) => r.key === 'newKey')).toBeDefined();
    });

    it('更新后写入审计日志', async () => {
      await service.updateClinicInfo('auditKey', 'auditValue');
      const logs = db.getTableData('AuditLog');
      expect(logs.length).toBe(1);
      expect(logs[0].type).toBe('SETTING_UPDATE');
    });

    it('更新后调用 invalidateCache（有 clinicId 时只清当前诊所缓存）', async () => {
      await service.updateClinicInfo('cacheKey', 'cacheValue');
      expect(cache.del).toHaveBeenCalled();
    });

    it('无 clinicId 时清空所有缓存（delPattern）', async () => {
      const noCtxService = new SettingsService(asDbService(db), cache, createMockClinicContext(null), auditLog);
      await noCtxService.updateClinicInfo('cacheKey', 'cacheValue');
      expect(cache.delPattern).toHaveBeenCalled();
    });
  });

  describe('upsertMany', () => {
    it('批量插入/更新配置', async () => {
      db.seed('ClinicInfo', [
        { id: '1', key: 'existing', value: 'old', clinicId: 'test-clinic-001', updatedAt: '2026-01-01' },
      ]);
      const result = await service.upsertMany({ existing: 'updated', brandNew: 'new' });
      expect(result).toEqual({ success: true });
      const data = db.getTableData('ClinicInfo');
      expect(data.find((r: any) => r.key === 'existing')!.value).toBe('updated');
      expect(data.find((r: any) => r.key === 'brandNew')).toBeDefined();
    });

    it('空对象直接返回 success', async () => {
      const result = await service.upsertMany({});
      expect(result).toEqual({ success: true });
    });
  });

  describe('delete', () => {
    it('删除配置并记录审计日志', async () => {
      db.seed('ClinicInfo', [
        { id: '1', key: 'toDelete', value: 'val', clinicId: 'test-clinic-001', updatedAt: '2026-01-01' },
      ]);
      // mock 不支持复杂 OR 条件 DELETE，使用 spyOn 模拟删除行为
      const originalPrepare = db.prepare.bind(db);
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        if (/DELETE\s+FROM\s+ClinicInfo/i.test(sql)) {
          // 实际从表中删除
          const tableData = db.tables.get('ClinicInfo')!;
          tableData.delete('1');
          return {
            run: () => ({ changes: 1, lastInsertRowid: '' }),
            get: () => null,
            all: () => [],
          };
        }
        return originalPrepare(sql);
      });
      const result = await service.delete('toDelete');
      expect(result).toEqual({ key: 'toDelete' });
      const data = db.getTableData('ClinicInfo');
      expect(data.find((r: any) => r.key === 'toDelete')).toBeUndefined();
      const logs = db.getTableData('AuditLog');
      expect(logs[0].type).toBe('SETTING_DELETE');
      prepareSpy.mockRestore();
    });

    it('有 clinicId 时调用 cache.del', async () => {
      await service.delete('anyKey');
      expect(cache.del).toHaveBeenCalled();
    });

    it('无 clinicId 时调用 cache.delPattern', async () => {
      const noCtxService = new SettingsService(asDbService(db), cache, createMockClinicContext(null), auditLog);
      await noCtxService.delete('anyKey');
      expect(cache.delPattern).toHaveBeenCalled();
    });
  });
});
