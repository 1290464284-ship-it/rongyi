import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api';
import type { Page } from './types';
import { DataTable, type DataTableColumn } from './components';

export function HrWorkflowPage() {
  const [message, setMessage] = useState('');
  const leaves = useQuery({
    queryKey: ['leaves'],
    queryFn: () => apiRequest<Page<Record<string, unknown>>>('/resources/leaveRequests?page=1&pageSize=100'),
  });

  async function approve(id: string, approved: boolean) {
    try {
      await apiRequest(`/hr/leaves/${id}/approve`, {
        method: 'PATCH',
        body: JSON.stringify({ approved }),
      });
      setMessage(approved ? '已批准' : '已驳回');
      await leaves.refetch();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '审批失败');
    }
  }

  const columns: DataTableColumn<Record<string, unknown>>[] = [
    { key: 'id', label: 'ID', render: (row) => String(row.id).slice(0, 8) },
    { key: 'userId', label: 'User', render: (row) => String(row.userId ?? '') },
    {
      key: 'dates',
      label: 'Dates',
      render: (row) => `${String(row.startDate ?? '')} - ${String(row.endDate ?? '')}`,
    },
    { key: 'status', label: 'Status', render: (row) => String(row.status ?? '') },
    {
      key: 'actions',
      label: 'Actions',
      render: (row) => (
        <>
          <button onClick={() => approve(String(row.id), true)}>批准</button>
          <button className="danger" onClick={() => approve(String(row.id), false)}>驳回</button>
        </>
      ),
    },
  ];

  return (
    <div className="page">
      <h1>人事审批</h1>
      {message && <p className="info">{message}</p>}
      <DataTable
        columns={columns}
        rows={leaves.data?.items.filter((row) => String(row.status) === 'PENDING') ?? []}
        keyField="id"
        emptyText="No pending leaves"
      />
    </div>
  );
}
