import type { FollowUpNps } from '../../follow-ups/types';

export function FollowUpStats({ summary, nps }: {
  summary: { total: number; overdue: number; today: number; upcoming: number } | undefined;
  nps: FollowUpNps | undefined;
}) {
  return (
    <>
      {summary && (
        <div className="stat-row">
          <span>总计：{summary.total}</span>
          <span>已逾期：{summary.overdue}</span>
          <span>今日：{summary.today}</span>
          <span>后续：{summary.upcoming}</span>
        </div>
      )}
      {nps && (
        <div className="stat-row">
          <span>NPS 得分：{nps.nps}</span>
          <span>推荐者：{nps.promoters}</span>
          <span>中立者：{nps.passives}</span>
          <span>贬损者：{nps.detractors}</span>
          <span>平均评分：{nps.average}</span>
        </div>
      )}
    </>
  );
}
