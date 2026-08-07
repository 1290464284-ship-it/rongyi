/**
 * NPS（净推荐值）计算共享函数。
 * 供 SatisfactionSurvey 与 FollowUp 两套评分统计复用，避免分值口径漂移。
 */

export function computeNps(promoters: number, detractors: number, total: number): number {
  return total > 0 ? Math.round(((promoters - detractors) / total) * 100) : 0;
}

export function computeAverage(ratingSum: number, total: number): number {
  return total > 0 ? Math.round((ratingSum / total) * 10) / 10 : 0;
}
