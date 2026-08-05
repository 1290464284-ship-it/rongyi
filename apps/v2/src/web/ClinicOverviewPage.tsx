import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api';
import { DataTable, QueryBoundary, type DataTableColumn } from './components';
import { formatMoney } from './format';

export function ClinicOverviewPage() {
  const query = useQuery({
    queryKey: ['clinic-overview'],
    queryFn: () => apiRequest<Array<Record<string, unknown>>>('/analytics/clinic-overview'),
  });

  return (
    <QueryBoundary isLoading={query.isLoading} error={query.error} data={query.data} errorLabel="无法加载多门店经营概览">
      <ClinicOverviewContent data={query.data!} />
    </QueryBoundary>
  );
}

function ClinicOverviewContent({ data: rows }: { data: Array<Record<string, unknown>> }) {
  const totals = rows.reduce<{
    patients: number;
    appointments: number;
    charges: number;
    paidAmount: number;
    unpaidAmount: number;
    inventoryItems: number;
    pendingFollowUps: number;
  }>((result, row) => ({
    patients: result.patients + toNumber(row.patients),
    appointments: result.appointments + toNumber(row.appointments),
    charges: result.charges + toNumber(row.charges),
    paidAmount: result.paidAmount + toNumber(row.paidAmount),
    unpaidAmount: result.unpaidAmount + toNumber(row.unpaidAmount),
    inventoryItems: result.inventoryItems + toNumber(row.inventoryItems),
    pendingFollowUps: result.pendingFollowUps + toNumber(row.pendingFollowUps),
  }), {
    patients: 0,
    appointments: 0,
    charges: 0,
    paidAmount: 0,
    unpaidAmount: 0,
    inventoryItems: 0,
    pendingFollowUps: 0,
  });

  const columns: DataTableColumn<Record<string, unknown>>[] = [
    { key: 'clinicName', label: '诊所', render: (row) => String(row.clinicName ?? row.clinicId ?? '') },
    { key: 'patients', label: '患者', render: (row) => String(toNumber(row.patients)) },
    { key: 'appointments', label: '预约', render: (row) => String(toNumber(row.appointments)) },
    { key: 'charges', label: '收费单', render: (row) => String(toNumber(row.charges)) },
    { key: 'paidAmount', label: '已收金额', render: (row) => formatMoney(row.paidAmount) },
    { key: 'unpaidAmount', label: '未收金额', render: (row) => formatMoney(row.unpaidAmount) },
    { key: 'inventoryItems', label: '库存项目', render: (row) => String(toNumber(row.inventoryItems)) },
    { key: 'pendingFollowUps', label: '待随访', render: (row) => String(toNumber(row.pendingFollowUps)) },
  ];

  return (
    <div className="page">
      <h1>多门店经营概览</h1>
      <div className="stat-row">
        <span>患者：{totals.patients}</span>
        <span>预约：{totals.appointments}</span>
        <span>已收：{formatMoney(totals.paidAmount)}</span>
        <span>未收：{formatMoney(totals.unpaidAmount)}</span>
      </div>
      <DataTable columns={columns} rows={rows} keyField="clinicId" emptyText="暂无诊所数据" />
    </div>
  );
}

function toNumber(value: unknown): number {
  return Number(value ?? 0);
}
