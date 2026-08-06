import { useState, type FormEvent } from 'react';
import { apiRequest } from '../api';
import { Dialog } from '../components';
import { errorMessage } from '../messages';
import { useToast } from '../toast-context';
import { rowPatientName, type RegistrationRow } from './types';

export function FollowUpDialog({
  row,
  onClose,
  onSaved,
}: {
  row: RegistrationRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { showToast } = useToast();
  const patientId = String(row.patientId ?? '');
  const patientName = rowPatientName(row);
  const defaultPlanDate = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  const [planDate, setPlanDate] = useState(defaultPlanDate);
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!planDate) {
      showToast('请选择随访日期', 'error');
      return;
    }
    setBusy(true);
    try {
      await apiRequest('/resources/followUps', {
        method: 'POST',
        body: JSON.stringify({ patientId, planDate, content: content || undefined, status: 'PENDING' }),
      });
      showToast('回访已创建', 'success');
      onSaved();
      onClose();
    } catch (error) {
      showToast(errorMessage(error, '创建回访失败'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open title="新建回访" onClose={onClose}>
      <form onSubmit={submit}>
        <label>
          患者
          <input readOnly value={patientName} aria-label="患者" />
        </label>
        <label>
          随访日期
          <input type="date" value={planDate} onChange={(event) => setPlanDate(event.target.value)} />
        </label>
        <label>
          内容
          <textarea value={content} onChange={(event) => setContent(event.target.value)} />
        </label>
        <label>
          状态
          <input readOnly value="PENDING" aria-label="状态" />
        </label>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>取消</button>
          <button type="submit" disabled={busy}>提交回访</button>
        </div>
      </form>
    </Dialog>
  );
}
