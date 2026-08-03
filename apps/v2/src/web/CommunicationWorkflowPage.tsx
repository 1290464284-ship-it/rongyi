import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api';

interface Page<T> { items: T[]; total: number; page: number; pageSize: number; }

export function CommunicationWorkflowPage() {
  const [message, setMessage] = useState('');
  const wechat = useQuery({
    queryKey: ['wechat-workflow'],
    queryFn: () => apiRequest<Page<Record<string, unknown>>>('/resources/wechatMessages?page=1&pageSize=100'),
  });

  async function send(id: string) {
    try {
      await apiRequest(`/wechat/${id}/send`, { method: 'POST', body: JSON.stringify({}) });
      setMessage('已发送');
      await wechat.refetch();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '发送失败');
    }
  }

  return (
    <div className="page">
      <h1>微信消息</h1>
      {message && <p className="info">{message}</p>}
      <div className="table-wrap">
        <table>
          <thead><tr><th>ID</th><th>Patient</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>
            {wechat.data?.items.map((row) => (
              <tr key={String(row.id)}>
                <td>{String(row.id).slice(0, 8)}</td>
                <td>{String(row.patientId ?? '')}</td>
                <td>{String(row.status ?? '')}</td>
                <td><button onClick={() => send(String(row.id))}>发送</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

