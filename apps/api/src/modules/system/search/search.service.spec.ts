import { SearchService } from './search.service';
import { MockDbService } from '../../../db/__mocks__/db-service.mock';
import { CacheService } from '../../../common/services/cache.service';
import { ClinicContextService } from '../../../common/services/clinic-context.service';

function createMockClinicContext(clinicId: string | null = 'test-clinic-001'): ClinicContextService {
  return {
    getClinicId: () => clinicId,
    getUserId: () => 'test-user-001',
    getRole: () => 'BOSS',
    run: <T>(_ctx: unknown, fn: () => T) => fn(),
    isInitialized: () => true,
  } as unknown as ClinicContextService;
}

function createMockCacheService(): CacheService {
  return {
    get: jest.fn().mockReturnValue(undefined),
    set: jest.fn(),
    del: jest.fn(),
    delPattern: jest.fn(),
    clear: jest.fn(),
    getOrSet: jest.fn().mockImplementation(async (_key: string, factory: () => any) => factory()),
    getStats: () => ({ hits: 0, misses: 0, hitRate: 0, size: 0, maxSize: 1000 }),
    has: () => false,
  } as unknown as CacheService;
}

/**
 * 判断 SQL 是否为"前缀搜索"（不包含 phone 字段的 LIKE 条件）。
 * Patient 前缀搜索 SQL 形如: WHERE (name LIKE ? OR code LIKE ?)
 * Patient full 搜索 SQL 形如: WHERE (name LIKE ? OR phone LIKE ? OR code LIKE ?)
 */
function isPatientPrefixSql(sql: string): boolean {
  return /FROM\s+Patient/i.test(sql) && !/phone\s+LIKE/i.test(sql);
}

function isPatientFullSql(sql: string): boolean {
  return /FROM\s+Patient/i.test(sql) && /phone\s+LIKE/i.test(sql);
}

function isApptPrefixSql(sql: string): boolean {
  return /FROM\s+Appointment|JOIN\s+Patient\s+p/i.test(sql) && !/p\.phone\s+LIKE/i.test(sql);
}

function isApptFullSql(sql: string): boolean {
  return /FROM\s+Appointment|JOIN\s+Patient\s+p/i.test(sql) && /p\.phone\s+LIKE/i.test(sql);
}

