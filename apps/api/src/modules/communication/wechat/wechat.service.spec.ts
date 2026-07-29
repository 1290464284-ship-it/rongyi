import { WechatService } from './wechat.service';
import { MockDbService , asDbService } from '../../../db/__mocks__/db-service.mock';
import { ClinicContextService } from '../../../common/services/clinic-context.service';
import { BusinessValidationException } from '@common/errors';
import { ForbiddenException } from '@nestjs/common';

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
    service = new WechatService(asDbService(db), createMockClinicContext());
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
      expect(messages[0].content).toBeUndefined();
    });

    it('content 和 templateId 都不传时为 undefined', async () => {
      await service.sendMessage({
        patientId: 'patient-001',
        type: 'TEXT',
      });

      const messages = db.getTableData('WechatMessage');
      expect(messages[0].content).toBeUndefined();
      expect(messages[0].templateId).toBeUndefined();
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
        expect(item.patientId).toBe('patient-001');
      });
    });

    it('按 type 过滤', async () => {
      const result = await service.findMany({ type: 'TEXT' });
      expect(result.items.length).toBe(2);
      expect(result.total).toBe(2);
      result.items.forEach(item => {
        expect(item.type).toBe('TEXT');
      });
    });

    it('按 status 过滤', async () => {
      const result = await service.findMany({ status: 'SENT' });
      expect(result.items.length).toBe(2);
      expect(result.total).toBe(2);
      result.items.forEach(item => {
        expect(item.status).toBe('SENT');
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
      } catch (err: unknown) {
        expect((err as { status: number }).status).toBe(400);
      }
    });

    it('send 委托给 sendMessage 发送消息', async () => {
      const result = await service.send({ patientId: 'p-001', type: 'text', content: '你好' });
      expect(result).toHaveProperty('id');
      expect(result.status).toBe('PENDING');
      expect(result.type).toBe('text');
      expect(result.content).toBe('你好');
    });

    it('send 缺少 patientId 时抛出校验异常', async () => {
      await expect(service.send({})).rejects.toThrow(BusinessValidationException);
      await expect(service.send({})).rejects.toThrow('patientId 不能为空');
    });

    it('sendBatch 批量发送消息', async () => {
      const result = await service.sendBatch({ patientIds: ['p-001', 'p-002'], type: 'text', content: '批量消息' });
      expect(result.count).toBe(2);
      expect(result.results).toHaveLength(2);
      expect(result.results[0].type).toBe('text');
      expect(result.results[1].type).toBe('text');
    });

    it('sendBatch 缺少 patientIds 时抛出校验异常', async () => {
      await expect(service.sendBatch({})).rejects.toThrow(BusinessValidationException);
      await expect(service.sendBatch({})).rejects.toThrow('patientIds 不能为空');
    });

    it('getBirthdayPatients 抛出 BusinessValidationException', async () => {
      await expect(service.getBirthdayPatients()).rejects.toThrow(BusinessValidationException);
      await expect(service.getBirthdayPatients()).rejects.toThrow('此功能尚未实现');
      try {
        await service.getBirthdayPatients();
      } catch (err: unknown) {
        expect((err as { status: number }).status).toBe(400);
      }
    });
  });

  // ==================== 边界分支补充 ====================

  describe('边界分支 - clinicId 为 null 时 sendMessage', () => {
    // P1 修复：原先 clinicId 为 null 时会写入 clinicId=null 的记录，
    // 这类记录在 buildClinicFilterOptional 路径下会被全诊所可见，构成跨租户数据泄露。
    // 现在统一走 super.create()，由 BaseService.create 强制校验 clinicId（缺失时抛 ForbiddenException）。
    it('clinicId 为 null 时抛出 ForbiddenException，防止跨租户数据泄露', async () => {
      const nullCtxService = new WechatService(asDbService(db), createMockClinicContext(null));

      await expect(nullCtxService.sendMessage({
        patientId: 'patient-001',
        type: 'TEXT',
        content: '测试消息',
      })).rejects.toThrow(ForbiddenException);

      // 不应写入任何记录
      const messages = db.getTableData('WechatMessage');
      expect(messages.length).toBe(0);
    });

    it('clinicId 为 null 且传 templateId 时同样抛出 ForbiddenException', async () => {
      const nullCtxService = new WechatService(asDbService(db), createMockClinicContext(null));

      await expect(nullCtxService.sendMessage({
        patientId: 'patient-002',
        type: 'TEMPLATE',
        templateId: 'tpl-002',
      })).rejects.toThrow(ForbiddenException);

      const messages = db.getTableData('WechatMessage');
      expect(messages.length).toBe(0);
    });

    it('clinicId 为空串时也抛出 ForbiddenException', async () => {
      const emptyCtxService = new WechatService(asDbService(db), createMockClinicContext(''));

      await expect(emptyCtxService.sendMessage({
        patientId: 'patient-003',
        type: 'TEXT',
      })).rejects.toThrow(ForbiddenException);

      const messages = db.getTableData('WechatMessage');
      expect(messages.length).toBe(0);
    });
  });
});
