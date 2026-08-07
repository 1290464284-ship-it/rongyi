import { EmptyState, LoadingState } from '../components';
import type { ChargeComboRow } from './charge-types';

export function ComboDialog({
  combos,
  onClose,
  onApply,
}: {
  combos: ChargeComboRow[] | null;
  onClose: () => void;
  onApply: (combo: ChargeComboRow) => void;
}) {
  return combos === null ? (
    <LoadingState />
  ) : combos.length === 0 ? (
    <EmptyState message="暂无可用收费组合" />
  ) : (
    <>
      <div className="combo-list">
        {combos.map((combo) => (
          <div className="charge-item-row" style={{ gridTemplateColumns: '2fr 1fr 72px 72px 72px' }} key={combo.id}>
            <span>{combo.name}</span>
            <span>{combo.code}</span>
            <span>{combo.items?.length ?? 0} 项</span>
            <span>{combo.type === 'PUBLIC' ? '公共' : '私有'}</span>
            <button type="button" aria-label={`载入组合 ${combo.name}`} onClick={() => onApply(combo)}>载入</button>
          </div>
        ))}
      </div>
      <div className="modal-actions">
        <button type="button" onClick={onClose}>取消</button>
      </div>
    </>
  );
}
