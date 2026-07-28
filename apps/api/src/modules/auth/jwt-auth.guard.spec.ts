import { ExecutionContext } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let reflector: { getAllAndOverride: jest.Mock };

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn(),
    };
    guard = new JwtAuthGuard(reflector as any);
  });

  function createMockContext(handler?: (...args: unknown[]) => unknown, classRef?: new (...args: unknown[]) => unknown): ExecutionContext {
    return {
      getHandler: () => handler || jest.fn(),
      getClass: () => classRef || class TestClass {},
      switchToHttp: () => ({
        getRequest: () => ({ headers: {} }),
        getResponse: () => ({ statusCode: 200 }),
      }),
    } as any;
  }

  describe('canActivate', () => {
    it('标记为 @Public() 的路由返回 true', () => {
      reflector.getAllAndOverride.mockReturnValue(true);

      const result = guard.canActivate(createMockContext());

      expect(result).toBe(true);
      expect(reflector.getAllAndOverride).toHaveBeenCalled();
    });

    it('未标记 @Public() 的路由调用父类 canActivate（抛出错误因无 passport 上下文）', async () => {
      reflector.getAllAndOverride.mockReturnValue(false);

      // super.canActivate 会抛错因为没有真实 passport 策略注册
      await expect(guard.canActivate(createMockContext())).rejects.toThrow();

      const callArgs = reflector.getAllAndOverride.mock.calls[0];
      expect(callArgs[0]).toBe('isPublic');
      expect(Array.isArray(callArgs[1])).toBe(true);
      expect(callArgs[1].length).toBe(2);
    });

    it('reflector 查询使用 handler 和 class 作为元数据来源', () => {
      reflector.getAllAndOverride.mockReturnValue(true);
      const handler = jest.fn();
      const classRef = class TestHandler {};

      guard.canActivate(createMockContext(handler, classRef));

      const metadataSources = reflector.getAllAndOverride.mock.calls[0][1];
      expect(metadataSources).toContain(handler);
      expect(metadataSources).toContain(classRef);
    });
  });
});
