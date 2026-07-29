import { AuditLogService } from './audit-log.service';
import { MockDbService, asDbService } from '../../db/__mocks__/db-service.mock';

describe('AuditLogService', () => {
  let db: MockDbService;
  let service: AuditLogService;

  beforeEach(() => {
    db = new MockDbService();
    service = new AuditLogService();
  });

  describe('logAudit', () => {
    it('应写入审计日志记录', () => {
      service.logAudit(asDbService(db), 'USER_CREATE', 'user-1', 'User', 'clinic-1', {
        afterData: { name: '张三' },
      });

      const logs = db.getTableData('AuditLog');
      expect(logs).toHaveLength(1);
      expect(logs[0].type).toBe('USER_CREATE');
      expect(logs[0].targetId).toBe('user-1');
      expect(logs[0].targetType).toBe('User');
      expect(logs[0].clinicId).toBe('clinic-1');
    });

    it('应自动序列化 beforeData/afterData', () => {
      service.logAudit(asDbService(db), 'UPDATE', 'id-1', 'Patient', 'c1', {
        beforeData: { name: '旧名' },
        afterData: { name: '新名' },
      });

      const logs = db.getTableData('AuditLog');
      expect(JSON.parse(logs[0].beforeData as string)).toEqual({ name: '旧名' });
      expect(JSON.parse(logs[0].afterData as string)).toEqual({ name: '新名' });
    });

    it('无 options 时 beforeData/afterData 应为 null', () => {
      service.logAudit(asDbService(db), 'DELETE', 'id-1', 'Patient', 'c1');

      const logs = db.getTableData('AuditLog');
      expect(logs[0].beforeData).toBeNull();
      expect(logs[0].afterData).toBeNull();
    });

    it('应记录 remark/operatorId/amount 等可选字段', () => {
      service.logAudit(asDbService(db), 'PAYMENT', 'id-1', 'Charge', 'c1', {
        remark: '现金支付',
        operatorId: 'doc-1',
        operatorName: '李医生',
        amount: 500,
        ip: 'test-ip',
      });

      const logs = db.getTableData('AuditLog');
      expect(logs[0].remark).toBe('现金支付');
      expect(logs[0].operatorId).toBe('doc-1');
      expect(logs[0].operatorName).toBe('李医生');
      expect(logs[0].amount).toBe(500);
      expect(logs[0].ip).toBe('test-ip');
    });

    it('clinicId 为 null 时应正确存储', () => {
      service.logAudit(asDbService(db), 'SYSTEM', 'id-1', 'System', null);

      const logs = db.getTableData('AuditLog');
      expect(logs[0].clinicId).toBeNull();
    });
  });

  describe('sanitizeAuditData', () => {
    it('应对敏感字段脱敏', () => {
      const result = service.sanitizeAuditData({ password: 'secret', name: '张三' }) as Record<string, unknown>;
      expect(result.password).toBe('[REDACTED]');
      expect(result.name).toBe('张三');
    });

    it('应递归脱敏嵌套对象', () => {
      const result = service.sanitizeAuditData({
        user: { passwordHash: 'hash', name: '李四' },
      }) as Record<string, unknown>;
      const nested = result.user as Record<string, unknown>;
      expect(nested.passwordHash).toBe('[REDACTED]');
      expect(nested.name).toBe('李四');
    });

    it('应处理数组', () => {
      const result = service.sanitizeAuditData([
        { phone: '13800000000' },
        { name: '正常' },
      ]) as Array<Record<string, unknown>>;
      expect(result[0].phone).toBe('[REDACTED]');
      expect(result[1].name).toBe('正常');
    });

    it('null/undefined 应原样返回', () => {
      expect(service.sanitizeAuditData(null)).toBeNull();
      expect(service.sanitizeAuditData(undefined)).toBeUndefined();
    });

    it('非对象值应原样返回', () => {
      expect(service.sanitizeAuditData('string')).toBe('string');
      expect(service.sanitizeAuditData(42)).toBe(42);
    });
  });
});
