import type { FormEvent } from 'react';
import { SearchableSelect } from '../components';
import { formatMoney, toCents } from '../lib/format';
import { useToast } from '../lib/toast-context';
import type { ChargeForm, ChargeItemForm } from './types';
import { buildValidItems, newItem } from './charge-utils';

export function ChargeCreateForm({
  form,
  update,
  updateItem,
  submitting,
  onSubmit,
  comboLoading,
  actionBusy,
  onLoadCombos,
  onQuoteDiscount,
}: {
  form: ChargeForm;
  update: (patch: Partial<ChargeForm>) => void;
  updateItem: (id: string, patch: Partial<ChargeItemForm>) => void;
  submitting: boolean;
  onSubmit: (event: FormEvent) => Promise<void>;
  comboLoading: boolean;
  actionBusy: boolean;
  onLoadCombos: () => void;
  onQuoteDiscount: () => void;
}) {
  const { showToast } = useToast();

  function handleSubmit(event: FormEvent) {
    // 已填写（有名称）但价格/数量无效的明细会被静默丢弃，提交前提示
    const filled = form.items.filter((item) => item.name.trim()).length;
    const valid = buildValidItems(form.items);
    if (filled - valid.length > 0) showToast(`${filled - valid.length} 条明细因缺少有效价格或数量将被忽略`, 'info');
    // M10：优惠金额必须落在 [0, 应收总额] 区间，超限即时提示并阻止提交
    const subtotal = valid.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const discount = toCents(form.discount);
    if (discount < 0 || discount > subtotal) {
      showToast(`优惠金额需在 0 与应收总额 ${formatMoney(subtotal)} 之间`, 'error');
      return;
    }
    return onSubmit(event);
  }

  return (
    <>
      <form className="inline-form" onSubmit={handleSubmit}>
        <SearchableSelect resource="patients" value={form.patientId} onChange={(id) => update({ patientId: id })} ariaLabel="患者" placeholder="选择患者" />
        <button type="submit" disabled={submitting}>{submitting ? '保存中...' : '新建收费单'}</button>
      </form>
      <div className="charge-items">
        {form.items.map((item) => (
          <div className="charge-item-row" style={{ gridTemplateColumns: '2fr 1fr 1fr 80px 72px 90px 72px' }} key={item.id}>
            <input
              aria-label="项目名称"
              value={item.name}
              placeholder="项目名称"
              onChange={(event) => updateItem(item.id, { name: event.target.value })}
            />
            <input
              aria-label="项目分类"
              value={item.category}
              placeholder="分类"
              onChange={(event) => updateItem(item.id, { category: event.target.value })}
            />
            <input
              aria-label="单价"
              type="number"
              min="0"
              value={item.price}
              placeholder="单价"
              onChange={(event) => updateItem(item.id, { price: event.target.value })}
            />
            <input
              aria-label="数量"
              type="number"
              min="1"
              value={item.quantity}
              onChange={(event) => updateItem(item.id, { quantity: event.target.value })}
            />
            <select
              aria-label="类型"
              value={item.costType}
              onChange={(event) => updateItem(item.id, { costType: event.target.value as 'SERVICE' | 'MATERIAL' })}
            >
              <option value="SERVICE">服务</option>
              <option value="MATERIAL">材料</option>
            </select>
            <button type="button" onClick={() => update({ items: form.items.filter((entry) => entry.id !== item.id) })}>移除</button>
          </div>
        ))}
      </div>
      <div className="inline-form">
        <button type="button" onClick={() => update({ items: [...form.items, newItem()] })}>添加明细</button>
        <button type="button" onClick={onLoadCombos} disabled={comboLoading}>{comboLoading ? '加载中...' : '调出收费组合'}</button>
      </div>
      <div className="inline-form">
        <label>
          优惠金额（元）
          <input type="number" min="0" value={form.discount} onChange={(event) => update({ discount: event.target.value })} />
        </label>
        <button type="button" onClick={onQuoteDiscount} disabled={actionBusy}>会员折扣试算</button>
      </div>
      <label>
        备注
        <textarea value={form.remark} onChange={(event) => update({ remark: event.target.value })} />
      </label>
    </>
  );
}
