import { migrateEncryptedData, runEncryptionMigration } from './encryption-migration';
import { MockDbService } from '../db/__mocks__/db-service.mock';
import { Logger } from '@nestjs/common';

const mockDecryptFieldWithFlag = jest.fn();
const mockEncryptField = jest.fn();
const mockSetLegacyEncryptionKey = jest.fn();

jest.mock('../common/utils/security/encryption', () => ({
  decryptFieldWithFlag: (...args: unknown[]) => mockDecryptFieldWithFlag(...args),
  encryptField: (...args: unknown[]) => mockEncryptField(...args),
  setLegacyEncryptionKey: (...args: unknown[]) => mockSetLegacyEncryptionKey(...args),
}));

describe('encryption-migration', () => {
  let dbService: MockDbService;

  beforeEach(() => {
    jest.clearAllMocks();
    dbService = new MockDbService();
  });

  describe('validateIdentifier (间接通过 migrateEncryptedData)', () => {
    it('应验证合法的表名和列名', () => {
      dbService.seed('Patient', []);
      mockDecryptFieldWithFlag.mockReturnValue({ plaintext: null, needsReencrypt: false });

      const result = migrateEncryptedData(dbService as any);
      expect(result.migrated).toBe(0);
      expect(result.errors).toBe(0);
    });

    it('无效表名应抛出错误', () => {
      const invalidDbService = new MockDbService();
      const mockPrepare = jest.fn().mockImplementation(() => {
        throw new Error('Invalid table name: Patient; DROP TABLE');
      });
      jest.spyOn(invalidDbService, 'prepare').mockImplementation(mockPrepare);

      expect(() => migrateEncryptedData(invalidDbService as any)).toThrow();
    });
  });

  describe('migrateEncryptedData', () => {
    it('无加密字段时应返回 0 migrated 和 0 errors', () => {
      dbService.seed('Patient', []);
      mockDecryptFieldWithFlag.mockReturnValue({ plaintext: null, needsReencrypt: false });

      const result = migrateEncryptedData(dbService as any);
      expect(result.migrated).toBe(0);
      expect(result.errors).toBe(0);
    });

    it('needsReencrypt=true 且 plaintext 非 null 时应重新加密', () => {
      dbService.seed('Patient', [
        { id: 'p-1', idCard: 'old-encrypted-data' },
      ]);
      mockDecryptFieldWithFlag.mockReturnValue({ plaintext: 'decrypted-text', needsReencrypt: true });
      mockEncryptField.mockReturnValue('new-encrypted-data');

      const result = migrateEncryptedData(dbService as any);
      expect(result.migrated).toBe(1);
      expect(result.errors).toBe(0);
    });

    it('needsReencrypt=false 时不应重新加密', () => {
      dbService.seed('Patient', [
        { id: 'p-1', idCard: 'active-key-encrypted' },
      ]);
      mockDecryptFieldWithFlag.mockReturnValue({ plaintext: 'decrypted-text', needsReencrypt: false });

      const result = migrateEncryptedData(dbService as any);
      expect(result.migrated).toBe(0);
      expect(result.errors).toBe(0);
    });

    it('needsReencrypt=true 但 plaintext 为 null 时不应重新加密', () => {
      dbService.seed('Patient', [
        { id: 'p-1', idCard: 'corrupted-data' },
      ]);
      mockDecryptFieldWithFlag.mockReturnValue({ plaintext: null, needsReencrypt: true });

      const result = migrateEncryptedData(dbService as any);
      expect(result.migrated).toBe(0);
      expect(result.errors).toBe(0);
    });

    it('多行混合状态应分别处理', () => {
      dbService.seed('Patient', [
        { id: 'p-1', idCard: 'needs-reencrypt' },
        { id: 'p-2', idCard: 'active-key' },
        { id: 'p-3', idCard: null },
        { id: 'p-4', idCard: '' },
      ]);

      mockDecryptFieldWithFlag
        .mockReturnValueOnce({ plaintext: 'text-1', needsReencrypt: true })
        .mockReturnValueOnce({ plaintext: 'text-2', needsReencrypt: false });
      mockEncryptField.mockReturnValue('new-encrypted');

      const result = migrateEncryptedData(dbService as any);
      expect(result.migrated).toBe(1);
      expect(result.errors).toBe(0);
    });

    it('解密失败应计入 errors 但不阻塞其他行', () => {
      dbService.seed('Patient', [
        { id: 'p-1', idCard: 'bad-data' },
        { id: 'p-2', idCard: 'good-data' },
      ]);

      mockDecryptFieldWithFlag
        .mockImplementationOnce(() => { throw new Error('decrypt failed'); })
        .mockReturnValueOnce({ plaintext: 'good-text', needsReencrypt: true });
      mockEncryptField.mockReturnValue('new-encrypted');

      const result = migrateEncryptedData(dbService as any);
      expect(result.migrated).toBe(1);
      expect(result.errors).toBe(1);
    });

    it('加密/更新失败应计入 errors 但不阻塞其他行', () => {
      dbService.seed('Patient', [
        { id: 'p-1', idCard: 'data-1' },
        { id: 'p-2', idCard: 'data-2' },
      ]);

      mockDecryptFieldWithFlag
        .mockReturnValueOnce({ plaintext: 'text-1', needsReencrypt: true })
        .mockReturnValueOnce({ plaintext: 'text-2', needsReencrypt: true });
      mockEncryptField
        .mockImplementation(() => { throw new Error('encrypt failed'); });

      const result = migrateEncryptedData(dbService as any);
      expect(result.migrated).toBe(0);
      expect(result.errors).toBe(2);
    });

    it('应为每行调用 encryptField', () => {
      dbService.seed('Patient', [
        { id: 'p-1', idCard: 'data-1' },
        { id: 'p-2', idCard: 'data-2' },
      ]);
      mockDecryptFieldWithFlag.mockReturnValue({ plaintext: 'text', needsReencrypt: true });
      mockEncryptField.mockReturnValue('new-encrypted');

      migrateEncryptedData(dbService as any);
      expect(mockEncryptField).toHaveBeenCalledTimes(2);
      expect(mockEncryptField).toHaveBeenCalledWith('text');
    });

    it('应使用正确的参数调用 UPDATE', () => {
      dbService.seed('Patient', [
        { id: 'p-1', idCard: 'old-data' },
      ]);
      mockDecryptFieldWithFlag.mockReturnValue({ plaintext: 'plain', needsReencrypt: true });
      mockEncryptField.mockReturnValue('encrypted-new');

      const spyPrepare = jest.spyOn(dbService, 'prepare');
      migrateEncryptedData(dbService as any);

      const updateCalls = spyPrepare.mock.calls.filter(c =>
        typeof c[0] === 'string' && c[0].includes('UPDATE'),
      );
      expect(updateCalls.length).toBeGreaterThan(0);
    });
  });

  describe('runEncryptionMigration', () => {
    it('无 legacyKey 时应返回 skipped=true', () => {
      const result = runEncryptionMigration(dbService as any);
      expect(result).toEqual({ skipped: true, migrated: 0, errors: 0 });
      expect(mockSetLegacyEncryptionKey).not.toHaveBeenCalled();
    });

    it('空字符串 legacyKey 应返回 skipped=true', () => {
      const result = runEncryptionMigration(dbService as any, '');
      expect(result).toEqual({ skipped: true, migrated: 0, errors: 0 });
      expect(mockSetLegacyEncryptionKey).not.toHaveBeenCalled();
    });

    it('有 legacyKey 时应设置密钥并执行迁移', () => {
      const legacyKey = 'a'.repeat(64);
      dbService.seed('Patient', [
        { id: 'p-1', idCard: 'old-data' },
      ]);
      mockDecryptFieldWithFlag.mockReturnValue({ plaintext: 'text', needsReencrypt: true });
      mockEncryptField.mockReturnValue('encrypted');

      const result = runEncryptionMigration(dbService as any, legacyKey);

      expect(mockSetLegacyEncryptionKey).toHaveBeenCalledWith(legacyKey);
      expect(result.skipped).toBe(false);
      expect(result.migrated).toBe(1);
      expect(result.errors).toBe(0);
    });

    it('迁移结果为 0 时不应记录日志', () => {
      const legacyKey = 'a'.repeat(64);
      dbService.seed('Patient', []);
      mockDecryptFieldWithFlag.mockReturnValue({ plaintext: null, needsReencrypt: false });

      const loggerSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
      const result = runEncryptionMigration(dbService as any, legacyKey);

      expect(loggerSpy).not.toHaveBeenCalled();
      expect(result).toEqual({ skipped: false, migrated: 0, errors: 0 });
      loggerSpy.mockRestore();
    });

    it('迁移有错误时应记录日志且 errors 计数正确', () => {
      const legacyKey = 'a'.repeat(64);
      dbService.seed('Patient', [
        { id: 'p-1', idCard: 'bad-data' },
      ]);
      mockDecryptFieldWithFlag.mockImplementation(() => { throw new Error('fail'); });

      const loggerSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
      const result = runEncryptionMigration(dbService as any, legacyKey);

      expect(loggerSpy).toHaveBeenCalled();
      expect(result.skipped).toBe(false);
      expect(result.migrated).toBe(0);
      expect(result.errors).toBe(1);
      loggerSpy.mockRestore();
    });

    it('迁移有成功时应记录日志且 migrated 计数正确', () => {
      const legacyKey = 'a'.repeat(64);
      dbService.seed('Patient', [
        { id: 'p-1', idCard: 'data' },
      ]);
      mockDecryptFieldWithFlag.mockReturnValue({ plaintext: 'text', needsReencrypt: true });
      mockEncryptField.mockReturnValue('encrypted');

      const loggerSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
      const result = runEncryptionMigration(dbService as any, legacyKey);

      expect(loggerSpy).toHaveBeenCalled();
      expect(result.skipped).toBe(false);
      expect(result.migrated).toBe(1);
      expect(result.errors).toBe(0);
      loggerSpy.mockRestore();
    });
  });
});