import { useState, type FormEvent } from 'react';
import { apiRequest } from '../../lib/api';
import { Dialog } from '../../components';
import { formatMoney, toCents } from '../../lib/format';
import { errorMessage } from '../../lib/messages';
import type { ToastKind } from '../../lib/toast-context';

interface MemberCardQuoteDialogProps {
  open: boolean;
  cardId: string | null;
  onClose: () => void;
  showToast: (message: string, kind?: ToastKind) => void;
}

export function MemberCardQuoteDialog({ open, cardId, onClose, showToast }: MemberCardQuoteDialogProps) {
  const [quoteValue, setQuoteValue] = useState('');
  const [quoteResult, setQuoteResult] = useState<Record<string, unknown> | null>(null);
  const [quoteBusy, setQuoteBusy] = useState(false);

  async function runQuote(event: FormEvent) {
    event.preventDefault();
    if (!cardId || quoteBusy) return;
    const value = Number(quoteValue || 0);
    if (!Number.isFinite(value) || value < 0) {
      showToast('请输入有效金额', 'error');
      return;
    }
    setQuoteBusy(true);
    try {
      const data = await apiRequest<Record<string, unknown>>(`/member-cards/${cardId}/quote`, {
        method: 'POST',
        body: JSON.stringify({ baseTotal: toCents(value) }),
      });
      setQuoteResult(data);
    } catch (error) {
      showToast(errorMessage(error, '报价试算失败'), 'error');
    } finally {
      setQuoteBusy(false);
    }
  }

  return (
    <Dialog open={open} title="报价试算" onClose={onClose}>
      <form onSubmit={runQuote}>
        <label>
          原价金额（元）
          <input type="number" min="0" value={quoteValue} onChange={(event) => { setQuoteValue(event.target.value); setQuoteResult(null); }} />
        </label>
        {quoteResult && (quoteResult.applied === false ? (
          <p className="error">该卡无折扣方案</p>
        ) : (
          <div className="quote-result">
            <p>折后应付：{formatMoney(quoteResult.total)}</p>
            <p>优惠：{formatMoney(quoteResult.discount)}</p>
            <p>年度剩余：{formatMoney(quoteResult.annualRemaining)}</p>
          </div>
        ))}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>取消</button>
          <button type="submit" disabled={quoteBusy}>试算</button>
        </div>
      </form>
    </Dialog>
  );
}
