import type { FormEvent } from 'react';
import { METHOD_LABELS, type PayMethodNode } from './types';

export function PaymentDialog({
  amount,
  setAmount,
  method,
  setMethod,
  setMethodRoot,
  busy,
  onClose,
  onSubmit,
  payTreeLoaded,
  payRoots,
  payLeafOptions,
  effectivePayRoot,
  effectivePayLeaf,
}: {
  amount: string;
  setAmount: (value: string) => void;
  method: string;
  setMethod: (value: string) => void;
  methodRoot: string;
  setMethodRoot: (value: string) => void;
  busy: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent) => Promise<void>;
  payTreeLoaded: boolean;
  payRoots: PayMethodNode[];
  payLeafOptions: PayMethodNode[];
  effectivePayRoot: string;
  effectivePayLeaf: string;
}) {
  return (
    <form onSubmit={onSubmit}>
      <label>
        收款金额（元）
        <input type="number" min="0" value={amount} onChange={(event) => setAmount(event.target.value)} />
      </label>
      {payTreeLoaded ? (
        <>
          <label>
            支付方式大类
            <select aria-label="支付方式大类" value={effectivePayRoot} onChange={(event) => setMethodRoot(event.target.value)}>
              {payRoots.map((node) => (
                <option key={node.id} value={node.id}>{node.name}</option>
              ))}
            </select>
          </label>
          <label>
            支付方式
            <select aria-label="支付方式" value={effectivePayLeaf} onChange={(event) => setMethod(event.target.value)}>
              {payLeafOptions.map((node) => (
                <option key={node.id} value={node.id}>{node.name}</option>
              ))}
            </select>
          </label>
        </>
      ) : (
        <label>
          支付方式
          <select value={method} onChange={(event) => setMethod(event.target.value)}>
            {Object.entries(METHOD_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
      )}
      <div className="modal-actions">
        <button type="button" onClick={onClose}>取消</button>
        <button type="submit" disabled={busy}>确认收款</button>
      </div>
    </form>
  );
}
