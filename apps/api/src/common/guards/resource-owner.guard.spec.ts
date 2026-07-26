import { ResourceOwnerGuard } from './resource-owner.guard';
import { Reflector } from '@nestjs/core';
import { ForbiddenException, ExecutionContext } from '@nestjs/common';
import { Role } from '@dental/shared';
import { DbService } from '../../db/db.service';

function createMockExecutionContext(
  user?: { id: string; role: Role },
  params?: Record<string, string>,
): ExecutionContext {
  const mockRequest = {
    user,
    params: params || {},
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

describe('ResourceOwnerGuard', () => {
  let guard: ResourceOwnerGuard;
  let reflector: Reflector;
  let dbService: DbService;
  let getAllAndOverrideMock: jest.Mock;
  let prepareMock: jest.Mock;
  let getMock: jest.Mock;

  beforeEach(() => {
    getAllAndOverrideMock = jest.fn();
    reflector = {
      getAllAndOverride: getAllAndOverrideMock,
    } as unknown as Reflector;

    getMock = jest.fn();
    prepareMock = jest.fn().mockReturnValue({ get: getMock });
    dbService = {
      prepare: prepareMock,
    } as unknown as DbService;

    guard = new ResourceOwnerGuard(reflector, dbService);
  });

  describe('未配置资源所有者', () => {
    it('未配置 @ResourceOwner 时直接放行', () => {
      getAllAndOverrideMock.mockReturnValue(undefined);
      const context = createMockExecutionContext({ id: 'doc-1', role: Role.DOCTOR });
      const result = guard.canActivate(context);
      expect(result).toBe(true);
    });
  });

  describe('未登录用户', () => {
    it('request.user 不存在时抛 ForbiddenException', () => {
      getAllAndOverrideMock.mockReturnValue({ resourceType: 'Appointment' });
      const context = createMockExecutionContext();
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
      expect(() => guard.canActivate(context)).toThrow('未登录');
    });
  });

  describe('BOSS 角色', () => {
    it('BOSS 角色直接放行，不查询数据库', () => {
      getAllAndOverrideMock.mockReturnValue({ resourceType: 'Appointment' });
      const context = createMockExecutionContext(
        { id: 'boss-1', role: Role.BOSS },
        { id: 'appt-1' },
      );
      const result = guard.canActivate(context);
      expect(result).toBe(true);
      expect(prepareMock).not.toHaveBeenCalled();
    });
  });

  describe('RECEPTIONIST 角色', () => {
    it('RECEPTIONIST 角色直接放行，不查询数据库', () => {
      getAllAndOverrideMock.mockReturnValue({ resourceType: 'Appointment' });
      const context = createMockExecutionContext(
        { id: 'recep-1', role: Role.RECEPTIONIST },
        { id: 'appt-1' },
      );
      const result = guard.canActivate(context);
      expect(result).toBe(true);
      expect(prepareMock).not.toHaveBeenCalled();
    });
  });

  describe('DOCTOR 角色 - 资源不存在', () => {
    it('资源不存在时放行', () => {
      getAllAndOverrideMock.mockReturnValue({ resourceType: 'Appointment' });
      getMock.mockReturnValue(undefined);
      const context = createMockExecutionContext(
        { id: 'doc-1', role: Role.DOCTOR },
        { id: 'non-existent' },
      );
      const result = guard.canActivate(context);
      expect(result).toBe(true);
      expect(prepareMock).toHaveBeenCalled();
    });
  });

  describe('DOCTOR 角色 - 是资源所有者', () => {
    it('doctorId 匹配时放行', () => {
      getAllAndOverrideMock.mockReturnValue({ resourceType: 'Appointment' });
      getMock.mockReturnValue({ doctorId: 'doc-1' });
      const context = createMockExecutionContext(
        { id: 'doc-1', role: Role.DOCTOR },
        { id: 'appt-1' },
      );
      const result = guard.canActivate(context);
      expect(result).toBe(true);
    });
  });

  describe('DOCTOR 角色 - 不是资源所有者', () => {
    it('doctorId 不匹配时抛 ForbiddenException', () => {
      getAllAndOverrideMock.mockReturnValue({ resourceType: 'Appointment' });
      getMock.mockReturnValue({ doctorId: 'other-doc' });
      const context = createMockExecutionContext(
        { id: 'doc-1', role: Role.DOCTOR },
        { id: 'appt-1' },
      );
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
      expect(() => guard.canActivate(context)).toThrow('无权访问该资源');
    });
  });

  describe('自定义 ID 参数', () => {
    it('使用自定义 idParam 从 params 中获取资源 ID', () => {
      getAllAndOverrideMock.mockReturnValue({ resourceType: 'Appointment', idParam: 'appointmentId' });
      getMock.mockReturnValue({ doctorId: 'doc-1' });
      const context = createMockExecutionContext(
        { id: 'doc-1', role: Role.DOCTOR },
        { appointmentId: 'appt-1' },
      );
      const result = guard.canActivate(context);
      expect(result).toBe(true);
      expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining('WHERE id = ?'));
    });

    it('params 中无对应 id 时放行', () => {
      getAllAndOverrideMock.mockReturnValue({ resourceType: 'Appointment', idParam: 'appointmentId' });
      const context = createMockExecutionContext(
        { id: 'doc-1', role: Role.DOCTOR },
        { id: 'appt-1' },
      );
      const result = guard.canActivate(context);
      expect(result).toBe(true);
      expect(prepareMock).not.toHaveBeenCalled();
    });
  });

  describe('自定义 owner 字段', () => {
    it('使用自定义 ownerField 查询数据库', () => {
      getAllAndOverrideMock.mockReturnValue({ resourceType: 'SomeTable', ownerField: 'ownerId' });
      getMock.mockReturnValue({ ownerId: 'doc-1' });
      const context = createMockExecutionContext(
        { id: 'doc-1', role: Role.DOCTOR },
        { id: 'resource-1' },
      );
      const result = guard.canActivate(context);
      expect(result).toBe(true);
      expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining('ownerId'));
    });
  });

  describe('资源无 owner 时', () => {
    it('ownerId 为 null 时放行', () => {
      getAllAndOverrideMock.mockReturnValue({ resourceType: 'Appointment' });
      getMock.mockReturnValue({ doctorId: null });
      const context = createMockExecutionContext(
        { id: 'doc-1', role: Role.DOCTOR },
        { id: 'appt-1' },
      );
      const result = guard.canActivate(context);
      expect(result).toBe(true);
    });
  });
});
