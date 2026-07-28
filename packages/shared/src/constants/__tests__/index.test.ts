import { describe, it, expect } from 'vitest';
import {
  MAX_PAGE_SIZE,
  PAGINATION,
  ROLES,
  ROLE_LEVELS,
  hasRoleLevel,
  CACHE_PREFIXES,
  buildCacheKey,
} from '../../constants';

describe('constants exports', () => {
  describe('pagination', () => {
    it('should export MAX_PAGE_SIZE', () => {
      expect(MAX_PAGE_SIZE).toBe(200);
    });

    it('should export PAGINATION object', () => {
      expect(PAGINATION.DEFAULT_PAGE).toBe(1);
      expect(PAGINATION.DEFAULT_PAGE_SIZE).toBe(20);
      expect(PAGINATION.MAX_PAGE_SIZE).toBe(200);
    });
  });

  describe('roles', () => {
    it('should export ROLES object', () => {
      expect(ROLES.BOSS).toBe('BOSS');
      expect(ROLES.DOCTOR).toBe('DOCTOR');
      expect(ROLES.RECEPTIONIST).toBe('RECEPTIONIST');
    });

    it('should export ROLE_LEVELS', () => {
      expect(ROLE_LEVELS.BOSS).toBe(5);
      expect(ROLE_LEVELS.ADMIN).toBe(4);
      expect(ROLE_LEVELS.DOCTOR).toBe(3);
    });

    it('hasRoleLevel should compare role levels correctly', () => {
      expect(hasRoleLevel('BOSS', 'DOCTOR')).toBe(true);
      expect(hasRoleLevel('DOCTOR', 'DOCTOR')).toBe(true);
      expect(hasRoleLevel('RECEPTIONIST', 'DOCTOR')).toBe(false);
      expect(hasRoleLevel('BOSS', 'BOSS')).toBe(true);
    });
  });

  describe('cache-keys', () => {
    it('should export CACHE_PREFIXES', () => {
      expect(CACHE_PREFIXES.USER).toBe('user:');
      expect(CACHE_PREFIXES.PATIENT).toBe('patient:');
      expect(CACHE_PREFIXES.APPOINTMENT).toBe('appointment:');
    });

    it('buildCacheKey should combine prefix and id', () => {
      expect(buildCacheKey('user:', '123')).toBe('user:123');
      expect(buildCacheKey('patient:', 'abc')).toBe('patient:abc');
    });
  });
});
