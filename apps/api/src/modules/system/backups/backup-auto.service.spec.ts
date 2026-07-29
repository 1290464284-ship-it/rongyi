import { BackupAutoService } from './backup-auto.service';
import { MockDbService , asDbService } from '../../../db/__mocks__/db-service.mock';
import { ClinicContextService } from '../../../common/services/clinic-context.service';
import { AlertCategory } from '../../../common/services/alert.service';

process.env.ENCRYPTION_KEY = 'test-encryption-key-for-unit-tests-only-00000000000000000000000000000000';

jest.mock('node:fs', () => {
  const actual = jest.requireActual('node:fs');
  return {
    ...actual,
    statSync: jest.fn(),
    existsSync: jest.fn(),
    readdirSync: jest.fn(),
    unlinkSync: jest.fn(),
    mkdirSync: jest.fn(),
  };
});

import * as fs from 'node:fs';

const mockedFs = jest.mocked(fs);

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

class ExtendedMockDbService extends MockDbService {
  checkpointCalls: string[] = [];
  execCalls: string[] = [];

  constructor() {
    super();
    if (!(this as any).tables.has('BackupRecord')) {
      (this as any).tables.set('BackupRecord', new Map());
    }
    if (!(this as any).tables.has('SystemAlert')) {
      (this as any).tables.set('SystemAlert', new Map());
    }
  }

  checkpoint(mode: string): void {
    this.checkpointCalls.push(mode);
  }

  exec(sql: string): void {
    this.execCalls.push(sql);
  }

  get db(): any {
    return {
      name: '/data/test.db',
    };
  }
}

function createMockManualBackup(): { [key: string]: jest.Mock } {
  return {
    create: jest.fn().mockResolvedValue({ id: 'auto-b-1', filename: 'auto-backup.sqlite', fileSize: 1024 }),
    removeById: jest.fn().mockResolvedValue({ filename: 'deleted.sqlite' }),
    verifyBackup: jest.fn().mockResolvedValue({ success: true, results: [], timestamp: new Date().toISOString(), filename: 'test.sqlite' }),
  };
}

function createMockAlertService(): { [key: string]: jest.Mock } {
  return {
    recordSuccess: jest.fn(),
    recordFailure: jest.fn(),
    recordAlert: jest.fn(),
  };
}

