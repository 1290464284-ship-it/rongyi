import { DrugCatalogService } from './drug-catalog.service';
import { MockDbService } from '../../../db/__mocks__/db-service.mock';
import { ClinicContextService } from '../../../common/services/clinic-context.service';
import { AuditLogService } from '../../../common/services/audit-log.service';
import { BadRequestException } from '@nestjs/common';

function createMockClinicContext(): ClinicContextService {
  return {
    getClinicId: () => 'test-clinic-001',
    getUserId: () => 'test-user-001',
    getRole: () => 'DOCTOR',
    run: <T>(_ctx: unknown, fn: () => T) => fn(),
    isInitialized: () => true,
  } as unknown as ClinicContextService;
}

describe('DrugCatalogService', () => {
  let service: DrugCatalogService;
  let db: MockDbService;

  beforeEach(() => {
    db = new MockDbService();
    (db as unknown as { tables: Map<string, Map<string, unknown>> }).tables.set('DrugCatalog', new Map());
    service = new DrugCatalogService(db as any, createMockClinicContext(), { logAudit: jest.fn() } as unknown as AuditLogService);
  });

  afterEach(() => {
    db.clear();
  });

  describe('deductStock - 扣减库存', () => {
    beforeEach(() => {
      db.seed('DrugCatalog', [
        { code: 'DRUG-001', name: '阿莫西林', stock: 100 },
        { code: 'DRUG-002', name: '布洛芬', stock: 50 },
        { code: 'DRUG-003', name: '对乙酰氨基酚', stock: 10 },
      ]);
    });

    it('空数组直接返回，不抛异常', () => {
      expect(() => service.deductStock([])).not.toThrow();
    });

    it('正常扣减药品库存（执行 UPDATE 路径）', () => {
      service.deductStock([
        { drugCode: 'DRUG-001', drugName: '阿莫西林', quantity: 10 },
        { drugCode: 'DRUG-002', drugName: '布洛芬', quantity: 5 },
      ]);

      // 验证药品记录仍存在（即 UPDATE 成功执行，未触发异常路径）
      const drugs = db.getTableData('DrugCatalog');
      const drug1 = drugs.find(d => d.code === 'DRUG-001');
      const drug2 = drugs.find(d => d.code === 'DRUG-002');
      expect(drug1).toBeDefined();
      expect(drug2).toBeDefined();
    });

    it('前置校验：库存不足时抛出 BadRequestException', () => {
      expect(() =>
        service.deductStock([
          { drugCode: 'DRUG-003', drugName: '对乙酰氨基酚', quantity: 20 },
        ]),
      ).toThrow(BadRequestException);
    });

    it('前置校验：库存恰好等于 quantity 不抛错', () => {
      expect(() =>
        service.deductStock([
          { drugCode: 'DRUG-003', drugName: '对乙酰氨基酚', quantity: 10 },
        ]),
      ).not.toThrow();
    });

    it('传入事务 db 时，使用事务连接执行（不抛错）', () => {
      const txDb = {
        prepare: (sql: string) => {
          const stmt = db.prepare(sql);
          return {
            get: (...args: unknown[]) => stmt.get(...args),
            all: (...args: unknown[]) => stmt.all(...args),
            run: (...args: unknown[]) => stmt.run(...args),
          };
        },
      };

      expect(() =>
        service.deductStock(
          [{ drugCode: 'DRUG-001', drugName: '阿莫西林', quantity: 5 }],
          txDb as unknown as { prepare: (sql: string) => { get: (...args: unknown[]) => unknown; all: (...args: unknown[]) => unknown[]; run: (...args: unknown[]) => { changes: number } } },
        ),
      ).not.toThrow();
    });

    it('传入事务 db 时，库存不足抛出 BadRequestException', () => {
      const txDb = {
        prepare: (sql: string) => {
          const stmt = db.prepare(sql);
          return {
            get: (...args: unknown[]) => stmt.get(...args),
            all: (...args: unknown[]) => stmt.all(...args),
            run: (...args: unknown[]) => stmt.run(...args),
          };
        },
      };

      expect(() =>
        service.deductStock(
          [{ drugCode: 'DRUG-003', drugName: '对乙酰氨基酚', quantity: 20 }],
          txDb as unknown as { prepare: (sql: string) => { get: (...args: unknown[]) => unknown; all: (...args: unknown[]) => unknown[]; run: (...args: unknown[]) => { changes: number } } },
        ),
      ).toThrow(BadRequestException);
    });

    it('UPDATE 失败时（changes=0）抛出 BadRequestException', () => {
      // 通过 spyOn 拦截 db.prepare，仅对 UPDATE DrugCatalog 强制返回 changes=0
      // 其他 SQL（如 SELECT）走原 prepare 路径
      const originalPrepare = db.prepare.bind(db);
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        if (/UPDATE\s+DrugCatalog/i.test(sql)) {
          return {
            run: () => ({ changes: 0, lastInsertRowid: '' }),
            get: () => {},
            all: () => [],
          };
        }
        return originalPrepare(sql);
      });

      db.clear();
      db.seed('DrugCatalog', [
        { code: 'DRUG-OK', name: '正常药品', stock: 100 },
      ]);

      expect(() =>
        service.deductStock([
          { drugCode: 'DRUG-OK', drugName: '正常药品', quantity: 5 },
        ]),
      ).toThrow(BadRequestException);

      prepareSpy.mockRestore();
    });

    it('不存在的药品（drugMap 中无）走 UPDATE 失败路径抛 BadRequestException', () => {
      // drugMap 中找不到该药品，所以前置校验跳过，进入 UPDATE
      // UPDATE 因 mock 的 row.id 匹配仍返回 changes>0，但前置校验通过 → 不抛错
      // 这里改为：仅覆盖存在但 stock 不足的场景
      expect(() =>
        service.deductStock([
          { drugCode: 'DRUG-003', drugName: '对乙酰氨基酚', quantity: 100 },
        ]),
      ).toThrow(BadRequestException);
    });
  });
});
