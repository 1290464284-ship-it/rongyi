/**
 * 缓存 key 前缀常量
 *
 * 集中管理所有缓存 key 前缀，避免 key 冲突和硬编码
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

/**
 * 字典类数据缓存键后缀
 * 用于变更频率低、读频率高的字典数据（治疗目录、病历常用语、病历模板等）
 */
export const DICTIONARY_CACHE_KEYS = {
  TREATMENT_CATALOG: 'treatmentCatalog',
  MEDICAL_RECORD_PHRASES: 'medicalRecordPhrases',
  MEDICAL_RECORD_TEMPLATES: 'medicalRecordTemplates',
  DEPARTMENT: 'department',
  TITLE: 'title',
  DRUG_CATALOG: 'drugCatalog',
  PAYMENT_METHOD: 'paymentMethod',
  MEMBER_CARD_TYPE: 'memberCardType',
} as const;

export type DictionaryCacheKey = typeof DICTIONARY_CACHE_KEYS[keyof typeof DICTIONARY_CACHE_KEYS];

export const STATS_CACHE_KEYS = {
  DASHBOARD: 'dashboard',
  REVENUE: 'revenue',
  DOCTOR_WORKLOAD: 'doctorWorkload',
  PATIENT_GROWTH: 'patientGrowth',
  REVENUE_BY_CATEGORY: 'revenueByCategory',
  REVENUE_BY_DOCTOR: 'revenueByDoctor',
  INVENTORY: 'inventory',
  APPOINTMENT: 'appointment',
  CHARGE: 'charge',
  PATIENT: 'patient',
  MEMBER: 'member',
} as const;

export type StatsCacheKey = typeof STATS_CACHE_KEYS[keyof typeof STATS_CACHE_KEYS];

export type CachePrefix = typeof CACHE_PREFIXES[keyof typeof CACHE_PREFIXES];

export function buildCacheKey(prefix: CachePrefix, id: string): string {
  return `${prefix}${id}`;
}

export function buildStatsCacheKey(category: StatsCacheKey, clinicId: string, ...parts: string[]): string {
  const base = `${CACHE_PREFIXES.STATS}${category}:${clinicId}`;
  return parts.length > 0 ? `${base}:${parts.join(':')}` : base;
}

/**
 * 构建字典类数据缓存键（按 clinicId 隔离，防止跨诊所缓存污染）
 * @example buildDictionaryCacheKey('treatmentCatalog', 'clinic-uuid-001')
 *          // => 'dict:treatmentCatalog:clinic-uuid-001'
 */
export function buildDictionaryCacheKey(category: DictionaryCacheKey, clinicId: string): string {
  return `${CACHE_PREFIXES.DICTIONARY}${category}:${clinicId}`;
}

/**
 * 构建用户权限缓存键（按 clinicId 隔离）
 * @example buildUserPermissionsCacheKey('user-uuid-001', 'clinic-uuid-001')
 *          // => 'user:permissions:user-uuid-001:clinic-uuid-001'
 */
export function buildUserPermissionsCacheKey(userId: string, clinicId: string): string {
  return `${CACHE_PREFIXES.USER_PERMISSIONS}${userId}:${clinicId}`;
}

/**
 * 构建用户角色缓存键（按 clinicId 隔离）
 * @example buildUserRolesCacheKey('user-uuid-001', 'clinic-uuid-001')
 *          // => 'user:roles:user-uuid-001:clinic-uuid-001'
 */
export function buildUserRolesCacheKey(userId: string, clinicId: string): string {
  return `${CACHE_PREFIXES.USER_ROLES}${userId}:${clinicId}`;
}
