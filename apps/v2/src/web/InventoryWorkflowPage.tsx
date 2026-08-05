import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api';
import type { Page } from './types';
import { DataTable, type DataTableColumn } from './components';
import { formatMoney } from './format';
import { errorMessage } from './messages';
import { useToast } from './toast-context';

const PROCESSING_STATUS_LABELS: Record<string, string> = {
  SENT: '已发送',
  IN_PROGRESS: '加工中',
  COMPLETED: '已完成',
  RECEIVED: '已收货',
};

const PURCHASE_STATUS_LABELS: Record<string, string> = {
  PENDING: '待收货',
  RECEIVED: '已收货',
  CANCELLED: '已取消',
};

export function InventoryWorkflowPage() {
  const { showToast } = useToast();
  const [selectedSuggestions, setSelectedSuggestions] = useState<string[]>([]);
  const purchase = useQuery({
    queryKey: ['po-workflow'],
    queryFn: () => apiRequest<Page<Record<string, unknown>>>('/resources/purchaseOrders?page=1&pageSize=100'),
  });
  const purchaseItems = useQuery({
    queryKey: ['po-items-workflow'],
    queryFn: () => apiRequest<Page<Record<string, unknown>>>('/resources/purchaseOrderItems?page=1&pageSize=200'),
  });
  const processing = useQuery({
    queryKey: ['processing-workflow'],
    queryFn: () => apiRequest<Page<Record<string, unknown>>>('/resources/processingOrders?page=1&pageSize=100'),
  });
  const suggestions = useQuery({
    queryKey: ['suggestions-workflow'],
    queryFn: () => apiRequest<Page<Record<string, unknown>>>('/resources/inventoryReplenishmentSuggestions?page=1&pageSize=100'),
  });

  async function run(path: string, method: 'PATCH' | 'POST', body: Record<string, unknown>) {
    try {
      await apiRequest(path, { method, body: JSON.stringify(body) });
      showToast('操作成功', 'success');
      await Promise.all([purchase.refetch(), processing.refetch(), suggestions.refetch()]);
    } catch (error) {
      showToast(errorMessage(error, '操作失败'), 'error');
    }
  }

  async function applySuggestions() {
    if (!selectedSuggestions.length) return;
    await run('/inventory/replenishment/apply', 'POST', { ids: selectedSuggestions });
    setSelectedSuggestions([]);
  }

  async function generateSuggestions() {
    await run('/inventory/replenishment/generate', 'POST', {});
  }

  const openSuggestions = suggestions.data?.items.filter((row) => {
    const status = row.status === null || row.status === undefined ? 'OPEN' : String(row.status);
    return status === 'OPEN';
  }) ?? [];

  const purchaseColumns: DataTableColumn<Record<string, unknown>>[] = [
    { key: 'number', label: '单号', render: (row) => String(row.number ?? row.id ?? '').slice(0, 14) },
    { key: 'supplierId', label: '供应商', render: (row) => String(row.supplierId ?? '') },
    { key: 'totalAmount', label: '金额', render: (row) => formatMoney(row.totalAmount) },
    { key: 'status', label: '状态', render: (row) => PURCHASE_STATUS_LABELS[String(row.status)] ?? String(row.status) },
    {
      key: 'actions',
      label: '操作',
      render: (row) => <button onClick={() => run(`/purchase-orders/${String(row.id)}/receive`, 'PATCH', {})}>收货</button>,
    },
  ];

  const purchaseItemColumns: DataTableColumn<Record<string, unknown>>[] = [
    { key: 'orderId', label: '采购单', render: (row) => String(row.orderId ?? '').slice(0, 8) },
    { key: 'name', label: '项目', render: (row) => String(row.name ?? row.itemId ?? '') },
    { key: 'quantity', label: '数量', render: (row) => String(row.quantity ?? '') },
    { key: 'unitPrice', label: '单价', render: (row) => formatMoney(row.unitPrice) },
    { key: 'subtotal', label: '小计', render: (row) => formatMoney(row.subtotal) },
  ];

  const processingColumns: DataTableColumn<Record<string, unknown>>[] = [
    { key: 'id', label: 'ID', render: (row) => String(row.id).slice(0, 8) },
    { key: 'status', label: '状态', render: (row) => PROCESSING_STATUS_LABELS[String(row.status)] ?? String(row.status) },
    {
      key: 'actions',
      label: '操作',
      render: (row) => (
        <select defaultValue="" onChange={(event) => event.target.value && run(`/processing-orders/${String(row.id)}/status`, 'PATCH', { status: event.target.value })}>
          <option value="">流转</option>
          <option value="SENT">已发送</option>
          <option value="IN_PROGRESS">加工中</option>
          <option value="COMPLETED">已完成</option>
          <option value="RECEIVED">已收货</option>
        </select>
      ),
    },
  ];

  const suggestionColumns: DataTableColumn<Record<string, unknown>>[] = [
    {
      key: 'selected',
      label: '选',
      render: (row) => (
        <input type="checkbox" checked={selectedSuggestions.includes(String(row.id))} onChange={(event) => {
          setSelectedSuggestions((current) => event.target.checked ? [...current, String(row.id)] : current.filter((id) => id !== String(row.id)));
        }} />
      ),
    },
    { key: 'inventoryId', label: '库存项目', render: (row) => String(row.inventoryId ?? row.id ?? '').slice(0, 12) },
    { key: 'rop', label: '补货点', render: (row) => String(row.rop ?? '') },
    { key: 'suggestedQty', label: '建议数量', render: (row) => String(row.suggestedQty ?? '') },
    { key: 'status', label: '状态', render: () => '待应用' },
  ];

  return (
    <div className="page">
      <h1>库存与采购操作</h1>
      <h2>采购单</h2>
      <DataTable
        columns={purchaseColumns}
        rows={purchase.data?.items.filter((row) => String(row.status) === 'PENDING') ?? []}
        keyField="id"
        emptyText="暂无待收货采购单"
      />
      <h2>采购单明细</h2>
      <DataTable columns={purchaseItemColumns} rows={purchaseItems.data?.items ?? []} keyField="id" emptyText="暂无采购明细" />
      <h2>加工单</h2>
      <DataTable columns={processingColumns} rows={processing.data?.items ?? []} keyField="id" emptyText="暂无加工单" />
      <h2>补货建议</h2>
      <div className="inline-form">
        <button onClick={generateSuggestions}>生成补货建议</button>
        <button onClick={applySuggestions}>应用选中建议</button>
      </div>
      <DataTable columns={suggestionColumns} rows={openSuggestions} keyField="id" emptyText="暂无待应用补货建议" />
    </div>
  );
}
