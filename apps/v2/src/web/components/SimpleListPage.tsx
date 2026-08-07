import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../lib/api';
import { DataTable, LoadingState, PageError } from '.';
import { formatDate, formatDateTime, formatDisplayValue, formatMoney } from '../lib/format';

const COLUMN_LABELS: Record<string, string> = {
  period: '期间',
  revenue: '收入',
  totalAmount: '金额',
  patientId: '患者',
  doctorId: '医生',
  itemName: '项目',
  category: '分类',
  count: '数量',
  rate: '比率',
  score: '评分',
};

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
    label: COLUMN_LABELS[column] ?? column,
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
