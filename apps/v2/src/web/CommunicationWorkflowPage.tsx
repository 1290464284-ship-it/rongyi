import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api';
import type { Page } from './types';
import { DataTable, LoadingState, PageError, type DataTableColumn } from './components';
import { errorMessage } from './messages';
import { useToast } from './toast-context';

interface ReminderItem {
  id: string;
  patientId: string;
  patientName: string | null;
  patientPhone: string | null;
  scene: string;
  sceneLabel: string;
  scheduledDate: string;
  sourceId: string | null;
  content: string;
  status: string;
}

interface ReminderConfig {
  enabled: boolean;
  appointmentDaysBefore: number;
  recallDaysAfter: number;
  firstExamDaysAfter: number;
}

interface RemindersData {
  date: string;
  config: ReminderConfig;
  items: ReminderItem[];
}

function reminderTagClass(scene: string): string {
  if (scene === 'TREATMENT_RECALL') return 'tag recall';
  if (scene === 'FIRST_EXAM_NUDGE') return 'tag nudge';
  return 'tag';
}

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
  const reminders = useQuery({
    queryKey: ['wechat-reminders', 'today'],
    queryFn: () => apiRequest<RemindersData>('/wechat-reminders/today'),
  });

  if (wechat.isLoading || status.isLoading || reminders.isLoading) return <LoadingState label="微信消息加载中..." />;
  const loadError = wechat.error ?? status.error ?? reminders.error;
  if (loadError) {
    return (
      <div className="page">
        <PageError message={loadError instanceof Error ? loadError.message : String(loadError)} />
        <button onClick={() => {
          void wechat.refetch();
          void status.refetch();
          void reminders.refetch();
        }}>重试</button>
      </div>
    );
  }

  async function send(id: string) {
    try {
      await apiRequest(`/wechat/${id}/send`, { method: 'POST', body: JSON.stringify({}) });
      showToast('已发送', 'success');
      await wechat.refetch();
    } catch (error) {
      showToast(errorMessage(error, '发送失败'), 'error');
    }
  }

  async function copyReminderContent(content: string) {
    try {
      await navigator.clipboard.writeText(content);
      showToast('话术已复制', 'success');
    } catch {
      showToast('复制失败，请手动选择复制', 'error');
    }
  }

  async function markReminderSent(id: string) {
    try {
      await apiRequest(`/wechat-reminders/${id}/mark-sent`, { method: 'POST', body: JSON.stringify({}) });
      showToast('已记录发送', 'success');
      await reminders.refetch();
      await wechat.refetch();
    } catch (error) {
      showToast(errorMessage(error, '操作失败'), 'error');
    }
  }

  async function dismissReminder(id: string) {
    try {
      await apiRequest(`/wechat-reminders/${id}/dismiss`, { method: 'POST', body: JSON.stringify({}) });
      showToast('已忽略', 'success');
      await reminders.refetch();
    } catch (error) {
      showToast(errorMessage(error, '操作失败'), 'error');
    }
  }

  const reminderData = reminders.data;
  const items = reminderData?.items ?? [];
  const config = reminderData?.config;

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

      <h2>今日微信提醒</h2>
      <p className="reminder-muted">
        {config?.enabled === false
          ? '提醒已停用（设置 wechatReminder.enabled=false）。'
          : `自动规则：复诊提醒（提前 ${config?.appointmentDaysBefore ?? 1} 天）、治疗后回访（${config?.recallDaysAfter ?? 3} 天后）、首诊跟进（${config?.firstExamDaysAfter ?? 3} 天后）。发完微信后点"已发微信"留痕。`}
      </p>
      {items.length === 0 ? (
        <div className="reminder-empty">今日无待发提醒</div>
      ) : (
        <div className="reminder-list">
          {items.map((item) => (
            <div className="reminder-card" key={item.id}>
              <div className="reminder-head">
                <strong>{item.patientName ?? ''}</strong>
                {item.patientPhone ? <span className="reminder-muted">{item.patientPhone}</span> : null}
                <span className={reminderTagClass(item.scene)}>{item.sceneLabel}</span>
              </div>
              <p className="reminder-content">{item.content}</p>
              <div className="reminder-actions">
                <button onClick={() => void copyReminderContent(item.content)}>复制话术</button>
                <button onClick={() => void markReminderSent(item.id)}>已发微信</button>
                <button onClick={() => void dismissReminder(item.id)}>忽略</button>
              </div>
            </div>
          ))}
        </div>
      )}

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
