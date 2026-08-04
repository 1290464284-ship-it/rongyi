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
      const result = prompt('完成结果（可选）') ?? '';
      await apiRequest(`/follow-ups/${id}/complete`, {
        method: 'PATCH',
        body: JSON.stringify({ result: result.trim() || undefined }),
      });
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

  const now = new Date();
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const rows = query.data ?? [];
  const groups = [
    { title: '已逾期', rows: rows.filter((row) => String(row.planDate ?? '') < todayKey) },
    { title: '今日待随访', rows: rows.filter((row) => String(row.planDate ?? '') === todayKey) },
    { title: '后续待随访', rows: rows.filter((row) => String(row.planDate ?? '') > todayKey) },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <h1>Follow-ups</h1>
        <button onClick={batchGenerate}>Batch generate</button>
      </div>
      {message && <p className="info">{message}</p>}
      {rows.length === 0 && <DataTable columns={columns} rows={[]} keyField="id" emptyText="No follow-ups" />}
      {groups.map((group) => (
        <section key={group.title}>
          <h2>{group.title} ({group.rows.length})</h2>
          <DataTable columns={columns} rows={group.rows} keyField="id" emptyText="暂无" />
        </section>
      ))}
    </div>
  );
}
