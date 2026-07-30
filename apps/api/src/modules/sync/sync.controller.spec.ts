import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';

describe('SyncController', () => {
  let controller: SyncController;
  let syncService: {
    pullChanges: jest.Mock;
    pushChanges: jest.Mock;
    cleanupOldChanges: jest.Mock;
  };

  beforeEach(() => {
    syncService = {
      pullChanges: jest.fn(),
      pushChanges: jest.fn(),
      cleanupOldChanges: jest.fn(),
    };
    controller = new SyncController(syncService as unknown as SyncService);
  });

  describe('pull', () => {
    it('应调用 syncService.pullChanges 并传入 since 和 deviceId', () => {
      const q = { since: '2026-07-01T00:00:00.000Z', deviceId: 'device-1' };
      syncService.pullChanges.mockReturnValue({ changes: [], serverTime: '2026-07-30T00:00:00.000Z', hasMore: false });
      const result = controller.pull(q);
      expect(syncService.pullChanges).toHaveBeenCalledWith('2026-07-01T00:00:00.000Z', 'device-1');
      expect(result).toEqual({ changes: [], serverTime: '2026-07-30T00:00:00.000Z', hasMore: false });
    });
  });

  describe('push', () => {
    it('应调用 syncService.pushChanges 并传入 payload', () => {
      const payload = {
        deviceId: 'device-1',
        changes: [{ tableName: 'Patient', recordId: 'p-1', operation: 'INSERT' as const, data: { name: '张三' }, updatedAt: '2026-07-30T00:00:00.000Z' }],
      };
      syncService.pushChanges.mockReturnValue({ accepted: 1, conflicts: 0, failed: 0, errors: [] });
      const result = controller.push(payload);
      expect(syncService.pushChanges).toHaveBeenCalledWith(payload);
      expect(result).toEqual({ accepted: 1, conflicts: 0, failed: 0, errors: [] });
    });
  });

  describe('cleanup', () => {
    it('应调用 syncService.cleanupOldChanges 并返回 { deleted }', () => {
      syncService.cleanupOldChanges.mockReturnValue(5);
      const result = controller.cleanup();
      expect(syncService.cleanupOldChanges).toHaveBeenCalled();
      expect(result).toEqual({ deleted: 5 });
    });

    it('无记录清理时应返回 { deleted: 0 }', () => {
      syncService.cleanupOldChanges.mockReturnValue(0);
      const result = controller.cleanup();
      expect(result).toEqual({ deleted: 0 });
    });
  });
});
