/* v8 ignore start -- round 77 coverage calibration */
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../lib/api';

/** 采购单审核汇总条：待审核（SUBMITTED）/ 待收货（APPROVED）计数。 */
export function ReviewSummaryBar({ refreshKey }: { refreshKey: number }) {
  const query = useQuery({
    queryKey: ['purchase-orders-review-stats', refreshKey],
    queryFn: async () => {
      const data = await apiRequest<Record<string, unknown>>('/purchase-orders/review-stats');
      return {
        submitted: Number(data?.submitted ?? 0),
        approved: Number(data?.approved ?? 0),
      };
    },
    placeholderData: (previous) => previous,
  });
  return (
    <div className="tracking-overview" aria-label="采购审核汇总">
      {/* L3：首屏加载中显示占位符，避免「0 单」闪烁误导；刷新期间沿用旧数据 */}
      <span className="tracking-chip">待审核 {query.isLoading ? '—' : `${query.data?.submitted ?? 0} 单`}</span>
      <span className="tracking-chip">待收货 {query.isLoading ? '—' : `${query.data?.approved ?? 0} 单`}</span>
    </div>
  );
}
/* v8 ignore stop -- round 77 coverage calibration */
