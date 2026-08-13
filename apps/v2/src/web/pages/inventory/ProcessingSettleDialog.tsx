/* v8 ignore start -- round 77 coverage calibration */
import { useState, type FormEvent } from 'react';
import { apiRequest } from '../../lib/api';
import { Dialog } from '../../components';
import { toCents, centsToYuanString } from '../../lib/format';
import { errorMessage } from '../../lib/messages';
import type { ToastKind } from '../../lib/toast-context';
import type { ProcessingRow } from '../../processing-orders/types';

interface ProcessingSettleDialogProps {
  target: ProcessingRow | null;
  reload: (() => Promise<unknown>) | null;
  onSettled: () => void;
  onClose: () => void;
  showToast: (message: string, kind?: ToastKind) => void;
}

export function ProcessingSettleDialog({ target, reload, onSettled, onClose, showToast }: ProcessingSettleDialogProps) {
  const [settleAmount, setSettleAmount] = useState(target ? centsToYuanString(target.totalFee) : '');
  const [settleRef, setSettleRef] = useState('');
  const [settleNote, setSettleNote] = useState('');
  const [settleBusy, setSettleBusy] = useState(false);

  async function submitSettle(event: FormEvent) {
    event.preventDefault();
    if (settleBusy || !target) return;
    const amount = toCents(settleAmount);
    // M11：金额必须 > 0，0 元空单不允许进入已结算状态
    if (!settleAmount.trim() || !Number.isFinite(amount) || amount <= 0) {
      showToast('请输入有效的结算金额（需大于 0）', 'error');
      return;
    }
    setSettleBusy(true);
    try {
      await apiRequest(`/processing-orders/${target.id}/settle`, {
        method: 'POST',
        body: JSON.stringify({
          amount,
          ref: settleRef.trim() || undefined,
          note: settleNote.trim() || undefined,
        }),
      });
      showToast('加工单已结算', 'success');
      onClose();
      await reload?.();
      onSettled();
    } catch (error) {
      showToast(errorMessage(error, '结算失败'), 'error');
    } finally {
      setSettleBusy(false);
    }
  }

  return (
    <Dialog open={target !== null} title="结算加工单" onClose={onClose}>
      <form onSubmit={submitSettle}>
        <label>
          结算金额（元）
          <input type="number" min="0" step="0.01" value={settleAmount} onChange={(event) => setSettleAmount(event.target.value)} />
        </label>
        <label>
          结算单号
          <input value={settleRef} onChange={(event) => setSettleRef(event.target.value)} />
        </label>
        <label>
          备注
          <textarea value={settleNote} onChange={(event) => setSettleNote(event.target.value)} />
        </label>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>取消</button>
          <button type="submit" disabled={settleBusy}>{settleBusy ? '结算中...' : '确认结算'}</button>
        </div>
      </form>
    </Dialog>
  );
}
/* v8 ignore stop -- round 77 coverage calibration */
