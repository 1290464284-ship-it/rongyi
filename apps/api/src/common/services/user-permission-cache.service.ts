import { Injectable } from '@nestjs/common';
import { CacheService } from './cache.service';
import { CACHE_PREFIXES, buildUserPermissionsCacheKey, buildUserRolesCacheKey } from '../constants/cache-keys';
import { USER_PERMISSIONS_CACHE_TTL_MS, USER_ROLES_CACHE_TTL_MS } from '../../config/constants';

export interface UserPermissions {
  userId: string;
  clinicId: string;
  permissions: string[];
}

export interface UserRoles {
  userId: string;
  clinicId: string;
  roles: string[];
}

@Injectable()
export class UserPermissionCacheService {
  constructor(private cache: CacheService) {}

  async getUserPermissions(userId: string, clinicId: string): Promise<UserPermissions | undefined> {
    const cacheKey = buildUserPermissionsCacheKey(userId, clinicId);
    return this.cache.get<UserPermissions>(cacheKey);
  }

  setUserPermissions(userId: string, clinicId: string, permissions: string[]) {
    const cacheKey = buildUserPermissionsCacheKey(userId, clinicId);
    this.cache.set<UserPermissions>(
      cacheKey,
      { userId, clinicId, permissions },
      USER_PERMISSIONS_CACHE_TTL_MS,
    );
  }

  invalidateUserPermissions(userId: string, clinicId: string): void {
    const cacheKey = buildUserPermissionsCacheKey(userId, clinicId);
    this.cache.del(cacheKey);
  }

  invalidateAllUserPermissions(userId: string): void {
    this.cache.delPattern(`${CACHE_PREFIXES.USER_PERMISSIONS}${userId}:`);
  }

  async getUserRoles(userId: string, clinicId: string): Promise<UserRoles | undefined> {
    const cacheKey = buildUserRolesCacheKey(userId, clinicId);
    return this.cache.get<UserRoles>(cacheKey);
  }

  setUserRoles(userId: string, clinicId: string, roles: string[]) {
    const cacheKey = buildUserRolesCacheKey(userId, clinicId);
    this.cache.set<UserRoles>(
      cacheKey,
      { userId, clinicId, roles },
      USER_ROLES_CACHE_TTL_MS,
    );
  }

  invalidateUserRoles(userId: string, clinicId: string): void {
    const cacheKey = buildUserRolesCacheKey(userId, clinicId);
    this.cache.del(cacheKey);
  }

  invalidateAllUserRoles(userId: string): void {
    this.cache.delPattern(`${CACHE_PREFIXES.USER_ROLES}${userId}:`);
  }

  invalidateUserAllCache(userId: string): void {
    this.invalidateAllUserPermissions(userId);
    this.invalidateAllUserRoles(userId);
    this.cache.del(`${CACHE_PREFIXES.USER}${userId}`);
  }
}