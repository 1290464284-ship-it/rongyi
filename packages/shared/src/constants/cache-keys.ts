/**
 * 缓存 key 前缀常量（前后端共享）
 *
 * 集中管理所有缓存 key 前缀，避免 key 冲突和硬编码。
 * API 层可扩展额外的服务端专用前缀。
 */
export const CACHE_PREFIXES = {
  USER: 'user:',
  USER_PERMISSIONS: 'user:permissions:',
  USER_ROLES: 'user:roles:',
  PATIENT: 'patient:',
  APPOINTMENT: 'appointment:',
  CLINIC: 'clinic:',
  SETTINGS: 'settings:',
  IDEMPOTENCY: 'idempotency:',
  OPERATION_LOG: 'oplog:',
  STATS: 'stats:',
  SEARCH: 'search:',
  DICTIONARY: 'dict:',
  DEPARTMENT: 'dict:department:',
  TITLE: 'dict:title:',
  DRUG_CATALOG: 'dict:drugCatalog:',
  PAYMENT_METHOD: 'dict:paymentMethod:',
  MEMBER_CARD_TYPE: 'dict:memberCardType:',
} as const;

export type CachePrefix = typeof CACHE_PREFIXES[keyof typeof CACHE_PREFIXES];

export function buildCacheKey(prefix: CachePrefix, id: string): string {
  return `${prefix}${id}`;
}
