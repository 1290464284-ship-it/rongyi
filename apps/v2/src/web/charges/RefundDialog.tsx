import type { FormEvent } from 'react';

export function RefundDialog({
  amount,
  setAmount,
  reason,
  setReason,
  busy,
  onClose,
  onSubmit,
}: {
  amount: string;
  setAmount: (value: string) => void;
  reason: string;
  setReason: (value: string) => void;
  busy: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent) => Promise<void>;
}) {
  return (
    <form onSubmit={onSubmit}>
      <label>
        退款金额（元）
        <input type="number" min="0" value={amount} onChange={(event) => setAmount(event.target.value)} />
      </label>
      <label>
        退款原因
        <textarea value={reason} onChange={(event) => setReason(event.target.value)} />
      </label>
      <div className="modal-actions">
        <button type="button" onClick={onClose}>取消</button>
        <button type="submit" disabled={busy}>确认退款</button>
      </div>
    </form>
  );
}
