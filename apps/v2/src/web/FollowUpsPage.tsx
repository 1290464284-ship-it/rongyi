import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { apiRequest, downloadCsvPath } from './api';
import { DataTable, type DataTableColumn } from './components';

export function FollowUpsPage() {
  const [message, setMessage] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const query = useQuery({
    queryKey: ['followup-reminders'],
    queryFn: () => apiRequest<Array<Record<string, unknown>>>('/follow-ups/reminders'),
  });
  const summary = useQuery({
    queryKey: ['followup-summary'],
    queryFn: () => apiRequest<{ total: number; overdue: number; today: number; upcoming: number }>('/follow-ups/reminders/summary'),
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

  async function completeSelected() {
    try {
      const result = prompt('\u5b8c\u6210\u7ed3\u679c\uff08\u53ef\u9009\uff09') ?? '';
      const data = await apiRequest<{ completed: number; skipped: number; errors: string[] }>(
        '/follow-ups/batch-complete',
        {
          method: 'POST',
          body: JSON.stringify({ ids: selectedIds, result: result.trim() || undefined }),
        },
      );
      setMessage(`Completed ${data.completed}, skipped ${data.skipped}`);
      setSelectedIds([]);
      await Promise.all([query.refetch(), summary.refetch()]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Batch completion failed');
    }
  }

  async function exportOverdue() {
    try {
      await downloadCsvPath('/follow-ups/reminders/export?scope=overdue', 'overdue-follow-ups.csv');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Export failed');
    }
  }

  const columns: DataTableColumn<Record<string, unknown>>[] = [
    {
      key: 'selected',
      label: 'Select',
      render: (row) => (
        <input
          type="checkbox"
          checked={selectedIds.includes(String(row.id))}
          onChange={(event) => {
            const id = String(row.id);
            setSelectedIds((current) => event.target.checked ? [...current, id] : current.filter((item) => item !== id));
          }}
        />
      ),
    },
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
        <button onClick={completeSelected} disabled={selectedIds.length === 0}>Complete selected</button>
        <button onClick={exportOverdue}>Export overdue</button>
      </div>
      {message && <p className="info">{message}</p>}
      {summary.data && (
        <div className="stat-row">
          <span>Total: {summary.data.total}</span>
          <span>Overdue: {summary.data.overdue}</span>
          <span>Today: {summary.data.today}</span>
          <span>Upcoming: {summary.data.upcoming}</span>
        </div>
      )}
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
