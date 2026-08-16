import { useRef, useState, type FormEvent } from 'react';
import { apiRequest } from '../lib/api';
import { Dialog } from '../components';
import { errorMessage } from '../lib/messages';
import { useToast } from '../lib/toast-context';
import { FOLLOW_UP_STATUS_LABELS } from './constants';
import type { FirstExamRow } from './types';

interface TrackingForm {
  followUpStatus: string;
  lossReasonType: string;
  lossReason: string;
  nextFollowUpAt: string;
  trackingNote: string;
}

export function TrackingDialog({
  row,
  reload,
  refetchOverview,
  onClose,
}: {
  row: FirstExamRow;
  reload: () => Promise<unknown>;
  refetchOverview: () => void;
  onClose: () => void;
}) {
  const { showToast } = useToast();
  const [form, setForm] = useState<TrackingForm>({
    followUpStatus: String(row.followUpStatus ?? 'NONE'),
    lossReasonType: '',
    lossReason: '',
    nextFollowUpAt: '',
    trackingNote: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const update = (patch: Partial<TrackingForm>) => setForm((current) => ({ ...current, ...patch }));

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      await apiRequest(`/first-exams/${row.id}/tracking`, {
        method: 'PATCH',
        body: JSON.stringify({
          followUpStatus: form.followUpStatus,
          lossReasonType: form.lossReasonType || undefined,
          lossReason: form.lossReason || undefined,
          nextFollowUpAt: form.nextFollowUpAt || undefined,
          trackingNote: form.trackingNote || undefined,
        }),
      });
      showToast('追踪状态已更新', 'success');
      await reload();
      refetchOverview();
      onClose();
    } catch (error) {
      showToast(errorMessage(error, '更新失败'), 'error');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  const needsLossReason = form.followUpStatus === 'LOST';
  const needsNextFollowUp = form.followUpStatus === 'PENDING' || form.followUpStatus === 'HORIZONTAL_SHOULD';

  return (
    <Dialog open title="首诊追踪" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <label>
          追踪状态
          <select
            aria-label="追踪状态"
            value={form.followUpStatus}
            onChange={(event) => update({ followUpStatus: event.target.value })}
          >
            {Object.entries(FOLLOW_UP_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        {needsLossReason && (
          <>
            <label>
              流失原因类型
              <input
                aria-label="流失原因类型"
                value={form.lossReasonType}
                onChange={(event) => update({ lossReasonType: event.target.value })}
                placeholder="如 COST / TRUST / TIME / OTHER 或自由文本"
              />
            </label>
            <label>
              流失原因
              <textarea aria-label="流失原因" value={form.lossReason} onChange={(event) => update({ lossReason: event.target.value })} />
            </label>
          </>
        )}
        {needsNextFollowUp && (
          <label>
            下次跟进日期
            <input
              type="date"
              aria-label="下次跟进日期"
              value={form.nextFollowUpAt}
              onChange={(event) => update({ nextFollowUpAt: event.target.value })}
            />
          </label>
        )}
        <label>
          追踪备注
          <textarea aria-label="追踪备注" value={form.trackingNote} onChange={(event) => update({ trackingNote: event.target.value })} />
        </label>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>取消</button>
          <button type="submit" disabled={submitting}>{submitting ? '保存中...' : '保存'}</button>
        </div>
      </form>
    </Dialog>
  );
}
