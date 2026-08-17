import { useState } from 'react';
import { useAsyncAction } from '../../hooks/use-async-action';

/** 行内“收货”按钮：busy 期间禁用，防止双击重复收货。 */
export function ReceiveButton({ id, onDone }: { id: string; onDone: (id: string) => Promise<void> }) {
  const { busy, run } = useAsyncAction();
  return (
    <button disabled={busy} onClick={() => run(() => onDone(id))}>
      {busy ? '收货中...' : '收货'}
    </button>
  );
}

/** 行内加工状态流转下拉：选中即触发，busy 期间禁用，防止连选重复流转。M12：受控 value + 选中后复位占位项。 */
export function StatusFlowSelect({ id, onDone }: { id: string; onDone: (id: string, status: string) => Promise<void> }) {
  const { busy, run } = useAsyncAction();
  const [value, setValue] = useState('');
  return (
    <select
      disabled={busy}
      value={value}
      onChange={(event) => {
        const next = event.target.value;
        setValue('');
        /* v8 ignore next -- 占位项是受控 value，重选 '' 不派发 change，守卫为防御冗余 */
        if (next) void run(() => onDone(id, next));
      }}
    >
      <option value="">流转</option>
      <option value="SENT">已发送</option>
      <option value="IN_PROGRESS">加工中</option>
      <option value="COMPLETED">已完成</option>
      <option value="RECEIVED">已收货</option>
    </select>
  );
}

/** 盘点单行内操作（锁定/完成/取消）：busy 期间全部禁用，防止双击重复状态迁移。 */
export function StocktakeRowActions({ id, onDone, locked = false }: {
  id: string;
  onDone: (path: string, method: 'PATCH' | 'POST', body?: Record<string, unknown>) => Promise<void>;
  locked?: boolean;
}) {
  const { busy, run } = useAsyncAction();
  if (locked) {
    return (
      <span className="inline-form">
        <button disabled={busy} onClick={() => run(() => onDone(`/stocktakes/${id}/complete`, 'POST'))}>完成盘点</button>
        <button disabled={busy} onClick={() => run(() => onDone(`/stocktakes/${id}/cancel`, 'POST'))}>取消</button>
      </span>
    );
  }
  return (
    <span className="inline-form">
      <button disabled={busy} onClick={() => run(() => onDone(`/stocktakes/${id}/lock`, 'POST'))}>锁定</button>
      <button disabled={busy} onClick={() => run(() => onDone(`/stocktakes/${id}/cancel`, 'POST'))}>取消</button>
    </span>
  );
}
