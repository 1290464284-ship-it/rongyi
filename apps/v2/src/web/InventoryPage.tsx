import { FormEvent, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api';
import type { Page } from './types';
import { errorMessage } from './messages';
import { useToast } from './toast-context';

export function InventoryPage() {
  const { showToast } = useToast();
  const [itemId, setItemId] = useState('inventory-demo-001');
  const [type, setType] = useState<'IN' | 'OUT' | 'ADJUST'>('IN');
  const [quantity, setQuantity] = useState('1');
  const [submitting, setSubmitting] = useState(false);
  const query = useQuery({
    queryKey: ['inventory'],
    queryFn: () => apiRequest<Page<Record<string, unknown>>>('/resources/inventoryItems?page=1&pageSize=20'),
  });
  const lowStock = useQuery({
    queryKey: ['inventory-low'],
    queryFn: () => apiRequest<Array<Record<string, unknown>>>('/inventory/low-stock'),
  });
  const expiring = useQuery({
    queryKey: ['inventory-expiring'],
    queryFn: () => apiRequest<Array<Record<string, unknown>>>('/inventory/expiring?days=30'),
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      await apiRequest('/inventory/transactions', {
        method: 'POST',
        body: JSON.stringify({ itemId, type, quantity: Number(quantity), requestId: crypto.randomUUID() }),
      });
      showToast('库存流水已记录', 'success');
      await Promise.all([query.refetch(), lowStock.refetch(), expiring.refetch()]);
    } catch (error) {
      showToast(errorMessage(error, '保存库存流水失败'), 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function generateReplenishment() {
    if (submitting) return;
    setSubmitting(true);
    try {
      await apiRequest('/inventory/replenishment/generate', { method: 'POST', body: JSON.stringify({}) });
      showToast('补货建议已生成', 'success');
      await lowStock.refetch();
    } catch (error) {
      showToast(errorMessage(error, '生成补货建议失败'), 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>库存管理</h1>
        <button onClick={generateReplenishment}>生成补货建议</button>
      </div>
      <form className="inline-form" onSubmit={submit}>
        <input value={itemId} onChange={(event) => setItemId(event.target.value)} />
        <select value={type} onChange={(event) => setType(event.target.value as typeof type)}>
          <option value="IN">IN</option>
          <option value="OUT">OUT</option>
          <option value="ADJUST">ADJUST</option>
        </select>
        <input type="number" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
        <button type="submit" disabled={submitting}>{submitting ? '保存中...' : '保存库存流水'}</button>
      </form>
      <div className="cards">
        {query.data?.items.map((row) => (
          <div className="card" key={String(row.id)}>
            <strong>{String(row.name ?? row.code ?? '')}</strong>
            <span>库存：{String(row.stock ?? '')} / 最低 {String(row.minStock ?? '')}</span>
          </div>
        ))}
      </div>
      <h2>低库存</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>名称</th><th>库存</th><th>最低</th></tr></thead>
          <tbody>
            {lowStock.data?.map((row) => (
              <tr key={String(row.id)}><td>{String(row.name)}</td><td>{String(row.stock)}</td><td>{String(row.minStock)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2>30 天内到期</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>名称</th><th>到期日期</th><th>库存</th></tr></thead>
          <tbody>
            {expiring.data?.map((row) => (
              <tr key={String(row.id)}><td>{String(row.name ?? row.code ?? '')}</td><td>{String(row.expireDate ?? '')}</td><td>{String(row.stock ?? '')}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
