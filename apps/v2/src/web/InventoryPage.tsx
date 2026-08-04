import { FormEvent, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api';
import type { Page } from './types';

export function InventoryPage() {
  const [itemId, setItemId] = useState('inventory-demo-001');
  const [type, setType] = useState<'IN' | 'OUT' | 'ADJUST'>('IN');
  const [quantity, setQuantity] = useState('1');
  const [message, setMessage] = useState('');
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
    try {
      await apiRequest('/inventory/transactions', {
        method: 'POST',
        body: JSON.stringify({ itemId, type, quantity: Number(quantity) }),
      });
      setMessage('Transaction recorded');
      await Promise.all([query.refetch(), lowStock.refetch(), expiring.refetch()]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Transaction failed');
    }
  }

  async function generateReplenishment() {
    try {
      await apiRequest('/inventory/replenishment/generate', { method: 'POST', body: JSON.stringify({}) });
      setMessage('Replenishment suggestions generated');
      await lowStock.refetch();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Generate failed');
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Inventory</h1>
        <button onClick={generateReplenishment}>Generate replenishment</button>
      </div>
      <form className="inline-form" onSubmit={submit}>
        <input value={itemId} onChange={(event) => setItemId(event.target.value)} />
        <select value={type} onChange={(event) => setType(event.target.value as typeof type)}>
          <option value="IN">IN</option>
          <option value="OUT">OUT</option>
          <option value="ADJUST">ADJUST</option>
        </select>
        <input type="number" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
        <button type="submit">Apply transaction</button>
      </form>
      {message && <p className="info">{message}</p>}
      <div className="cards">
        {query.data?.items.map((row) => (
          <div className="card" key={String(row.id)}>
            <strong>{String(row.name ?? row.code ?? '')}</strong>
            <span>Stock: {String(row.stock ?? '')} / Min {String(row.minStock ?? '')}</span>
          </div>
        ))}
      </div>
      <h2>Low stock</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Stock</th><th>Min</th></tr></thead>
          <tbody>
            {lowStock.data?.map((row) => (
              <tr key={String(row.id)}><td>{String(row.name)}</td><td>{String(row.stock)}</td><td>{String(row.minStock)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2>Expiring within 30 days</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Expire date</th><th>Stock</th></tr></thead>
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
