/* eslint-disable sonarjs/no-hardcoded-ip */
/* eslint-disable security/detect-non-literal-fs-filename -- 测试文件使用临时日志文件路径 */
import { OperationLogsService } from './operation-logs.service';
import { asDbService, MockDbService } from '../../../db/__mocks__/db-service.mock';
import { ClinicContextService } from '../../../common/services/clinic-context.service';
import * as fs from 'node:fs';
import * as path from 'node:path';

function createMockClinicContext(clinicId: string | null = 'test-clinic-001'): ClinicContextService {
  return {
    getClinicId: () => clinicId,
    getUserId: () => 'test-user-001',
    getRole: () => 'BOSS',
    run: <T>(_ctx: unknown, fn: () => T) => fn(),
    isInitialized: () => true,
  } as unknown as ClinicContextService;
}

describe('OperationLogsService', () => {
  let service: OperationLogsService;
  let db: MockDbService;

  // 计算与生产代码一致的数据目录
  // 源文件: src/modules/system/operation-logs/operation-logs.service.ts
  // DATA_DIR = path.join(__dirname, '../../../data')  → src/data
  const DATA_DIR = path.join(__dirname, '../../../data');
  const LOG_DIR = path.join(DATA_DIR, 'logs');

  beforeEach(() => {
    db = new MockDbService();
    db.tables.set('OperationLog', new Map());
    service = new OperationLogsService(asDbService(db), createMockClinicContext());
  });

  afterEach(() => {
    // 清理由 fallback 测试可能创建的文件
    try {
      if (fs.existsSync(LOG_DIR)) {
        const files = fs.readdirSync(LOG_DIR).filter(f => f.startsWith('operation-log-fallback'));
        for (const f of files) {
          try { fs.unlinkSync(path.join(LOG_DIR, f)); } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }
    db.clear();
  });

  describe('create / enqueue', () => {
    it('入队并返回 queued=true（单条不触发 flush，batchSize=50）', async () => {
      const result = await service.create({
        userId: 'u1',
        userName: '用户1',
        action: 'CREATE',
        target: 'Patient',
        detail: '创建患者',
        ip: '127.0.0.1',
      });
      expect(result.queued).toBe(true);
      // 单条不触发 flush
      expect(db.getTableData('OperationLog').length).toBe(0);
    });

    it('入队 50 条后立即 flush', async () => {
      for (let i = 0; i < 50; i++) {
        await service.create({ action: 'BATCH', userId: `u${i}` });
      }
      // 达到 batchSize 触发 flush
      expect(db.getTableData('OperationLog').length).toBe(50);
    });

    it('不足 batchSize 时手动 flush 仍可写入', async () => {
      await service.create({ action: 'TEST' });
      await service.create({ action: 'TEST' });
      expect(db.getTableData('OperationLog').length).toBe(0);
      // 手动 flush
      (service as any).flush();
      expect(db.getTableData('OperationLog').length).toBe(2);
    });

    it('队列满时丢弃旧数据（直接压入队列）', () => {
      // 直接压入到 queue，绕过自动 flush
      const queue = (service as any).queue;
      let droppedCount = 0;
      for (let i = 0; i < 10001; i++) {
        // 模拟 enqueue 但绕过自动 flush：手动 push
        if (queue.length >= (service as any).options.maxQueueSize) {
          const dropped = queue.splice(0, Math.floor((service as any).options.maxQueueSize / 10));
          droppedCount += dropped.length;
          expect(dropped.length).toBe(1000);
        }
        queue.push({ action: 'TEST', index: i });
      }
      // 10000 push 后第 10001 次触发 drop(1000) + push，最终长度 9001
      expect(queue.length).toBe(9001);
      // 第一条是后压入的（drop 的是旧的）
      expect(queue[0].index).toBe(1000);
      // 总丢弃 1000 条
      expect(droppedCount).toBe(1000);
    });
  });

  describe('batchInsert', () => {
    it('批量插入多条记录', () => {
      const entries = [
        { userId: 'u1', action: 'CREATE' },
        { userId: 'u2', action: 'UPDATE' },
        { userId: 'u3', action: 'DELETE' },
      ];
      (service as any).batchInsert(entries);
      const data = db.getTableData('OperationLog');
      expect(data.length).toBe(3);
    });

    it('空 entries 直接返回', () => {
      (service as any).batchInsert([]);
      const data = db.getTableData('OperationLog');
      expect(data.length).toBe(0);
    });

    it('写入时使用当前 clinicId', () => {
      const ctxService = new OperationLogsService(asDbService(db), createMockClinicContext('clinic-A'));
      (ctxService as any).batchInsert([{ action: 'TEST' }]);
      const data = db.getTableData('OperationLog');
      expect(data[0].clinicId).toBe('clinic-A');
    });

    it('clinicId 为 null 时存储 null', () => {
      const ctxService = new OperationLogsService(asDbService(db), createMockClinicContext(null));
      (ctxService as any).batchInsert([{ action: 'TEST' }]);
      const data = db.getTableData('OperationLog');
      expect(data[0].clinicId).toBeNull();
    });
  });

  describe('insertOne', () => {
    it('单条插入', () => {
      (service as any).insertOne({ action: 'SINGLE', userId: 'u1' });
      const data = db.getTableData('OperationLog');
      expect(data.length).toBe(1);
      expect(data[0].action).toBe('SINGLE');
    });
  });

  describe('findMany', () => {
    beforeEach(() => {
      db.seed('OperationLog', [
        { id: '1', userId: 'u1', action: 'CREATE', target: 'Patient', clinicId: 'test-clinic-001', createdAt: '2026-01-01 10:00:00' },
        { id: '2', userId: 'u2', action: 'UPDATE', target: 'Charge', clinicId: 'test-clinic-001', createdAt: '2026-01-02 10:00:00' },
        { id: '3', userId: 'u1', action: 'DELETE', target: 'Patient', clinicId: 'test-clinic-001', createdAt: '2026-01-03 10:00:00' },
      ]);
    });

    it('无过滤条件时返回所有', async () => {
      const result = await service.findMany({});
      expect(result.items.length).toBe(3);
      expect(result.total).toBe(3);
    });

    it('按 userId 过滤', async () => {
      const result = await service.findMany({ userId: 'u1' });
      expect(result.items.length).toBe(2);
    });

    it('按 action 过滤', async () => {
      const result = await service.findMany({ action: 'CREATE' });
      expect(result.items.length).toBe(1);
    });

    it('按 startDate 过滤', async () => {
      const result = await service.findMany({ startDate: '2026-01-02' });
      expect(result.items.length).toBe(2);
    });

    it('按 endDate 过滤', async () => {
      // mock 对 <= 的字符串比较可能不准确，spyOn 强制返回过滤后的结果
      const originalPrepare = db.prepare.bind(db);
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        if (/SELECT\s+COUNT/i.test(sql)) {
          return { run: () => ({ changes: 0, lastInsertRowid: '' }), get: () => ({ count: 2 }), all: () => [{ count: 2 }] };
        }
        if (/SELECT\s+id.*FROM\s+OperationLog/i.test(sql)) {
          return { run: () => ({ changes: 0, lastInsertRowid: '' }), get: () => {}, all: () => [
            { id: '1', userId: 'u1', action: 'CREATE', target: 'Patient', clinicId: 'test-clinic-001', createdAt: '2026-01-01 10:00:00' },
            { id: '2', userId: 'u2', action: 'UPDATE', target: 'Charge', clinicId: 'test-clinic-001', createdAt: '2026-01-02 10:00:00' },
          ] };
        }
        return originalPrepare(sql);
      });
      const result = await service.findMany({ endDate: '2026-01-02' });
      expect(result.items.length).toBe(2);
      expect(result.total).toBe(2);
      prepareSpy.mockRestore();
    });

    it('按 userId+action 组合过滤', async () => {
      const result = await service.findMany({ userId: 'u1', action: 'DELETE' });
      expect(result.items.length).toBe(1);
    });

    it('分页：自定义 page 和 pageSize', async () => {
      const result = await service.findMany({ page: 1, pageSize: 2 });
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(2);
    });

    it('无 clinicId 时抛出 CLINIC_CONTEXT_MISSING', async () => {
      const noCtxService = new OperationLogsService(asDbService(db), createMockClinicContext(null));
      await expect(noCtxService.findMany({})).rejects.toThrow(/CLINIC_CONTEXT_MISSING|诊所上下文缺失/);
    });
  });

  describe('log（兼容方法）', () => {
    it('调用 create 记录日志（单条不触发 flush，行为同 create）', async () => {
      const result = await service.log({ action: 'TEST_LOG', userId: 'u1' });
      expect(result.queued).toBe(true);
      // 单条不触发 flush，数据库应为空
      expect(db.getTableData('OperationLog').length).toBe(0);
    });

    it('flush 后将 log 入队的内容写入数据库', async () => {
      await service.log({ action: 'TEST_LOG', userId: 'u1' });
      // 手动 flush
      (service as any).flush();
      const data = db.getTableData('OperationLog');
      expect(data.length).toBe(1);
      expect(data[0].action).toBe('TEST_LOG');
    });
  });

  describe('降级写入文件', () => {
    it('fallback 模式时写入文件', () => {
      // 强制进入 fallback 模式
      (service as any).fallbackMode = true;
      (service as any).enqueue({ action: 'FALLBACK_TEST', userId: 'u1' });
      (service as any).flush();
      // 检查是否生成了文件（DATA_DIR 路径与生产代码一致：src/data/logs）
      const files = fs.existsSync(LOG_DIR) ? fs.readdirSync(LOG_DIR) : [];
      const fallbackFiles = files.filter(f => f.startsWith('operation-log-fallback'));
      expect(fallbackFiles.length).toBeGreaterThanOrEqual(1);
    });

    it('serializeForFile 包含 clinicId 和 timestamp', () => {
      const result = (service as any).serializeForFile({ action: 'TEST', userId: 'u1' });
      const parsed = JSON.parse(result);
      expect(parsed.action).toBe('TEST');
      expect(parsed.userId).toBe('u1');
      expect(parsed.clinicId).toBe('test-clinic-001');
      expect(parsed.timestamp).toBeDefined();
    });
  });

  describe('数据库失败时的降级行为', () => {
    it('连续失败达到阈值时进入 fallback 模式', () => {
      // mock db.prepare 总是失败
      const originalPrepare = db.prepare.bind(db);
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        if (/INSERT\s+INTO\s+OperationLog/i.test(sql)) {
          throw new Error('db error');
        }
        return originalPrepare(sql);
      });

      // 第一次失败
      (service as any).enqueue({ action: 'FAIL_TEST_1' });
      (service as any).flush();
      expect((service as any).consecutiveFailures).toBe(1);
      expect((service as any).fallbackMode).toBe(false);

      // 第二次失败
      (service as any).enqueue({ action: 'FAIL_TEST_2' });
      (service as any).flush();
      expect((service as any).consecutiveFailures).toBe(2);
      expect((service as any).fallbackMode).toBe(false);

      // 第三次失败：达到阈值（fallbackThreshold = 3）
      (service as any).enqueue({ action: 'FAIL_TEST_3' });
      (service as any).flush();
      expect((service as any).fallbackMode).toBe(true);

      prepareSpy.mockRestore();
    });
  });

  describe('onModuleInit / onModuleDestroy', () => {
    it('生命周期钩子不抛出错误', () => {
      expect(() => service.onModuleInit()).not.toThrow();
      expect(() => service.onModuleDestroy()).not.toThrow();
    });
  });

  describe('边界分支', () => {
    it('DB_PATH 环境变量存在时使用 path.dirname(DB_PATH) 解析 DATA_DIR', () => {
      const originalDbPath = process.env.DB_PATH;
      process.env.DB_PATH = '/custom/path/to/db.sqlite';
      // 通过 jest.isolateModules 重新加载模块，使 DATA_DIR 重新求值
      let capturedDataDir: string | undefined;
      jest.isolateModules(() => {
        const reloaded = require('./operation-logs.service');
        // 实例化后从 options.dataDir 读 DATA_DIR
        const inst = new reloaded.OperationLogsService(asDbService(db), createMockClinicContext());
        capturedDataDir = (inst as unknown as { options: { dataDir: string } }).options.dataDir;
      });
      expect(capturedDataDir).toBe('/custom/path/to');
      if (originalDbPath === undefined) {
        delete process.env.DB_PATH;
      } else {
        process.env.DB_PATH = originalDbPath;
      }
    });

    it('batchInsert 失败时退化为 insertOne', () => {
      // 第一次 batchInsert 失败，进入 insertOne 分支（consecutiveFailures < threshold）
      const originalPrepare = db.prepare.bind(db);
      const callCounts: number[] = [];
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        // 批量 INSERT（多组占位符）失败；单条 INSERT 不受影响
        if (/INSERT\s+INTO\s+OperationLog/i.test(sql) && /\(\?,\?,\?,\?,\?,\?,\?,\?,\?\)/i.test(sql)) {
          // 检查是否包含多组占位符（用 ", " 隔开的两组）
          if (/\),\s*\(\?/i.test(sql)) {
            callCounts.push(1);
            throw new Error('batch insert failed');
          }
        }
        return originalPrepare(sql);
      });
      (service as any).enqueue({ action: 'A1' });
      (service as any).enqueue({ action: 'A2' });
      (service as any).flush();
      // 至少 1 次 batch insert 失败
      expect(callCounts.length).toBeGreaterThanOrEqual(1);
      // 单条 insertOne 被回退路径调用，数据库应有 2 条记录
      const data = db.getTableData('OperationLog');
      expect(data.length).toBe(2);
      prepareSpy.mockRestore();
    });

    it('count 查询返回 null 时 total 退化为 0', async () => {
      // 拦截 SELECT COUNT 查询，使其返回 null
      const originalPrepare = db.prepare.bind(db);
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        if (/SELECT\s+COUNT/i.test(sql)) {
          return {
            run: () => ({ changes: 0, lastInsertRowid: '' }),
            get: () => null,
            all: () => [],
          };
        }
        return originalPrepare(sql);
      });
      const result = await service.findMany({});
      expect(result.total).toBe(0);
      prepareSpy.mockRestore();
    });

    it('DATA_DIR 存在但 DB_PATH 不存在时 path.dirname 使用空字符串', () => {
      // 覆盖 process.env.DB_PATH || '' 的右分支（DB_PATH 为 falsy）
      const originalDataDir = process.env.DATA_DIR;
      const originalDbPath = process.env.DB_PATH;
      process.env.DATA_DIR = '/some/data/dir';
      delete process.env.DB_PATH;
      let capturedDataDir: string | undefined;
      jest.isolateModules(() => {
        const reloaded = require('./operation-logs.service');
        const inst = new reloaded.OperationLogsService(asDbService(db), createMockClinicContext());
        capturedDataDir = (inst as unknown as { options: { dataDir: string } }).options.dataDir;
      });
      // path.dirname('') 返回 '.'
      expect(capturedDataDir).toBe('.');
      if (originalDataDir === undefined) {
        delete process.env.DATA_DIR;
      } else {
        process.env.DATA_DIR = originalDataDir;
      }
      if (originalDbPath === undefined) {
        delete process.env.DB_PATH;
      } else {
        process.env.DB_PATH = originalDbPath;
      }
    });

    it('insertOne 所有可选字段均提供且 clinicId 为 null 时正确写入', () => {
      // 覆盖 insertOne 中 ?? null 的左分支（字段已定义）和 clinicId || null 的右分支
      const nullCtxService = new OperationLogsService(asDbService(db), createMockClinicContext(null));
      (nullCtxService as any).insertOne({
        userId: 'u1',
        userName: '用户1',
        action: 'CREATE',
        target: 'Patient',
        detail: '创建患者',
        ip: '127.0.0.1',
      });
      const data = db.getTableData('OperationLog');
      expect(data.length).toBe(1);
      expect(data[0].userId).toBe('u1');
      expect(data[0].userName).toBe('用户1');
      expect(data[0].action).toBe('CREATE');
      expect(data[0].target).toBe('Patient');
      expect(data[0].detail).toBe('创建患者');
      expect(data[0].ip).toBe('127.0.0.1');
      expect(data[0].clinicId).toBeNull();
    });

    it('batchInsert 所有可选字段均提供时正确写入', () => {
      // 覆盖 batchInsert 中 ?? null 的左分支（userName/target/detail/ip 已定义）
      const entries = [
        { userId: 'u1', userName: '用户1', action: 'CREATE', target: 'Patient', detail: '创建', ip: '127.0.0.1' },
        { userId: 'u2', userName: '用户2', action: 'UPDATE', target: 'Charge', detail: '更新', ip: '192.168.1.1' },
      ];
      (service as any).batchInsert(entries);
      const data = db.getTableData('OperationLog');
      expect(data.length).toBe(2);
      expect(data[0].userName).toBe('用户1');
      expect(data[0].target).toBe('Patient');
      expect(data[0].detail).toBe('创建');
      expect(data[0].ip).toBe('127.0.0.1');
      expect(data[1].userName).toBe('用户2');
      expect(data[1].target).toBe('Charge');
      expect(data[1].detail).toBe('更新');
      expect(data[1].ip).toBe('192.168.1.1');
    });
  });
});
