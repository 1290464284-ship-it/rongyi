
import { OperationLogsController } from './operation-logs.controller';
import { BusinessValidationException } from '@common/errors';
import { OperationLogsService } from './operation-logs.service';

describe('OperationLogsController', () => {
  let controller: OperationLogsController;
  let service: { create: jest.Mock; findMany: jest.Mock };

  beforeEach(() => {
    service = {
      create: jest.fn(),
      findMany: jest.fn(),
    };
    controller = new OperationLogsController(service as unknown as OperationLogsService);
  });

  describe('findMany', () => {
    it('调用 service.findMany，默认分页参数', async () => {
      const expected = { items: [], total: 0, page: 1, pageSize: 50 };
      service.findMany.mockResolvedValue(expected);

      const result = await controller.findMany();
      expect(result).toEqual(expected);
      expect(service.findMany).toHaveBeenCalledWith({ page: 1, pageSize: 50 });
    });

    it('传入 page 和 pageSize 字符串参数', async () => {
      const expected = { items: [], total: 0, page: 2, pageSize: 20 };
      service.findMany.mockResolvedValue(expected);

      const result = await controller.findMany('2', '20');
      expect(result).toEqual(expected);
      expect(service.findMany).toHaveBeenCalledWith({ page: 2, pageSize: 20 });
    });

    it('page 为无效值时使用默认值 1', async () => {
      const expected = { items: [], total: 0, page: 1, pageSize: 50 };
      service.findMany.mockResolvedValue(expected);

      await controller.findMany('abc');
      expect(service.findMany).toHaveBeenCalledWith({ page: 1, pageSize: 50 });
    });

    it('pageSize 为无效值时使用默认值 50', async () => {
      const expected = { items: [], total: 0, page: 1, pageSize: 50 };
      service.findMany.mockResolvedValue(expected);

      await controller.findMany(undefined, '-1');
      expect(service.findMany).toHaveBeenCalledWith({ page: 1, pageSize: 50 });
    });
  });

  describe('batchLog', () => {
    const mockReq = {
      user: { id: 'user-123', name: '张三', username: 'zhangsan' },
    };

    it('正常批量日志，从 req.user 取用户信息', async () => {
      const logs = [
        { timestamp: '2026-01-01T00:00:00Z', level: 'error' as const, message: '测试错误1', url: '/api/test' },
        { timestamp: '2026-01-01T00:00:01Z', level: 'info' as const, message: '测试信息' },
      ];

      const result = await controller.batchLog({ logs }, mockReq);

      expect(result).toEqual({ success: true });
      expect(service.create).toHaveBeenCalledTimes(2);

      const firstCall = service.create.mock.calls[0][0];
      expect(firstCall.userId).toBe('user-123');
      expect(firstCall.userName).toBe('张三');
      expect(firstCall.action).toContain('[ERROR] 测试错误1');
      expect(firstCall.target).toBe('/api/test');

      const secondCall = service.create.mock.calls[1][0];
      expect(secondCall.userId).toBe('user-123');
      expect(secondCall.userName).toBe('张三');
      expect(secondCall.action).toContain('[INFO] 测试信息');
    });

    it('logs 为空数组时抛 BusinessValidationException', async () => {
      await expect(
        controller.batchLog({ logs: [] }, mockReq as any)
      ).rejects.toThrow(BusinessValidationException);
      await expect(
        controller.batchLog({ logs: [] }, mockReq as any)
      ).rejects.toThrow('logs 不能为空');
    });

    it('logs 不存在或非数组时抛 BusinessValidationException', async () => {
      await expect(
        controller.batchLog({} as any, mockReq as any)
      ).rejects.toThrow(BusinessValidationException);

      await expect(
        controller.batchLog({ logs: 'not-array' } as any, mockReq as any)
      ).rejects.toThrow(BusinessValidationException);

      await expect(
        controller.batchLog(null as any, mockReq as any)
      ).rejects.toThrow(BusinessValidationException);
    });

    it('超过 50 条时抛 BusinessValidationException', async () => {
      const logs = Array.from({ length: 51 }, (_, i) => ({
        timestamp: '2026-01-01T00:00:00Z',
        level: 'info' as const,
        message: `日志${i}`,
      }));

      await expect(
        controller.batchLog({ logs }, mockReq as any)
      ).rejects.toThrow(BusinessValidationException);
      await expect(
        controller.batchLog({ logs }, mockReq as any)
      ).rejects.toThrow('单次批量日志不能超过 50 条');
    });

    it('无 message 的日志跳过', async () => {
      const logs = [
        { timestamp: '2026-01-01T00:00:00Z', level: 'error' as const, message: '' },
        { timestamp: '2026-01-01T00:00:01Z', level: 'info' as const },
        { timestamp: '2026-01-01T00:00:02Z', level: 'warn' as const, message: 123 as any },
        { timestamp: '2026-01-01T00:00:03Z', level: 'info' as const, message: '有效日志' },
      ];

      await controller.batchLog({ logs } as any, mockReq);

      expect(service.create).toHaveBeenCalledTimes(1);
      expect(service.create.mock.calls[0][0].action).toContain('有效日志');
    });

    it('截取超长字段（message 500、url 500、stack 2000、context 500、userAgent 500）', async () => {
      const longMessage = 'A'.repeat(1000);
      const longUrl = 'http://example.com/' + 'B'.repeat(1000);
      const longStack = 'C'.repeat(3000);
      const longContext = 'D'.repeat(1000);
      const longUserAgent = 'E'.repeat(1000);

      const logs = [{
        timestamp: '2026-01-01T00:00:00Z',
        level: 'error' as const,
        message: longMessage,
        url: longUrl,
        stack: longStack,
        context: longContext,
        userAgent: longUserAgent,
      }];

      await controller.batchLog({ logs }, mockReq);

      expect(service.create).toHaveBeenCalledTimes(1);
      const callArg = service.create.mock.calls[0][0];

      const actionPrefix = '[ERROR] ';
      expect(callArg.action.length).toBe(actionPrefix.length + 500);
      expect(callArg.action.startsWith(actionPrefix + 'A'.repeat(500))).toBe(true);

      expect(callArg.target.length).toBe(500);
      expect(callArg.target.startsWith('http://example.com/')).toBe(true);

      const detail = JSON.parse(callArg.detail);
      expect(detail.stack.length).toBe(2000);
      expect(detail.stack.startsWith('C'.repeat(2000))).toBe(true);
      expect(detail.context.length).toBe(500);
      expect(detail.context.startsWith('D'.repeat(500))).toBe(true);
      expect(detail.userAgent.length).toBe(500);
      expect(detail.userAgent.startsWith('E'.repeat(500))).toBe(true);
    });

    it('req.user 不存在时使用 system 作为默认用户', async () => {
      const logs = [
        { timestamp: '2026-01-01T00:00:00Z', level: 'info' as const, message: '系统日志' },
      ];

      await controller.batchLog({ logs }, {});

      expect(service.create).toHaveBeenCalledTimes(1);
      const callArg = service.create.mock.calls[0][0];
      expect(callArg.userId).toBe('system');
      expect(callArg.userName).toBe('system');
    });

    it('req.user 只有 username 没有 name 时使用 username', async () => {
      const logs = [
        { timestamp: '2026-01-01T00:00:00Z', level: 'info' as const, message: '测试' },
      ];
      const req = { user: { id: 'user-456', username: 'lisi' } };

      await controller.batchLog({ logs }, req);

      expect(service.create).toHaveBeenCalledTimes(1);
      const callArg = service.create.mock.calls[0][0];
      expect(callArg.userId).toBe('user-456');
      expect(callArg.userName).toBe('lisi');
    });

    it('level 为 undefined 时默认 info', async () => {
      const logs = [
        { timestamp: '2026-01-01T00:00:00Z', message: '测试' },
      ];

      await controller.batchLog({ logs }, mockReq);

      expect(service.create).toHaveBeenCalledTimes(1);
      const callArg = service.create.mock.calls[0][0];
      expect(callArg.action).toContain('[INFO]');
    });

    it('level 转为大写', async () => {
      const logs = [
        { timestamp: '2026-01-01T00:00:00Z', level: 'warning' as const, message: '警告' },
      ];

      await controller.batchLog({ logs }, mockReq);

      expect(service.create).toHaveBeenCalledTimes(1);
      const callArg = service.create.mock.calls[0][0];
      expect(callArg.action).toContain('[WARNING]');
    });

    it('url 为空时 target 为 null', async () => {
      const logs = [
        { timestamp: '2026-01-01T00:00:00Z', level: 'info' as const, message: '测试' },
      ];

      await controller.batchLog({ logs }, mockReq);

      expect(service.create).toHaveBeenCalledTimes(1);
      const callArg = service.create.mock.calls[0][0];
      expect(callArg.target).toBeUndefined();
    });
  });
});
