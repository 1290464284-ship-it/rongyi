import { ClinicContextService, ClinicContextData } from './clinic-context.service';

describe('ClinicContextService', () => {
  let service: ClinicContextService;

  beforeEach(() => {
    service = new ClinicContextService();
  });

  describe('默认值', () => {
    it('未设置上下文时 getClinicId 返回 null', () => {
      expect(service.getClinicId()).toBeNull();
    });

    it('未设置上下文时 getUserId 返回 null', () => {
      expect(service.getUserId()).toBeNull();
    });

    it('未设置上下文时 getRole 返回 null', () => {
      expect(service.getRole()).toBeNull();
    });

    it('未设置上下文时 getUserAgent 返回 null', () => {
      expect(service.getUserAgent()).toBeNull();
    });

    it('未设置上下文时 getSource 返回 null', () => {
      expect(service.getSource()).toBeNull();
    });

    it('未设置上下文时 isInitialized 返回 false', () => {
      expect(service.isInitialized()).toBe(false);
    });
  });

  describe('run() 与 getter 方法', () => {
    const context: ClinicContextData = {
      clinicId: 'clinic-001',
      userId: 'user-001',
      role: 'admin',
      userAgent: 'Mozilla/5.0',
      source: 'web',
    };

    it('run() 内可以正确获取 clinicId', () => {
      service.run(context, () => {
        expect(service.getClinicId()).toBe('clinic-001');
      });
    });

    it('run() 内可以正确获取 userId', () => {
      service.run(context, () => {
        expect(service.getUserId()).toBe('user-001');
      });
    });

    it('run() 内可以正确获取 role', () => {
      service.run(context, () => {
        expect(service.getRole()).toBe('admin');
      });
    });

    it('run() 内可以正确获取 userAgent', () => {
      service.run(context, () => {
        expect(service.getUserAgent()).toBe('Mozilla/5.0');
      });
    });

    it('run() 内可以正确获取 source', () => {
      service.run(context, () => {
        expect(service.getSource()).toBe('web');
      });
    });

    it('run() 内 isInitialized 返回 true', () => {
      service.run(context, () => {
        expect(service.isInitialized()).toBe(true);
      });
    });

    it('run() 执行完毕后上下文恢复，getter 返回 null', () => {
      service.run(context, () => {
        // 上下文内
      });
      expect(service.getClinicId()).toBeNull();
      expect(service.getUserId()).toBeNull();
      expect(service.getRole()).toBeNull();
      expect(service.isInitialized()).toBe(false);
    });

    it('run() 返回函数的返回值', () => {
      const result = service.run(context, () => {
        return 'hello';
      });
      expect(result).toBe('hello');
    });

    it('部分字段为 null 时能正确读取', () => {
      const partialContext: ClinicContextData = {
        clinicId: 'clinic-002',
        userId: null,
        role: null,
        userAgent: null,
        source: null,
      };
      service.run(partialContext, () => {
        expect(service.getClinicId()).toBe('clinic-002');
        expect(service.getUserId()).toBeNull();
        expect(service.getRole()).toBeNull();
      });
    });
  });

  describe('嵌套 run() 调用', () => {
    const outerContext: ClinicContextData = {
      clinicId: 'outer-clinic',
      userId: 'outer-user',
      role: 'outer-role',
      userAgent: 'outer-ua',
      source: 'outer-source',
    };

    const innerContext: ClinicContextData = {
      clinicId: 'inner-clinic',
      userId: 'inner-user',
      role: 'inner-role',
      userAgent: 'inner-ua',
      source: 'inner-source',
    };

    it('嵌套 run() 时内层覆盖外层上下文', () => {
      service.run(outerContext, () => {
        expect(service.getClinicId()).toBe('outer-clinic');

        service.run(innerContext, () => {
          expect(service.getClinicId()).toBe('inner-clinic');
          expect(service.getUserId()).toBe('inner-user');
        });

        expect(service.getClinicId()).toBe('outer-clinic');
      });
    });

    it('内层退出后恢复外层上下文', () => {
      service.run(outerContext, () => {
        service.run(innerContext, () => {
          // 内层
        });
        expect(service.getClinicId()).toBe('outer-clinic');
        expect(service.getUserId()).toBe('outer-user');
        expect(service.isInitialized()).toBe(true);
      });
    });
  });

  describe('多实例隔离', () => {
    it('不同实例的上下文互不影响', () => {
      const service1 = new ClinicContextService();
      const service2 = new ClinicContextService();

      const context1: ClinicContextData = {
        clinicId: 'clinic-1',
        userId: 'user-1',
        role: 'role-1',
        userAgent: 'ua-1',
        source: 'source-1',
      };

      const context2: ClinicContextData = {
        clinicId: 'clinic-2',
        userId: 'user-2',
        role: 'role-2',
        userAgent: 'ua-2',
        source: 'source-2',
      };

      service1.run(context1, () => {
        expect(service1.getClinicId()).toBe('clinic-1');
        expect(service2.getClinicId()).toBeNull();
        expect(service2.isInitialized()).toBe(false);
      });

      service2.run(context2, () => {
        expect(service2.getClinicId()).toBe('clinic-2');
        expect(service1.getClinicId()).toBeNull();
        expect(service1.isInitialized()).toBe(false);
      });
    });
  });

  describe('异步上下文隔离', () => {
    it('setTimeout 中仍能保持正确的上下文', (done) => {
      const context: ClinicContextData = {
        clinicId: 'async-clinic',
        userId: 'async-user',
        role: 'async-role',
        userAgent: 'async-ua',
        source: 'async-source',
      };

      service.run(context, () => {
        setTimeout(() => {
          expect(service.getClinicId()).toBe('async-clinic');
          expect(service.getUserId()).toBe('async-user');
          expect(service.getRole()).toBe('async-role');
          expect(service.isInitialized()).toBe(true);
          done();
        }, 10);
      });
    });

    it('Promise 链中仍能保持正确的上下文', async () => {
      const context: ClinicContextData = {
        clinicId: 'promise-clinic',
        userId: 'promise-user',
        role: 'promise-role',
        userAgent: 'promise-ua',
        source: 'promise-source',
      };

      const result = await service.run(context, async () => {
        await Promise.resolve();
        return service.getClinicId();
      });

      expect(result).toBe('promise-clinic');
    });

    it('两个并行的异步上下文互不干扰', async () => {
      const contextA: ClinicContextData = {
        clinicId: 'clinic-A',
        userId: 'user-A',
        role: 'role-A',
        userAgent: 'ua-A',
        source: 'source-A',
      };

      const contextB: ClinicContextData = {
        clinicId: 'clinic-B',
        userId: 'user-B',
        role: 'role-B',
        userAgent: 'ua-B',
        source: 'source-B',
      };

      const promiseA = service.run(contextA, async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return service.getClinicId();
      });

      const promiseB = service.run(contextB, async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return service.getClinicId();
      });

      const [resultA, resultB] = await Promise.all([promiseA, promiseB]);

      expect(resultA).toBe('clinic-A');
      expect(resultB).toBe('clinic-B');
    });
  });
});
