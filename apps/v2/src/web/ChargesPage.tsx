import { FormEvent, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api';
import type { Page } from './types';
import { DataTable, type DataTableColumn } from './components';

export function ChargesPage() {
  const [patientId, setPatientId] = useState('patient-demo-001');
  const [itemsJson, setItemsJson] = useState('[{"name":"Examination","category":"EXAM","price":100,"quantity":1}]');
  const [message, setMessage] = useState('');
  const query = useQuery({
    queryKey: ['charges'],
    queryFn: () => apiRequest<Page<Record<string, unknown>>>('/resources/charges?page=1&pageSize=20'),
  });

  async function create(event: FormEvent) {
    event.preventDefault();
    try {
      const items = JSON.parse(itemsJson) as Array<Record<string, unknown>>;
      const result = await apiRequest<{ id: string }>('/charges', {
        method: 'POST',
        body: JSON.stringify({ patientId, items }),
      });
      setMessage(`Charge created: ${result.id}`);
      await query.refetch();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Create failed');
    }
  }

  async function pay(id: string) {
    try {
      const amount = Number(prompt('Payment amount (cents)?') ?? 0);
      const requestId = prompt('Request ID (optional)') ?? undefined;
      await apiRequest(`/charges/${id}/pay`, {
        method: 'PATCH',
        body: JSON.stringify({ amount, method: 'CASH', requestId: requestId || undefined }),
      });
      setMessage('Payment recorded');
      await query.refetch();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Payment failed');
    }
  }

  async function refund(id: string) {
    try {
      const amount = Number(prompt('Refund amount (cents)?') ?? 0);
      await apiRequest(`/charges/${id}/refund`, {
        method: 'POST',
        body: JSON.stringify({ amount, reason: 'desktop refund' }),
      });
      setMessage('Refund recorded');
      await query.refetch();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Refund failed');
    }
  }

  const columns: DataTableColumn<Record<string, unknown>>[] = [
    { key: 'id', label: 'ID', render: (row) => String(row.id).slice(0, 8) },
    { key: 'number', label: 'Number', render: (row) => String(row.number ?? '') },
    { key: 'totalAmount', label: 'Total', render: (row) => String(row.totalAmount ?? '') },
    { key: 'paidAmount', label: 'Paid', render: (row) => String(row.paidAmount ?? '') },
    { key: 'status', label: 'Status', render: (row) => String(row.status ?? '') },
    {
      key: 'actions',
      label: 'Action',
      render: (row) => (
        <>
          <button onClick={() => pay(String(row.id))}>Pay</button>
          <button className="danger" onClick={() => refund(String(row.id))}>Refund</button>
        </>
      ),
    },
  ];

  return (
    <div className="page">
      <h1>Charges</h1>
      <form className="inline-form" onSubmit={create}>
        <input value={patientId} onChange={(event) => setPatientId(event.target.value)} />
        <textarea value={itemsJson} onChange={(event) => setItemsJson(event.target.value)} />
        <button type="submit">Create charge</button>
      </form>
      {message && <p className="info">{message}</p>}
      <DataTable columns={columns} rows={query.data?.items ?? []} keyField="id" emptyText="No charges" />
    </div>
  );
}
