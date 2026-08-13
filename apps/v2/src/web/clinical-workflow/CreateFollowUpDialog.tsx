import { useState, type FormEvent } from 'react';
import { apiRequest } from '../lib/api';
import { Dialog } from '../components';
import { errorMessage } from '../lib/messages';
import { useToast } from '../lib/toast-context';
import { rowPatientName, type RegistrationRow } from './types';

export function CreateFollowUpDialog({
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
  // 默认随访日期在挂载时计算一次（惰性初始化，避免渲染期调用 Date.now 的非纯函数）
  const [planDate, setPlanDate] = useState(() => {
    const date = new Date(Date.now() + 7 * 86_400_000);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  });
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
        body: JSON.stringify({ patientId, planDate, content: content || undefined }),
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
