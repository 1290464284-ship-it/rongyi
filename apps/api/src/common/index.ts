export * from './services/base.service';
export * from './services/logger.service';
export * from './utils';
export * from './dto/pagination.dto';
export * from './middleware/rate-limit.middleware';
export * from './middleware/rate-limit-store';
export * from './filters/all-exceptions.filter';

export { TableNames, type TableName, CACHE_PREFIXES, type CachePrefix, buildCacheKey } from './constants';
// 角色常量统一来自 @dental/shared，确保前后端共享同一事实来源
export { ROLES, ROLE_LEVELS, hasRoleLevel, type SharedRole } from '@dental/shared';
