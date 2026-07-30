import { StatsCacheCategory } from '../types/stats-cache-category';

/**
 * StatsService 接口（仅声明需要的方法，避免循环依赖）
 */
interface StatsServiceLike {
  invalidateStatsCache(category?: StatsCacheCategory): void;
}

/**
 * 预定义的缓存失效组合
 *
 * 各业务服务在财务操作后需要失效的统计缓存子集。
 * 避免每个服务重复书写相同的 invalidateStatsCache 调用序列。
 */
export const CacheGroups = {
  /** 收费相关操作（创建/支付/退款） */
  financial: ['dashboard', 'revenue', 'charge', 'doctorWorkload', 'revenueByDoctor', 'revenueByCategory'] as StatsCacheCategory[],

  /** 会员卡相关操作 */
  member: ['dashboard', 'member', 'revenue'] as StatsCacheCategory[],

  /** 预约相关操作 */
  appointment: ['dashboard', 'appointment', 'doctorWorkload'] as StatsCacheCategory[],

  /** 库存相关操作 */
  inventory: ['dashboard', 'inventory'] as StatsCacheCategory[],

  /** 患者相关操作 */
  patient: ['dashboard', 'patient', 'patientGrowth'] as StatsCacheCategory[],
} as const;

export type CacheGroupKey = keyof typeof CacheGroups;

/**
 * 批量失效统计缓存
 *
 * @param statsService - StatsService 实例
 * @param categories - 要失效的缓存类别列表
 *
 * @example
 * // 替代 6 行重复调用：
 * invalidateStatsCaches(this.statsService, CacheGroups.financial);
 *
 * // 自定义组合：
 * invalidateStatsCaches(this.statsService, ['dashboard', 'member']);
 */
export function invalidateStatsCaches(
  statsService: StatsServiceLike,
  categories: readonly StatsCacheCategory[],
): void {
  for (const category of categories) {
    statsService.invalidateStatsCache(category);
  }
}
