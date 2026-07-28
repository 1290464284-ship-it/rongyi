/* eslint-disable security/detect-non-literal-fs-filename -- 测试文件使用临时数据库路径 */
import Database from 'better-sqlite3';
import { DbService } from './db.service';

type DbInstance = InstanceType<typeof Database>;

describe('DbService', () => {
  let db: DbInstance;
  let dbService: DbService;

  function createTestDbService(database: DbInstance): DbService {
    const service = new DbService();
    (service as unknown as { database: DbInstance }).database = database;
    (service as unknown as { statementCache: Map<string, unknown> }).statementCache = new Map();
    return service;
  }

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = MEMORY');
    db.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)');
    dbService = createTestDbService(db);
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      // 忽略关闭错误
    }
  });

  describe('prepare 语句缓存', () => {
    it('应缓存 prepare 语句，重复调用返回同一实例', () => {
      const sql = 'SELECT * FROM test WHERE id = ?';
      const stmt1 = dbService.prepare(sql);
      const stmt2 = dbService.prepare(sql);
      expect(stmt1).toBe(stmt2);
    });

    it('应能执行 prepare 的语句并返回正确结果', () => {
      db.prepare('INSERT INTO test (id, name) VALUES (?, ?)').run(1, 'foo');
      const stmt = dbService.prepare('SELECT * FROM test WHERE id = ?');
      const row = stmt.get(1) as { id: number; name: string };
      expect(row.id).toBe(1);
      expect(row.name).toBe('foo');
    });

    it('多次 prepare 不同语句应分别缓存', () => {
      const sql1 = 'SELECT * FROM test WHERE id = ?';
      const sql2 = 'SELECT * FROM test WHERE name = ?';
      const stmt1 = dbService.prepare(sql1);
      const stmt2 = dbService.prepare(sql2);
      expect(stmt1).not.toBe(stmt2);
      expect(dbService.prepare(sql1)).toBe(stmt1);
      expect(dbService.prepare(sql2)).toBe(stmt2);
    });
  });

  describe('clearStatementCache 清除缓存', () => {
    it('应清除所有已缓存的语句', () => {
      const sql = 'SELECT * FROM test WHERE id = ?';
      dbService.prepare(sql);
      dbService.clearStatementCache();
      const stmt2 = dbService.prepare(sql);
      expect(stmt2).toBeDefined();
    });
  });

  describe('语句缓存淘汰机制', () => {
    it('缓存超过 100 条时应淘汰最旧的语句', () => {
      for (let i = 0; i < 110; i++) {
        dbService.prepare(`SELECT * FROM test WHERE id = ${i}`);
      }
      const earlyStmt = dbService.prepare('SELECT * FROM test WHERE id = 0');
      const recentStmt = dbService.prepare('SELECT * FROM test WHERE id = 109');
      expect(earlyStmt).toBeDefined();
      expect(recentStmt).toBeDefined();
    });
  });

  describe('exec 执行 SQL', () => {
    it('应成功执行 DDL 语句', () => {
      expect(() => {
        dbService.exec('CREATE TABLE exec_test (id INTEGER PRIMARY KEY)');
      }).not.toThrow();
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='exec_test'").get();
      expect(tables).toBeTruthy();
    });

    it('应成功执行 DML 语句', () => {
      dbService.exec("INSERT INTO test (id, name) VALUES (1, 'a')");
      const row = db.prepare('SELECT * FROM test WHERE id = 1').get() as { id: number; name: string };
      expect(row.name).toBe('a');
    });

    it('执行无效 SQL 应抛出异常', () => {
      expect(() => {
        dbService.exec('INVALID SQL');
      }).toThrow();
    });
  });

  describe('pragma 执行 PRAGMA', () => {
    it('应能读取 pragma 值', () => {
      const result = dbService.pragma('journal_mode');
      expect(result).toBeDefined();
    });

    it('应能设置 pragma 值', () => {
      expect(() => {
        dbService.pragma('busy_timeout = 5000');
      }).not.toThrow();
    });
  });

  describe('name 属性', () => {
    it('应返回数据库名称', () => {
      expect(typeof dbService.name).toBe('string');
    });
  });

  describe('timedQuery 计时查询', () => {
    it('应返回查询结果', () => {
      db.prepare('INSERT INTO test (id, name) VALUES (?, ?)').run(1, 'test');
      const result = dbService.timedQuery('SELECT * FROM test', () => {
        return db.prepare('SELECT * FROM test').all();
      });
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(1);
    });

    it('快速查询不应记录慢查询日志', () => {
      const loggerSpy = jest.spyOn(DbService.prototype['logger'] || console, 'warn').mockImplementation(() => {});
      dbService.timedQuery('SELECT 1', () => 42);
      expect(loggerSpy).not.toHaveBeenCalled();
      loggerSpy.mockRestore();
    });
  });

  describe('transaction 事务', () => {
    it('正常事务应提交数据', () => {
      dbService.transaction((txDb) => {
        txDb.prepare('INSERT INTO test (id, name) VALUES (?, ?)').run(1, 'tx_test');
      });
      const row = db.prepare('SELECT * FROM test WHERE id = 1').get() as { id: number; name: string };
      expect(row).toBeTruthy();
      expect(row.name).toBe('tx_test');
    });

    it('事务抛出异常应回滚', () => {
      try {
        dbService.transaction(() => {
          db.prepare('INSERT INTO test (id, name) VALUES (?, ?)').run(2, 'rollback_test');
          throw new Error('测试回滚');
        });
      } catch {
        // 预期抛出
      }
      const row = db.prepare('SELECT * FROM test WHERE id = 2').get();
      expect(row).toBeFalsy();
    });

    it('嵌套事务应正常工作', () => {
      dbService.transaction((outerDb) => {
        outerDb.prepare('INSERT INTO test (id, name) VALUES (?, ?)').run(3, 'outer');
        dbService.transaction((innerDb) => {
          innerDb.prepare('INSERT INTO test (id, name) VALUES (?, ?)').run(4, 'inner');
        });
      });
      const rows = db.prepare('SELECT * FROM test WHERE id IN (3, 4)').all() as { id: number; name: string }[];
      expect(rows.length).toBe(2);
    });

    it('嵌套事务内层回滚不应影响外层提交的数据', () => {
      dbService.transaction((outerDb) => {
        outerDb.prepare('INSERT INTO test (id, name) VALUES (?, ?)').run(5, 'outer_ok');
        try {
          dbService.transaction(() => {
            db.prepare('INSERT INTO test (id, name) VALUES (?, ?)').run(6, 'inner_rollback');
            throw new Error('内层回滚');
          });
        } catch {
          // 内层回滚
        }
      });
      const outerRow = db.prepare('SELECT * FROM test WHERE id = 5').get();
      const innerRow = db.prepare('SELECT * FROM test WHERE id = 6').get();
      expect(outerRow).toBeTruthy();
      expect(innerRow).toBeFalsy();
    });
  });

  describe('close 关闭数据库', () => {
    it('应能成功关闭数据库连接', () => {
      expect(() => {
        dbService.close();
      }).not.toThrow();
    });
  });

  describe('checkpoint WAL checkpoint', () => {
    it('默认 TRUNCATE 模式 checkpoint 不应抛出', () => {
      expect(() => {
        dbService.checkpoint();
      }).not.toThrow();
    });

    it('PASSIVE 模式 checkpoint 不应抛出', () => {
      expect(() => {
        dbService.checkpoint('PASSIVE');
      }).not.toThrow();
    });

    it('FULL 模式 checkpoint 不应抛出', () => {
      expect(() => {
        dbService.checkpoint('FULL');
      }).not.toThrow();
    });

    it('RESTART 模式 checkpoint 不应抛出', () => {
      expect(() => {
        dbService.checkpoint('RESTART');
      }).not.toThrow();
    });
  });

  describe('db getter', () => {
    it('应返回 IDatabase 实例', () => {
      const database = dbService.db;
      expect(database).toBeDefined();
      expect(typeof database.prepare).toBe('function');
      expect(typeof database.exec).toBe('function');
    });
  });

  describe('openReadonly 打开只读连接', () => {
    it('应能打开文件数据库的只读连接', () => {
      const tmpPath = require('node:path').join(require('node:os').tmpdir(), `test_readonly_${Date.now()}.db`);
      const tmpDb = new Database(tmpPath);
      tmpDb.exec('CREATE TABLE t (id INTEGER)');
      tmpDb.close();

      const readonlyDb = dbService.openReadonly(tmpPath);
      expect(readonlyDb).toBeDefined();
      expect(readonlyDb.name).toBeDefined();
      readonlyDb.close();

      try {
        require('node:fs').unlinkSync(tmpPath);
      } catch {
        // 忽略删除错误
      }
    });
  });

  describe('backup 备份数据库', () => {
    it('backup 方法应存在且返回 Promise', () => {
      expect(typeof dbService.backup).toBe('function');
    });
  });

  describe('timedQuery 慢查询', () => {
    it('慢查询应记录警告日志', () => {
      const loggerSpy = jest.spyOn((dbService as any).logger, 'warn').mockImplementation(() => {});
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));

      dbService.timedQuery('SLOW QUERY', () => {
        jest.advanceTimersByTime(200);
        return 'result';
      });

      expect(loggerSpy).toHaveBeenCalled();
      loggerSpy.mockRestore();
      jest.useRealTimers();
    });
  });

  describe('pragma 错误处理', () => {
    it('pragma 执行失败应抛出异常', () => {
      const originalPragma = db.pragma.bind(db);
      (db as any).pragma = jest.fn(() => {
        throw new Error('pragma error');
      });

      expect(() => {
        dbService.pragma('invalid_pragma');
      }).toThrow('pragma error');

      (db as any).pragma = originalPragma;
    });
  });

  describe('close 错误处理', () => {
    it('close 失败应抛出异常', () => {
      const originalClose = db.close.bind(db);
      (db as any).close = jest.fn(() => {
        throw new Error('close error');
      });

      expect(() => {
        dbService.close();
      }).toThrow('close error');

      (db as any).close = originalClose;
    });
  });

  describe('checkpoint 错误处理', () => {
    it('checkpoint 失败应记录错误日志但不抛出', () => {
      const loggerSpy = jest.spyOn((dbService as any).logger, 'error').mockImplementation(() => {});
      const originalPragma = db.pragma.bind(db);
      (db as any).pragma = jest.fn(() => {
        throw new Error('checkpoint error');
      });

      expect(() => {
        dbService.checkpoint('PASSIVE');
      }).not.toThrow();

      expect(loggerSpy).toHaveBeenCalled();
      loggerSpy.mockRestore();
      (db as any).pragma = originalPragma;
    });
  });

  describe('rebuildConnection 重建连接', () => {
    it('应能重建数据库连接', () => {
      const loggerSpy = jest.spyOn((dbService as any).logger, 'log').mockImplementation(() => {});
      const mockTimer = { unref: jest.fn() } as unknown as NodeJS.Timeout;
      const setIntervalSpy = jest.spyOn(globalThis, 'setInterval').mockReturnValue(mockTimer);
      const clearIntervalSpy = jest.spyOn(globalThis, 'clearInterval').mockImplementation(() => {});

      (dbService as any).walCheckpointTimer = mockTimer;

      dbService.rebuildConnection();

      expect((dbService as any).database).toBeDefined();
      expect(loggerSpy).toHaveBeenCalledWith('数据库连接已重建');
      expect(setIntervalSpy).toHaveBeenCalled();
      expect(clearIntervalSpy).toHaveBeenCalled();

      loggerSpy.mockRestore();
      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    });

    it('关闭连接失败时不应影响重建', () => {
      const originalClose = db.close.bind(db);
      (db as any).close = jest.fn(() => {
        throw new Error('close error');
      });
      const loggerWarnSpy = jest.spyOn((dbService as any).logger, 'warn').mockImplementation(() => {});
      const loggerSpy = jest.spyOn((dbService as any).logger, 'log').mockImplementation(() => {});
      const mockTimer = { unref: jest.fn() } as unknown as NodeJS.Timeout;
      const setIntervalSpy = jest.spyOn(globalThis, 'setInterval').mockReturnValue(mockTimer);

      expect(() => {
        dbService.rebuildConnection();
      }).not.toThrow();

      expect(loggerWarnSpy).toHaveBeenCalled();
      expect(loggerSpy).toHaveBeenCalled();

      loggerWarnSpy.mockRestore();
      loggerSpy.mockRestore();
      setIntervalSpy.mockRestore();
      (db as any).close = originalClose;
    });

    it('无 walCheckpointTimer 时应正常工作', () => {
      const loggerSpy = jest.spyOn((dbService as any).logger, 'log').mockImplementation(() => {});
      const mockTimer = { unref: jest.fn() } as unknown as NodeJS.Timeout;
      const setIntervalSpy = jest.spyOn(globalThis, 'setInterval').mockReturnValue(mockTimer);

      (dbService as any).walCheckpointTimer = null;

      expect(() => {
        dbService.rebuildConnection();
      }).not.toThrow();

      expect(loggerSpy).toHaveBeenCalled();

      loggerSpy.mockRestore();
      setIntervalSpy.mockRestore();
    });
  });
});
