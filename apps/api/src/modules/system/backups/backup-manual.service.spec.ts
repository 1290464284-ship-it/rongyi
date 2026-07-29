import { BackupManualService } from './backup-manual.service';
import { MockDbService } from '../../../db/__mocks__/db-service.mock';
import { ClinicContextService } from '../../../common/services/clinic-context.service';
import { AuditLogService } from '../../../common/services/audit-log.service';

const mockFs = {
  statSync: jest.fn().mockReturnValue({ size: 1024 }),
  existsSync: jest.fn().mockReturnValue(true),
  mkdirSync: jest.fn(),
  unlinkSync: jest.fn(),
  copyFileSync: jest.fn(),
  readFileSync: jest.fn().mockReturnValue(Buffer.from('test-data-content')),
  writeFileSync: jest.fn(),
  renameSync: jest.fn(),
  chmodSync: jest.fn(),
  rmdirSync: jest.fn(),
};

jest.mock('node:fs', () => {
  const actual = jest.requireActual('node:fs');
  return {
    ...actual,
    statSync: (...args: unknown[]) => mockFs.statSync(...args),
    existsSync: (...args: unknown[]) => mockFs.existsSync(...args),
    mkdirSync: (...args: unknown[]) => mockFs.mkdirSync(...args),
    unlinkSync: (...args: unknown[]) => mockFs.unlinkSync(...args),
    copyFileSync: (...args: unknown[]) => mockFs.copyFileSync(...args),
    readFileSync: (...args: unknown[]) => mockFs.readFileSync(...args),
    writeFileSync: (...args: unknown[]) => mockFs.writeFileSync(...args),
    renameSync: (...args: unknown[]) => mockFs.renameSync(...args),
    chmodSync: (...args: unknown[]) => mockFs.chmodSync(...args),
    rmdirSync: (...args: unknown[]) => mockFs.rmdirSync(...args),
  };
});

jest.mock('../../../common/utils/security/encryption', () => {
  const BACKUP_MAGIC = Buffer.from('DBAK');
  return {
    encryptBuffer: jest.fn().mockImplementation((buffer: Buffer) => buffer),
    decryptBufferIfEncrypted: jest.fn().mockImplementation((buffer: Buffer) => buffer),
    isEncryptedBuffer: jest.fn().mockImplementation((data: Buffer) =>
      data.length >= 5 && Buffer.from(data.subarray(0, 4)).equals(BACKUP_MAGIC),
    ),
    getBackupEncryptionKey: jest.fn().mockReturnValue(Buffer.alloc(32, 0xab)),
  };
});

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

function createExtendedMockDbService(): MockDbService & {
  checkpoint: jest.Mock;
  openReadonly: jest.Mock;
  rebuildConnection: jest.Mock;
  db: {
    name: string;
    backup: jest.Mock;
    pragma: jest.Mock;
    close: jest.Mock;
  };
} {
  const dbService = new MockDbService() as any;
  dbService.checkpoint = jest.fn();
  dbService.openReadonly = jest.fn().mockReturnValue({
    prepare: jest.fn().mockReturnValue({
      get: jest.fn().mockReturnValue({ integrity_check: 'ok' }),
      all: jest.fn().mockReturnValue([{ integrity_check: 'ok' }]),
    }),
    close: jest.fn(),
  });
  dbService.rebuildConnection = jest.fn();
  dbService.db = {
    name: ':memory:',
    backup: jest.fn().mockResolvedValue(undefined),
    pragma: jest.fn(),
    close: jest.fn(),
  };
  return dbService;
}

