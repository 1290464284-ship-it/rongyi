import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest, fetchAllPages } from '../lib/api';
import { SearchableSelect } from '../components';
import { centsToYuanString } from '../lib/format';
import { newItem } from './items';
import type { ProcessingOrderForm, ProcessingOrderItemRow } from './types';

export function ProcessingOrderFormFields({
  form,
  update,
  editing,
  editingId,
  onItemsLoaded,
}: {
  form: ProcessingOrderForm;
  update: (patch: Partial<ProcessingOrderForm>) => void;
  editing: boolean;
  editingId: string | null;
  onItemsLoaded?: () => void;
}) {
  const doctors = useQuery({
    queryKey: ['processing-doctors'],
    queryFn: () => apiRequest<Array<Record<string, unknown>>>('/doctors'),
  });
  const loadedItemsForRef = useRef<string | null>(null);
  const updateRef = useRef(update);
  const onItemsLoadedRef = useRef(onItemsLoaded);
  useEffect(() => { updateRef.current = update; });
  useEffect(() => { onItemsLoadedRef.current = onItemsLoaded; });
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [itemsLoading, setItemsLoading] = useState(false);
  useEffect(() => {
    if (!editing || !editingId || loadedItemsForRef.current === editingId) return;
    let cancelled = false;
    loadedItemsForRef.current = editingId;
    setItemsError(null);
    setItemsLoading(true);
    fetchAllPages<ProcessingOrderItemRow>(`/resources/processingOrderItems?orderId=${editingId}`)
      .then((rows) => {
        if (cancelled) return;
        updateRef.current({
          items: (rows ?? []).map((row) => ({
            id: String(row.id),
            name: String(row.name ?? ''),
            spec: String(row.spec ?? ''),
            quantity: String(row.quantity ?? '1'),
            unitPrice: centsToYuanString(row.unitPrice ?? 0),
            subtotal: centsToYuanString(row.subtotal ?? 0),
            status: String(row.status ?? 'DRAFT'),
          })),
        });
        onItemsLoadedRef.current?.();
      })
      .catch(() => {
        if (!cancelled) {
          setItemsError('明细加载失败，请关闭后重试');
        }
      })
      .finally(() => {
        if (!cancelled) setItemsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [editing, editingId]);
  return (
    <>
      <label>
        患者
        <SearchableSelect resource="patients" value={form.patientId} onChange={(id) => update({ patientId: id })} ariaLabel="患者" placeholder="选择患者" />
      </label>
      <label>
        医生
        <select value={form.doctorId} onChange={(event) => update({ doctorId: event.target.value })}>
          <option value="">不指定</option>
          {doctors.data?.map((row) => (
            <option key={String(row.id)} value={String(row.id)}>{String(row.name ?? row.id)}</option>
          ))}
        </select>
      </label>
      <label>
        加工单号
        <input value={form.number} onChange={(event) => update({ number: event.target.value })} />
      </label>
      <label>
        颜色
        <input value={form.shade} onChange={(event) => update({ shade: event.target.value })} />
      </label>
      <label>
        牙位（逗号分隔）
        <input value={form.teethNumbers} onChange={(event) => update({ teethNumbers: event.target.value })} />
      </label>
      <label>
        总费用
        <input type="number" min="0" value={form.totalFee} onChange={(event) => update({ totalFee: event.target.value })} />
      </label>
      {itemsError && <p className="error">{itemsError}</p>}
      {itemsLoading && <p className="page-state">明细加载中...</p>}
      {form.items.map((item) => (
        <div className="charge-item-row" key={item.id}>
          <input aria-label="加工项目" disabled={itemsLoading} value={item.name} placeholder="项目名称" onChange={(event) => update({ items: form.items.map((entry) => entry.id === item.id ? { ...entry, name: event.target.value } : entry) })} />
          <input aria-label="加工数量" disabled={itemsLoading} type="number" min="1" value={item.quantity} onChange={(event) => update({ items: form.items.map((entry) => entry.id === item.id ? { ...entry, quantity: event.target.value } : entry) })} />
          <input aria-label="加工单价" disabled={itemsLoading} type="number" min="0" value={item.unitPrice} onChange={(event) => update({ items: form.items.map((entry) => entry.id === item.id ? { ...entry, unitPrice: event.target.value } : entry) })} />
          <button type="button" disabled={itemsLoading} onClick={() => update({ items: form.items.filter((entry) => entry.id !== item.id) })}>移除</button>
        </div>
      ))}
      <button type="button" disabled={itemsLoading} onClick={() => update({ items: [...form.items, newItem()] })}>添加明细</button>
    </>
  );
}
