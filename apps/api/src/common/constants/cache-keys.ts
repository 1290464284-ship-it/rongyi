/**
 * 缓存 key 前缀常量
 *
 * P1 修复：CACHE_PREFIXES 从 @dental/shared 单源重新导出，避免双源定义导致未来不同步。
 * 原先 API 本地和 shared 包各定义一份，设缓存与删缓存分别从不同来源导入，
 * 一旦新增前缀只更新一份会导致缓存永不被失效（最难排查的脏读幽灵）。
 *
 * API 专有的扩展常量（DICTIONARY_CACHE_KEYS、STATS_CACHE_KEYS 及 builder 函数）仍保留在此文件。
 */
import { CACHE_PREFIXES } from '@dental/shared';

// 重新导出 shared 包的常量和类型，保持现有 import 路径兼容
export { CACHE_PREFIXES } from '@dental/shared';
export type { CachePrefix } from '@dental/shared';
export { buildCacheKey } from '@dental/shared';

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