describe('SearchService', () => {
  let service: SearchService;
  let db: MockDbService;
  let cache: CacheService;
  let context: ClinicContextService;

  beforeEach(() => {
    db = new MockDbService();
    (db as any).tables.set('Patient', new Map());
    (db as any).tables.set('Appointment', new Map());
    cache = createMockCacheService();
    context = createMockClinicContext();
    service = new SearchService(db as any, cache, context);
  });

  afterEach(() => {
    db.clear();
    jest.restoreAllMocks();
  });

  describe('search - 整体流程', () => {
    it('无 clinicId 上下文时抛出 CLINIC_CONTEXT_MISSING', async () => {
      const noCtxService = new SearchService(db as any, cache, createMockClinicContext(null));
      await expect(noCtxService.search('张')).rejects.toThrow(/CLINIC_CONTEXT_MISSING|诊所上下文缺失/);
    });

    it('正常搜索：返回 patients/appointments/total', async () => {
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        if (isPatientPrefixSql(sql)) {
          return {
            run: () => ({ changes: 0, lastInsertRowid: '' }),
            get: () => {},
            all: () => [
              { id: 'p1', name: '张三', code: 'P001', phone: '13800138000', gender: 'M', birthDate: '1990-01-01' },
            ],
          };
        }
        if (isPatientFullSql(sql)) {
          // 单关键字只返回 1 条 < 5，会触发 full 搜索
          return {
            run: () => ({ changes: 0, lastInsertRowid: '' }),
            get: () => {},
            all: () => [
              { id: 'p1', name: '张三', code: 'P001', phone: '13800138000', gender: 'M', birthDate: '1990-01-01' },
            ],
          };
        }
        if (isApptPrefixSql(sql)) {
          return {
            run: () => ({ changes: 0, lastInsertRowid: '' }),
            get: () => {},
            all: () => [
              { id: 'a1', patientId: 'p1', doctorId: 'd1', startTime: '2026-01-01 10:00', endTime: '2026-01-01 11:00', status: 'BOOKED', type: 'CONSULT', patientName: '张三' },
            ],
          };
        }
        if (isApptFullSql(sql)) {
          return {
            run: () => ({ changes: 0, lastInsertRowid: '' }),
            get: () => {},
            all: () => [
              { id: 'a1', patientId: 'p1', doctorId: 'd1', startTime: '2026-01-01 10:00', endTime: '2026-01-01 11:00', status: 'BOOKED', type: 'CONSULT', patientName: '张三' },
            ],
          };
        }
        return { run: () => ({ changes: 0, lastInsertRowid: '' }), get: () => {}, all: () => [] };
      });

      const result = await service.search('张');
      expect(result.patients.length).toBe(1);
      expect(result.appointments.length).toBe(1);
      expect(result.total).toBe(2);
      prepareSpy.mockRestore();
    });

    it('前缀搜索结果 >= 5 时使用前缀搜索（不调用 full 搜索）', async () => {
      const calls: string[] = [];
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        calls.push(sql);
        if (isPatientPrefixSql(sql)) {
          return {
            run: () => ({ changes: 0, lastInsertRowid: '' }),
            get: () => {},
            all: () => [
              { id: 'p1', name: '张一' }, { id: 'p2', name: '张二' }, { id: 'p3', name: '张三' },
              { id: 'p4', name: '张四' }, { id: 'p5', name: '张五' }, { id: 'p6', name: '张六' },
            ],
          };
        }
        if (isApptPrefixSql(sql)) {
          return {
            run: () => ({ changes: 0, lastInsertRowid: '' }),
            get: () => {},
            all: () => [
              { id: 'a1' }, { id: 'a2' }, { id: 'a3' }, { id: 'a4' }, { id: 'a5' }, { id: 'a6' },
            ],
          };
        }
        return { run: () => ({ changes: 0, lastInsertRowid: '' }), get: () => {}, all: () => [] };
      });

      const result = await service.search('张');
      expect(result.patients.length).toBe(6);
      // 前缀搜索已返回 >= 5 条，不会再调用 full 搜索
      const patientFullCalls = calls.filter(isPatientFullSql);
      expect(patientFullCalls.length).toBe(0);
      prepareSpy.mockRestore();
    });

    it('前缀搜索结果 < 5 时回退到 full 搜索', async () => {
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        if (isPatientPrefixSql(sql)) {
          return {
            run: () => ({ changes: 0, lastInsertRowid: '' }),
            get: () => {},
            all: () => [
              { id: 'p1', name: '张一' }, { id: 'p2', name: '张二' },
            ],
          };
        }
        if (isPatientFullSql(sql)) {
          return {
            run: () => ({ changes: 0, lastInsertRowid: '' }),
            get: () => {},
            all: () => [
              { id: 'p1', name: '张一' }, { id: 'p2', name: '张二' }, { id: 'p3', name: '李三' },
            ],
          };
        }
        if (isApptPrefixSql(sql) || isApptFullSql(sql)) {
          return { run: () => ({ changes: 0, lastInsertRowid: '' }), get: () => {}, all: () => [] };
        }
        return { run: () => ({ changes: 0, lastInsertRowid: '' }), get: () => {}, all: () => [] };
      });

      const result = await service.search('张');
      // full 搜索结果覆盖前缀结果
      expect(result.patients.length).toBe(3);
      prepareSpy.mockRestore();
    });

    it('结果超过 MAX_RESULTS=100 时被截断', async () => {
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        if (isPatientPrefixSql(sql)) {
          // 返回 110 条
          const rows = Array.from({ length: 110 }, (_, i) => ({ id: `p${i}`, name: `患者${i}` }));
          return {
            run: () => ({ changes: 0, lastInsertRowid: '' }),
            get: () => {},
            all: () => rows,
          };
        }
        if (isApptPrefixSql(sql) || isApptFullSql(sql)) {
          return { run: () => ({ changes: 0, lastInsertRowid: '' }), get: () => {}, all: () => [] };
        }
        return { run: () => ({ changes: 0, lastInsertRowid: '' }), get: () => {}, all: () => [] };
      });

      const result = await service.search('患');
      expect(result.patients.length).toBe(100);
      prepareSpy.mockRestore();
    });

    it('appointments 前缀搜索 < 5 时回退到 full 搜索（带 phone 条件）', async () => {
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        if (isPatientPrefixSql(sql) || isPatientFullSql(sql)) {
          return { run: () => ({ changes: 0, lastInsertRowid: '' }), get: () => {}, all: () => [] };
        }
        if (isApptPrefixSql(sql)) {
          return {
            run: () => ({ changes: 0, lastInsertRowid: '' }),
            get: () => {},
            all: () => [{ id: 'a1', patientName: '张三' }],
          };
        }
        if (isApptFullSql(sql)) {
          return {
            run: () => ({ changes: 0, lastInsertRowid: '' }),
            get: () => {},
            all: () => [
              { id: 'a1', patientName: '张三' }, { id: 'a2', patientName: '李四' },
              { id: 'a3', patientName: '王五' }, { id: 'a4', patientName: '赵六' },
              { id: 'a5', patientName: '孙七' }, { id: 'a6', patientName: '周八' },
            ],
          };
        }
        return { run: () => ({ changes: 0, lastInsertRowid: '' }), get: () => {}, all: () => [] };
      });

      const result = await service.search('张');
      expect(result.appointments.length).toBe(6);
      prepareSpy.mockRestore();
    });

    it('appointments 前缀搜索 >= 5 时不调用 full 搜索', async () => {
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        if (isPatientPrefixSql(sql) || isPatientFullSql(sql)) {
          return { run: () => ({ changes: 0, lastInsertRowid: '' }), get: () => {}, all: () => [] };
        }
        if (isApptPrefixSql(sql)) {
          return {
            run: () => ({ changes: 0, lastInsertRowid: '' }),
            get: () => {},
            all: () => [
              { id: 'a1' }, { id: 'a2' }, { id: 'a3' }, { id: 'a4' }, { id: 'a5' }, { id: 'a6' },
            ],
          };
        }
        if (isApptFullSql(sql)) {
          return { run: () => ({ changes: 0, lastInsertRowid: '' }), get: () => {}, all: () => [] };
        }
        return { run: () => ({ changes: 0, lastInsertRowid: '' }), get: () => {}, all: () => [] };
      });

      const result = await service.search('张');
      expect(result.appointments.length).toBe(6);
      prepareSpy.mockRestore();
    });
  });

  describe('search - 参数处理', () => {
    it('多关键字空格分隔时只取第一个词作为前缀', async () => {
      let firstPrefix: string | undefined;
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        if (isPatientPrefixSql(sql)) {
          return {
            run: () => ({ changes: 0, lastInsertRowid: '' }),
            get: () => {},
            all: (...args: unknown[]) => {
              firstPrefix = args[0] as string;
              return [];
            },
          };
        }
        return { run: () => ({ changes: 0, lastInsertRowid: '' }), get: () => {}, all: () => [] };
      });

      await service.search('张三 李四');
      expect(firstPrefix).toBe('张三%');
      prepareSpy.mockRestore();
    });

    it('关键字含特殊字符被转义（LIKE 注入防护）', async () => {
      let firstPrefix: string | undefined;
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        if (isPatientPrefixSql(sql)) {
          return {
            run: () => ({ changes: 0, lastInsertRowid: '' }),
            get: () => {},
            all: (...args: unknown[]) => {
              firstPrefix = args[0] as string;
              return [];
            },
          };
        }
        return { run: () => ({ changes: 0, lastInsertRowid: '' }), get: () => {}, all: () => [] };
      });

      await service.search('张%');
      // prefixLike = escapeLike('张%') + '%' = '张\%' + '%' = '张\%%'
      // % 字符被转义不会变成 LIKE 通配符，但额外追加的 % 是用于前缀匹配
      expect(firstPrefix).toBe('张\\%%');
      prepareSpy.mockRestore();
    });

    it('关键字首尾空白被 trim', async () => {
      let firstPrefix: string | undefined;
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        if (isPatientPrefixSql(sql)) {
          return {
            run: () => ({ changes: 0, lastInsertRowid: '' }),
            get: () => {},
            all: (...args: unknown[]) => {
              firstPrefix = args[0] as string;
              return [];
            },
          };
        }
        return { run: () => ({ changes: 0, lastInsertRowid: '' }), get: () => {}, all: () => [] };
      });

      await service.search('  张三  ');
      expect(firstPrefix).toBe('张三%');
      prepareSpy.mockRestore();
    });

    it('空字符串关键字', async () => {
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((_sql: string) => {
        return { run: () => ({ changes: 0, lastInsertRowid: '' }), get: () => {}, all: () => [] };
      });

      const result = await service.search('');
      expect(result.patients).toEqual([]);
      expect(result.appointments).toEqual([]);
      expect(result.total).toBe(0);
      prepareSpy.mockRestore();
    });
  });
});
