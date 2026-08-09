import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../../lib/api';
import { errorMessage } from '../../lib/messages';
import { useToast } from '../../lib/toast-context';

interface ReminderConfig {
  enabled: boolean;
  appointmentDaysBefore: number;
  recallDaysAfter: number;
  firstExamDaysAfter: number;
}

const EMPTY_FORM: ReminderConfig = {
  enabled: true,
  appointmentDaysBefore: 1,
  recallDaysAfter: 3,
  firstExamDaysAfter: 3,
};

export function WechatReminderSettings() {
  const query = useQuery({
    queryKey: ['wechat-reminder-config'],
    queryFn: () => apiRequest<ReminderConfig>('/wechat-reminders/config'),
  });

  if (query.isLoading) {
    return <div className="reminder-muted">提醒设置加载中...</div>;
  }

  return (
    <ReminderSettingsForm
      initialConfig={query.data ?? EMPTY_FORM}
      onSaved={() => query.refetch()}
    />
  );
}

function ReminderSettingsForm({ initialConfig, onSaved }: {
  initialConfig: ReminderConfig;
  onSaved: () => Promise<unknown>;
}) {
  const { showToast } = useToast();
  const [form, setForm] = useState<ReminderConfig>(initialConfig);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await apiRequest('/wechat-reminders/config', {
        method: 'PATCH',
        body: JSON.stringify(form),
      });
      showToast('提醒设置已保存', 'success');
      await onSaved();
    } catch (error) {
      showToast(errorMessage(error, '保存提醒设置失败'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="wechat-reminder-settings">
      <h2>提醒设置</h2>
      <div className="wechat-reminder-settings-grid">
        <label>
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(event) => setForm((current) => ({ ...current, enabled: event.target.checked }))}
          />
          启用提醒
        </label>
        <label>
          复诊提前提醒天数
          <input
            type="number"
            min={0}
            max={365}
            value={form.appointmentDaysBefore}
            onChange={(event) => setForm((current) => ({ ...current, appointmentDaysBefore: Number(event.target.value) }))}
          />
        </label>
        <label>
          治疗回访延迟天数
          <input
            type="number"
            min={0}
            max={365}
            value={form.recallDaysAfter}
            onChange={(event) => setForm((current) => ({ ...current, recallDaysAfter: Number(event.target.value) }))}
          />
        </label>
        <label>
          首诊跟进延迟天数
          <input
            type="number"
            min={0}
            max={365}
            value={form.firstExamDaysAfter}
            onChange={(event) => setForm((current) => ({ ...current, firstExamDaysAfter: Number(event.target.value) }))}
          />
        </label>
        <button type="button" disabled={busy} onClick={() => void save()}>
          {busy ? '保存中...' : '保存设置'}
        </button>
      </div>
    </section>
  );
}
