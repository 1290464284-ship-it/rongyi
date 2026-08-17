import type { Dispatch, SetStateAction } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { DataTable } from '../../components';
import { formatMoney } from '../../lib/format';
import { flowStatsColumns } from '../../processing-orders/columns';
import type { ProcessingFlowStatsData, SettleStats } from '../../processing-orders/types';

/** 结算汇总条：未结算/已结算单数与金额。 */
export function ProcessingSettleSummary({ stats }: { stats: SettleStats }) {
  return (
    <div className="settle-summary">
      <span>未结算 {stats.unsettled?.count ?? 0} 单（金额 {formatMoney(stats.unsettled?.feeTotal ?? 0)}）</span>
      <span>已结算 {stats.settled?.count ?? 0} 单（金额 {formatMoney(stats.settled?.amountTotal ?? 0)}）</span>
    </div>
  );
}

/** 流程统计区：日期筛选 + 流程步骤统计表。 */
export function ProcessingFlowStatsSection({
  statsFrom,
  statsTo,
  setStatsFrom,
  setStatsTo,
  flowStats,
}: {
  statsFrom: string;
  statsTo: string;
  setStatsFrom: Dispatch<SetStateAction<string>>;
  setStatsTo: Dispatch<SetStateAction<string>>;
  flowStats: UseQueryResult<ProcessingFlowStatsData, Error>;
}) {
  return (
    <section>
      <h2>流程统计</h2>
      <div className="inline-form">
        <input aria-label="统计开始日期" type="date" value={statsFrom} onChange={(event) => setStatsFrom(event.target.value)} />
        <input aria-label="统计结束日期" type="date" value={statsTo} onChange={(event) => setStatsTo(event.target.value)} />
      </div>
      <DataTable
        columns={flowStatsColumns}
        rows={flowStats.data?.steps ?? []}
        keyField="stepId"
        emptyText="暂无流程统计数据"
      />
    </section>
  );
}
