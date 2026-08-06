import type { FirstExamTrackingOverview } from './types';

export function TrackingOverviewBar({ data }: { data?: FirstExamTrackingOverview }) {
  return (
    <div className="tracking-overview" aria-label="追踪概览">
      <span className="tracking-chip">待跟进 {data?.PENDING ?? 0}</span>
      <span className="tracking-chip">需横向转诊 {data?.HORIZONTAL_SHOULD ?? 0}</span>
      <span className="tracking-chip">横向已转 {data?.HORIZONTAL_DONE ?? 0}</span>
      <span className="tracking-chip">已流失 {data?.LOST ?? 0}</span>
      <span className="tracking-chip">今日应跟进 {data?.dueToday ?? 0}</span>
    </div>
  );
}
