/**
 * 统计缓存分类
 *
 * 从 system/stats/stats.interfaces.ts 迁移至 common/types，
 * 以消除 common/utils/cache-invalidation → system/stats 的跨层反向依赖（循环依赖）。
 */
export type StatsCacheCategory =
  | 'dashboard'
  | 'revenue'
  | 'doctorWorkload'
  | 'patientGrowth'
  | 'revenueByCategory'
  | 'revenueByDoctor'
  | 'inventory'
  | 'appointment'
  | 'charge'
  | 'patient'
  | 'member';
