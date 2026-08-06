import { useState, type FormEvent } from 'react';
import type { ReactNode } from 'react';
import { apiRequest } from '../api';
import { errorMessage } from '../messages';
import { useToast } from '../toast-context';
import { FOLLOW_UP_LABELS, type PlanRow } from './plan-types';

export function FollowUpDialog({
  plan,
  onClose,
  onSaved,
}: {
  plan: PlanRow;
  onClose: () => void;
  onSaved: () => Promise<unknown>;
}): ReactNode {
  const { showToast } = useToast();
  const [status, setStatus] = useState(String(plan.followUpStatus ?? 'NONE'));
  const [nextDate, setNextDate] = useState(String(plan.nextFollowUpAt ?? ''));
  const [note, setNote] = useState(String(plan.trackingNote ?? ''));
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    try {
      await apiRequest(`/treatment-plans/${plan.id}/follow-up`, {
        method: 'POST',
        body: JSON.stringify({
          followUpStatus: status,
          nextFollowUpAt: nextDate.trim() || undefined,
          trackingNote: note.trim() || undefined,
        }),
      });
      showToast('回访信息已保存', 'success');
      await onSaved();
      onClose();
    } catch (error) {
      showToast(errorMessage(error, '保存回访失败'), 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <label>
        回访状态
        <select aria-label="回访状态" value={status} onChange={(event) => setStatus(event.target.value)}>
          {Object.entries(FOLLOW_UP_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </label>
      <label>
        下次回访时间
        <input aria-label="下次回访时间" type="date" value={nextDate} onChange={(event) => setNextDate(event.target.value)} />
      </label>
      <label>
        回访备注
        <textarea aria-label="回访备注" value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      <div className="modal-actions">
        <button type="button" onClick={onClose}>取消</button>
        <button type="submit" disabled={submitting}>{submitting ? '保存中...' : '保存'}</button>
      </div>
    </form>
  );
}
