import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api';
import type { Page } from './types';
import { DataTable, type DataTableColumn } from './components';
import { errorMessage } from './messages';
import { useToast } from './toast-context';

export function CommunicationWorkflowPage() {
  const { showToast } = useToast();
  const wechat = useQuery({
    queryKey: ['wechat-workflow'],
    queryFn: () => apiRequest<Page<Record<string, unknown>>>('/resources/wechatMessages?page=1&pageSize=100'),
  });
  const status = useQuery({
    queryKey: ['wechat-status'],
    queryFn: () => apiRequest<{ configured: boolean; provider: string }>('/wechat/status'),
  });

  async function send(id: string) {
    try {
      await apiRequest(`/wechat/${id}/send`, { method: 'POST', body: JSON.stringify({}) });
      showToast('已发送', 'success');
      await wechat.refetch();
    } catch (error) {
      showToast(errorMessage(error, '发送失败'), 'error');
    }
  }

  const columns: DataTableColumn<Record<string, unknown>>[] = [
    { key: 'patient', label: '患者', render: (row) => String(row.patientName ?? row.patientId ?? '') },
    { key: 'type', label: '类型', render: (row) => String(row.type ?? '') },
    { key: 'content', label: '内容', render: (row) => String(row.content ?? '') },
    { key: 'status', label: '状态', render: (row) => String(row.status ?? '') },
    {
      key: 'actions',
      label: '操作',
      render: (row) => (
        <button disabled={status.data?.configured === false} onClick={() => void send(String(row.id))}>
          发送
        </button>
      ),
    },
  ];

  return (
    <div className="page">
      <h1>微信消息</h1>
      <div className="stat-row">
        <span className={status.data?.configured ? undefined : 'error'}>
          {status.data?.configured === false ? '微信通道未开通，发送按钮已禁用' : '微信通道已开通'}
        </span>
        {status.data?.configured === false && <small>请配置 V2_WECHAT_API_URL、V2_WECHAT_APP_ID、V2_WECHAT_APP_SECRET</small>}
      </div>
      <DataTable columns={columns} rows={wechat.data?.items ?? []} keyField="id" emptyText="暂无微信消息" />
    </div>
  );
}
