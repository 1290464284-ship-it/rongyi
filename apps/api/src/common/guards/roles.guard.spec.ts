import { RolesGuard } from './roles.guard';
import { Reflector } from '@nestjs/core';
import { ForbiddenException, ExecutionContext } from '@nestjs/common';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { Role } from '@dental/shared';

function createMockExecutionContext(user?: { role: Role }): ExecutionContext {
  const mockRequest = {
    user,
  };

  return {
    getHandler: jest.fn().mockReturnValue({}),
    getClass: jest.fn().mockReturnValue({}),
    switchToHttp: () => ({
      getRequest: () => mockRequest,
      getResponse: () => ({}),
      getNext: () => ({}),
    }),
    getArgs: () => [],
    getArgByIndex: () => {},
    switchToRpc: () => ({
      getData: () => ({}),
      getContext: () => ({}),
    }),
    switchToWs: () => ({
      getClient: () => ({}),
      getData: () => ({}),
    }),
    getType: () => 'http',
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;
  let getAllAndOverrideMock: jest.Mock;

  beforeEach(() => {
    getAllAndOverrideMock = jest.fn();
    reflector = {
      getAllAndOverride: getAllAndOverrideMock,
    } as unknown as Reflector;
    guard = new RolesGuard(reflector);
  });

  describe('公共接口放行', () => {
    it('handler 层级标记 @Public 时直接放行', () => {
      getAllAndOverrideMock.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return true;
      });

      const context = createMockExecutionContext();
      const result = guard.canActivate(context);

      expect(result).toBe(true);
      expect(getAllAndOverrideMock).toHaveBeenCalledWith(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
    });

    it('class 层级标记 @Public 时直接放行', () => {
      getAllAndOverrideMock.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return true;
      });

      const context = createMockExecutionContext();
      const result = guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('@Public 标记时不检查角色也不检查用户', () => {
      getAllAndOverrideMock.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return true;
      });

      const context = createMockExecutionContext();
      const result = guard.canActivate(context);

      expect(result).toBe(true);
      const publicCallIndex = getAllAndOverrideMock.mock.calls.findIndex(
        (call) => call[0] === ROLES_KEY,
      );
      expect(publicCallIndex).toBe(-1);
    });
  });

  describe('未配置角色', () => {
    it('handler 和 class 都未配置角色时抛 ForbiddenException', () => {
      getAllAndOverrideMock.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return;
        if (key === ROLES_KEY) return;
      });

      const context = createMockExecutionContext({ role: Role.BOSS });

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
      expect(() => guard.canActivate(context)).toThrow('未配置角色权限');
    });

    it('handler 角色为空数组时抛 ForbiddenException', () => {
      getAllAndOverrideMock.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return;
        if (key === ROLES_KEY) return [];
      });

      const context = createMockExecutionContext({ role: Role.BOSS });

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
      expect(() => guard.canActivate(context)).toThrow('未配置角色权限');
    });
  });

  describe('未登录用户', () => {
    it('request.user 不存在时抛 ForbiddenException', () => {
      getAllAndOverrideMock.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return;
        if (key === ROLES_KEY) return [Role.BOSS];
      });

      const context = createMockExecutionContext();

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
      expect(() => guard.canActivate(context)).toThrow('未登录');
    });

    it('request.user 为 undefined 时抛 ForbiddenException', () => {
      getAllAndOverrideMock.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return;
        if (key === ROLES_KEY) return [Role.BOSS];
      });

      const context = createMockExecutionContext();

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });
  });

  describe('角色不匹配', () => {
    it('用户角色不在允许列表中时抛 ForbiddenException', () => {
      getAllAndOverrideMock.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return;
        if (key === ROLES_KEY) return [Role.BOSS];
      });

      const context = createMockExecutionContext({ role: Role.DOCTOR });

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
      expect(() => guard.canActivate(context)).toThrow('权限不足');
    });

    it('单角色配置与用户角色不匹配', () => {
      getAllAndOverrideMock.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return;
        if (key === ROLES_KEY) return [Role.RECEPTIONIST];
      });

      const context = createMockExecutionContext({ role: Role.BOSS });

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('多角色配置但用户角色不在其中', () => {
      getAllAndOverrideMock.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return;
        if (key === ROLES_KEY) return [Role.BOSS, Role.DOCTOR];
      });

      const context = createMockExecutionContext({ role: Role.RECEPTIONIST });

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });
  });

  describe('角色匹配通过', () => {
    it('用户角色匹配单角色配置时返回 true', () => {
      getAllAndOverrideMock.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return;
        if (key === ROLES_KEY) return [Role.BOSS];
      });

      const context = createMockExecutionContext({ role: Role.BOSS });
      const result = guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('用户角色匹配多角色配置中的一个时返回 true', () => {
      getAllAndOverrideMock.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return;
        if (key === ROLES_KEY) return [Role.BOSS, Role.DOCTOR];
      });

      const context = createMockExecutionContext({ role: Role.DOCTOR });
      const result = guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('RECEPTIONIST 角色匹配时返回 true', () => {
      getAllAndOverrideMock.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return;
        if (key === ROLES_KEY) return [Role.RECEPTIONIST];
      });

      const context = createMockExecutionContext({ role: Role.RECEPTIONIST });
      const result = guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('用户角色是多角色配置中第一个时返回 true', () => {
      getAllAndOverrideMock.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return;
        if (key === ROLES_KEY) return [Role.BOSS, Role.DOCTOR, Role.RECEPTIONIST];
      });

      const context = createMockExecutionContext({ role: Role.BOSS });
      const result = guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('用户角色是多角色配置中最后一个时返回 true', () => {
      getAllAndOverrideMock.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return;
        if (key === ROLES_KEY) return [Role.BOSS, Role.DOCTOR, Role.RECEPTIONIST];
      });

      const context = createMockExecutionContext({ role: Role.RECEPTIONIST });
      const result = guard.canActivate(context);

      expect(result).toBe(true);
    });
  });

  describe('元数据读取层级', () => {
    it('使用 getAllAndOverride 读取 IS_PUBLIC_KEY 元数据', () => {
      getAllAndOverrideMock.mockReturnValue(undefined);

      const context = createMockExecutionContext({ role: Role.BOSS });
      try {
        guard.canActivate(context);
      } catch {
        // ignore
      }

      const publicCall = getAllAndOverrideMock.mock.calls.find(
        (call) => call[0] === IS_PUBLIC_KEY,
      );
      expect(publicCall).toBeDefined();
      expect(publicCall![1]).toEqual([context.getHandler(), context.getClass()]);
    });

    it('使用 getAllAndOverride 读取 ROLES_KEY 元数据', () => {
      getAllAndOverrideMock.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return;
        if (key === ROLES_KEY) return [Role.BOSS];
      });

      const context = createMockExecutionContext({ role: Role.BOSS });
      guard.canActivate(context);

      const rolesCall = getAllAndOverrideMock.mock.calls.find(
        (call) => call[0] === ROLES_KEY,
      );
      expect(rolesCall).toBeDefined();
      expect(rolesCall![1]).toEqual([context.getHandler(), context.getClass()]);
    });

    it('getAllAndOverride 接收 handler 和 class 两个目标', () => {
      getAllAndOverrideMock.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return;
        if (key === ROLES_KEY) return [Role.BOSS];
      });

      const mockHandler = function testHandler() {};
      const mockClass = function TestClass() {};

      const context = {
        getHandler: () => mockHandler,
        getClass: () => mockClass,
        switchToHttp: () => ({
          getRequest: () => ({ user: { role: Role.BOSS } }),
          getResponse: () => ({}),
          getNext: () => ({}),
        }),
      } as unknown as ExecutionContext;

      guard.canActivate(context);

      expect(getAllAndOverrideMock).toHaveBeenCalledWith(IS_PUBLIC_KEY, [mockHandler, mockClass]);
      expect(getAllAndOverrideMock).toHaveBeenCalledWith(ROLES_KEY, [mockHandler, mockClass]);
    });
  });
});
