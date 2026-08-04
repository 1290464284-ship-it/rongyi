import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api';
import { DataTable, type DataTableColumn } from './components';

export function ClinicOverviewPage() {
  const query = useQuery({
    queryKey: ['clinic-overview'],
    queryFn: () => apiRequest<Array<Record<string, unknown>>>('/analytics/clinic-overview'),
  });

  if (query.isLoading) return <div className="page">Loading...</div>;
  if (query.error || !query.data) {
    return <div className="page error">{(query.error as Error)?.message ?? 'Failed to load clinic overview'}</div>;
  }

  const rows = query.data;
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
    { key: 'clinicName', label: 'Clinic', render: (row) => String(row.clinicName ?? row.clinicId ?? '') },
    { key: 'patients', label: 'Patients', render: (row) => String(toNumber(row.patients)) },
    { key: 'appointments', label: 'Appointments', render: (row) => String(toNumber(row.appointments)) },
    { key: 'charges', label: 'Charges', render: (row) => String(toNumber(row.charges)) },
    { key: 'paidAmount', label: 'Paid', render: (row) => String(toNumber(row.paidAmount)) },
    { key: 'unpaidAmount', label: 'Unpaid', render: (row) => String(toNumber(row.unpaidAmount)) },
    { key: 'inventoryItems', label: 'Inventory', render: (row) => String(toNumber(row.inventoryItems)) },
    { key: 'pendingFollowUps', label: 'Follow-ups', render: (row) => String(toNumber(row.pendingFollowUps)) },
  ];

  return (
    <div className="page">
      <h1>Clinic Overview</h1>
      <div className="stat-row">
        <span>Patients: {totals.patients}</span>
        <span>Appointments: {totals.appointments}</span>
        <span>Paid: {totals.paidAmount}</span>
        <span>Unpaid: {totals.unpaidAmount}</span>
      </div>
      <DataTable columns={columns} rows={rows} keyField="clinicId" emptyText="No clinic data" />
    </div>
  );
}

function toNumber(value: unknown): number {
  return Number(value ?? 0);
}
