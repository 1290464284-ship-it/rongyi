import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { apiRequest } from './api';
import { DataTable, type DataTableColumn } from './components';

export function FollowUpsPage() {
  const [message, setMessage] = useState('');
  const query = useQuery({
    queryKey: ['followup-reminders'],
    queryFn: () => apiRequest<Array<Record<string, unknown>>>('/follow-ups/reminders'),
  });

  async function batchGenerate() {
    try {
      await apiRequest('/follow-ups/batch-generate', { method: 'POST', body: JSON.stringify({ limit: 50 }) });
      setMessage('Batch generation completed');
      await query.refetch();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Batch generation failed');
    }
  }

  async function completeFollowUp(id: string) {
    try {
      await apiRequest(`/follow-ups/${id}/complete`, { method: 'PATCH', body: '{}' });
      setMessage('Follow-up completed');
      await query.refetch();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Follow-up completion failed');
    }
  }

  const columns: DataTableColumn<Record<string, unknown>>[] = [
    {
      key: 'patient',
      label: 'Patient',
      render: (row) => String(row.patientName ?? row.patientId ?? ''),
    },
    { key: 'planDate', label: 'Plan date', render: (row) => String(row.planDate ?? '') },
    { key: 'status', label: 'Status', render: (row) => String(row.status ?? '') },
    { key: 'content', label: 'Content', render: (row) => String(row.content ?? '') },
    {
      key: 'actions',
      label: 'Actions',
      render: (row) => <button onClick={() => completeFollowUp(String(row.id))}>Complete</button>,
    },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <h1>Follow-ups</h1>
        <button onClick={batchGenerate}>Batch generate</button>
      </div>
      {message && <p className="info">{message}</p>}
      <DataTable columns={columns} rows={query.data ?? []} keyField="id" emptyText="No follow-ups" />
    </div>
  );
}
