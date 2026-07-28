
import { SoftDeleteManager, SoftDeleteContext } from './soft-delete-manager.service';
import { BusinessNotFoundException } from '@common/errors';

describe('SoftDeleteManager 软删除管理', () => {
  let manager: SoftDeleteManager;
  let mockDb: Record<string, jest.Mock>;
  let mockDbService: any;
  let prepareMock: jest.Mock;
  let transactionMock: jest.Mock;

  beforeEach(() => {
    manager = new SoftDeleteManager();

    prepareMock = jest.fn();
    transactionMock = jest.fn((callback) => callback(mockDb));

    mockDb = {
      prepare: prepareMock,
    };

    mockDbService = {
      transaction: transactionMock,
    };
  });

  const createDefaultContext = (overrides: Partial<SoftDeleteContext> = {}): SoftDeleteContext => ({
    tableName: 'TestTable',
    cascadeTables: [],
    uniqueFields: [],
    hasSoftDelete: true,
    selectColumns: 'id, name, phone, createdAt, updatedAt, deletedAt',
    clinicClause: { clause: 'AND clinicId = ?', params: ['clinic-123'] },
    clinicId: 'clinic-123',
    ...overrides,
  });

  describe('基础软删除功能', () => {
    it('应成功软删除存在的记录', () => {
      const existingRecord = {
        id: 'rec-001',
        name: '测试记录',
        phone: '13800138000',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        deletedAt: null,
      };

      const selectStmt = { get: jest.fn().mockReturnValue(existingRecord) };
      const updateStmt = { run: jest.fn() };
      const auditStmt = { run: jest.fn() };

      prepareMock
        .mockReturnValueOnce(selectStmt)
        .mockReturnValueOnce(updateStmt)
        .mockReturnValueOnce(auditStmt);

      const ctx = createDefaultContext();
      const result = manager.softDelete(mockDbService, 'rec-001', ctx);

      expect(transactionMock).toHaveBeenCalled();
      expect(result).toEqual(existingRecord);
      expect(updateStmt.run).toHaveBeenCalled();
      expect(auditStmt.run).toHaveBeenCalled();
    });

    it('记录不存在时应抛出 BusinessNotFoundException', () => {
      const selectStmt = { get: jest.fn().mockReturnValue(undefined) };
      prepareMock.mockReturnValue(selectStmt);

      const ctx = createDefaultContext();
      expect(() => {
        manager.softDelete(mockDbService, 'nonexistent-id', ctx);
      }).toThrow(BusinessNotFoundException);
      expect(() => {
        manager.softDelete(mockDbService, 'nonexistent-id', ctx);
      }).toThrow('TestTable不存在');
    });

    it('记录已删除时应抛出 BusinessNotFoundException', () => {
      const selectStmt = { get: jest.fn().mockReturnValue(undefined) };
      prepareMock.mockReturnValueOnce(selectStmt);

      const ctx = createDefaultContext({ hasSoftDelete: true });
      expect(() => {
        manager.softDelete(mockDbService, 'already-deleted', ctx);
      }).toThrow(BusinessNotFoundException);
    });

    it('不支持软删除的表应正常删除（不检查 deletedAt）', () => {
      const existingRecord = {
        id: 'rec-002',
        name: '测试',
      };

      const selectStmt = { get: jest.fn().mockReturnValue(existingRecord) };
      const updateStmt = { run: jest.fn() };
      const auditStmt = { run: jest.fn() };

      prepareMock
        .mockReturnValueOnce(selectStmt)
        .mockReturnValueOnce(updateStmt)
        .mockReturnValueOnce(auditStmt);

      const ctx = createDefaultContext({
        hasSoftDelete: false,
        selectColumns: 'id, name',
      });

      const result = manager.softDelete(mockDbService, 'rec-002', ctx);
      expect(result).toEqual(existingRecord);
    });
  });

  describe('唯一字段处理', () => {
    it('普通唯一字段应追加 _deleted_ 后缀', () => {
      const existingRecord = {
        id: 'rec-001abcdef',
        name: 'unique-name',
        deletedAt: null,
      };

      const selectStmt = { get: jest.fn().mockReturnValue(existingRecord) };
      const updateStmt = { run: jest.fn() };
      const auditStmt = { run: jest.fn() };

      prepareMock
        .mockReturnValueOnce(selectStmt)
        .mockReturnValueOnce(updateStmt)
        .mockReturnValueOnce(auditStmt);

      const ctx = createDefaultContext({
        uniqueFields: ['name'],
        selectColumns: 'id, name, deletedAt',
      });

      manager.softDelete(mockDbService, 'rec-001abcdef', ctx);

      const updateCall = updateStmt.run.mock.calls[0];
      const nameValue = updateCall.find((arg: any) => typeof arg === 'string' && arg.startsWith('unique-name_deleted_'));
      expect(nameValue).toBeDefined();
      expect(nameValue).toContain('rec-001a');
    });

    it('敏感唯一字段（phone）应替换为随机字符串', () => {
      const existingRecord = {
        id: 'rec-001',
        phone: '13800138000',
        deletedAt: null,
      };

      const selectStmt = { get: jest.fn().mockReturnValue(existingRecord) };
      const updateStmt = { run: jest.fn() };
      const auditStmt = { run: jest.fn() };

      prepareMock
        .mockReturnValueOnce(selectStmt)
        .mockReturnValueOnce(updateStmt)
        .mockReturnValueOnce(auditStmt);

      const ctx = createDefaultContext({
        uniqueFields: ['phone'],
        selectColumns: 'id, phone, deletedAt',
      });

      manager.softDelete(mockDbService, 'rec-001', ctx);

      const updateCall = updateStmt.run.mock.calls[0];
      const phoneValue = updateCall.find(
        (arg: any) => typeof arg === 'string' && arg.startsWith('DELETED_'),
      );
      expect(phoneValue).toBeDefined();
      expect(phoneValue).not.toBe('13800138000');
    });

    it('idCard 敏感字段应替换为随机字符串', () => {
      const existingRecord = {
        id: 'rec-001',
        idCard: '110101199001011234',
        deletedAt: null,
      };

      const selectStmt = { get: jest.fn().mockReturnValue(existingRecord) };
      const updateStmt = { run: jest.fn() };
      const auditStmt = { run: jest.fn() };

      prepareMock
        .mockReturnValueOnce(selectStmt)
        .mockReturnValueOnce(updateStmt)
        .mockReturnValueOnce(auditStmt);

      const ctx = createDefaultContext({
        uniqueFields: ['idCard'],
        selectColumns: 'id, idCard, deletedAt',
      });

      manager.softDelete(mockDbService, 'rec-001', ctx);

      const updateCall = updateStmt.run.mock.calls[0];
      const idCardValue = updateCall.find(
        (arg: any) => typeof arg === 'string' && arg.startsWith('DELETED_'),
      );
      expect(idCardValue).toBeDefined();
    });

    it('字段值为 null 时不应更新该字段', () => {
      const existingRecord = {
        id: 'rec-001',
        phone: null,
        deletedAt: null,
      };

      const selectStmt = { get: jest.fn().mockReturnValue(existingRecord) };
      const updateStmt = { run: jest.fn() };
      const auditStmt = { run: jest.fn() };

      prepareMock
        .mockReturnValueOnce(selectStmt)
        .mockReturnValueOnce(updateStmt)
        .mockReturnValueOnce(auditStmt);

      const ctx = createDefaultContext({
        uniqueFields: ['phone'],
        selectColumns: 'id, phone, deletedAt',
      });

      manager.softDelete(mockDbService, 'rec-001', ctx);

      const updateCall = updateStmt.run.mock.calls[0];
      const phoneUpdates = updateCall.filter(
        (arg: any) => typeof arg === 'string' && arg.startsWith('DELETED_'),
      );
      expect(phoneUpdates.length).toBe(0);
    });

    it('无效字段名应被跳过', () => {
      const existingRecord = {
        id: 'rec-001',
        name: 'test',
        deletedAt: null,
      };

      const selectStmt = { get: jest.fn().mockReturnValue(existingRecord) };
      const updateStmt = { run: jest.fn() };
      const auditStmt = { run: jest.fn() };

      prepareMock
        .mockReturnValueOnce(selectStmt)
        .mockReturnValueOnce(updateStmt)
        .mockReturnValueOnce(auditStmt);

      const ctx = createDefaultContext({
        uniqueFields: ['invalid-field; DROP TABLE'],
        selectColumns: 'id, name, deletedAt',
      });

      expect(() => {
        manager.softDelete(mockDbService, 'rec-001', ctx);
      }).not.toThrow();
    });
  });

  describe('级联软删除', () => {
    it('应级联更新关联表的 deletedAt', () => {
      const existingRecord = {
        id: 'rec-001',
        name: '主记录',
        deletedAt: null,
      };

      const selectStmt = { get: jest.fn().mockReturnValue(existingRecord) };
      const updateStmt = { run: jest.fn() };
      const cascadeStmt1 = { run: jest.fn() };
      const cascadeStmt2 = { run: jest.fn() };
      const auditStmt = { run: jest.fn() };

      prepareMock
        .mockReturnValueOnce(selectStmt)
        .mockReturnValueOnce(updateStmt)
        .mockReturnValueOnce(cascadeStmt1)
        .mockReturnValueOnce(cascadeStmt2)
        .mockReturnValueOnce(auditStmt);

      const ctx = createDefaultContext({
        cascadeTables: [
          { table: 'ChildTable1', foreignKey: 'parentId' },
          { table: 'ChildTable2', foreignKey: 'masterId' },
        ],
        selectColumns: 'id, name, deletedAt',
      });

      manager.softDelete(mockDbService, 'rec-001', ctx);

      expect(cascadeStmt1.run).toHaveBeenCalled();
      expect(cascadeStmt2.run).toHaveBeenCalled();
      expect(prepareMock).toHaveBeenCalledTimes(5);
    });

    it('级联更新应包含诊所过滤条件', () => {
      const existingRecord = {
        id: 'rec-001',
        name: '主记录',
        deletedAt: null,
      };

      const selectStmt = { get: jest.fn().mockReturnValue(existingRecord) };
      const updateStmt = { run: jest.fn() };
      const cascadeStmt = { run: jest.fn() };
      const auditStmt = { run: jest.fn() };

      prepareMock
        .mockReturnValueOnce(selectStmt)
        .mockReturnValueOnce(updateStmt)
        .mockReturnValueOnce(cascadeStmt)
        .mockReturnValueOnce(auditStmt);

      const ctx = createDefaultContext({
        cascadeTables: [{ table: 'ChildTable', foreignKey: 'parentId' }],
        selectColumns: 'id, name, deletedAt',
      });

      manager.softDelete(mockDbService, 'rec-001', ctx);

      const cascadeCall = cascadeStmt.run.mock.calls[0];
      expect(cascadeCall).toContain('rec-001');
      expect(cascadeCall).toContain('clinic-123');
    });

    it('无级联表时不应创建级联语句', () => {
      const existingRecord = {
        id: 'rec-001',
        name: '测试',
        deletedAt: null,
      };

      const selectStmt = { get: jest.fn().mockReturnValue(existingRecord) };
      const updateStmt = { run: jest.fn() };
      const auditStmt = { run: jest.fn() };

      prepareMock
        .mockReturnValueOnce(selectStmt)
        .mockReturnValueOnce(updateStmt)
        .mockReturnValueOnce(auditStmt);

      const ctx = createDefaultContext({
        cascadeTables: [],
        selectColumns: 'id, name, deletedAt',
      });

      manager.softDelete(mockDbService, 'rec-001', ctx);
      expect(prepareMock).toHaveBeenCalledTimes(3);
    });
  });

  describe('审计日志', () => {
    it('应写入 SOFT_DELETE 类型的审计日志', () => {
      const existingRecord = {
        id: 'rec-001',
        name: '测试记录',
        deletedAt: null,
      };

      const selectStmt = { get: jest.fn().mockReturnValue(existingRecord) };
      const updateStmt = { run: jest.fn() };
      const auditStmt = { run: jest.fn() };

      prepareMock
        .mockReturnValueOnce(selectStmt)
        .mockReturnValueOnce(updateStmt)
        .mockReturnValueOnce(auditStmt);

      const ctx = createDefaultContext({
        selectColumns: 'id, name, deletedAt',
      });

      manager.softDelete(mockDbService, 'rec-001', ctx);

      expect(auditStmt.run).toHaveBeenCalled();
      const auditParams = auditStmt.run.mock.calls[0];
      expect(auditParams[1]).toBe('SOFT_DELETE');
      expect(auditParams[2]).toBe('rec-001');
      expect(auditParams[3]).toBe('TestTable');
      expect(auditParams[5]).toBe('clinic-123');
    });

    it('审计日志的 beforeData 应为 JSON 字符串', () => {
      const existingRecord = {
        id: 'rec-001',
        name: '测试',
        deletedAt: null,
      };

      const selectStmt = { get: jest.fn().mockReturnValue(existingRecord) };
      const updateStmt = { run: jest.fn() };
      const auditStmt = { run: jest.fn() };

      prepareMock
        .mockReturnValueOnce(selectStmt)
        .mockReturnValueOnce(updateStmt)
        .mockReturnValueOnce(auditStmt);

      const ctx = createDefaultContext({
        selectColumns: 'id, name, deletedAt',
      });

      manager.softDelete(mockDbService, 'rec-001', ctx);

      const auditParams = auditStmt.run.mock.calls[0];
      const beforeData = JSON.parse(auditParams[4]);
      expect(beforeData).toEqual(existingRecord);
    });
  });

  describe('诊所过滤', () => {
    it('应包含诊所过滤条件在查询中', () => {
      const selectStmt = { get: jest.fn().mockReturnValue(undefined) };
      prepareMock.mockReturnValueOnce(selectStmt);

      const ctx = createDefaultContext({
        clinicClause: { clause: 'AND clinicId = ?', params: ['clinic-abc'] },
        clinicId: 'clinic-abc',
      });

      expect(() => {
        manager.softDelete(mockDbService, 'rec-001', ctx);
      }).toThrow(BusinessNotFoundException);

      const selectSql = prepareMock.mock.calls[0][0];
      expect(selectSql).toContain('clinicId');
    });

    it('无诊所过滤时应正常工作', () => {
      const existingRecord = {
        id: 'rec-001',
        name: '无诊所记录',
        deletedAt: null,
      };

      const selectStmt = { get: jest.fn().mockReturnValue(existingRecord) };
      const updateStmt = { run: jest.fn() };
      const auditStmt = { run: jest.fn() };

      prepareMock
        .mockReturnValueOnce(selectStmt)
        .mockReturnValueOnce(updateStmt)
        .mockReturnValueOnce(auditStmt);

      const ctx = createDefaultContext({
        clinicClause: { clause: '', params: [] },
        clinicId: null,
        selectColumns: 'id, name, deletedAt',
      });

      const result = manager.softDelete(mockDbService, 'rec-001', ctx);
      expect(result).toEqual(existingRecord);
    });
  });

  describe('事务处理', () => {
    it('应在事务中执行所有操作', () => {
      const existingRecord = {
        id: 'rec-001',
        name: '测试',
        deletedAt: null,
      };

      const selectStmt = { get: jest.fn().mockReturnValue(existingRecord) };
      const updateStmt = { run: jest.fn() };
      const auditStmt = { run: jest.fn() };

      let transactionCalled = false;
      mockDbService.transaction = jest.fn((callback) => {
        transactionCalled = true;
        return callback(mockDb);
      });

      prepareMock
        .mockReturnValueOnce(selectStmt)
        .mockReturnValueOnce(updateStmt)
        .mockReturnValueOnce(auditStmt);

      const ctx = createDefaultContext({
        selectColumns: 'id, name, deletedAt',
      });

      manager.softDelete(mockDbService, 'rec-001', ctx);
      expect(transactionCalled).toBe(true);
    });

    it('查询失败时应抛出异常且不执行更新', () => {
      const selectStmt = {
        get: jest.fn().mockImplementation(() => {
          throw new Error('DB error');
        }),
      };
      prepareMock.mockReturnValueOnce(selectStmt);

      const ctx = createDefaultContext();
      expect(() => {
        manager.softDelete(mockDbService, 'rec-001', ctx);
      }).toThrow('DB error');
    });
  });

  describe('返回值', () => {
    it('应返回删除前的记录数据', () => {
      const existingRecord = {
        id: 'rec-001',
        name: '原数据',
        value: 123,
        deletedAt: null,
      };

      const selectStmt = { get: jest.fn().mockReturnValue(existingRecord) };
      const updateStmt = { run: jest.fn() };
      const auditStmt = { run: jest.fn() };

      prepareMock
        .mockReturnValueOnce(selectStmt)
        .mockReturnValueOnce(updateStmt)
        .mockReturnValueOnce(auditStmt);

      const ctx = createDefaultContext({
        selectColumns: 'id, name, value, deletedAt',
      });

      const result = manager.softDelete(mockDbService, 'rec-001', ctx);
      expect(result).toBe(existingRecord);
      expect(result.name).toBe('原数据');
      expect(result.value).toBe(123);
    });
  });
});
