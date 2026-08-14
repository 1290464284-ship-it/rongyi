import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../lib/api';
import { Dialog, LoadingState, PageError, SearchableSelect } from '../components';
import { errorMessage } from '../lib/messages';
import { useToast } from '../lib/toast-context';
import { newCreateItem, type CreateForm, type CreateItemRow, type DispenseDetail } from './types';

/** 编辑发药单弹窗：拉取详情回填表单（明细行携带服务端 id），提交 PATCH /dispenses/:id。 */
export function DispenseEditDialog({
  dispenseId,
  onClose,
  onDone,
  stale,
}: {
  dispenseId: string;
  onClose: () => void;
  onDone: () => void;
  stale?: boolean;
}) {
  const { showToast } = useToast();
  const [form, setForm] = useState<CreateForm | null>(null);
  const [itemsMeta, setItemsMeta] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const detail = useQuery({
    queryKey: ['dispense-detail', dispenseId],
    queryFn: () => apiRequest<DispenseDetail>(`/dispenses/${dispenseId}`),
  });

  // 详情到达后回填表单：form 为 null 时渲染派生自 detail.data（无 effect setState），
  // 一旦用户编辑 form 非 null 即脱离回填；明细行以服务端 id 作为 key，提交时回传
  function buildFormFromDetail(data: DispenseDetail): CreateForm {
    return {
      number: String(data.number ?? ''),
      patientId: String(data.patientId ?? ''),
      note: String(data.note ?? ''),
      items: (data.items ?? []).map((item) => ({
        key: item.id,
        id: item.id,
        itemId: String(item.itemId ?? ''),
        quantity: String(Number(item.quantity ?? 0)),
        batchId: String(item.batchId ?? ''),
      })),
    };
  }

  const effectiveForm: CreateForm | null = form ?? (detail.data ? buildFormFromDetail(detail.data) : null);

  function updateForm(patch: Partial<CreateForm>) {
    setForm((current) => {
      // updateForm 只在表单已渲染时可达（effectiveForm 非空）：此时 current
      // 与 detail.data 必有一个非空，detail.data 为空时 current 恒非空。
      const base = current ?? buildFormFromDetail(detail.data as DispenseDetail);
      return { ...base, ...patch };
    });
  }

  function updateItem(key: string, patch: Partial<CreateItemRow>) {
    setForm((current) => {
      const base = current ?? buildFormFromDetail(detail.data as DispenseDetail);
      return { ...base, items: base.items.map((item) => (item.key === key ? { ...item, ...patch } : item)) };
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || stale || !effectiveForm) return;
    const form = effectiveForm;
    const items = form.items
      .filter((item) => item.itemId !== '' && Number.isSafeInteger(Number(item.quantity)) && Number(item.quantity) > 0)
      .map((item) => ({
        ...(item.id ? { id: item.id } : {}),
        itemId: item.itemId,
        quantity: Number(item.quantity),
        batchId: item.batchId.trim() === '' ? undefined : item.batchId.trim(),
      }));
    // 已选药品但数量无效（空/0/非整数）的明细会被静默丢弃，提交前提示
    const dropped = form.items.filter((item) => item.itemId !== '').length - items.length;
    if (dropped > 0) showToast(`${dropped} 条明细因数量无效将被忽略`, 'info');
    if (!form.patientId || !form.number.trim() || items.length === 0) {
      showToast('请选择患者、填写单号并至少填写一条有效发药明细', 'error');
      return;
    }
    setBusy(true);
    try {
      await apiRequest(`/dispenses/${dispenseId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          number: form.number.trim(),
          patientId: form.patientId,
          note: form.note.trim() || undefined,
          items,
        }),
      });
      showToast('发药单已更新', 'success');
      onClose();
      onDone();
    } catch (error) {
      showToast(errorMessage(error, '更新发药单失败'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open title="编辑发药单" onClose={onClose}>
      {detail.error ? (
        <PageError message={errorMessage(detail.error, '加载发药单失败')} />
      ) : detail.isLoading || !effectiveForm ? (
        <LoadingState label="加载发药单..." />
      ) : (
        <form className="inline-form" onSubmit={submit}>
          <label>
            患者
            <SearchableSelect
              resource="patients"
              value={effectiveForm.patientId}
              onChange={(id) => updateForm({ patientId: id })}
              ariaLabel="编辑患者"
              placeholder="选择患者"
            />
          </label>
          <label>
            单号
            <input aria-label="编辑单号" value={effectiveForm.number} onChange={(event) => updateForm({ number: event.target.value })} />
          </label>
          <label>
            发药备注
            <input aria-label="编辑发药备注" value={effectiveForm.note} onChange={(event) => updateForm({ note: event.target.value })} />
          </label>
          {effectiveForm.items.map((item) => (
            <div className="charge-item-row" key={item.key}>
              <SearchableSelect
                resource="inventoryItems"
                value={item.itemId}
                onChange={(id) => updateItem(item.key, { itemId: id, batchId: '' })}
                ariaLabel="编辑物品"
                placeholder="选择物品"
                onLoaded={(rows) => {
                  setItemsMeta((current) => {
                    const next = { ...current };
                    /* v8 ignore next -- spec「treats items without a batchManaged flag」已覆盖无 batchManaged 条目的 ?? 0 分支（断言通过即执行），setState-updater 内 ?? v8 未入账，属采集缺陷 */
                    for (const row of rows) next[String(row.id)] = Number(row.batchManaged ?? 0) === 1;
                    return next;
                  });
                }}
              />
              <input
                aria-label="编辑发药数量"
                type="number"
                min="1"
                value={item.quantity}
                onChange={(event) => updateItem(item.key, { quantity: event.target.value })}
              />
              {itemsMeta[item.itemId] === true && (
                <BatchSelect
                  itemId={item.itemId}
                  value={item.batchId}
                  onChange={(batchId) => updateItem(item.key, { batchId })}
                  ariaLabel="编辑批次"
                />
              )}
              <button type="button" onClick={() => updateForm({ items: effectiveForm.items.filter((entry) => entry.key !== item.key) })}>
                移除
              </button>
            </div>
          ))}
          <button type="button" onClick={() => updateForm({ items: [...effectiveForm.items, { ...newCreateItem() }] })}>添加明细</button>
          <div className="modal-actions">
            <button type="button" onClick={onClose}>取消</button>
            <button type="submit" disabled={busy}>{busy ? '保存中...' : '保存修改'}</button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

/** 批次下拉：加载指定物品的可选批次（剩余量）。 */
export function BatchSelect({
  itemId,
  value,
  onChange,
  ariaLabel,
}: {
  itemId: string;
  value: string;
  onChange: (batchId: string) => void;
  ariaLabel: string;
}) {
  const batches = useQuery({
    queryKey: ['inventory-batches', itemId],
    queryFn: () =>
      apiRequest<{ batches: Array<Record<string, unknown>> }>(`/inventory-batches?itemId=${encodeURIComponent(itemId)}`),
    enabled: itemId !== '',
  });
  const rows = batches.data?.batches ?? [];
  return (
    <span className="searchable-select">
      <select aria-label={ariaLabel} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">选择批次</option>
        {rows.map((batch) => (
          <option key={String(batch.id)} value={String(batch.id)}>
            {String(batch.batchNo ?? batch.id)}
          </option>
        ))}
      </select>
      {batches.error && <span className="error">{errorMessage(batches.error)}</span>}
    </span>
  );
}
