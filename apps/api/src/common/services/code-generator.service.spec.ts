import { CodeGenerator } from './code-generator.service';
import { MockDbService, asDbService } from '../../db/__mocks__/db-service.mock';

describe('CodeGenerator', () => {
  let db: MockDbService;
  let generator: CodeGenerator;

  beforeEach(() => {
    db = new MockDbService();
    generator = new CodeGenerator();
  });

  describe('generateCode', () => {
    it('无现有记录时应返回 PREFIX000001', () => {
      db.seed('Patient', []);
      const code = generator.generateCode(asDbService(db), 'Patient', 'P', { clause: '', params: [] });
      expect(code).toBe('P000001');
    });

    it('有现有记录时应递增序号', () => {
      db.seed('Patient', [
        { id: '1', code: 'P000001', clinicId: 'c1', createdAt: '2026-01-01' },
        { id: '2', code: 'P000002', clinicId: 'c1', createdAt: '2026-01-01' },
      ]);
      const code = generator.generateCode(asDbService(db), 'Patient', 'P', { clause: '', params: [] });
      expect(code).toBe('P000003');
    });

    it('不同前缀应独立计数', () => {
      db.seed('Patient', [
        { id: '1', code: 'P000005', clinicId: 'c1', createdAt: '2026-01-01' },
      ]);
      const code = generator.generateCode(asDbService(db), 'Patient', 'C', { clause: '', params: [] });
      expect(code).toBe('C000001');
    });

    it('多字符前缀应正确处理', () => {
      db.seed('Visit', [
        { id: '1', code: 'VT000003', clinicId: 'c1', createdAt: '2026-01-01' },
      ]);
      const code = generator.generateCode(asDbService(db), 'Visit', 'VT', { clause: '', params: [] });
      expect(code).toBe('VT000004');
    });

    it('应使用事务', () => {
      const transactionSpy = jest.spyOn(db, 'transaction');
      db.seed('Patient', []);
      generator.generateCode(asDbService(db), 'Patient', 'P', { clause: '', params: [] });
      expect(transactionSpy).toHaveBeenCalled();
    });

    it('编码应为 6 位补零', () => {
      db.seed('Patient', []);
      const code = generator.generateCode(asDbService(db), 'Patient', 'P', { clause: '', params: [] });
      expect(code).toMatch(/^P\d{6}$/);
    });
  });
});
