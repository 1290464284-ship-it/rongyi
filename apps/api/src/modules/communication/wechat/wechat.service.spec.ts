import { WechatService } from './wechat.service';
import { MockDbService } from '../../../db/__mocks__/db-service.mock';
import { ClinicContextService } from '../../../common/services/clinic-context.service';
import { BusinessValidationException } from '@common/errors';

function createMockClinicContext(clinicId: string | null = 'test-clinic-001'): ClinicContextService {
  return {
    getClinicId: () => clinicId,
    getUserId: () => 'test-user-001',
    getRole: () => 'BOSS',
    run: <T>(_ctx: unknown, fn: () => T) => fn(),
    isInitialized: () => true,
  } as unknown as ClinicContextService;
}

describe('WechatService', () => {
  let service: WechatService;
  let db: MockDbService;

  beforeEach(() => {
    db = new MockDbService();
    service = new WechatService(db as any, createMockClinicContext());
  });

  afterEach(() => {
    db.clear();
  });

  describe('sendMessage - 发送微信消息', () => {
    it('正常发送消息，返回 id 和 PENDING 状态', async () => {
      const result = await service.sendMessage({
        patientId: 'patient-001',
        type: 'TEXT',
        content: '你好',
      });

      expect(result.id).toBeDefined();
      expect(result.status).toBe('PENDING');

      const messages = db.getTableData('WechatMessage');
      expect(messages.length).toBe(1);
      expect(messages[0].patientId).toBe('patient-001');
      expect(messages[0].type).toBe('TEXT');
      expect(messages[0].content).toBe('你好');
      expect(messages[0].status).toBe('PENDING');
      expect(messages[0].clinicId).toBe('test-clinic-001');
    });

    it('支持 templateId 参数', async () => {
      const result = await service.sendMessage({
        patientId: 'patient-001',
        type: 'TEMPLATE',
        templateId: 'tpl-001',
      });

      expect(result.id).toBeDefined();
      expect(result.status).toBe('PENDING');

      const messages = db.getTableData('WechatMessage');
      expect(messages[0].templateId).toBe('tpl-001');
      expect(messages[0].content).toBeNull();
    });

    it('content 和 templateId 都不传时为 null', async () => {
      await service.sendMessage({
        patientId: 'patient-001',
        type: 'TEXT',
      });

      const messages = db.getTableData('WechatMessage');
      expect(messages[0].content).toBeNull();
      expect(messages[0].templateId).toBeNull();
    });
  });

  describe('findByPatient - 按患者查询消息', () => {
    beforeEach(() => {
      db.seed('WechatMessage', [
        { id: 'msg-1', patientId: 'patient-001', type: 'TEXT', content: '消息1', status: 'SENT', clinicId: 'test-clinic-001', createdAt: '2026-01-01T00:00:00.000Z', deletedAt: null },
        { id: 'msg-2', patientId: 'patient-001', type: 'TEMPLATE', content: null, status: 'PENDING', clinicId: 'test-clinic-001', createdAt: '2026-01-02T00:00:00.000Z', deletedAt: null },
        { id: 'msg-3', patientId: 'patient-002', type: 'TEXT', content: '消息3', status: 'SENT', clinicId: 'test-clinic-001', createdAt: '2026-01-03T00:00:00.000Z', deletedAt: null },
      ]);
    });

    it('返回指定患者的所有消息', async () => {
      const result = await service.findByPatient('patient-001');
      expect(result.items.length).toBe(2);
      expect(result.items[0].patientId).toBe('patient-001');
      expect(result.items[1].patientId).toBe('patient-001');
    });

    it('患者没有消息时返回空数组', async () => {
      const result = await service.findByPatient('non-existent');
      expect(result.items.length).toBe(0);
      expect(result.total).toBe(0);
    });
  });

  describe('findMany - 分页查询消息', () => {
    beforeEach(() => {
      db.seed('WechatMessage', [
        { id: 'msg-1', patientId: 'patient-001', type: 'TEXT', content: '消息1', status: 'SENT', clinicId: 'test-clinic-001', createdAt: '2026-01-01T00:00:00.000Z', deletedAt: null },
        { id: 'msg-2', patientId: 'patient-001', type: 'TEMPLATE', content: null, status: 'PENDING', clinicId: 'test-clinic-001', createdAt: '2026-01-02T00:00:00.000Z', deletedAt: null },
        { id: 'msg-3', patientId: 'patient-002', type: 'TEXT', content: '消息3', status: 'SENT', clinicId: 'test-clinic-001', createdAt: '2026-01-03T00:00:00.000Z', deletedAt: null },
        { id: 'msg-4', patientId: 'patient-002', type: 'IMAGE', content: 'img.png', status: 'FAILED', clinicId: 'test-clinic-001', createdAt: '2026-01-04T00:00:00.000Z', deletedAt: null },
      ]);
    });

    it('无过滤条件时返回所有消息', async () => {
      const result = await service.findMany({});
      expect(result.items.length).toBe(4);
      expect(result.total).toBe(4);
    });

    it('按 patientId 过滤', async () => {
      const result = await service.findMany({ patientId: 'patient-001' });
      expect(result.items.length).toBe(2);
      expect(result.total).toBe(2);
      result.items.forEach(item => {
        expect((item as any).patientId).toBe('patient-001');
      });
    });

    it('按 type 过滤', async () => {
      const result = await service.findMany({ type: 'TEXT' });
      expect(result.items.length).toBe(2);
      expect(result.total).toBe(2);
      result.items.forEach(item => {
        expect((item as any).type).toBe('TEXT');
      });
    });

    it('按 status 过滤', async () => {
      const result = await service.findMany({ status: 'SENT' });
      expect(result.items.length).toBe(2);
      expect(result.total).toBe(2);
      result.items.forEach(item => {
        expect((item as any).status).toBe('SENT');
      });
    });

    it('组合过滤：patientId + type + status', async () => {
      const result = await service.findMany({ patientId: 'patient-001', type: 'TEXT', status: 'SENT' });
      expect(result.items.length).toBe(1);
      expect(result.total).toBe(1);
      expect((result.items[0] as any).id).toBe('msg-1');
    });

    it('支持分页参数', async () => {
      const result = await service.findMany({}, 1, 2);
      expect(result.items.length).toBe(2);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(2);
      expect(result.total).toBe(4);
    });

    it('params 为 null 时正常返回', async () => {
      const result = await service.findMany(null);
      expect(result.items.length).toBe(4);
      expect(result.total).toBe(4);
    });
  });

  describe('Stub 方法 - 未实现功能', () => {
    it('getAppointmentReminders 抛出 BusinessValidationException', async () => {
      await expect(service.getAppointmentReminders()).rejects.toThrow(BusinessValidationException);
      await expect(service.getAppointmentReminders()).rejects.toThrow('此功能尚未实现');
      try {
        await service.getAppointmentReminders();
      } catch (err: any) {
        expect(err.status).toBe(400);
      }
    });

    it('send 抛出 BusinessValidationException', async () => {
      await expect(service.send({})).rejects.toThrow(BusinessValidationException);
      await expect(service.send({})).rejects.toThrow('此功能尚未实现');
      try {
        await service.send({});
      } catch (err: any) {
        expect(err.status).toBe(400);
      }
    });

    it('sendBatch 抛出 BusinessValidationException', async () => {
      await expect(service.sendBatch({})).rejects.toThrow(BusinessValidationException);
      await expect(service.sendBatch({})).rejects.toThrow('此功能尚未实现');
      try {
        await service.sendBatch({});
      } catch (err: any) {
        expect(err.status).toBe(400);
      }
    });

    it('getBirthdayPatients 抛出 BusinessValidationException', async () => {
      await expect(service.getBirthdayPatients()).rejects.toThrow(BusinessValidationException);
      await expect(service.getBirthdayPatients()).rejects.toThrow('此功能尚未实现');
      try {
        await service.getBirthdayPatients();
      } catch (err: any) {
        expect(err.status).toBe(400);
      }
    });
  });

  // ==================== 边界分支补充 ====================

  describe('边界分支 - clinicId 为 null 时 sendMessage', () => {
    it('clinicId 为 null 时 WechatMessage 记录的 clinicId 应存储为 null', async () => {
      const nullCtxService = new WechatService(db as any, createMockClinicContext(null));

      const result = await nullCtxService.sendMessage({
        patientId: 'patient-001',
        type: 'TEXT',
        content: '测试消息',
      });

      expect(result.id).toBeDefined();
      expect(result.status).toBe('PENDING');

      const messages = db.getTableData('WechatMessage');
      expect(messages.length).toBe(1);
      expect(messages[0].clinicId).toBeNull();
      expect(messages[0].patientId).toBe('patient-001');
    });

    it('clinicId 为 null 且 content/templateId 均不传时 clinicId 仍为 null', async () => {
      const nullCtxService = new WechatService(db as any, createMockClinicContext(null));

      await nullCtxService.sendMessage({
        patientId: 'patient-002',
        type: 'TEMPLATE',
        templateId: 'tpl-002',
      });

      const messages = db.getTableData('WechatMessage');
      expect(messages[0].clinicId).toBeNull();
      expect(messages[0].templateId).toBe('tpl-002');
      expect(messages[0].content).toBeNull();
    });
  });
});
