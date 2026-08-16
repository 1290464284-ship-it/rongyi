import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../../lib/api';
import { DataTable, LoadingState, PageError } from '../../components';
import { REPORT_TYPES, REPORT_TYPE_LABELS } from '../../inventory/constants';
import { detailReportColumns, summaryReportColumns } from '../../inventory/columns';
import type { InventoryReportData } from '../../inventory/types';

export function InventoryReportPanel() {
  const [reportType, setReportType] = useState('IN');
  const [reportFrom, setReportFrom] = useState('');
  const [reportTo, setReportTo] = useState('');
  const report = useQuery({
    queryKey: ['inventory-report', reportType, reportFrom, reportTo],
    queryFn: () => {
      const params = new URLSearchParams();
      if (reportFrom) params.set('from', reportFrom);
      if (reportTo) params.set('to', reportTo);
      const queryString = params.toString();
      return apiRequest<InventoryReportData>(
        `/inventory-reports/${reportType}${queryString ? `?${queryString}` : ''}`,
      );
    },
    // C2：refetch 期间延续旧数据，避免整表被 LoadingState 替换闪烁
    placeholderData: (previous) => previous,
  });

  return (
    <div className="tab-panel">
      <h2>库存明细报表</h2>
      <div className="inline-form">
        <select aria-label="报表类型" value={reportType} onChange={(event) => setReportType(event.target.value)}>
          {REPORT_TYPES.map((entry) => (
            <option key={entry.value} value={entry.value}>{entry.label}</option>
          ))}
        </select>
        <input aria-label="报表开始日期" type="date" value={reportFrom} onChange={(event) => setReportFrom(event.target.value)} />
        <input aria-label="报表结束日期" type="date" value={reportTo} onChange={(event) => setReportTo(event.target.value)} />
      </div>
      {(report.isLoading || report.isFetching) && !report.data && <LoadingState label="报表加载中..." />}
      {!report.isFetching && report.error && (
        <>
          <PageError message={report.error instanceof Error ? report.error.message : String(report.error)} />
          <button type="button" className="btn-secondary" onClick={() => void report.refetch()}>重试</button>
        </>
      )}
      {!report.isFetching && report.data && (
        <>
          <div className="stat-row">
            <span>{REPORT_TYPE_LABELS[report.data.type] ?? report.data.type}</span>
            <span>共 {report.data.total} 条</span>
            {report.data.from && <span>从 {report.data.from}</span>}
            {report.data.to && <span>至 {report.data.to}</span>}
          </div>
          {report.data.truncated && <p className="report-truncated">数据较多，仅显示前 {report.data.total} 条</p>}
          <DataTable
            columns={report.data.type === 'SUMMARY' ? summaryReportColumns : detailReportColumns}
            rows={report.data.items}
            keyField={report.data.type === 'SUMMARY' ? 'itemId' : 'id'}
            emptyText="暂无报表数据"
          />
        </>
      )}
    </div>
  );
}