describe('BackupAutoService', () => {
  let service: BackupAutoService;
  let db: ExtendedMockDbService;
  let manualBackup: { [key: string]: jest.Mock };
  let alertService: { [key: string]: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    mockedFs.statSync.mockReturnValue({ size: 1024 * 1024 } as any);
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readdirSync.mockReturnValue([]);

    db = new ExtendedMockDbService();
    manualBackup = createMockManualBackup();
    alertService = createMockAlertService();

    service = new BackupAutoService(
      asDbService(db),
      alertService as any,
      createMockClinicContext(),
      manualBackup as any,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    db.clear();
  });

  describe('onModuleInit - 模块初始化', () => {
    it('应启动自动备份和自动验证定时器', () => {
      const startSpy = jest.spyOn(service as any, 'startAutoBackup');
      const startVerifySpy = jest.spyOn(service as any, 'startAutoVerify');

      service.onModuleInit();

      expect(startSpy).toHaveBeenCalled();
      expect(startVerifySpy).toHaveBeenCalled();
    });
  });

  describe('onModuleDestroy - 模块销毁', () => {
    it('应停止自动备份和自动验证定时器', () => {
      const stopSpy = jest.spyOn(service as any, 'stopAutoBackup');
      const stopVerifySpy = jest.spyOn(service as any, 'stopAutoVerify');

      service.onModuleInit();
      service.onModuleDestroy();

      expect(stopSpy).toHaveBeenCalled();
      expect(stopVerifySpy).toHaveBeenCalled();
    });
  });

  describe('performAutoBackup - 执行自动备份', () => {
    it('成功备份后应记录成功告警并清理旧备份', async () => {
      const cleanupSpy = jest.spyOn(service, 'cleanupOldAutoBackups').mockResolvedValue(undefined);

      await service.performAutoBackup();

      expect(manualBackup.create).toHaveBeenCalledWith(
        'AUTO',
        '自动定时备份',
        expect.objectContaining({ id: 'system' }),
      );
      expect(alertService.recordSuccess).toHaveBeenCalledWith(
        AlertCategory.BACKUP,
        'auto-backup',
      );
      expect(cleanupSpy).toHaveBeenCalled();
    });

    it('备份失败时应记录失败告警', async () => {
      manualBackup.create.mockRejectedValue(new Error('backup failed'));

      await service.performAutoBackup();

      expect(alertService.recordFailure).toHaveBeenCalledWith(
        AlertCategory.BACKUP,
        'auto-backup',
        '自动备份失败',
        'backup failed',
      );
    });
  });

  describe('ensureDailyBackup - 确保每日备份', () => {
    it('今日已有备份时不执行新备份', async () => {
      jest.spyOn(db, 'prepare').mockReturnValue({
        get: jest.fn().mockReturnValue({ cnt: 1 }),
      } as any);

      const performSpy = jest.spyOn(service, 'performAutoBackup');

      await service.ensureDailyBackup();

      expect(performSpy).not.toHaveBeenCalled();
    });

    it('今日无备份时执行自动备份', async () => {
      jest.spyOn(db, 'prepare').mockReturnValue({
        get: jest.fn().mockReturnValue({ cnt: 0 }),
      } as any);

      const performSpy = jest.spyOn(service, 'performAutoBackup').mockResolvedValue(undefined);

      await service.ensureDailyBackup();

      expect(performSpy).toHaveBeenCalled();
    });
  });

  describe('cleanupOldAutoBackups - 清理旧自动备份', () => {
    it('超过最大数量时应删除超出的备份', async () => {
      const now = new Date();
      const backups: Record<string, unknown>[] = [];
      for (let i = 0; i < 10; i++) {
        backups.push({
          id: `auto-b-${i}`,
          filename: `auto-backup-${i}.sqlite`,
          type: 'AUTO',
          clinicId: 'test-clinic-001',
          createdAt: new Date(now.getTime() - i * 3600000).toISOString(),
        });
      }
      db.seed('BackupRecord', backups);

      await service.cleanupOldAutoBackups();

      expect(manualBackup.removeById).toHaveBeenCalled();
    });

    it('未超过最大数量时不删除任何备份', async () => {
      db.seed('BackupRecord', [
        {
          id: 'auto-b-1',
          filename: 'auto-1.sqlite',
          type: 'AUTO',
          clinicId: 'test-clinic-001',
          createdAt: new Date().toISOString(),
        },
      ]);

      await service.cleanupOldAutoBackups();

      expect(manualBackup.removeById).not.toHaveBeenCalled();
    });
  });

  describe('performAutoVerify - 执行自动验证', () => {
    it('存在自动备份时应调用验证方法', async () => {
      const now = new Date();
      db.seed('BackupRecord', [
        {
          id: 'auto-b-1',
          filename: 'auto-1.sqlite',
          type: 'AUTO',
          clinicId: 'test-clinic-001',
          createdAt: new Date(now.getTime() - 3600000).toISOString(),
        },
        {
          id: 'auto-b-2',
          filename: 'auto-2.sqlite',
          type: 'AUTO',
          clinicId: 'test-clinic-001',
          createdAt: now.toISOString(),
        },
      ]);

      await service.performAutoVerify();

      expect(manualBackup.verifyBackup).toHaveBeenCalled();
    });

    it('没有自动备份时跳过验证', async () => {
      await service.performAutoVerify();

      expect(manualBackup.verifyBackup).not.toHaveBeenCalled();
    });

    it('验证失败时不应抛出异常（捕获并记录日志）', async () => {
      db.seed('BackupRecord', [
        {
          id: 'auto-b-1',
          filename: 'auto-1.sqlite',
          type: 'AUTO',
          clinicId: 'test-clinic-001',
          createdAt: new Date().toISOString(),
        },
      ]);
      manualBackup.verifyBackup.mockRejectedValue(new Error('verify failed'));

      await expect(service.performAutoVerify()).resolves.not.toThrow();
    });

    it('只验证最近的 3 个自动备份', async () => {
      const now = new Date();
      const backups: Record<string, unknown>[] = [];
      for (let i = 0; i < 5; i++) {
        backups.push({
          id: `auto-b-${i}`,
          filename: `auto-${i}.sqlite`,
          type: 'AUTO',
          clinicId: 'test-clinic-001',
          createdAt: new Date(now.getTime() - i * 3600000).toISOString(),
        });
      }
      db.seed('BackupRecord', backups);

      await service.performAutoVerify();

      expect(manualBackup.verifyBackup).toHaveBeenCalledTimes(3);
    });

    it('只验证 AUTO 类型的备份', async () => {
      const now = new Date();
      db.seed('BackupRecord', [
        {
          id: 'manual-b-1',
          filename: 'manual-1.sqlite',
          type: 'MANUAL',
          clinicId: 'test-clinic-001',
          createdAt: now.toISOString(),
        },
      ]);

      jest.spyOn(db, 'prepare').mockReturnValue({
        all: jest.fn().mockReturnValue([]),
        get: jest.fn().mockReturnValue(null),
      } as any);

      await service.performAutoVerify();

      expect(manualBackup.verifyBackup).not.toHaveBeenCalled();
    });

    it('验证结果为失败时不抛出异常', async () => {
      db.seed('BackupRecord', [
        {
          id: 'auto-b-1',
          filename: 'auto-1.sqlite',
          type: 'AUTO',
          clinicId: 'test-clinic-001',
          createdAt: new Date().toISOString(),
        },
      ]);
      manualBackup.verifyBackup.mockResolvedValue({
        success: false,
        results: [{ step: 'integrity_check', ok: false }],
        timestamp: new Date().toISOString(),
        filename: 'auto-1.sqlite',
      });

      await expect(service.performAutoVerify()).resolves.not.toThrow();
    });
  });

  describe('数据库优化', () => {
    it('自动备份成功后执行数据库优化', async () => {
      const execSpy = jest.spyOn(db, 'exec');

      await service.performAutoBackup();

      expect(execSpy).toHaveBeenCalled();
    });

    it('小数据库执行完整 VACUUM', async () => {
      mockedFs.statSync.mockReturnValue({ size: 10 * 1024 * 1024 } as any);
      const execSpy = jest.spyOn(db, 'exec');

      await service.performAutoBackup();

      expect(execSpy).toHaveBeenCalledWith('VACUUM');
      expect(execSpy).toHaveBeenCalledWith('ANALYZE');
    });

    it('数据库优化失败时不影响备份结果', async () => {
      const execSpy = jest.spyOn(db, 'exec').mockImplementation(() => {
        throw new Error('vacuum failed');
      });

      await expect(service.performAutoBackup()).resolves.not.toThrow();
      expect(alertService.recordSuccess).toHaveBeenCalled();

      execSpy.mockRestore();
    });

    it('执行 checkpoint 后再优化', async () => {
      const checkpointSpy = jest.spyOn(db, 'checkpoint');

      await service.performAutoBackup();

      expect(checkpointSpy).toHaveBeenCalledWith('TRUNCATE');
    });
  });

  describe('定时器管理', () => {
    it('重复启动自动备份不会创建多个定时器', () => {
      service.onModuleInit();
      const startSpy = jest.spyOn(service as any, 'startAutoBackup');

      service.onModuleInit();

      expect(startSpy).toHaveBeenCalled();
    });

    it('模块销毁时清理所有定时器', () => {
      service.onModuleInit();
      service.onModuleDestroy();

      expect((service as any).autoBackupTimer).toBeNull();
      expect((service as any).autoVerifyTimer).toBeNull();
    });

    it('停止未启动的定时器不会报错', () => {
      expect(() => {
        (service as any).stopAutoBackup();
        (service as any).stopAutoVerify();
      }).not.toThrow();
    });
  });

  describe('孤儿文件清理', () => {
    it('清理孤儿备份文件', async () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readdirSync.mockReturnValue([
        'orphan1.sqlite',
        'orphan2.sqlite',
        'recorded.sqlite',
      ] as any);
      mockedFs.statSync.mockReturnValue({ size: 1024, mtimeMs: Date.now() } as any);

      db.seed('BackupRecord', [
        {
          id: 'b-1',
          filename: 'recorded.sqlite',
          type: 'MANUAL',
          clinicId: 'test-clinic-001',
          createdAt: new Date().toISOString(),
        },
      ]);

      const cleanupOrphanedFiles = (service as any).cleanupOrphanedFiles;
      await cleanupOrphanedFiles.call(service);

      expect(mockedFs.unlinkSync).toHaveBeenCalled();
    });

    it('备份目录不存在时跳过清理', async () => {
      mockedFs.existsSync.mockReturnValue(false);

      const cleanupOrphanedFiles = (service as any).cleanupOrphanedFiles;
      await cleanupOrphanedFiles.call(service);

      expect(mockedFs.readdirSync).not.toHaveBeenCalled();
    });

    it('清理过期的手动备份', async () => {
      const oldDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      db.seed('BackupRecord', [
        {
          id: 'old-manual-1',
          filename: 'old-manual.sqlite',
          type: 'MANUAL',
          clinicId: 'test-clinic-001',
          createdAt: oldDate.toISOString(),
        },
      ]);

      const cleanupOrphanedFiles = (service as any).cleanupOrphanedFiles;
      await cleanupOrphanedFiles.call(service);

      expect(manualBackup.removeById).toHaveBeenCalled();
    });

    it('目录超限时清理最旧的备份', async () => {
      mockedFs.existsSync.mockReturnValue(true);
      const largeSize = 100 * 1024 * 1024 * 1024;
      mockedFs.readdirSync.mockReturnValue([
        'backup1.sqlite',
        'backup2.sqlite',
      ] as any);
      mockedFs.statSync.mockReturnValue({ size: largeSize, mtimeMs: Date.now() } as any);

      db.seed('BackupRecord', [
        {
          id: 'b-1',
          filename: 'backup1.sqlite',
          type: 'MANUAL',
          clinicId: 'test-clinic-001',
          createdAt: new Date(Date.now() - 86400000).toISOString(),
        },
        {
          id: 'b-2',
          filename: 'backup2.sqlite',
          type: 'MANUAL',
          clinicId: 'test-clinic-001',
          createdAt: new Date().toISOString(),
        },
      ]);

      const cleanupOrphanedFiles = (service as any).cleanupOrphanedFiles;
      await cleanupOrphanedFiles.call(service);

      expect(mockedFs.unlinkSync).toHaveBeenCalled();
    });
  });
});
