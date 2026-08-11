import { useEffect, useRef, useState } from 'react';
import { fetchAllPages } from '../lib/api';
import { SearchableSelect, type SearchableSelectRow } from '../components';
import { centsToYuanString } from '../lib/format';
import { newItem } from './form';
import type { PurchaseOrderForm, PurchaseOrderItemRow } from './types';

export function PurchaseOrderFormFields({
  form,
  update,
  inventoryRows: _inventoryRows,
  setInventoryRows,
  editing,
  editingId,
  onItemsLoaded,
}: {
  form: PurchaseOrderForm;
  update: (patch: Partial<PurchaseOrderForm>) => void;
  inventoryRows: SearchableSelectRow[];
  setInventoryRows: (rows: SearchableSelectRow[]) => void;
  editing: boolean;
  editingId: string | null;
  onItemsLoaded?: () => void;
}) {
  const loadedItemsForRef = useRef<string | null>(null);
  const updateRef = useRef(update);
  const onItemsLoadedRef = useRef(onItemsLoaded);
  useEffect(() => { updateRef.current = update; });
  useEffect(() => { onItemsLoadedRef.current = onItemsLoaded; });
  const [itemsError, setItemsError] = useState<string | null>(null);
  // L2：明细异步回填完成前禁用编辑区，避免整表覆盖用户正在输入的内容（竞态）
  const [itemsLoading, setItemsLoading] = useState(false);
  useEffect(() => {
    if (!editing || !editingId || loadedItemsForRef.current === editingId) return;
    let cancelled = false;
    loadedItemsForRef.current = editingId;
    setItemsError(null);
    setItemsLoading(true);
    fetchAllPages<PurchaseOrderItemRow>(`/resources/purchaseOrderItems?orderId=${editingId}`)
      .then((rows) => {
        if (cancelled) return;
        updateRef.current({
          items: (rows ?? []).map((row) => ({
            id: String(row.id),
            itemId: String(row.itemId ?? ''),
            name: String(row.name ?? ''),
            spec: String(row.spec ?? ''),
            quantity: String(row.quantity ?? '1'),
            unitPrice: centsToYuanString(row.unitPrice ?? 0),
            subtotal: centsToYuanString(row.subtotal ?? 0),
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
        采购单号
        <input value={form.number} onChange={(event) => update({ number: event.target.value })} />
      </label>
      <label>
        供应商
        <SearchableSelect
          resource="suppliers"
          value={form.supplierId}
          onChange={(id) => update({ supplierId: id })}
          ariaLabel="供应商"
          placeholder="不指定"
        />
      </label>
      {itemsError && <p className="error">{itemsError}</p>}
      {itemsLoading && <p className="page-state">明细加载中...</p>}
      {!itemsLoading && form.items.map((item) => (
        <div className="charge-item-row" key={item.id}>
          <SearchableSelect
            resource="inventoryItems"
            value={item.itemId}
            onChange={(id) => update({ items: form.items.map((entry) => entry.id === item.id ? { ...entry, itemId: id } : entry) })}
            ariaLabel="采购项目"
            placeholder="选择项目"
            onLoaded={(rows) => setInventoryRows(rows)}
          />
          <input aria-label="采购数量" type="number" min="1" value={item.quantity} onChange={(event) => update({ items: form.items.map((entry) => entry.id === item.id ? { ...entry, quantity: event.target.value } : entry) })} />
          <input aria-label="采购单价" type="number" min="0" value={item.unitPrice} onChange={(event) => update({ items: form.items.map((entry) => entry.id === item.id ? { ...entry, unitPrice: event.target.value } : entry) })} />
          <button type="button" onClick={() => update({ items: form.items.filter((entry) => entry.id !== item.id) })}>移除</button>
        </div>
      ))}
      <button type="button" disabled={itemsLoading} onClick={() => update({ items: [...form.items, newItem()] })}>添加明细</button>
    </>
  );
}
