import { useState, type FormEvent } from 'react';
import { apiRequest } from '../lib/api';
import { SearchableSelect } from '../components';
import { errorMessage } from '../lib/messages';
import { useToast } from '../lib/toast-context';
import { BatchSelect } from './DispenseEditDialog';
import { emptyCreateForm, newCreateItem, type CreateForm, type CreateItemRow } from './types';

/** 新建发药单表单区：createForm 状态与提交逻辑均在本面板内部，提交成功后经 onCreated 通知页面刷新列表。 */
export function DispenseCreateForm({ onCreated }: { onCreated: () => void }) {
  const { showToast } = useToast();
  const [createForm, setCreateForm] = useState<CreateForm>(emptyCreateForm);
  // 物品 id -> 是否批次管理；由“物品”下拉的 onLoaded 回填，用于按行渲染“批次”下拉
  const [itemsMeta, setItemsMeta] = useState<Record<string, boolean>>({});
  const [createBusy, setCreateBusy] = useState(false);

  function updateCreate(patch: Partial<CreateForm>) {
    setCreateForm((current) => ({ ...current, ...patch }));
  }

  function updateCreateItem(key: string, patch: Partial<CreateItemRow>) {
    setCreateForm((current) => ({
      ...current,
      items: current.items.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    }));
  }

  async function submitCreate(event: FormEvent) {
    event.preventDefault();
    if (createBusy) return;
    const items = createForm.items
      .filter((item) => item.itemId !== '' && Number.isSafeInteger(Number(item.quantity)) && Number(item.quantity) > 0)
      .map((item) => ({
        itemId: item.itemId,
        quantity: Number(item.quantity),
        batchId: item.batchId.trim() === '' ? undefined : item.batchId.trim(),
      }));
    // 已选药品但数量无效（空/0/非整数）的明细会被静默丢弃，提交前提示
    const dropped = createForm.items.filter((item) => item.itemId !== '').length - items.length;
    if (dropped > 0) showToast(`${dropped} 条明细因数量无效将被忽略`, 'info');
    if (!createForm.patientId || !createForm.number.trim() || items.length === 0) {
      showToast('请选择患者、填写单号并至少填写一条有效发药明细', 'error');
      return;
    }
    setCreateBusy(true);
    try {
      await apiRequest('/dispenses', {
        method: 'POST',
        body: JSON.stringify({
          number: createForm.number.trim(),
          patientId: createForm.patientId,
          note: createForm.note.trim() || undefined,
          items,
        }),
      });
      showToast('发药单已创建', 'success');
      setCreateForm(emptyCreateForm());
      onCreated();
    } catch (error) {
      showToast(errorMessage(error, '创建发药单失败'), 'error');
    } finally {
      setCreateBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>新建发药单</h2>
      <form className="inline-form" onSubmit={submitCreate}>
        <label>
          患者
          <SearchableSelect
            resource="patients"
            value={createForm.patientId}
            onChange={(id) => updateCreate({ patientId: id })}
            ariaLabel="患者"
            placeholder="选择患者"
          />
        </label>
        <label>
          单号
          <input aria-label="单号" value={createForm.number} onChange={(event) => updateCreate({ number: event.target.value })} />
        </label>
        <label>
          发药备注
          <input aria-label="发药备注" value={createForm.note} onChange={(event) => updateCreate({ note: event.target.value })} />
        </label>
        {createForm.items.map((item) => (
          <div className="charge-item-row" key={item.key}>
            <SearchableSelect
              resource="inventoryItems"
              value={item.itemId}
              onChange={(id) => updateCreateItem(item.key, { itemId: id, batchId: '' })}
              ariaLabel="物品"
              placeholder="选择物品"
              onLoaded={(rows) => {
                setItemsMeta((current) => {
                  const next = { ...current };
                  for (const row of rows) next[String(row.id)] = Number(row.batchManaged ?? 0) === 1;
                  return next;
                });
              }}
            />
            <input
              aria-label="发药数量"
              type="number"
              min="1"
              value={item.quantity}
              onChange={(event) => updateCreateItem(item.key, { quantity: event.target.value })}
            />
            {itemsMeta[item.itemId] === true && (
              <BatchSelect
                itemId={item.itemId}
                value={item.batchId}
                onChange={(batchId) => updateCreateItem(item.key, { batchId })}
                ariaLabel="批次"
              />
            )}
            <button type="button" onClick={() => updateCreate({ items: createForm.items.filter((entry) => entry.key !== item.key) })}>
              移除
            </button>
          </div>
        ))}
        <button type="button" onClick={() => updateCreate({ items: [...createForm.items, newCreateItem()] })}>添加明细</button>
        <button type="submit" disabled={createBusy}>{createBusy ? '创建中...' : '创建发药单'}</button>
      </form>
    </section>
  );
}
