import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../lib/api';
import { DataTable, LoadingState, PageError } from '.';
import { formatDate, formatDateTime, formatDisplayValue, formatMoney } from '../lib/format';
import { SIMPLE_LIST_COLUMN_LABELS } from '../lib/labels';

/**
 * 只读统计端点表格（Round7 M-02 职责说明）。
 * 仅用于 hub-tabs.tsx 的 5 个统计 Tab（/stats/revenue、/stats/inventory、
 * /analytics/rfm、/analytics/churn、/analytics/doctor-anomalies）：
 * 请求一个返回数组的只读端点，首行字段即列，值按列名智能格式化。
 * 不提供增删改/搜索/分页（统计端点由后端聚合）。
 * 列名中文标签集中在 lib/labels.ts 的 SIMPLE_LIST_COLUMN_LABELS（M-02）。
 */
export function SimpleListPage({ title, endpoint }: { title: string; endpoint: string }) {
  const query = useQuery({
    queryKey: [endpoint],
    queryFn: () => apiRequest<unknown[]>(endpoint),
  });
  if (query.isLoading) return <LoadingState />;
  if (query.error) return <PageError message={(query.error as Error).message} />;
  const rows = (query.data ?? []) as Array<Record<string, unknown>>;
  const columns = rows.length ? Object.keys(rows[0]) : [];
  const dataColumns = columns.map((column) => ({
    key: column,
    label: SIMPLE_LIST_COLUMN_LABELS[column] ?? column,
    render: (row: Record<string, unknown>) => format(column, row[column]),
  }));
  return (
    <div className="page">
      <h1>{title}</h1>
      <DataTable columns={dataColumns} rows={rows} emptyText="暂无数据" />
    </div>
  );
}

function format(column: string, value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  if (['revenue', 'amount', 'totalAmount', 'paidAmount', 'unpaidAmount', 'monetary', 'price', 'unitPrice', 'subtotal'].includes(column)) {
    return formatMoney(value);
  }
  if (['createdAt', 'updatedAt', 'paidAt', 'completedAt', 'sentAt', 'receivedAt', 'deliveredAt', 'issuedAt', 'startTime', 'endTime'].includes(column)) {
    return formatDateTime(value);
  }
  if (['birthDate', 'planDate', 'expireDate', 'workDate', 'startDate', 'endDate', 'purchaseDate', 'examDate', 'surveyDate'].includes(column)) {
    return formatDate(value);
  }
  return formatDisplayValue(value);
}
