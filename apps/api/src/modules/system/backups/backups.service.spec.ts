import { BackupsService } from './backups.service';

describe('BackupsService', () => {
  let service: BackupsService;
  let autoBackup: { [key: string]: jest.Mock };
  let manualBackup: { [key: string]: jest.Mock };

  beforeEach(() => {
    manualBackup = {
      findMany: jest.fn(),
      create: jest.fn(),
      restore: jest.fn(),
      delete: jest.fn(),
      removeById: jest.fn(),
      restoreById: jest.fn(),
      list: jest.fn(),
      drill: jest.fn(),
      verifyBackup: jest.fn(),
    };

    autoBackup = {
      performAutoBackup: jest.fn(),
      ensureDailyBackup: jest.fn(),
      cleanupOldAutoBackups: jest.fn(),
      performAutoVerify: jest.fn(),
    };

    service = new BackupsService(
      autoBackup as any,
      manualBackup as any,
    );
  });

  describe('手动备份委托', () => {
    it('findMany 委托给manualBackup.findMany', async () => {
      const expected = [{ id: 'b-1' }];
      manualBackup.findMany.mockResolvedValue(expected);

      const result = await service.findMany();
      expect(result).toEqual(expected);
      expect(manualBackup.findMany).toHaveBeenCalled();
    });

    it('create 委托给manualBackup.create', async () => {
      const user = { id: 'u-1' };
      const expected = { id: 'b-1' };
      manualBackup.create.mockResolvedValue(expected);

      const result = await service.create('manual', 'remark', user);
      expect(result).toEqual(expected);
      expect(manualBackup.create).toHaveBeenCalledWith('manual', 'remark', user);
    });

    it('restore 委托给manualBackup.restore', async () => {
      const user = { id: 'u-1' };
      const expected = { success: true };
      manualBackup.restore.mockResolvedValue(expected);

      const result = await service.restore('backup.db', user);
      expect(result).toEqual(expected);
      expect(manualBackup.restore).toHaveBeenCalledWith('backup.db', user);
    });

    it('delete 委托给manualBackup.delete', async () => {
      const expected = { success: true };
      manualBackup.delete.mockResolvedValue(expected);

      const result = await service.delete('backup.db');
      expect(result).toEqual(expected);
      expect(manualBackup.delete).toHaveBeenCalledWith('backup.db');
    });

    it('removeById 委托给manualBackup.removeById', async () => {
      const expected = { success: true };
      manualBackup.removeById.mockResolvedValue(expected);

      const result = await service.removeById('b-1');
      expect(result).toEqual(expected);
      expect(manualBackup.removeById).toHaveBeenCalledWith('b-1');
    });

    it('restoreById 委托给manualBackup.restoreById', async () => {
      const user = { id: 'u-1' };
      const expected = { success: true };
      manualBackup.restoreById.mockResolvedValue(expected);

      const result = await service.restoreById('b-1', user);
      expect(result).toEqual(expected);
      expect(manualBackup.restoreById).toHaveBeenCalledWith('b-1', user);
    });

    it('list 委托给manualBackup.list', async () => {
      const expected = [{ id: 'b-1', filename: 'backup.db' }];
      manualBackup.list.mockResolvedValue(expected);

      const result = await service.list();
      expect(result).toEqual(expected);
      expect(manualBackup.list).toHaveBeenCalled();
    });

    it('drill 委托给manualBackup.drill', async () => {
      const expected = { success: true, duration: 100 };
      manualBackup.drill.mockResolvedValue(expected);

      const result = await service.drill();
      expect(result).toEqual(expected);
      expect(manualBackup.drill).toHaveBeenCalled();
    });

    it('verifyBackup 委托给manualBackup.verifyBackup', async () => {
      const expected = { success: true, valid: true };
      manualBackup.verifyBackup.mockResolvedValue(expected);

      const result = await service.verifyBackup('b-1');
      expect(result).toEqual(expected);
      expect(manualBackup.verifyBackup).toHaveBeenCalledWith('b-1');
    });
  });

  describe('自动备份委托', () => {
    it('performAutoBackup 委托给autoBackup.performAutoBackup', async () => {
      const expected = { success: true };
      autoBackup.performAutoBackup.mockResolvedValue(expected);

      const result = await service.performAutoBackup();
      expect(result).toEqual(expected);
      expect(autoBackup.performAutoBackup).toHaveBeenCalled();
    });

    it('ensureDailyBackup 委托给autoBackup.ensureDailyBackup', async () => {
      const expected = { success: true };
      autoBackup.ensureDailyBackup.mockResolvedValue(expected);

      const result = await service.ensureDailyBackup();
      expect(result).toEqual(expected);
      expect(autoBackup.ensureDailyBackup).toHaveBeenCalled();
    });

    it('cleanupOldAutoBackups 委托给autoBackup.cleanupOldAutoBackups', async () => {
      const expected = { deleted: 3 };
      autoBackup.cleanupOldAutoBackups.mockResolvedValue(expected);

      const result = await service.cleanupOldAutoBackups();
      expect(result).toEqual(expected);
      expect(autoBackup.cleanupOldAutoBackups).toHaveBeenCalled();
    });

    it('performAutoVerify 委托给autoBackup.performAutoVerify', async () => {
      const expected = { verified: 5 };
      autoBackup.performAutoVerify.mockResolvedValue(expected);

      const result = await service.performAutoVerify();
      expect(result).toEqual(expected);
      expect(autoBackup.performAutoVerify).toHaveBeenCalled();
    });
  });
});