describe('BackupManualService', () => {
  let service: BackupManualService;
  let dbService: ReturnType<typeof createExtendedMockDbService>;
  let clinicContext: ClinicContextService;

  beforeEach(() => {
    jest.clearAllMocks();
    Object.values(mockFs).forEach(fn => {
      if (jest.isMockFunction(fn)) {
        fn.mockClear();
      }
    });
    mockFs.statSync.mockReturnValue({ size: 1024 });
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(Buffer.from('test-data-content'));

    dbService = createExtendedMockDbService();
    clinicContext = createMockClinicContext();
    // P2 修复：使用真实 AuditLogService 实例，确保 logAudit 实际写入 AuditLog 表
    const auditLogService = new AuditLogService();
    service = new BackupManualService(dbService as any, clinicContext, auditLogService);

    dbService.seed('BackupRecord', [
      { id: 'b-1', filename: 'dental-2026-01-01.sqlite', fileSize: 1024, type: 'MANUAL', remark: null, clinicId: 'test-clinic-001', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'b-2', filename: 'dental-2026-01-02.sqlite', fileSize: 2048, type: 'AUTO', remark: 'auto backup', clinicId: 'test-clinic-001', createdAt: '2026-01-02T00:00:00.000Z' },
    ]);
  });

  describe('findMany', () => {
    it('应返回所有备份记录', async () => {
      const result = await service.findMany();
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('list', () => {
    it('应返回最近 200 条备份记录', async () => {
      const result = await service.list();
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });

    it('应按 createdAt 降序排列', async () => {
      const result = await service.list() as Array<{ createdAt: string }>;
      if (result.length >= 2) {
        expect(new Date(result[0].createdAt).getTime()).toBeGreaterThanOrEqual(
          new Date(result[1].createdAt).getTime(),
        );
      }
    });
  });

  describe('create', () => {
    beforeEach(() => {
      mockFs.statSync.mockReturnValue({ size: 4096 });
      mockFs.readFileSync.mockReturnValue(Buffer.from('unencrypted-backup-content'));
      dbService.openReadonly.mockReturnValue({
        prepare: jest.fn().mockReturnValue({
          get: jest.fn().mockReturnValue({ integrity_check: 'ok' }),
        }),
        close: jest.fn(),
      });
    });

    it('应成功创建备份并返回结果', async () => {
      const result = await service.create('MANUAL', 'test remark', {});
      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.filename).toContain('dental-');
      expect(result.fileSize).toBeDefined();
    });

    it('应将备份记录插入数据库', async () => {
      await service.create('MANUAL', 'test remark', {});
      const records = dbService.getTableData('BackupRecord');
      expect(records.length).toBeGreaterThanOrEqual(3);
    });

    it('应使用默认类型当 type 为 undefined 时', async () => {
      const result = await service.create(undefined, undefined, {});
      expect(result).toBeDefined();
      const records = dbService.getTableData('BackupRecord');
      const lastRecord = records[records.length - 1];
      expect(lastRecord.type).toBe('MANUAL');
    });

    it('WAL checkpoint 失败时应继续执行', async () => {
      dbService.checkpoint.mockImplementation(() => {
        throw new Error('checkpoint failed');
      });
      const result = await service.create('MANUAL', 'remark', {});
      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
    });

    it('SQLite backup API 失败时应回退到文件复制', async () => {
      dbService.db.backup.mockRejectedValueOnce(new Error('backup API failed'));
      const result = await service.create('MANUAL', 'remark', {});
      expect(result).toBeDefined();
      expect(mockFs.copyFileSync).toHaveBeenCalled();
    });

    it('备份文件不存在时应抛出异常', async () => {
      mockFs.statSync.mockImplementation(() => {
        throw new Error('ENOENT: file not found');
      });
      await expect(service.create('MANUAL', 'remark', {})).rejects.toThrow(
        '备份文件创建失败',
      );
    });

    it('完整性检查失败时应删除损坏文件并抛出异常', async () => {
      dbService.openReadonly.mockReturnValue({
        prepare: jest.fn().mockReturnValue({
          get: jest.fn().mockReturnValue({ integrity_check: 'not ok' }),
        }),
        close: jest.fn(),
      });
      await expect(service.create('MANUAL', 'remark', {})).rejects.toThrow(
        '备份完整性检查失败',
      );
      expect(mockFs.unlinkSync).toHaveBeenCalled();
    });

    it('加密失败时应删除文件并抛出异常', async () => {
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error('read error');
      });
      await expect(service.create('MANUAL', 'remark', {})).rejects.toThrow(
        '备份文件加密失败',
      );
    });
  });

  describe('restore', () => {
    beforeEach(() => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(Buffer.from('non-encrypted-data'));
      dbService.openReadonly.mockReturnValue({
        prepare: jest.fn().mockReturnValue({
          get: jest.fn().mockReturnValue({ integrity_check: 'ok' }),
        }),
        close: jest.fn(),
      });
    });

    it('应拒绝包含路径遍历字符的文件名', async () => {
      await expect(service.restore('../etc/passwd', {})).rejects.toThrow('非法的文件名');
    });

    it('应拒绝包含反斜杠的文件名', async () => {
      await expect(service.restore('path\\file', {})).rejects.toThrow('非法的文件名');
    });

    it('应拒绝包含正斜杠的文件名', async () => {
      await expect(service.restore('path/file', {})).rejects.toThrow('非法的文件名');
    });

    it('不存在的备份记录应抛出异常', async () => {
      await expect(service.restore('non-existent.sqlite', {})).rejects.toThrow(
        '备份文件不存在',
      );
    });

    it('备份文件在磁盘上不存在时应抛出异常', async () => {
      mockFs.existsSync.mockReturnValue(false);
      await expect(service.restore('dental-2026-01-01.sqlite', {})).rejects.toThrow(
        '备份文件不存在',
      );
    });

    it('应成功恢复备份', async () => {
      const result = await service.restore('dental-2026-01-01.sqlite', {});
      expect(result).toEqual({ success: true });
    });

    it('恢复时应关闭数据库并重建连接', async () => {
      await service.restore('dental-2026-01-01.sqlite', {});
      expect(dbService.db.close).toHaveBeenCalled();
      expect(dbService.rebuildConnection).toHaveBeenCalled();
    });

    it('恢复成功后应写入审计日志', async () => {
      await service.restore('dental-2026-01-01.sqlite', {});
      const logs = dbService.getTableData('AuditLog');
      const restoreLog = logs.find((l: any) => l.type === 'BACKUP_RESTORE');
      expect(restoreLog).toBeDefined();
    });

    it('加密文件解密失败应抛出异常', async () => {
      const encryptedBuffer = Buffer.from([
        0x44, 0x42, 0x41, 0x4b, 0x01, 0x00, 0x00, 0x00,
      ]);
      mockFs.readFileSync.mockReturnValue(encryptedBuffer);
      const enc = require('../../../common/utils/security/encryption');
      (enc.decryptBufferIfEncrypted as jest.Mock).mockReturnValueOnce(null);
      await expect(service.restore('dental-2026-01-01.sqlite', {})).rejects.toThrow();
    });

    it('完整性检查失败时应抛出异常', async () => {
      dbService.openReadonly.mockReturnValue({
        prepare: jest.fn().mockReturnValue({
          get: jest.fn().mockReturnValue({ integrity_check: 'corrupted' }),
        }),
        close: jest.fn(),
      });
      await expect(service.restore('dental-2026-01-01.sqlite', {})).rejects.toThrow(
        '备份文件完整性检查失败',
      );
    });

    it('替换数据库文件失败时应回滚', async () => {
      let renameCount = 0;
      mockFs.renameSync.mockImplementation(() => {
        renameCount++;
        if (renameCount === 2) {
          throw new Error('replace failed');
        }
      });
      await expect(service.restore('dental-2026-01-01.sqlite', {})).rejects.toThrow(
        '备份恢复失败',
      );
    });

    it('临时文件清理失败不应影响恢复结果', async () => {
      mockFs.unlinkSync.mockImplementationOnce(() => {});
      mockFs.unlinkSync.mockImplementationOnce(() => {});
      mockFs.unlinkSync.mockImplementationOnce(() => {
        throw new Error('cleanup failed');
      });
      const result = await service.restore('dental-2026-01-01.sqlite', {});
      expect(result).toEqual({ success: true });
    });

    it('chmod 失败不应影响恢复', async () => {
      mockFs.chmodSync.mockImplementation(() => {
        throw new Error('chmod failed');
      });
      const result = await service.restore('dental-2026-01-01.sqlite', {});
      expect(result).toEqual({ success: true });
    });
  });

  describe('delete', () => {
    it('应拒绝包含路径遍历字符的文件名', async () => {
      await expect(service.delete('../etc/passwd')).rejects.toThrow('非法的文件名');
    });

    it('应拒绝包含反斜杠的文件名', async () => {
      await expect(service.delete('path\\file')).rejects.toThrow('非法的文件名');
    });

    it('应拒绝包含正斜杠的文件名', async () => {
      await expect(service.delete('path/file')).rejects.toThrow('非法的文件名');
    });

    it('不存在的记录应抛出异常', async () => {
      await expect(service.delete('non-existent.sqlite')).rejects.toThrow(
        '备份记录不存在',
      );
    });

    it('应成功删除备份记录和文件', async () => {
      mockFs.existsSync.mockReturnValue(true);
      const result = await service.delete('dental-2026-01-01.sqlite');
      expect(result).toEqual({ filename: 'dental-2026-01-01.sqlite' });
      expect(mockFs.unlinkSync).toHaveBeenCalled();
    });

    it('备份文件不存在时仍应删除记录', async () => {
      mockFs.existsSync.mockReturnValue(false);
      const result = await service.delete('dental-2026-01-01.sqlite');
      expect(result).toEqual({ filename: 'dental-2026-01-01.sqlite' });
    });
  });

  describe('removeById', () => {
    it('不存在的 id 应抛出异常', async () => {
      await expect(service.removeById('non-existent')).rejects.toThrow(
        '备份记录不存在',
      );
    });

    it('存在的 id 应调用 delete', async () => {
      mockFs.existsSync.mockReturnValue(true);
      const result = await service.removeById('b-1');
      expect(result).toBeDefined();
    });
  });

  describe('restoreById', () => {
    it('不存在的 id 应抛出异常', async () => {
      await expect(service.restoreById('non-existent', {})).rejects.toThrow(
        '备份记录不存在',
      );
    });

    it('存在的 id 应调用 restore', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(Buffer.from('non-encrypted-data'));
      dbService.openReadonly.mockReturnValue({
        prepare: jest.fn().mockReturnValue({
          get: jest.fn().mockReturnValue({ integrity_check: 'ok' }),
        }),
        close: jest.fn(),
      });
      const result = await service.restoreById('b-1', {});
      expect(result).toEqual({ success: true });
    });
  });

  describe('drill', () => {
    it('应成功执行 drill 流程', async () => {
      mockFs.readFileSync.mockReturnValue(Buffer.from('data'));
      const result = await service.drill();
      expect(result).toBeDefined();
      expect(result.success).toBeDefined();
      expect(result.results).toBeDefined();
      expect(Array.isArray(result.results)).toBe(true);
      expect(result.timestamp).toBeDefined();
    });

    it('应包含 create_backup 步骤', async () => {
      const result = await service.drill();
      const createStep = result.results.find((r: any) => r.step === 'create_backup');
      expect(createStep).toBeDefined();
      expect(createStep!.ok).toBe(true);
    });

    it('应包含 integrity_check 步骤', async () => {
      const result = await service.drill();
      const integrityStep = result.results.find((r: any) => r.step === 'integrity_check');
      expect(integrityStep).toBeDefined();
      expect(integrityStep!.ok).toBe(true);
    });

    it('应包含核心表验证步骤', async () => {
      const result = await service.drill();
      const coreTables = ['User', 'Patient', 'Charge', 'Appointment', 'Visit'];
      for (const table of coreTables) {
        const step = result.results.find((r: any) => r.step === `verify_${table}`);
        expect(step).toBeDefined();
      }
    });

    it('应包含 cleanup 步骤', async () => {
      const result = await service.drill();
      const cleanupStep = result.results.find((r: any) => r.step === 'cleanup');
      expect(cleanupStep).toBeDefined();
    });

    it('完整性检查失败时应标记为不成功', async () => {
      dbService.openReadonly.mockReturnValue({
        prepare: jest.fn().mockReturnValue({
          all: jest.fn().mockReturnValue([
            { integrity_check: 'ok' },
            { integrity_check: 'corrupted' },
          ]),
        }),
        close: jest.fn(),
      });
      const result = await service.drill();
      expect(result.success).toBe(false);
    });

    it('表验证失败应标记该步骤为不成功', async () => {
      dbService.openReadonly.mockReturnValue({
        prepare: jest.fn().mockImplementation((sql: string) => {
          if (sql.includes('integrity_check')) {
            return { all: jest.fn().mockReturnValue([{ integrity_check: 'ok' }]) };
          }
          if (sql.includes('FROM User')) {
            throw new Error('table not found');
          }
          return { get: jest.fn().mockReturnValue({}) };
        }),
        close: jest.fn(),
      });
      const result = await service.drill();
      const userStep = result.results.find((r: any) => r.step === 'verify_User');
      expect(userStep?.ok).toBe(false);
    });

    it('WAL checkpoint 失败不应中断 drill', async () => {
      dbService.checkpoint.mockImplementation(() => {
        throw new Error('checkpoint failed');
      });
      const result = await service.drill();
      expect(result.success).toBeDefined();
    });

    it('清理失败应记录但不抛出', async () => {
      mockFs.unlinkSync.mockImplementation(() => {
        throw new Error('unlink failed');
      });
      mockFs.rmdirSync.mockImplementation(() => {
        throw new Error('rmdir failed');
      });
      const result = await service.drill();
      const cleanupStep = result.results.find((r: any) => r.step === 'cleanup');
      expect(cleanupStep?.ok).toBe(false);
    });

    it('创建临时目录失败应返回错误结果', async () => {
      mockFs.mkdirSync.mockImplementation(() => {
        throw new Error('mkdir failed');
      });
      const result = await service.drill();
      expect(result.success).toBe(false);
      const errorStep = result.results.find((r: any) => r.step === 'error');
      expect(errorStep).toBeDefined();
    });
  });

  describe('verifyBackup', () => {
    beforeEach(() => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(Buffer.from('non-encrypted-content'));
      dbService.openReadonly.mockReturnValue({
        prepare: jest.fn().mockImplementation((sql: string) => {
          if (sql.includes('integrity_check')) {
            return { get: jest.fn().mockReturnValue({ integrity_check: 'ok' }) };
          }
          return { get: jest.fn().mockReturnValue({}) };
        }),
        close: jest.fn(),
      });
    });

    it('不存在的 id 应抛出异常', async () => {
      await expect(service.verifyBackup('non-existent')).rejects.toThrow(
        '备份记录不存在',
      );
    });

    it('应成功验证备份', async () => {
      const result = await service.verifyBackup('b-1');
      expect(result.success).toBe(true);
      expect(result.filename).toBe('dental-2026-01-01.sqlite');
      expect(result.results.length).toBeGreaterThan(0);
    });

    it('应包含解密步骤（非加密文件跳过）', async () => {
      const result = await service.verifyBackup('b-1');
      const decryptStep = result.results.find((r: any) => r.step === 'decrypt');
      expect(decryptStep).toBeUndefined();
    });

    it('应包含 file_exists 步骤', async () => {
      const result = await service.verifyBackup('b-1');
      const fileExistsStep = result.results.find((r: any) => r.step === 'file_exists');
      expect(fileExistsStep).toBeDefined();
      expect(fileExistsStep!.ok).toBe(true);
    });

    it('应包含 integrity_check 步骤', async () => {
      const result = await service.verifyBackup('b-1');
      const integrityStep = result.results.find((r: any) => r.step === 'integrity_check');
      expect(integrityStep).toBeDefined();
      expect(integrityStep!.ok).toBe(true);
    });

    it('应包含核心表读取步骤', async () => {
      const result = await service.verifyBackup('b-1');
      const coreTables = ['User', 'Patient', 'Charge', 'Appointment', 'Visit'];
      for (const table of coreTables) {
        const step = result.results.find((r: any) => r.step === `read_${table}`);
        expect(step).toBeDefined();
      }
    });

    it('备份文件不存在应抛出异常', async () => {
      mockFs.existsSync.mockReturnValue(false);
      await expect(service.verifyBackup('b-1')).rejects.toThrow('备份文件不存在');
    });

    it('完整性检查失败应返回不成功', async () => {
      dbService.openReadonly.mockReturnValue({
        prepare: jest.fn().mockImplementation((sql: string) => {
          if (sql.includes('integrity_check')) {
            return { get: jest.fn().mockReturnValue({ integrity_check: 'corrupted' }) };
          }
          return { get: jest.fn().mockReturnValue({}) };
        }),
        close: jest.fn(),
      });
      const result = await service.verifyBackup('b-1');
      expect(result.success).toBe(false);
    });

    it('表读取失败应标记该步骤为不成功', async () => {
      dbService.openReadonly.mockReturnValue({
        prepare: jest.fn().mockImplementation((sql: string) => {
          if (sql.includes('integrity_check')) {
            return { get: jest.fn().mockReturnValue({ integrity_check: 'ok' }) };
          }
          if (sql.includes('FROM User')) {
            throw new Error('no such table');
          }
          return { get: jest.fn().mockReturnValue({}) };
        }),
        close: jest.fn(),
      });
      const result = await service.verifyBackup('b-1');
      const userStep = result.results.find((r: any) => r.step === 'read_User');
      expect(userStep?.ok).toBe(false);
    });

    it('文件不存在应抛出异常', async () => {
      mockFs.existsSync.mockReturnValue(false);
      await expect(service.verifyBackup('b-1')).rejects.toThrow('备份文件不存在');
    });

    it('数据库完整性检查失败应返回 unsuccessful', async () => {
      dbService.openReadonly.mockReturnValue({
        prepare: jest.fn().mockImplementation((sql: string) => {
          if (sql.includes('integrity_check')) {
            return { get: jest.fn().mockReturnValue({ integrity_check: 'not ok' }) };
          }
          return { get: jest.fn().mockReturnValue({}) };
        }),
        close: jest.fn(),
      });
      const result = await service.verifyBackup('b-1');
      expect(result.success).toBe(false);
    });
  });

  describe('create - 更多边界条件', () => {
    beforeEach(() => {
      mockFs.statSync.mockReturnValue({ size: 4096 });
      mockFs.mkdirSync.mockImplementation(() => {});
      mockFs.readFileSync.mockReturnValue(Buffer.from('unencrypted-backup-content'));
      mockFs.unlinkSync.mockImplementation(() => {});
      dbService.openReadonly.mockReturnValue({
        prepare: jest.fn().mockReturnValue({
          get: jest.fn().mockReturnValue({ integrity_check: 'ok' }),
        }),
        close: jest.fn(),
      });
    });

    it('备份文件加密失败且清理也失败时应抛出异常', async () => {
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error('encryption error');
      });
      mockFs.unlinkSync.mockImplementation(() => {
        throw new Error('unlink error');
      });

      await expect(service.create('MANUAL', 'remark', {})).rejects.toThrow(
        '备份文件加密失败',
      );
    });

    it('WAL checkpoint 失败且 backup API 也失败时应回退到文件复制', async () => {
      dbService.checkpoint.mockImplementation(() => {
        throw new Error('checkpoint failed');
      });
      dbService.db.backup.mockRejectedValueOnce(new Error('backup API failed'));

      const result = await service.create('MANUAL', 'remark', {});
      expect(result).toBeDefined();
      expect(mockFs.copyFileSync).toHaveBeenCalled();
    });
  });

  describe('restore - 路径安全检查', () => {
    it('应拒绝包含 .. 的文件名', async () => {
      await expect(service.restore('dental-..sqlite', {})).rejects.toThrow('非法的文件名');
    });

    it('应拒绝包含 / 的文件名', async () => {
      await expect(service.restore('/etc/passwd', {})).rejects.toThrow('非法的文件名');
    });

    it('应拒绝包含 \\ 的文件名', async () => {
      await expect(service.restore('C:\\Windows\\system32\\test', {})).rejects.toThrow('非法的文件名');
    });
  });

  describe('drill - 更多边界条件', () => {
    beforeEach(() => {
      mockFs.mkdirSync.mockImplementation(() => {});
      mockFs.copyFileSync.mockImplementation(() => {});
      mockFs.unlinkSync.mockImplementation(() => {});
      mockFs.rmdirSync.mockImplementation(() => {});
    });

    it('核心表验证失败应标记 allReadable 为 false', async () => {
      dbService.openReadonly.mockReturnValue({
        prepare: jest.fn().mockImplementation((sql: string) => {
          if (sql.includes('integrity_check')) {
            return { all: jest.fn().mockReturnValue([{ integrity_check: 'ok' }]) };
          }
          throw new Error('table error');
        }),
        close: jest.fn(),
      });

      const result = await service.drill();
      expect(result.success).toBe(false);
      expect(result.results.some((r: any) => !r.ok && r.step.startsWith('verify_'))).toBe(true);
    });

    it('copyFileSync 失败应返回错误结果', async () => {
      mockFs.copyFileSync.mockImplementation(() => {
        throw new Error('copy failed');
      });

      const result = await service.drill();
      expect(result.success).toBe(false);
      const errorStep = result.results.find((r: any) => r.step === 'error');
      expect(errorStep).toBeDefined();
    });
  });
});
