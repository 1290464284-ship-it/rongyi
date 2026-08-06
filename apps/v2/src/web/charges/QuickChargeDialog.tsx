import type { FormEvent } from 'react';
import { SearchableSelect } from '../components';
import type { ChargeTreeNode } from './charge-types';

export function QuickChargeDialog({
  target,
  quantity,
  setQuantity,
  patientId,
  setPatientId,
  busy,
  onClose,
  onSubmit,
}: {
  target: ChargeTreeNode | null;
  quantity: string;
  setQuantity: (value: string) => void;
  patientId: string;
  setPatientId: (value: string) => void;
  busy: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent) => Promise<void>;
}) {
  return (
    <form onSubmit={onSubmit}>
      <label>
        项目名
        <input readOnly aria-label="快捷收费项目名" value={target?.name ?? ''} />
      </label>
      <label>
        单价（元）
        <input readOnly aria-label="快捷收费单价" value={target ? (target.price / 100).toString() : ''} />
      </label>
      <label>
        数量
        <input
          type="number"
          min="1"
          step="1"
          aria-label="快捷收费数量"
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
        />
      </label>
      <span>患者</span>
      <SearchableSelect resource="patients" value={patientId} onChange={setPatientId} ariaLabel="快捷收费患者" placeholder="选择患者" />
      <div className="modal-actions">
        <button type="button" onClick={onClose}>取消</button>
        <button type="submit" disabled={busy}>{busy ? '提交中...' : '确认快捷收费'}</button>
      </div>
    </form>
  );
}
