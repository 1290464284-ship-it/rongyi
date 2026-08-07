import { useState, type FormEvent } from 'react';
import { apiRequest } from '../lib/api';
import { Dialog } from '../components';
import { toCents } from '../lib/format';
import { errorMessage } from '../lib/messages';
import { useToast } from '../lib/toast-context';
import { rowPatientName, type RegistrationRow } from './types';

export interface ChargeItemForm {
  id: string;
  name: string;
  category: string;
  price: string;
  quantity: string;
}

function newChargeItem(): ChargeItemForm {
  return { id: crypto.randomUUID(), name: '', category: '', price: '', quantity: '1' };
}

export function ChargeDialog({
  row,
  onClose,
  onSaved,
}: {
  row: RegistrationRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { showToast } = useToast();
  const [items, setItems] = useState<ChargeItemForm[]>([newChargeItem()]);
  const [busy, setBusy] = useState(false);
  const patientId = String(row.patientId ?? '');
  const patientName = rowPatientName(row);

  function updateItem(id: string, patch: Partial<ChargeItemForm>) {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const validItems = items
      .filter((item) => item.name.trim())
      .map((item) => ({
        name: item.name.trim(),
        category: item.category.trim() || 'GENERAL',
        price: toCents(item.price),
        quantity: Number(item.quantity || 0),
      }))
      .filter((item) => item.price > 0 && item.quantity > 0);
    if (!patientId || validItems.length === 0) {
      showToast('请至少填写一条有效收费明细', 'error');
      return;
    }
    setBusy(true);
    try {
      // 注意：/api/v2/charges 的 route-policy 只允许财务角色，医生点击会得到 403 ——
      // 这是既有权限设计，页面只负责把错误 toast 出来，不做绕过。
      await apiRequest('/charges', { method: 'POST', body: JSON.stringify({ patientId, items: validItems }) });
      showToast('划价已提交', 'success');
      onSaved();
      onClose();
    } catch (error) {
      showToast(errorMessage(error, '提交划价失败'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open title="划价" onClose={onClose}>
      <form onSubmit={submit}>
        <label>
          患者
          <input readOnly value={patientName} aria-label="患者" />
        </label>
        {items.map((item) => (
          <div className="charge-item" key={item.id}>
            <label>
              项目名称
              <input value={item.name} onChange={(event) => updateItem(item.id, { name: event.target.value })} />
            </label>
            <label>
              分类
              <input value={item.category} onChange={(event) => updateItem(item.id, { category: event.target.value })} />
            </label>
            <label>
              单价(元)
              <input
                type="number"
                min="0"
                step="0.01"
                value={item.price}
                onChange={(event) => updateItem(item.id, { price: event.target.value })}
              />
            </label>
            <label>
              数量
              <input
                type="number"
                min="1"
                step="1"
                value={item.quantity}
                onChange={(event) => updateItem(item.id, { quantity: event.target.value })}
              />
            </label>
            <button
              type="button"
              onClick={() => setItems((current) => current.filter((entry) => entry.id !== item.id))}
              disabled={items.length === 1}
            >
              删除
            </button>
          </div>
        ))}
        <button type="button" onClick={() => setItems((current) => [...current, newChargeItem()])}>添加明细</button>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>取消</button>
          <button type="submit" disabled={busy}>提交划价</button>
        </div>
      </form>
    </Dialog>
  );
}
