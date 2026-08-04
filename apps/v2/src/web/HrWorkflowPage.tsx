import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api';
import type { Page } from './types';

export function HrWorkflowPage() {
  const [message, setMessage] = useState('');
  const leaves = useQuery({
    queryKey: ['leaves'],
    queryFn: () => apiRequest<Page<Record<string, unknown>>>('/resources/leaveRequests?page=1&pageSize=100'),
  });

  async function approve(id: string, approved: boolean) {
    await apiRequest(`/hr/leaves/${id}/approve`, {
      method: 'PATCH',
      body: JSON.stringify({ approved }),
    });
    setMessage(approved ? '已批准' : '已驳回');
    await leaves.refetch();
  }

  return (
    <div className="page">
      <h1>人事审批</h1>
      {message && <p className="info">{message}</p>}
      <div className="table-wrap">
        <table>
          <thead><tr><th>ID</th><th>User</th><th>Dates</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {leaves.data?.items.filter((row) => String(row.status) === 'PENDING').map((row) => (
              <tr key={String(row.id)}>
                <td>{String(row.id).slice(0, 8)}</td>
                <td>{String(row.userId ?? '')}</td>
                <td>{String(row.startDate ?? '')} - {String(row.endDate ?? '')}</td>
                <td>{String(row.status ?? '')}</td>
                <td>
                  <button onClick={() => approve(String(row.id), true)}>批准</button>
                  <button className="danger" onClick={() => approve(String(row.id), false)}>驳回</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
