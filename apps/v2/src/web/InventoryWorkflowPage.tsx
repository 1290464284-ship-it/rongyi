import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api';
import type { Page } from './types';
import { DataTable, type DataTableColumn } from './components';

export function InventoryWorkflowPage() {
  const [message, setMessage] = useState('');
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
      setMessage('操作成功');
      await Promise.all([purchase.refetch(), processing.refetch(), suggestions.refetch()]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '操作失败');
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
    { key: 'number', label: 'Number', render: (row) => String(row.number ?? row.id ?? '').slice(0, 14) },
    { key: 'supplierId', label: 'Supplier', render: (row) => String(row.supplierId ?? '') },
    { key: 'totalAmount', label: 'Amount', render: (row) => String(row.totalAmount ?? '') },
    { key: 'status', label: 'Status', render: (row) => String(row.status) },
    {
      key: 'actions',
      label: 'Action',
      render: (row) => <button onClick={() => run(`/purchase-orders/${String(row.id)}/receive`, 'PATCH', {})}>收货</button>,
    },
  ];

  const purchaseItemColumns: DataTableColumn<Record<string, unknown>>[] = [
    { key: 'orderId', label: 'Order', render: (row) => String(row.orderId ?? '').slice(0, 8) },
    { key: 'name', label: 'Item', render: (row) => String(row.name ?? row.itemId ?? '') },
    { key: 'quantity', label: 'Qty', render: (row) => String(row.quantity ?? '') },
    { key: 'unitPrice', label: 'Unit price', render: (row) => String(row.unitPrice ?? '') },
    { key: 'subtotal', label: 'Subtotal', render: (row) => String(row.subtotal ?? '') },
  ];

  const processingColumns: DataTableColumn<Record<string, unknown>>[] = [
    { key: 'id', label: 'ID', render: (row) => String(row.id).slice(0, 8) },
    { key: 'status', label: 'Status', render: (row) => String(row.status) },
    {
      key: 'actions',
      label: 'Action',
      render: (row) => (
        <select defaultValue="" onChange={(event) => event.target.value && run(`/processing-orders/${String(row.id)}/status`, 'PATCH', { status: event.target.value })}>
          <option value="">流转</option>
          <option value="SENT">SENT</option>
          <option value="IN_PROGRESS">IN_PROGRESS</option>
          <option value="COMPLETED">COMPLETED</option>
          <option value="RECEIVED">RECEIVED</option>
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
    { key: 'inventoryId', label: 'Item', render: (row) => String(row.inventoryId ?? row.id ?? '').slice(0, 12) },
    { key: 'rop', label: 'ROP', render: (row) => String(row.rop ?? '') },
    { key: 'suggestedQty', label: 'Qty', render: (row) => String(row.suggestedQty ?? '') },
    { key: 'status', label: 'Status', render: () => 'OPEN' },
  ];

  return (
    <div className="page">
      <h1>库存与采购操作</h1>
      {message && <p className="info">{message}</p>}
      <h2>采购单</h2>
      <DataTable
        columns={purchaseColumns}
        rows={purchase.data?.items.filter((row) => String(row.status) === 'PENDING') ?? []}
        keyField="id"
        emptyText="No pending purchase orders"
      />
      <h2>采购单明细</h2>
      <DataTable columns={purchaseItemColumns} rows={purchaseItems.data?.items ?? []} keyField="id" emptyText="No purchase items" />
      <h2>加工单</h2>
      <DataTable columns={processingColumns} rows={processing.data?.items ?? []} keyField="id" emptyText="No processing orders" />
      <h2>补货建议</h2>
      <div className="inline-form">
        <button onClick={generateSuggestions}>生成补货建议</button>
        <button onClick={applySuggestions}>应用选中建议</button>
      </div>
      <DataTable columns={suggestionColumns} rows={openSuggestions} keyField="id" emptyText="No open suggestions" />
    </div>
  );
}
