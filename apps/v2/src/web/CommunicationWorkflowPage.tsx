import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api';
import type { Page } from './types';
import { DataTable, type DataTableColumn } from './components';

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

  const columns: DataTableColumn<Record<string, unknown>>[] = [
    { key: 'id', label: 'ID', render: (row) => String(row.id).slice(0, 8) },
    { key: 'patientId', label: 'Patient', render: (row) => String(row.patientId ?? '') },
    { key: 'status', label: 'Status', render: (row) => String(row.status ?? '') },
    {
      key: 'actions',
      label: 'Action',
      render: (row) => <button onClick={() => send(String(row.id))}>发送</button>,
    },
  ];

  return (
    <div className="page">
      <h1>微信消息</h1>
      {message && <p className="info">{message}</p>}
      <DataTable columns={columns} rows={wechat.data?.items ?? []} keyField="id" emptyText="No messages" />
    </div>
  );
}
