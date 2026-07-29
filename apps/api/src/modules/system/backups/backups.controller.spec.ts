import { BackupsController } from './backups.controller';
import { AlertLevel, AlertCategory } from '../../../common/services/alert.service';

describe('BackupsController', () => {
  let controller: BackupsController;
  let backupsService: Record<string, jest.Mock>;
  let alertService: Record<string, jest.Mock>;

  beforeEach(() => {
    backupsService = {
      list: jest.fn(),
      create: jest.fn(),
      restoreById: jest.fn(),
      removeById: jest.fn(),
      drill: jest.fn(),
      verifyBackup: jest.fn(),
    };

    alertService = {
      getAlerts: jest.fn(),
      resolveAlert: jest.fn(),
      clearResolved: jest.fn(),
    };

    controller = new BackupsController(
      backupsService as any,
      alertService as any,
    );
  });

  describe('list', () => {
    it('应委托给 backupsService.list', () => {
      const expected = [{ id: 'b-1' }];
      backupsService.list.mockReturnValue(expected);

      const result = controller.list();
      expect(result).toEqual(expected);
      expect(backupsService.list).toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('应委托给 backupsService.create', () => {
      const dto = { type: 'manual', remark: 'test' };
      const req = { user: { id: 'u-1' } } as any;
      const expected = { id: 'b-1' };
      backupsService.create.mockReturnValue(expected);

      const result = controller.create(dto, req);
      expect(result).toEqual(expected);
      expect(backupsService.create).toHaveBeenCalledWith('manual', 'test', req.user);
    });

    it('type 和 remark 可选', () => {
      const dto = {};
      const req = { user: { id: 'u-1' } } as any;
      controller.create(dto, req);
      expect(backupsService.create).toHaveBeenCalledWith(undefined, undefined, req.user);
    });
  });

  describe('restore', () => {
    it('应委托给 backupsService.restoreById', () => {
      const req = { user: { id: 'u-1' } } as any;
      const expected = { success: true };
      backupsService.restoreById.mockReturnValue(expected);

      const result = controller.restore('b-1', req);
      expect(result).toEqual(expected);
      expect(backupsService.restoreById).toHaveBeenCalledWith('b-1', req.user);
    });
  });

  describe('remove', () => {
    it('应委托给 backupsService.removeById', () => {
      const expected = { filename: 'test.sqlite' };
      backupsService.removeById.mockReturnValue(expected);

      const result = controller.remove('b-1');
      expect(result).toEqual(expected);
      expect(backupsService.removeById).toHaveBeenCalledWith('b-1');
    });
  });

  describe('drill', () => {
    it('应委托给 backupsService.drill', () => {
      const expected = { success: true, results: [] };
      backupsService.drill.mockReturnValue(expected);

      const result = controller.drill();
      expect(result).toEqual(expected);
    });
  });

  describe('verify', () => {
    it('应委托给 backupsService.verifyBackup', () => {
      const expected = { success: true, results: [] };
      backupsService.verifyBackup.mockReturnValue(expected);

      const result = controller.verify('b-1');
      expect(result).toEqual(expected);
      expect(backupsService.verifyBackup).toHaveBeenCalledWith('b-1');
    });
  });

  describe('getAlerts', () => {
    it('应传递筛选参数给 alertService', () => {
      const expected = [{ id: 'a-1' }];
      alertService.getAlerts.mockReturnValue(expected);

      const result = controller.getAlerts(AlertLevel.WARNING, AlertCategory.BACKUP, 'true', '10');
      expect(result).toEqual(expected);
      expect(alertService.getAlerts).toHaveBeenCalledWith({
        level: AlertLevel.WARNING,
        category: AlertCategory.BACKUP,
        resolved: true,
        limit: 10,
      });
    });

    it('参数可选', () => {
      controller.getAlerts();
      expect(alertService.getAlerts).toHaveBeenCalledWith({
        level: undefined,
        category: undefined,
        resolved: undefined,
        limit: undefined,
      });
    });
  });

  describe('resolveAlert', () => {
    it('应委托给 alertService.resolveAlert', () => {
      alertService.resolveAlert.mockReturnValue(true);
      const result = controller.resolveAlert('a-1');
      expect(result).toEqual({ success: true });
    });
  });

  describe('clearResolvedAlerts', () => {
    it('应委托给 alertService.clearResolved', () => {
      const result = controller.clearResolvedAlerts();
      expect(result).toEqual({ success: true });
      expect(alertService.clearResolved).toHaveBeenCalled();
    });
  });
});
