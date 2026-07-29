import { UserPermissionCacheService } from './user-permission-cache.service';
import { CacheService } from './cache.service';

function createMockCache(): jest.Mocked<CacheService> {
  return {
    get: jest.fn().mockResolvedValue(undefined),
    set: jest.fn(),
    del: jest.fn(),
    delPattern: jest.fn(),
  } as unknown as jest.Mocked<CacheService>;
}

describe('UserPermissionCacheService', () => {
  let cache: jest.Mocked<CacheService>;
  let service: UserPermissionCacheService;

  beforeEach(() => {
    cache = createMockCache();
    service = new UserPermissionCacheService(cache);
  });

  describe('getUserPermissions / setUserPermissions', () => {
    it('set 应调用 cache.set 存储权限数据', () => {
      service.setUserPermissions('user-1', 'clinic-1', ['read', 'write']);
      expect(cache.set).toHaveBeenCalledWith(
        expect.stringContaining('user-1'),
        { userId: 'user-1', clinicId: 'clinic-1', permissions: ['read', 'write'] },
        expect.any(Number),
      );
    });

    it('get 应调用 cache.get 并返回缓存数据', async () => {
      const cached = { userId: 'user-1', clinicId: 'clinic-1', permissions: ['read'] };
      (cache.get as jest.Mock).mockResolvedValue(cached);

      const result = await service.getUserPermissions('user-1', 'clinic-1');
      expect(result).toEqual(cached);
      expect(cache.get).toHaveBeenCalledWith(expect.stringContaining('user-1'));
    });

    it('get 缓存未命中应返回 undefined', async () => {
      (cache.get as jest.Mock).mockResolvedValue(undefined);
      const result = await service.getUserPermissions('user-1', 'clinic-1');
      expect(result).toBeUndefined();
    });
  });

  describe('invalidateUserPermissions', () => {
    it('应调用 cache.del 删除权限缓存', () => {
      service.invalidateUserPermissions('user-1', 'clinic-1');
      expect(cache.del).toHaveBeenCalledWith(expect.stringContaining('user-1'));
    });
  });

  describe('invalidateAllUserPermissions', () => {
    it('应调用 cache.delPattern 按前缀删除', () => {
      service.invalidateAllUserPermissions('user-1');
      expect(cache.delPattern).toHaveBeenCalledWith(expect.stringContaining('user-1'));
    });
  });

  describe('getUserRoles / setUserRoles', () => {
    it('set 应调用 cache.set 存储角色数据', () => {
      service.setUserRoles('user-1', 'clinic-1', ['DOCTOR']);
      expect(cache.set).toHaveBeenCalledWith(
        expect.stringContaining('user-1'),
        { userId: 'user-1', clinicId: 'clinic-1', roles: ['DOCTOR'] },
        expect.any(Number),
      );
    });

    it('get 应返回缓存的角色', async () => {
      const cached = { userId: 'user-1', clinicId: 'clinic-1', roles: ['ADMIN'] };
      (cache.get as jest.Mock).mockResolvedValue(cached);

      const result = await service.getUserRoles('user-1', 'clinic-1');
      expect(result).toEqual(cached);
    });
  });

  describe('invalidateUserRoles', () => {
    it('应调用 cache.del 删除角色缓存', () => {
      service.invalidateUserRoles('user-1', 'clinic-1');
      expect(cache.del).toHaveBeenCalledWith(expect.stringContaining('user-1'));
    });
  });

  describe('invalidateAllUserRoles', () => {
    it('应调用 cache.delPattern 按前缀删除', () => {
      service.invalidateAllUserRoles('user-1');
      expect(cache.delPattern).toHaveBeenCalledWith(expect.stringContaining('user-1'));
    });
  });

  describe('invalidateUserAllCache', () => {
    it('应同时清除权限和角色缓存', () => {
      service.invalidateUserAllCache('user-1');
      // 应调用 delPattern 两次（权限+角色）和 del 一次（用户缓存）
      expect(cache.delPattern).toHaveBeenCalledTimes(2);
      expect(cache.del).toHaveBeenCalledTimes(1);
    });
  });
});
