describe('dev-assert', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    jest.resetModules();
  });

  describe('开发环境 (NODE_ENV !== production)', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'development';
      jest.resetModules();
    });

    it('truthy 条件不应抛出异常', () => {
      const { devAssert } = require('./dev-assert');
      expect(() => devAssert(true, 'message')).not.toThrow();
      expect(() => devAssert(1, 'message')).not.toThrow();
      expect(() => devAssert('test', 'message')).not.toThrow();
    });

    it('falsy 条件应抛出异常', () => {
      const { devAssert } = require('./dev-assert');
      expect(() => devAssert(false, '错误信息')).toThrow();
      expect(() => devAssert(0, '错误信息')).toThrow();
      expect(() => devAssert('', '错误信息')).toThrow();
      expect(() => devAssert(null, '错误信息')).toThrow();
      expect(() => devAssert(undefined, '错误信息')).toThrow();
    });

    it('抛出的异常应包含状态码 500', () => {
      const { devAssert } = require('./dev-assert');
      try {
        devAssert(false, 'test');
        fail('应该抛出异常');
      } catch (err: unknown) {
        const exception = err as { getStatus?: () => number; status?: number };
        const status = exception.getStatus ? exception.getStatus() : exception.status;
        expect(status).toBe(500);
      }
    });

    it('错误信息应包含开发环境标识', () => {
      const { devAssert } = require('./dev-assert');
      try {
        devAssert(false, '测试断言失败');
        fail('应该抛出异常');
      } catch (err: unknown) {
        const message = (err as Error).message;
        expect(message).toContain('[开发环境断言]');
        expect(message).toContain('测试断言失败');
      }
    });
  });

  describe('生产环境 (NODE_ENV = production)', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
      jest.resetModules();
    });

    it('truthy 条件不应抛出异常', () => {
      const { devAssert } = require('./dev-assert');
      expect(() => devAssert(true, 'message')).not.toThrow();
    });

    it('falsy 条件也不应抛出异常（生产环境跳过）', () => {
      const { devAssert } = require('./dev-assert');
      expect(() => devAssert(false, '错误信息')).not.toThrow();
      expect(() => devAssert(null, '错误信息')).not.toThrow();
      expect(() => devAssert(undefined, '错误信息')).not.toThrow();
    });

    it('falsy 条件不应有任何返回值', () => {
      const { devAssert } = require('./dev-assert');
      const result = devAssert(false, 'test');
      expect(result).toBeUndefined();
    });
  });

  describe('测试环境 (NODE_ENV = test)', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'test';
      jest.resetModules();
    });

    it('测试环境也应执行断言（非 production）', () => {
      const { devAssert } = require('./dev-assert');
      expect(() => devAssert(false, 'test error')).toThrow();
    });
  });
});
