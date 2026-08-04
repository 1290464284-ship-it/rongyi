import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api';
import type { Page } from './types';

export function InventoryWorkflowPage() {
  const [message, setMessage] = useState('');
  const [selectedSuggestions, setSelectedSuggestions] = useState<string[]>([]);
  const purchase = useQuery({
    queryKey: ['po-workflow'],
    queryFn: () => apiRequest<Page<Record<string, unknown>>>('/resources/purchaseOrders?page=1&pageSize=100'),
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

  return (
    <div className="page">
      <h1>库存与采购操作</h1>
      {message && <p className="info">{message}</p>}
      <h2>采购单</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Number</th><th>Supplier</th><th>Amount</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>
            {purchase.data?.items.filter((row) => String(row.status) === 'PENDING').map((row) => (
              <tr key={String(row.id)}>
                <td>{String(row.number ?? row.id ?? '').slice(0, 14)}</td>
                <td>{String(row.supplierId ?? '')}</td>
                <td>{String(row.totalAmount ?? '')}</td>
                <td>{String(row.status)}</td>
                <td><button onClick={() => run(`/purchase-orders/${String(row.id)}/receive`, 'PATCH', {})}>收货</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2>加工单</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>ID</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>
            {processing.data?.items.map((row) => (
              <tr key={String(row.id)}>
                <td>{String(row.id).slice(0, 8)}</td>
                <td>{String(row.status)}</td>
                <td>
                  <select defaultValue="" onChange={(event) => event.target.value && run(`/processing-orders/${String(row.id)}/status`, 'PATCH', { status: event.target.value })}>
                    <option value="">流转</option>
                    <option value="SENT">SENT</option>
                    <option value="IN_PROGRESS">IN_PROGRESS</option>
                    <option value="COMPLETED">COMPLETED</option>
                    <option value="RECEIVED">RECEIVED</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2>补货建议</h2>
      <div className="inline-form">
        <button onClick={generateSuggestions}>生成补货建议</button>
        <button onClick={applySuggestions}>应用选中建议</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>选</th><th>Item</th><th>ROP</th><th>Qty</th><th>Status</th></tr></thead>
          <tbody>
            {openSuggestions.map((row) => (
              <tr key={String(row.id)}>
                <td>
                  <input type="checkbox" checked={selectedSuggestions.includes(String(row.id))} onChange={(event) => {
                    setSelectedSuggestions((current) => event.target.checked ? [...current, String(row.id)] : current.filter((id) => id !== String(row.id)));
                  }} />
                </td>
                <td>{String(row.inventoryId ?? row.id ?? '').slice(0, 12)}</td>
                <td>{String(row.rop ?? '')}</td>
                <td>{String(row.suggestedQty ?? '')}</td>
                <td>OPEN</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
