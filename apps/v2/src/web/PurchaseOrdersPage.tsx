import { FormEvent, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api';
import type { Page } from './types';
import { DataTable, Dialog, EmptyState, LoadingState, PageError, SearchableSelect, type SearchableSelectRow } from './components';
import { formatMoney, toCents } from './format';
import { errorMessage } from './messages';
import { useToast } from './toast-context';

interface PurchaseRow extends Record<string, unknown> {
  id: string;
  number?: string | null;
  supplierId?: string | null;
  supplierIdLabel?: string | null;
  totalAmount?: number | null;
  status?: string | null;
}

interface PurchaseItemForm {
  id: string;
  itemId: string;
  quantity: string;
  unitPrice: string;
}

function newItem(): PurchaseItemForm {
  return { id: crypto.randomUUID(), itemId: '', quantity: '1', unitPrice: '' };
}

export function PurchaseOrdersPage() {
  const { showToast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [number, setNumber] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [items, setItems] = useState<PurchaseItemForm[]>([newItem()]);
  const [submitting, setSubmitting] = useState(false);
  const [inventoryRows, setInventoryRows] = useState<SearchableSelectRow[]>([]);

  const query = useQuery({
    queryKey: ['purchase-orders'],
    queryFn: () => apiRequest<Page<PurchaseRow>>('/resources/purchaseOrders?page=1&pageSize=50'),
  });

  if (query.isLoading) return <LoadingState />;
  if (query.error) return <PageError message={(query.error as Error).message} />;

  async function create(event: FormEvent) {
    event.preventDefault();
    const validItems = items
      .filter((item) => item.quantity && item.unitPrice)
      .map((item) => ({
        itemId: item.itemId || undefined,
        name: item.itemId ? String(inventoryRows.find((row) => String(row.id) === item.itemId)?.name ?? '') : '自定义项目',
        quantity: Number(item.quantity),
        unitPrice: toCents(item.unitPrice),
      }))
      .filter((item) => item.quantity > 0 && item.unitPrice >= 0);
    if (submitting || !number.trim() || validItems.length === 0) {
      showToast('请填写采购单号并至少添加一条有效明细', 'error');
      return;
    }
    setSubmitting(true);
    try {
      await apiRequest('/purchase-orders', {
        method: 'POST',
        body: JSON.stringify({ number: number.trim(), supplierId: supplierId || undefined, items: validItems, requestId: crypto.randomUUID() }),
      });
      showToast('采购单已创建', 'success');
      setShowForm(false);
      setNumber('');
      setSupplierId('');
      setItems([newItem()]);
      await query.refetch();
    } catch (error) {
      showToast(errorMessage(error, '创建采购单失败'), 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function receive(id: string) {
    if (submitting) return;
    setSubmitting(true);
    try {
      await apiRequest(`/purchase-orders/${id}/receive`, { method: 'PATCH' });
      showToast('采购单已收货', 'success');
      await query.refetch();
    } catch (error) {
      showToast(errorMessage(error, '收货失败'), 'error');
    } finally {
      setSubmitting(false);
    }
  }

  const columns = [
    { key: 'number', label: '采购单号' },
    { key: 'supplierId', label: '供应商', render: (row: PurchaseRow) => row.supplierIdLabel ?? row.supplierId ?? '' },
    { key: 'totalAmount', label: '金额', render: (row: PurchaseRow) => formatMoney(row.totalAmount) },
    { key: 'status', label: '状态' },
    {
      key: 'actions',
      label: '操作',
      render: (row: PurchaseRow) => (
        <button disabled={String(row.status) !== 'PENDING'} onClick={() => receive(row.id)}>收货</button>
      ),
    },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <h1>采购单管理</h1>
        <button onClick={() => setShowForm(true)}>新建采购单</button>
      </div>
      {query.data?.items.length ? (
        <DataTable columns={columns} rows={query.data.items} keyField="id" />
      ) : (
        <EmptyState message="暂无采购单" />
      )}

      <Dialog open={showForm} title="新建采购单" onClose={() => setShowForm(false)}>
        <form onSubmit={create}>
          <label>
            采购单号
            <input value={number} onChange={(event) => setNumber(event.target.value)} />
          </label>
          <label>
            供应商
            <SearchableSelect
              resource="suppliers"
              value={supplierId}
              onChange={setSupplierId}
              ariaLabel="供应商"
              placeholder="不指定"
            />
          </label>
          {items.map((item) => (
            <div className="charge-item-row" key={item.id}>
              <SearchableSelect
                resource="inventoryItems"
                value={item.itemId}
                onChange={(id) => updateItem(item.id, { itemId: id })}
                ariaLabel="采购项目"
                placeholder="选择项目"
                onLoaded={(rows) => setInventoryRows(rows)}
              />
              <input aria-label="采购数量" type="number" min="1" value={item.quantity} onChange={(event) => updateItem(item.id, { quantity: event.target.value })} />
              <input aria-label="采购单价" type="number" min="0" value={item.unitPrice} onChange={(event) => updateItem(item.id, { unitPrice: event.target.value })} />
              <button type="button" onClick={() => setItems((current) => current.filter((entry) => entry.id !== item.id))}>移除</button>
            </div>
          ))}
          <button type="button" onClick={() => setItems((current) => [...current, newItem()])}>添加明细</button>
          <div className="modal-actions">
            <button type="button" onClick={() => setShowForm(false)}>取消</button>
            <button type="submit" disabled={submitting}>{submitting ? '保存中...' : '保存'}</button>
          </div>
        </form>
      </Dialog>
    </div>
  );

  function updateItem(id: string, patch: Partial<PurchaseItemForm>) {
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  }
}
