import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { apiRequest } from './api';

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

  return (
    <div className="page">
      <div className="page-head">
        <h1>Follow-ups</h1>
        <button onClick={batchGenerate}>Batch generate</button>
      </div>
      {message && <p className="info">{message}</p>}
      <div className="table-wrap">
        <table>
          <thead><tr><th>Patient</th><th>Plan date</th><th>Status</th><th>Content</th><th>Actions</th></tr></thead>
          <tbody>
            {query.data?.map((row) => (
              <tr key={String(row.id)}>
                <td>{String(row.patientName ?? row.patientId ?? '')}</td>
                <td>{String(row.planDate ?? '')}</td>
                <td>{String(row.status ?? '')}</td>
                <td>{String(row.content ?? '')}</td>
                <td>
                  <button onClick={() => completeFollowUp(String(row.id))}>Complete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
