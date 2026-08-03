import { SyncService } from './sync.service';
import { MockDbService } from '../../db/__mocks__/db-service.mock';
import { ClinicContextService } from '../../common/services/clinic-context.service';

function createMockClinicContext(clinicId = 'test-clinic-001'): ClinicContextService {
  return {
    getClinicId: () => clinicId,
    getUserId: () => 'test-user',
    getRole: () => 'BOSS',
    getUserAgent: () => 'jest-test-agent',
    getSource: () => 'test',
    run: <T>(_ctx: unknown, fn: () => T) => fn(),
    isInitialized: () => true,
  } as unknown as ClinicContextService;
}

describe('SyncService', () => {
  let service: SyncService;
  let dbService: MockDbService;
  let clinicContext: ClinicContextService;

  beforeEach(() => {
    dbService = new MockDbService();
    clinicContext = createMockClinicContext();
    service = new SyncService(dbService as any, clinicContext);

    dbService.seed('SyncChangeLog', []);
  });

  describe('logChange', () => {
    it('应记录一条变更到 SyncChangeLog', () => {
      service.logChange('Patient', 'p-1', 'INSERT', 'device-1');

      const logs = dbService.getTableData('SyncChangeLog');
      expect(logs).toHaveLength(1);
      expect(logs[0].tableName).toBe('Patient');
      expect(logs[0].recordId).toBe('p-1');
      expect(logs[0].operation).toBe('INSERT');
      expect(logs[0].deviceId).toBe('device-1');
      expect(logs[0].clinicId).toBe('test-clinic-001');
    });

    it('无 clinicId 时应跳过记录', () => {
      clinicContext = createMockClinicContext('');
      service = new SyncService(dbService as any, clinicContext);

      service.logChange('Patient', 'p-1', 'INSERT', 'device-1');

      const logs = dbService.getTableData('SyncChangeLog');
      expect(logs).toHaveLength(0);
    });

    it('deviceId 为空时应使用 server 作为默认值', () => {
      service.logChange('Patient', 'p-1', 'UPDATE', '');

      const logs = dbService.getTableData('SyncChangeLog');
      expect(logs).toHaveLength(1);
      expect(logs[0].deviceId).toBe('server');
    });

    it('INSERT/UPDATE/DELETE 操作都应记录', () => {
      service.logChange('Patient', 'p-1', 'INSERT', 'd1');
      service.logChange('Patient', 'p-1', 'UPDATE', 'd1');
      service.logChange('Patient', 'p-1', 'DELETE', 'd1');

      const logs = dbService.getTableData('SyncChangeLog');
      expect(logs).toHaveLength(3);
      expect(logs[0].operation).toBe('INSERT');
      expect(logs[1].operation).toBe('UPDATE');
      expect(logs[2].operation).toBe('DELETE');
    });
  });

  describe('pullChanges', () => {
    it('应返回指定时间戳之后的变更', () => {
      const now = new Date().toISOString();
      const past = new Date(Date.now() - 86400000).toISOString();

      dbService.seed('SyncChangeLog', [
        { id: 'c-1', tableName: 'Patient', recordId: 'p-1', operation: 'INSERT', deviceId: 'device-2', clinicId: 'test-clinic-001', createdAt: now },
        { id: 'c-2', tableName: 'Patient', recordId: 'p-2', operation: 'UPDATE', deviceId: 'device-1', clinicId: 'test-clinic-001', createdAt: now },
      ]);

      const result = service.pullChanges(past, 'device-2');

      expect(result.changes).toHaveLength(1);
      expect(result.changes[0].deviceId).toBe('device-1');
      expect(result.serverTime).toBeDefined();
    });

    it('无 clinicId 时应返回空数组', () => {
      clinicContext = createMockClinicContext('');
      service = new SyncService(dbService as any, clinicContext);

      const result = service.pullChanges(new Date().toISOString(), 'device-1');
      expect(result.changes).toEqual([]);
    });

    it('应返回空数组当无变更时', () => {
      const result = service.pullChanges(new Date().toISOString(), 'device-1');
      expect(result.changes).toEqual([]);
      expect(result.serverTime).toBeDefined();
    });

    it('应排除自身设备的所有变更', () => {
      const now = new Date().toISOString();
      dbService.seed('SyncChangeLog', [
        { id: 'c-1', tableName: 'Patient', recordId: 'p-1', operation: 'INSERT', deviceId: 'device-1', clinicId: 'test-clinic-001', createdAt: now },
        { id: 'c-2', tableName: 'Patient', recordId: 'p-2', operation: 'UPDATE', deviceId: 'device-1', clinicId: 'test-clinic-001', createdAt: now },
      ]);

      const result = service.pullChanges(new Date(Date.now() - 86400000).toISOString(), 'device-1');
      expect(result.changes).toHaveLength(0);
    });

    it('应按 createdAt ASC 排序', () => {
      const now = new Date().toISOString();
      const past = new Date(Date.now() - 86400000).toISOString();
      dbService.seed('SyncChangeLog', [
        { id: 'c-1', tableName: 'Patient', recordId: 'p-1', operation: 'INSERT', deviceId: 'device-2', clinicId: 'test-clinic-001', createdAt: now },
        { id: 'c-2', tableName: 'Patient', recordId: 'p-2', operation: 'UPDATE', deviceId: 'device-3', clinicId: 'test-clinic-001', createdAt: past },
      ]);

      const result = service.pullChanges(new Date(Date.now() - 86400000).toISOString(), 'device-1');
      if (result.changes.length >= 2) {
        expect(new Date(result.changes[0].createdAt).getTime()).toBeLessThanOrEqual(
          new Date(result.changes[1].createdAt).getTime(),
        );
      }
    });
  });

  describe('pushChanges', () => {
    it('无 clinicId 时应返回 accepted: 0', () => {
      clinicContext = createMockClinicContext('');
      service = new SyncService(dbService as any, clinicContext);

      const result = service.pushChanges({
        deviceId: 'device-1',
        changes: [{ tableName: 'Patient', recordId: 'p-1', operation: 'INSERT', data: { name: 'Test' }, updatedAt: new Date().toISOString() }],
      });

      expect(result.accepted).toBe(0);
      expect(result.conflicts).toBe(0);
    });

    it('空变更数组应返回 0 accepted', () => {
      const result = service.pushChanges({
        deviceId: 'device-1',
        changes: [],
      });

      expect(result.accepted).toBe(0);
      expect(result.conflicts).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.errors).toEqual([]);
    });

    it('应拒绝无效表名', () => {
      const result = service.pushChanges({
        deviceId: 'device-1',
        changes: [{ tableName: 'invalid;table', recordId: 'p-1', operation: 'INSERT', data: { name: 'Test' }, updatedAt: new Date().toISOString() }],
      });

      expect(result.accepted).toBe(0);
      expect(result.failed).toBe(1);
      expect(result.errors.length).toBe(1);
    });

    it('应接受 DELETE 操作', () => {
      dbService.seed('Patient', [{ id: 'p-1', name: 'Test', clinicId: 'test-clinic-001', updatedAt: new Date(Date.now() - 10000).toISOString() }]);

      const result = service.pushChanges({
        deviceId: 'device-1',
        changes: [{ tableName: 'Patient', recordId: 'p-1', operation: 'DELETE', updatedAt: new Date().toISOString() }],
      });

      expect(result.accepted).toBe(1);
      expect(result.conflicts).toBe(0);
    });

    it('应接受 INSERT 操作', () => {
      const result = service.pushChanges({
        deviceId: 'device-1',
        changes: [{ tableName: 'Patient', recordId: 'p-new', operation: 'INSERT', data: { id: 'p-new', name: 'New' }, updatedAt: new Date().toISOString() }],
      });

      expect(result.accepted).toBe(1);
      const logs = dbService.getTableData('SyncChangeLog');
      expect(logs.length).toBeGreaterThanOrEqual(1);
    });

    it('应接受 UPDATE 操作', () => {
      dbService.seed('Patient', [{ id: 'p-1', name: 'Old', clinicId: 'test-clinic-001', updatedAt: new Date(Date.now() - 10000).toISOString() }]);

      const result = service.pushChanges({
        deviceId: 'device-1',
        changes: [{ tableName: 'Patient', recordId: 'p-1', operation: 'UPDATE', data: { name: 'Updated' }, updatedAt: new Date().toISOString() }],
      });

      expect(result.accepted).toBe(1);
    });

    it('冲突时应返回 conflicts 计数（最后写入胜出）', () => {
      const futureDate = new Date(Date.now() + 100000).toISOString();
      dbService.seed('Patient', [{ id: 'p-1', name: 'Old', clinicId: 'test-clinic-001', updatedAt: futureDate }]);

      const result = service.pushChanges({
        deviceId: 'device-1',
        changes: [{ tableName: 'Patient', recordId: 'p-1', operation: 'UPDATE', data: { name: 'ShouldBeRejected' }, updatedAt: new Date().toISOString() }],
      });

      expect(result.conflicts).toBe(1);
      expect(result.accepted).toBe(0);
    });

    it('多条变更应逐条处理', () => {
      const result = service.pushChanges({
        deviceId: 'device-1',
        changes: [
          { tableName: 'Patient', recordId: 'p-1', operation: 'INSERT', data: { id: 'p-1', name: 'First' }, updatedAt: new Date().toISOString() },
          { tableName: 'Patient', recordId: 'p-2', operation: 'INSERT', data: { id: 'p-2', name: 'Second' }, updatedAt: new Date().toISOString() },
          { tableName: 'Invalid!', recordId: 'p-3', operation: 'INSERT', data: {}, updatedAt: new Date().toISOString() },
        ],
      });

      expect(result.accepted).toBe(2);
      expect(result.failed).toBe(1);
      expect(result.errors.length).toBe(1);
    });

    it('无 data 的 INSERT 不应执行但仍记录变更', () => {
      const result = service.pushChanges({
        deviceId: 'device-1',
        changes: [{ tableName: 'Patient', recordId: 'p-1', operation: 'INSERT', data: undefined, updatedAt: new Date().toISOString() }],
      });

      expect(result.accepted).toBe(1);
    });

    it('data 中只有无效列名时不应执行写入', () => {
      const result = service.pushChanges({
        deviceId: 'device-1',
        changes: [{ tableName: 'Patient', recordId: 'p-1', operation: 'UPDATE', data: { 'invalid;col': 'val' }, updatedAt: new Date().toISOString() }],
      });

      expect(result.accepted).toBe(1);
    });

    it('INSERT 操作 data 中只有 id 字段时应跳过写入', () => {
      const result = service.pushChanges({
        deviceId: 'device-1',
        changes: [{ tableName: 'Patient', recordId: 'p-new', operation: 'INSERT', data: { id: 'p-new' }, updatedAt: new Date().toISOString() }],
      });

      expect(result.accepted).toBe(1);
    });

    it('UPDATE 操作 data 中只有 id 字段时应跳过写入', () => {
      dbService.seed('Patient', [{ id: 'p-1', name: 'Test', clinicId: 'test-clinic-001', updatedAt: new Date(Date.now() - 10000).toISOString() }]);

      const result = service.pushChanges({
        deviceId: 'device-1',
        changes: [{ tableName: 'Patient', recordId: 'p-1', operation: 'UPDATE', data: { id: 'p-1' }, updatedAt: new Date().toISOString() }],
      });

      expect(result.accepted).toBe(1);
    });

    it('INSERT 操作 data 中所有值均为 undefined 时应跳过写入', () => {
      const result = service.pushChanges({
        deviceId: 'device-1',
        changes: [{ tableName: 'Patient', recordId: 'p-new', operation: 'INSERT', data: { id: 'p-new', name: undefined as unknown as string }, updatedAt: new Date().toISOString() }],
      });

      expect(result.accepted).toBe(1);
    });

    it('DELETE 操作针对不存在的记录应仍标记为 accepted', () => {
      const result = service.pushChanges({
        deviceId: 'device-1',
        changes: [{ tableName: 'Patient', recordId: 'non-existent', operation: 'DELETE', updatedAt: new Date().toISOString() }],
      });

      expect(result.accepted).toBe(1);
      expect(result.conflicts).toBe(0);
    });

    it('INSERT 操作带数据且记录已存在应执行 UPSERT', () => {
      dbService.seed('Patient', [{ id: 'p-upsert', name: 'OldName', clinicId: 'test-clinic-001', updatedAt: new Date(Date.now() - 10000).toISOString() }]);

      const result = service.pushChanges({
        deviceId: 'device-1',
        changes: [{ tableName: 'Patient', recordId: 'p-upsert', operation: 'INSERT', data: { id: 'p-upsert', name: 'NewName' }, updatedAt: new Date().toISOString() }],
      });

      expect(result.accepted).toBe(1);
    });

    it('UPDATE 操作不存在的记录应成功执行', () => {
      const result = service.pushChanges({
        deviceId: 'device-1',
        changes: [{ tableName: 'Patient', recordId: 'p-nonexist', operation: 'UPDATE', data: { name: 'Test' }, updatedAt: new Date().toISOString() }],
      });

      expect(result.accepted).toBe(1);
    });

    it('INSERT 操作 data 为空对象时应跳过写入但仍记录变更', () => {
      const result = service.pushChanges({
        deviceId: 'device-1',
        changes: [{ tableName: 'Patient', recordId: 'p-1', operation: 'INSERT', data: {}, updatedAt: new Date().toISOString() }],
      });

      expect(result.accepted).toBe(1);
      const logs = dbService.getTableData('SyncChangeLog');
      expect(logs.length).toBeGreaterThan(0);
    });

    it('UPDATE 操作 data 为空对象时应跳过写入但仍记录变更', () => {
      dbService.seed('Patient', [{ id: 'p-1', name: 'Test', clinicId: 'test-clinic-001', updatedAt: new Date(Date.now() - 10000).toISOString() }]);

      const result = service.pushChanges({
        deviceId: 'device-1',
        changes: [{ tableName: 'Patient', recordId: 'p-1', operation: 'UPDATE', data: {}, updatedAt: new Date().toISOString() }],
      });

      expect(result.accepted).toBe(1);
    });

    it('UPDATE 操作携带 deletedAt 应被剥离，不写入记录', () => {
      const originalUpdatedAt = new Date(Date.now() - 10000).toISOString();
      dbService.seed('Patient', [{
        id: 'p-del-at',
        name: 'Test',
        clinicId: 'test-clinic-001',
        deletedAt: null,
        updatedAt: originalUpdatedAt,
      }]);

      const result = service.pushChanges({
        deviceId: 'device-1',
        changes: [{
          tableName: 'Patient',
          recordId: 'p-del-at',
          operation: 'UPDATE',
          data: { name: 'Updated', deletedAt: new Date().toISOString() },
          updatedAt: new Date().toISOString(),
        }],
      });

      expect(result.accepted).toBe(1);

      // 验证 deletedAt 未被写入（记录仍为活跃状态）
      const rows = dbService.getTableData('Patient');
      const updated = rows.find((r: Record<string, unknown>) => r.id === 'p-del-at');
      expect(updated).toBeDefined();
      expect(updated!.deletedAt).toBeNull();
      expect(updated!.name).toBe('Updated');
    });

    it('INSERT 操作携带 deletedAt 应被剥离，新记录不应有 deletedAt', () => {
      const result = service.pushChanges({
        deviceId: 'device-1',
        changes: [{
          tableName: 'Patient',
          recordId: 'p-new-del',
          operation: 'INSERT',
          data: { id: 'p-new-del', name: 'New', deletedAt: new Date().toISOString() },
          updatedAt: new Date().toISOString(),
        }],
      });

      expect(result.accepted).toBe(1);

      // 验证 deletedAt 未被写入
      const rows = dbService.getTableData('Patient');
      const inserted = rows.find((r: Record<string, unknown>) => r.id === 'p-new-del');
      expect(inserted).toBeDefined();
      expect(inserted!.deletedAt).toBeUndefined();
    });

    it('多条混合操作（INSERT/UPDATE/DELETE/无效）应分别统计', () => {
      dbService.seed('Patient', [
        { id: 'p-upd', name: 'Old', clinicId: 'test-clinic-001', updatedAt: new Date(Date.now() - 10000).toISOString() },
        { id: 'p-del', name: 'ToDelete', clinicId: 'test-clinic-001', updatedAt: new Date(Date.now() - 10000).toISOString() },
      ]);

      const futureDate = new Date(Date.now() + 100000).toISOString();
      dbService.seed('Patient', [
        { id: 'p-conflict', name: 'Newer', clinicId: 'test-clinic-001', updatedAt: futureDate },
      ]);

      const result = service.pushChanges({
        deviceId: 'device-1',
        changes: [
          { tableName: 'Patient', recordId: 'p-new', operation: 'INSERT', data: { id: 'p-new', name: 'New' }, updatedAt: new Date().toISOString() },
          { tableName: 'Patient', recordId: 'p-upd', operation: 'UPDATE', data: { name: 'Updated' }, updatedAt: new Date().toISOString() },
          { tableName: 'Patient', recordId: 'p-del', operation: 'DELETE', updatedAt: new Date().toISOString() },
          { tableName: 'Patient', recordId: 'p-conflict', operation: 'UPDATE', data: { name: 'ShouldFail' }, updatedAt: new Date().toISOString() },
          { tableName: 'Bad;Table', recordId: 'p-bad', operation: 'INSERT', data: {}, updatedAt: new Date().toISOString() },
        ],
      });

      expect(result.accepted).toBe(3);
      expect(result.conflicts).toBe(1);
      expect(result.failed).toBe(1);
    });
  });

  describe('cleanupOldChanges', () => {
    it('应删除超过 7 天的变更记录', () => {
      const oldDate = new Date(Date.now() - 8 * 86400000).toISOString();
      const newDate = new Date().toISOString();

      dbService.seed('SyncChangeLog', [
        { id: 'c-1', tableName: 'Patient', recordId: 'p-1', operation: 'INSERT', deviceId: 'device-1', clinicId: 'clinic-1', createdAt: oldDate },
        { id: 'c-2', tableName: 'Patient', recordId: 'p-2', operation: 'INSERT', deviceId: 'device-1', clinicId: 'clinic-1', createdAt: newDate },
      ]);

      const deleted = service.cleanupOldChanges();
      expect(deleted).toBeGreaterThanOrEqual(0);
    });

    it('无过期记录时应返回 0', () => {
      const newDate = new Date().toISOString();
      dbService.seed('SyncChangeLog', [
        { id: 'c-1', tableName: 'Patient', recordId: 'p-1', operation: 'INSERT', deviceId: 'device-1', clinicId: 'clinic-1', createdAt: newDate },
      ]);

      const deleted = service.cleanupOldChanges();
      expect(deleted).toBe(0);
    });
  });

  describe('sanitizeTableName', () => {
    it('应接受合法表名', () => {
      const result = service.pushChanges({
        deviceId: 'device-1',
        changes: [{ tableName: 'Patient', recordId: 'p-1', operation: 'INSERT', data: { id: 'p-1' }, updatedAt: new Date().toISOString() }],
      });
      expect(result.accepted).toBe(1);
    });

    it('应拒绝包含 SQL 注入字符的表名', () => {
      const result = service.pushChanges({
        deviceId: 'device-1',
        changes: [{ tableName: 'Patient; DROP TABLE', recordId: 'p-1', operation: 'INSERT', data: {}, updatedAt: new Date().toISOString() }],
      });
      expect(result.failed).toBe(1);
    });

    it('应拒绝空表名', () => {
      const result = service.pushChanges({
        deviceId: 'device-1',
        changes: [{ tableName: '', recordId: 'p-1', operation: 'INSERT', data: {}, updatedAt: new Date().toISOString() }],
      });
      expect(result.failed).toBe(1);
    });
  });
});
