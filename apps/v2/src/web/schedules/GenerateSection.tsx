import { useState, type FormEvent } from 'react';
import { apiRequest } from '../lib/api';
import { errorMessage } from '../lib/messages';
import { useToast } from '../lib/toast-context';
import { formatWorkDays, mondayOf } from './format';
import type { GenerateResult, ShiftTemplate, UserRow } from './types';

export function GenerateSection({
  templates,
  users,
  weekStart,
  onWeekStartChange,
  onGenerated,
}: {
  templates?: ShiftTemplate[];
  users?: UserRow[];
  weekStart: string;
  onWeekStartChange: (value: string) => void;
  onGenerated: () => Promise<unknown>;
}) {
  const { showToast } = useToast();
  const [templateId, setTemplateId] = useState('');
  const [userId, setUserId] = useState('');
  const [generating, setGenerating] = useState(false);

  async function handleGenerate(event: FormEvent) {
    event.preventDefault();
    if (!templateId || !userId || !weekStart) {
      showToast('请选择用户、模板和周', 'error');
      return;
    }
    setGenerating(true);
    try {
      const result = await apiRequest<GenerateResult>('/shift-templates/generate', {
        method: 'POST',
        body: JSON.stringify({ templateId, userId, weekStart }),
      });
      showToast(`已生成 ${result.created} 条固定排班${result.skipped > 0 ? `，跳过 ${result.skipped} 条已存在` : ''}`, 'success');
      await onGenerated();
    } catch (error) {
      showToast(errorMessage(error, '生成排班失败'), 'error');
    } finally {
      setGenerating(false);
    }
  }

  return (
    <section aria-label="固定排班">
      <h2>固定排班</h2>
      <form className="form-grid" onSubmit={handleGenerate}>
        <label>
          用户
          <select aria-label="选择用户" value={userId} onChange={(event) => setUserId(event.target.value)}>
            <option value="">选择用户</option>
            {(users ?? []).map((user) => (
              <option key={user.id} value={user.id}>{user.name ?? user.username ?? user.id}</option>
            ))}
          </select>
        </label>
        <label>
          排班模板
          <select aria-label="选择模板" value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
            <option value="">选择模板</option>
            {(templates ?? []).map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}（{formatWorkDays(template.workDays ?? [])} {template.startTime}-{template.endTime}）
              </option>
            ))}
          </select>
        </label>
        <label>
          周（自动取所在周的周一）
          <input aria-label="选择周" type="date" value={weekStart} onChange={(event) => {
            const picked = event.target.value;
            onWeekStartChange(picked ? mondayOf(new Date(`${picked}T00:00:00`)) : mondayOf(new Date()));
          }} />
        </label>
        <button type="submit" disabled={generating}>{generating ? '生成中...' : '生成固定排班'}</button>
      </form>
    </section>
  );
}
